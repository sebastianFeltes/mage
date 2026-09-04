import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { createRuntime, runMage } from "../../src/loop/metacog";
import { resetSessionStore } from "../../src/session/store";

describe("eval_grounded", () => {
  test("ingest + kpi.lookup responde con valor y source", async () => {
    const prev = process.env.MAGE_STUB_PLAN;
    process.env.MAGE_STUB_PLAN = JSON.stringify({
      thought: "lookup",
      confidence: 1,
      toolCalls: [{ tool: "kpi.lookup", input: { name: "arr" }, reason: "kpi" }],
      proposedAnswer: "999",
    });
    try {
      resetSessionStore();
      const rt = await createRuntime({
        ...loadConfig(),
        provider: "stub",
        fallbackOllama: false,
        sessionStore: "memory",
        factsPath: join(mkdtempSync(join(tmpdir(), "mage-eval-facts-")), "facts.sqlite"),
      });
      rt.facts.ingest({
        source: "cliente://acme",
        facts: [{ name: "arr", text: "ARR", value: "1200000" }],
      });
      const result = await runMage("cuál es el ARR", rt);
      expect(result.status).toBe("answered");
      expect(result.answer).toContain("1200000");
      expect(result.answer).not.toContain("999");
      expect((result.evidence[0]?.output as { source: string }).source).toBe("cliente://acme");
    } finally {
      if (prev === undefined) delete process.env.MAGE_STUB_PLAN;
      else process.env.MAGE_STUB_PLAN = prev;
    }
  });
});
