import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { createRuntime, runMage } from "../src/loop/metacog";
import { isPositiveEvidence } from "../src/loop/result";
import { SqliteGraphMemory } from "../src/memory/sqlite-graph";
import { startServer } from "../src/server";
import { resetRuntime } from "../src/runtime";
import { resetSessionStore } from "../src/session/store";
import { ToolRegistry } from "../src/tools/registry";
import { ScriptRunner } from "../src/sandbox/script";
import { SandboxError } from "../src/sandbox/runner";

const tmpFacts = (): string => join(mkdtempSync(join(tmpdir(), "mage-holes-")), "facts.sqlite");

const stubRt = async (factsPath = tmpFacts()) => {
  resetSessionStore();
  return createRuntime({
    ...loadConfig(),
    provider: "stub",
    fallbackOllama: false,
    sessionStore: "memory",
    factsPath,
  });
};

describe("agujeros de producto", () => {
  test("catalogo del planner oculta demos y writes", () => {
    const line = new ToolRegistry().catalogLine();
    expect(line).toContain("kpi.lookup");
    expect(line).toContain("calc");
    expect(line).not.toContain("memory.ingest");
    expect(line).not.toContain("count_letter");
    expect(line).not.toContain("is_palindrome");
    expect(line).not.toContain("next_prime");
    expect(line).not.toContain("script.run");
  });

  test("planner no puede dispatch memory.ingest", async () => {
    const rt = await stubRt();
    await expect(
      rt.registry.dispatch(
        "memory.ingest",
        { facts: [{ name: "arr", text: "x", source: "s" }] },
        rt.pool,
        {
          memorySearch: async () => [],
          script: rt.script,
          facts: rt.facts,
          tenantId: "default",
          allowWrite: false,
        },
      ),
    ).rejects.toBeInstanceOf(SandboxError);
    expect(rt.facts.lookup("default", "arr")).toBeNull();
  });

  test("ingest con allowWrite sí escribe", async () => {
    const rt = await stubRt();
    const { output } = await rt.registry.dispatch(
      "memory.ingest",
      { source: "cliente://x", facts: [{ name: "arr", text: "ARR", value: "1" }] },
      rt.pool,
      {
        memorySearch: async () => [],
        script: new ScriptRunner(rt.config),
        facts: rt.facts,
        tenantId: "default",
        allowWrite: true,
      },
    );
    const rec = output as { upserted: number };
    expect(rec.upserted).toBe(1);
    expect(rt.facts.lookup("default", "arr")?.value).toBe("1");
  });

  test("plan que nombra memory.ingest no persiste", async () => {
    const prev = process.env.MAGE_STUB_PLAN;
    process.env.MAGE_STUB_PLAN = JSON.stringify({
      thought: "guardo",
      confidence: 1,
      toolCalls: [
        {
          tool: "memory.ingest",
          input: { source: "evil", facts: [{ name: "pib", text: "999", value: "999" }] },
          reason: "poison",
        },
      ],
      proposedAnswer: "999",
    });
    try {
      const rt = await stubRt();
      const result = await runMage("guarda el PIB 999", rt);
      expect(result.status).toBe("error");
      expect(result.refusalReason).toBe("tool_failed");
      expect(rt.facts.lookup("default", "pib")).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.MAGE_STUB_PLAN;
      else process.env.MAGE_STUB_PLAN = prev;
    }
  });

  test("memory.search vacío no es evidence positiva", () => {
    expect(
      isPositiveEvidence({
        id: "e",
        tool: "memory.search",
        input: { query: "arr" },
        output: { ok: true, hits: [] },
        ms: 1,
      }),
    ).toBe(false);
  });

  test("memory.search no produce answer", async () => {
    const prev = process.env.MAGE_STUB_PLAN;
    process.env.MAGE_STUB_PLAN = JSON.stringify({
      thought: "busco",
      confidence: 1,
      toolCalls: [{ tool: "memory.search", input: { query: "arr" }, reason: "search" }],
      proposedAnswer: "1200000",
    });
    try {
      const rt = await stubRt();
      const result = await runMage("cuál es el ARR", rt);
      expect(result.status).toBe("refused");
      expect(result.answer).toBe("");
    } finally {
      if (prev === undefined) delete process.env.MAGE_STUB_PLAN;
      else process.env.MAGE_STUB_PLAN = prev;
    }
  });

  test("ingest contradicción no pisa", async () => {
    const rt = await stubRt();
    const first = rt.facts.ingest({
      tenantId: "acme",
      source: "cliente://a",
      facts: [{ name: "arr", text: "ARR 1", value: "1" }],
    });
    expect(first.upserted).toBe(1);
    const second = rt.facts.ingest({
      tenantId: "acme",
      source: "cliente://b",
      facts: [{ name: "arr", text: "ARR 2", value: "2" }],
    });
    expect(second.upserted).toBe(0);
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0]?.name).toBe("arr");
    expect(rt.facts.lookup("acme", "arr")?.value).toBe("1");
  });

  test("grafo sqlite aísla tenant", async () => {
    const path = tmpFacts();
    const g = new SqliteGraphMemory({ ...loadConfig(), factsPath: path, graphBackend: "sqlite" });
    await g.connect();
    await g.commit([{ type: "Hecho", name: "arr", props: { text: "secreto acme" } }], [], "acme");
    const acme = await g.search("arr", 8, "acme");
    const globex = await g.search("arr", 8, "globex");
    expect(acme.some((h) => h.text.includes("secreto acme"))).toBe(true);
    expect(globex).toEqual([]);
    await g.close();
  });
});

describe("http idempotency y metrics", () => {
  test("Idempotency-Key rejuega el mismo MageResult", async () => {
    resetRuntime();
    resetSessionStore();
    const server = await startServer({ port: 0, apiKey: null });
    const base = `http://127.0.0.1:${server.port}`;
    const headers = {
      "Content-Type": "application/json",
      "Idempotency-Key": "k-calc-1",
    };
    const body = JSON.stringify({ query: "cuánto es 3+3" });
    const a = await fetch(`${base}/v1/query`, { method: "POST", headers, body });
    const b = await fetch(`${base}/v1/query`, { method: "POST", headers, body });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers.get("Idempotency-Replayed")).toBe("1");
    const ja = (await a.json()) as { answer: string; sessionId?: string };
    const jb = (await b.json()) as { answer: string; sessionId?: string };
    expect(jb.answer).toBe(ja.answer);
    expect(jb.sessionId).toBe(ja.sessionId);
    const health = await fetch(`${base}/health`);
    const h = (await health.json()) as { metrics: { queries: number; answered: number } };
    expect(h.metrics.answered).toBeGreaterThanOrEqual(1);
    server.stop(true);
    resetRuntime();
    resetSessionStore();
  });
});
