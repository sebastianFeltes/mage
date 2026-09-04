import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { createRuntime, runMage } from "../src/loop/metacog";
import { ToolRegistry } from "../src/tools/registry";
import { resetSessionStore } from "../src/session/store";

const tmpFacts = (): string => join(mkdtempSync(join(tmpdir(), "mage-facts-")), "facts.sqlite");

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

const lookupPlan = JSON.stringify({
  thought: "lookup arr",
  confidence: 1,
  assumptions: [],
  toolCalls: [{ tool: "kpi.lookup", input: { name: "arr" }, reason: "kpi" }],
  proposedAnswer: null,
  memoryCandidates: [],
  relationCandidates: [],
});

describe("wedge consultoría", () => {
  test("catalogo del planner no incluye memory.ingest", () => {
    const line = new ToolRegistry().catalogLine();
    expect(line).toContain("kpi.lookup");
    expect(line).toContain("source.cite");
    expect(line).toContain("rule.check");
    expect(line).not.toContain("memory.ingest");
    expect(line).not.toContain("is_palindrome");
  });

  test("wedge_e2e", async () => {
    const prev = process.env.MAGE_STUB_PLAN;
    process.env.MAGE_STUB_PLAN = lookupPlan;
    try {
      const rt = await stubRuntime();
      const { upserted } = rt.facts.ingest({
        tenantId: "default",
        source: "cliente://acme",
        facts: [{ name: "arr", text: "ARR 1.2M USD FY25", value: "1200000" }],
      });
      expect(upserted).toBe(1);

      const result = await runMage("cuál es el ARR", rt);
      expect(result.status).toBe("answered");
      expect(result.answer).toContain("1200000");
      expect(result.evidence[0]?.tool).toBe("kpi.lookup");
      const out = result.evidence[0]?.output as { source?: string; found?: boolean };
      expect(out.source).toBe("cliente://acme");
      expect(out.found).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MAGE_STUB_PLAN;
      else process.env.MAGE_STUB_PLAN = prev;
    }
  });

  test("wedge_sin_semilla", async () => {
    const prev = process.env.MAGE_STUB_PLAN;
    process.env.MAGE_STUB_PLAN = lookupPlan;
    try {
      const rt = await stubRuntime();
      const result = await runMage("cuál es el ARR", rt);
      expect(result.status).toBe("refused");
      expect(result.answer).toBe("");
      expect(result.refusalReason).toBe("not_found");
      const out = result.evidence[0]?.output as { found?: boolean };
      expect(out.found).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MAGE_STUB_PLAN;
      else process.env.MAGE_STUB_PLAN = prev;
    }
  });
});
