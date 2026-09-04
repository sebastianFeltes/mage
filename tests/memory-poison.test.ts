import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { createRuntime, runMage } from "../src/loop/metacog";
import { InMemoryGraphMemory } from "../src/memory/in-memory";
import { resetSessionStore } from "../src/session/store";

const stubPlan = {
  thought: "invento un hecho",
  confidence: 0.99,
  assumptions: [],
  toolCalls: [],
  proposedAnswer: "El PIB es 999",
  memoryCandidates: [{ type: "Hecho", name: "PIB", props: { text: "999" } }],
  relationCandidates: [],
};

export const runPoisonNoWrite = async (): Promise<void> => {
  const prev = process.env.MAGE_STUB_PLAN;
  process.env.MAGE_STUB_PLAN = JSON.stringify(stubPlan);
  const graph = new InMemoryGraphMemory();
  try {
    resetSessionStore();
    const rt = await createRuntime({ ...loadConfig(), provider: "stub", fallbackOllama: false });
    rt.graph = graph;

    const result = await runMage("cuál es el PIB de Francia", rt);
    expect(result.status).toBe("refused");
    expect(result.answer).toBe("");

    const hits = await graph.search("PIB", 8);
    const blob = JSON.stringify(hits);
    expect(blob.includes("999")).toBe(false);
    expect(hits.some((h) => h.name === "PIB")).toBe(false);

    await graph.commit([{ type: "Hecho", name: "PIB", props: { text: "ingest explícito" } }]);
    const after = await graph.search("PIB", 8);
    expect(after.some((h) => h.name === "PIB")).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.MAGE_STUB_PLAN;
    else process.env.MAGE_STUB_PLAN = prev;
  }
};

describe("memory poison", () => {
  test("poison_no_escribe", runPoisonNoWrite);
});
