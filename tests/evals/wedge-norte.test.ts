import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/config";
import { createRuntime, runMage, type MageRuntime } from "../../src/loop/metacog";
import { parseIngestJson } from "../../src/memory/ingest";
import { resetSessionStore } from "../../src/session/store";
import type { ToolCall } from "../../src/llm/schemas";

const FACTS_PATH = resolve(import.meta.dir, "../../examples/consultora-norte/facts.json");
const TENANT = "norte";
const SOURCE = "cliente://norte/fy26";

const stubRuntime = async (): Promise<MageRuntime> => {
  resetSessionStore();
  return createRuntime({
    ...loadConfig(),
    provider: "stub",
    fallbackOllama: false,
    sessionStore: "memory",
    factsPath: join(mkdtempSync(join(tmpdir(), "mage-norte-")), "facts.sqlite"),
  });
};

const ingestNorte = async (rt: MageRuntime): Promise<void> => {
  const raw = (await Bun.file(FACTS_PATH).json()) as unknown;
  const req = parseIngestJson(raw);
  expect(req.tenantId).toBe(TENANT);
  expect(req.source).toBe(SOURCE);
  expect(req.facts.length).toBe(10);
  const { upserted } = rt.facts.ingest(req);
  expect(upserted).toBe(10);
};

const withStubPlan = async <T>(
  toolCalls: ToolCall[],
  proposedAnswer: string | null,
  fn: () => Promise<T>,
): Promise<T> => {
  const prev = process.env.MAGE_STUB_PLAN;
  process.env.MAGE_STUB_PLAN = JSON.stringify({
    thought: "stub",
    confidence: 1,
    toolCalls,
    proposedAnswer,
  });
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.MAGE_STUB_PLAN;
    else process.env.MAGE_STUB_PLAN = prev;
  }
};

const ask = (
  rt: MageRuntime,
  query: string,
  toolCalls: ToolCall[],
  proposedAnswer: string | null = null,
) => withStubPlan(toolCalls, proposedAnswer, () => runMage(query, rt, { tenantId: TENANT }));

const lookup = (name: string): ToolCall[] => [
  { tool: "kpi.lookup", input: { name }, reason: "kpi" },
];

describe("eval_wedge_norte", () => {
  test("ingest + batería stub mide answered vs evidence positiva", async () => {
    const rt = await stubRuntime();
    await ingestNorte(rt);

    const oee = await ask(rt, "cuál es el OEE", lookup("oee"));
    expect(oee.status).toBe("answered");
    expect(oee.answer).toContain("0.74");
    expect((oee.evidence[0]?.output as { source?: string }).source).toBe(SOURCE);

    const scrap = await ask(rt, "fuente del scrap", [
      { tool: "source.cite", input: { name: "scrap" }, reason: "cite" },
    ]);
    expect(scrap.status).toBe("answered");
    expect(scrap.answer).toContain(SOURCE);

    const rule = await ask(rt, "rule oee >= 0.80", [
      { tool: "rule.check", input: { name: "oee", op: "gte", value: "0.80" }, reason: "rule" },
    ]);
    expect(rule.status).toBe("answered");
    const ruleOut = rule.evidence[0]?.output as { passed?: boolean };
    expect(ruleOut.passed).toBe(false);

    const backlog = await ask(rt, "cuál es el backlog", lookup("backlog"));
    expect(backlog.status).toBe("answered");
    expect(backlog.answer).toContain("2100000");

    const pib = await ask(rt, "cuál es el PIB de Francia", []);
    expect(pib.status).toBe("refused");
    expect(pib.answer).toBe("");
    expect(/\d/.test(pib.answer)).toBe(false);
    expect(pib.answer).not.toContain(oee.answer);
    expect(pib.answer).not.toContain(backlog.answer);
    expect(pib.answer).not.toContain("0.74");
    expect(pib.answer).not.toContain("2100000");

    const arr = await ask(rt, "cuál es el ARR", lookup("arr"));
    expect(arr.status).toBe("refused");
    expect(arr.refusalReason).toBe("not_found");

    const poisoned = await ask(rt, "cuál es el OEE", lookup("oee"), "999");
    expect(poisoned.status).toBe("answered");
    expect(poisoned.answer).not.toBe("999");
    expect(poisoned.answer).toContain("0.74");

    const foo = await ask(rt, "lookup nombre inventado fooKpi", lookup("fooKpi"));
    expect(foo.status).toBe("refused");

    const snap = rt.metrics.snapshot();
    expect(snap.rotting).toBe(false);
    expect(snap.answeredRate).toBeLessThanOrEqual(snap.positiveEvidenceRate + 1e-9);
    expect(snap.refused).toBeGreaterThanOrEqual(1);
    expect(snap.answered).toBeGreaterThanOrEqual(1);
  });

  test.skipIf(!process.env.MAGE_EVAL_LLM)("wedge_norte_llm_opcional", async () => {
    resetSessionStore();
    const rt = await createRuntime({
      ...loadConfig(),
      sessionStore: "memory",
      factsPath: join(mkdtempSync(join(tmpdir(), "mage-norte-llm-")), "facts.sqlite"),
    });
    await ingestNorte(rt);
    const pib = await runMage("cuál es el PIB de Francia", rt, { tenantId: TENANT });
    expect(pib.status).toBe("refused");
    expect(/\d/.test(pib.answer)).toBe(false);
    await runMage("cuál es el OEE", rt, { tenantId: TENANT });
    expect(rt.metrics.snapshot().rotting).toBe(false);
  });
});
