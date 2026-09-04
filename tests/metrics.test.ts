import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { createRuntime, runMage } from "../src/loop/metacog";
import {
  computeSnapshot,
  recordResult,
  resetMetrics,
  snapshotMetrics,
  type MageMetrics,
} from "../src/loop/metrics";
import type { MageResult, MageTimings } from "../src/loop/result";
import type { Plan } from "../src/llm/schemas";
import { resetRuntime } from "../src/runtime";
import { startServer } from "../src/server";
import { resetSessionStore } from "../src/session/store";

const tmpFacts = (): string => join(mkdtempSync(join(tmpdir(), "mage-metrics-")), "facts.sqlite");

const stubRuntime = async () => {
  resetSessionStore();
  return createRuntime({
    ...loadConfig(),
    provider: "stub",
    fallbackOllama: false,
    sessionStore: "memory",
    factsPath: tmpFacts(),
  });
};

const emptyPlan = (): Plan => ({
  thought: "stub",
  confidence: 0,
  assumptions: [],
  toolCalls: [],
  proposedAnswer: null,
  memoryCandidates: [],
  relationCandidates: [],
});

const timings = (over: Partial<MageTimings> = {}): MageTimings => ({
  bootMs: 0,
  enrichMs: 0,
  planMs: 0,
  sandboxMs: 0,
  totalMs: 0,
  attempts: 1,
  usedReasonModel: false,
  ...over,
});

const fakeResult = (over: Partial<MageResult> = {}): MageResult => ({
  status: "refused",
  answer: "",
  evidence: [],
  plan: emptyPlan(),
  timings: timings(),
  ...over,
});

const withStubPlan = async <T>(plan: unknown, fn: () => Promise<T>): Promise<T> => {
  const prev = process.env.MAGE_STUB_PLAN;
  process.env.MAGE_STUB_PLAN = JSON.stringify(plan);
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.MAGE_STUB_PLAN;
    else process.env.MAGE_STUB_PLAN = prev;
  }
};

describe("ola 11 métricas", () => {
  test("metrics_fastpath_no_ensucia_planMs", async () => {
    resetMetrics();
    const rt = await stubRuntime();
    await runMage("(12+8)*3", rt);
    const snap = rt.metrics.snapshot();
    expect(snap.answered).toBe(1);
    expect(snap.planMs.length).toBe(0);
    expect(snap.planMsP50).toBeNull();
    expect(snap.rotting).toBe(false);
  });

  test("metrics_refused_sin_evidence", async () => {
    resetMetrics();
    await withStubPlan(
      {
        thought: "no sé",
        confidence: 0.9,
        toolCalls: [],
        proposedAnswer: "El PIB es 3000",
      },
      async () => {
        const rt = await stubRuntime();
        await runMage("cuál es el PIB de Francia", rt);
        const snap = rt.metrics.snapshot();
        expect(snap.refused).toBe(1);
        expect(snap.withPositiveEvidence).toBe(0);
        expect(snap.refusedRate).toBe(1);
        expect(snap.rotting).toBe(false);
      },
    );
  });

  test("metrics_answered_con_kpi", async () => {
    resetMetrics();
    await withStubPlan(
      {
        thought: "lookup arr",
        confidence: 1,
        toolCalls: [{ tool: "kpi.lookup", input: { name: "arr" }, reason: "kpi" }],
        proposedAnswer: null,
      },
      async () => {
        const rt = await stubRuntime();
        rt.facts.ingest({
          tenantId: "default",
          source: "cliente://acme",
          facts: [{ name: "arr", text: "ARR 1.2M USD FY25", value: "1200000" }],
        });
        await runMage("cuál es el ARR", rt);
        const snap = rt.metrics.snapshot();
        expect(snap.answered).toBe(1);
        expect(snap.withPositiveEvidence).toBe(1);
        expect(snap.answeredRate).toBe(snap.positiveEvidenceRate);
        expect(snap.rotting).toBe(false);
      },
    );
  });

  test("metrics_planMs_percentiles", () => {
    resetMetrics();
    for (const planMs of [10, 20, 100]) {
      recordResult(fakeResult({ timings: timings({ planMs }) }));
    }
    const snap = snapshotMetrics();
    expect(typeof snap.planMsP50).toBe("number");
    expect(typeof snap.planMsP95).toBe("number");
    expect(Number.isFinite(snap.planMsP50)).toBe(true);
    expect(Number.isFinite(snap.planMsP95)).toBe(true);
    expect(snap.planMsP95!).toBeGreaterThanOrEqual(snap.planMsP50!);
  });

  test("metrics_tool_error", () => {
    resetMetrics();
    recordResult(fakeResult(), { toolError: true });
    const snap = snapshotMetrics();
    expect(snap.toolErrors).toBe(1);
    expect(snap.toolErrorRate).toBeGreaterThan(0);
  });

  test("metrics_rotting_detecta_invariante_rota", () => {
    const state: MageMetrics = {
      queries: 2,
      answered: 2,
      refused: 0,
      errors: 0,
      toolErrors: 0,
      withEvidence: 2,
      withPositiveEvidence: 1,
      attemptsSum: 2,
      planMs: [],
    };
    const snap = computeSnapshot(state);
    expect(snap.rotting).toBe(true);
    expect(snap.answeredRate).toBeGreaterThan(snap.positiveEvidenceRate);
  });

  test("health_expone_snapshot", async () => {
    resetRuntime();
    resetSessionStore();
    const server = await startServer({ port: 0, apiKey: null });
    try {
      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(health.ok).toBe(true);
      const body = (await health.json()) as {
        metrics: { refusedRate: unknown; rotting: unknown; toolErrorRate: unknown; planMsP50: unknown };
      };
      expect(typeof body.metrics.refusedRate).toBe("number");
      expect(typeof body.metrics.rotting).toBe("boolean");
      expect(typeof body.metrics.toolErrorRate).toBe("number");
    } finally {
      server.stop(true);
      resetRuntime();
      resetSessionStore();
    }
  });
});
