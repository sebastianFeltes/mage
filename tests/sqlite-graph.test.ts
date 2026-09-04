import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { formatStatusLines } from "../src/cli/shell";
import { createRuntime } from "../src/loop/metacog";
import { GraphMemory } from "../src/memory/graph";
import { createGraphStore, SqliteGraphMemory } from "../src/memory/sqlite-graph";

const tmpFacts = (): string => join(mkdtempSync(join(tmpdir(), "mage-graph-")), "facts.sqlite");

describe("sqlite graph", () => {
  test("seed y search sin Falkor", async () => {
    const factsPath = tmpFacts();
    const g = new SqliteGraphMemory({ ...loadConfig(), factsPath, graphBackend: "sqlite" });
    await g.connect();
    expect(g.backend).toBe("sqlite");
    expect(g.isReady).toBe(true);
    const n = await g.seed();
    expect(n).toBe(3);
    const hits = await g.search("FastPath", 8);
    expect(hits.some((h) => h.name === "FastPath")).toBe(true);
    const neighbors = await g.search("Mage", 8);
    expect(neighbors.some((h) => h.name === "FastPath")).toBe(true);
    await g.close();
  });

  test("createGraphStore default es sqlite", async () => {
    const factsPath = tmpFacts();
    const store = createGraphStore({ ...loadConfig(), factsPath, graphBackend: "sqlite" });
    await store.connect();
    expect(store.backend).toBe("sqlite");
    await store.close();
  });

  test("MAGE_GRAPH=off es off", async () => {
    const store = createGraphStore({ ...loadConfig(), graphBackend: "off" });
    await store.connect();
    expect(store.backend).toBe("off");
    expect(store.isReady).toBe(false);
    expect(await store.search("Mage", 8)).toEqual([]);
  });

  test("Falkor no conecta si MAGE_GRAPH=sqlite", async () => {
    const g = new GraphMemory({ ...loadConfig(), graphBackend: "sqlite" });
    await g.connect();
    expect(g.backend).toBe("off");
    expect(g.isReady).toBe(false);
  });
});

describe("mage status honesto", () => {
  test("graph: sqlite sin Docker", async () => {
    const factsPath = tmpFacts();
    const rt = await createRuntime({
      ...loadConfig(),
      provider: "stub",
      fallbackOllama: false,
      factsPath,
      graphBackend: "sqlite",
      embedProvider: "none",
    });
    const lines = formatStatusLines(rt);
    expect(lines.some((l) => l === "graph: sqlite")).toBe(true);
    expect(lines.some((l) => l === "vectors: none")).toBe(true);
    expect(rt.graph.backend).toBe("sqlite");
    await rt.graph.close();
    rt.facts.close();
  });
});
