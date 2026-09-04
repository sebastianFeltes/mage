import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { createRuntime, runMage } from "../src/loop/metacog";
import { getSessionStore, resetSessionStore } from "../src/session/store";

const tmpFacts = (): string => join(mkdtempSync(join(tmpdir(), "mage-tenant-")), "facts.sqlite");

const lookupPlan = JSON.stringify({
  thought: "lookup arr",
  confidence: 1,
  assumptions: [],
  toolCalls: [{ tool: "kpi.lookup", input: { name: "arr" }, reason: "kpi" }],
  proposedAnswer: null,
  memoryCandidates: [],
  relationCandidates: [],
});

describe("tenant isolation", () => {
  test("tenant B no ve facts de A", async () => {
    const prev = process.env.MAGE_STUB_PLAN;
    process.env.MAGE_STUB_PLAN = lookupPlan;
    resetSessionStore();
    try {
      const rt = await createRuntime({
        ...loadConfig(),
        provider: "stub",
        fallbackOllama: false,
        sessionStore: "memory",
        factsPath: tmpFacts(),
      });
      rt.facts.ingest({
        tenantId: "acme",
        source: "cliente://acme",
        facts: [{ name: "arr", text: "ARR acme", value: "1200000" }],
      });

      const asAcme = await runMage("cuál es el ARR", rt, { tenantId: "acme" });
      expect(asAcme.status).toBe("answered");
      expect(asAcme.answer).toContain("1200000");
      expect(asAcme.tenantId).toBe("acme");

      const asGlobex = await runMage("cuál es el ARR", rt, { tenantId: "globex" });
      expect(asGlobex.status).toBe("refused");
      expect(asGlobex.answer).toBe("");
      expect(asGlobex.refusalReason).toBe("not_found");
      expect(rt.facts.lookup("globex", "arr")).toBeNull();
      expect(rt.facts.search("globex", "arr")).toHaveLength(0);
      expect(rt.facts.search("acme", "arr").some((f) => f.value === "1200000")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.MAGE_STUB_PLAN;
      else process.env.MAGE_STUB_PLAN = prev;
      resetSessionStore();
    }
  });

  test("sesión de A no es visible para B", async () => {
    resetSessionStore();
    const rt = await createRuntime({
      ...loadConfig(),
      provider: "stub",
      fallbackOllama: false,
      sessionStore: "memory",
      factsPath: tmpFacts(),
    });
    const store = getSessionStore(rt.config);
    const a = store.create({ tenantId: "acme" });
    store.append(a.id, "user", "secreto de acme");
    expect(store.get(a.id, "acme")?.turns[0]?.content).toBe("secreto de acme");
    expect(store.get(a.id, "globex")).toBeNull();
    expect(store.list("globex")).not.toContain(a.id);
    expect(store.list("acme")).toContain(a.id);
    resetSessionStore();
  });

  test("historial largo compacta a K turnos + summary", async () => {
    resetSessionStore();
    const rt = await createRuntime({
      ...loadConfig(),
      provider: "stub",
      fallbackOllama: false,
      sessionStore: "memory",
      sessionMaxTurns: 8,
      factsPath: tmpFacts(),
    });
    let sessionId: string | undefined;
    for (let i = 0; i < 8; i++) {
      const r = await runMage("cuánto es 1+1", rt, { sessionId, tenantId: "acme" });
      sessionId = r.sessionId;
    }
    const store = getSessionStore(rt.config);
    const sess = store.get(sessionId!, "acme");
    expect(sess).toBeTruthy();
    expect(sess!.turns.length).toBeLessThanOrEqual(8);
    expect(sess!.turns.length).toBeGreaterThan(0);
    expect(sess!.summary?.lastStatus).toBe("answered");
    resetSessionStore();
  });
});
