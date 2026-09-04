import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { mage } from "../src/index";
import { createRuntime, runMage } from "../src/loop/metacog";
import { finalizeResult, type Evidence, type MageTimings } from "../src/loop/result";
import type { Plan } from "../src/llm/schemas";
import { resetSessionStore } from "../src/session/store";

const stubRuntime = () => createRuntime({ ...loadConfig(), provider: "stub", fallbackOllama: false });

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

const plan = (over: Partial<Plan> = {}): Plan => ({
  thought: "stub",
  confidence: 0.99,
  assumptions: [],
  toolCalls: [],
  proposedAnswer: "El PIB es 3000 mil millones",
  memoryCandidates: [],
  relationCandidates: [],
  ...over,
});

describe("invariantes ola 1", () => {
  test("refuse_pregunta_abierta", async () => {
    resetSessionStore();
    const rt = await stubRuntime();
    const result = await runMage("cuál es el PIB de Francia", rt);
    expect(result.status).toBe("refused");
    expect(result.answer).toBe("");
    expect(/\d/.test(result.answer)).toBe(false);
    expect(result.refusalReason).toBe("no_evidence");
    expect(result.evidence).toEqual([]);
  });

  test("fastpath_calc_sigue_answered", async () => {
    resetSessionStore();
    const rt = await stubRuntime();
    const result = await runMage("cuánto es (12+8)*3", rt);
    expect(result.status).toBe("answered");
    expect(result.answer).toBe("60");
    expect(result.evidence[0]?.tool).toBe("calc");
  });

  test("planOnly_no_es_answer", async () => {
    resetSessionStore();
    const rt = await stubRuntime();
    const result = await mage("cuál es el PIB de Francia", { planOnly: true, runtime: rt });
    expect(result.status).toBe("refused");
    expect(result.answer).toBe("");
    expect(result.evidence).toEqual([]);
  });

  test("confidence_no_habilita_answer", async () => {
    const prev = process.env.MAGE_STUB_PLAN;
    process.env.MAGE_STUB_PLAN = JSON.stringify({
      thought: "adivino",
      confidence: 0.99,
      toolCalls: [],
      proposedAnswer: "El PIB es 3000",
    });
    try {
      resetSessionStore();
      const rt = await stubRuntime();
      const result = await runMage("cuál es el PIB de Francia", rt);
      expect(result.status).toBe("refused");
      expect(result.answer).toBe("");
      expect(result.answer.includes("3000")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MAGE_STUB_PLAN;
      else process.env.MAGE_STUB_PLAN = prev;
    }
  });
});

describe("finalizeResult", () => {
  test("cero evidence → refused", () => {
    const r = finalizeResult({ plan: plan(), evidence: [], draft: "42", timings: timings() });
    expect(r.status).toBe("refused");
    expect(r.answer).toBe("");
    expect(r.refusalReason).toBe("no_evidence");
  });

  test("draft sucio no pisa evidence válida", () => {
    const evidence: Evidence[] = [
      {
        id: "e1",
        tool: "calc",
        input: { expr: "0.1+0.2" },
        output: { ok: true, value: 0.3 },
        ms: 1,
      },
    ];
    const r = finalizeResult({
      plan: plan({ proposedAnswer: "el resultado es 999" }),
      evidence,
      draft: "el resultado es 999",
      timings: timings(),
    });
    expect(r.status).toBe("answered");
    expect(r.answer).toBe("0.3");
  });
});
