import type { MageConfig } from "../config";
import type { GraphHit, HybridHit, VectorHit } from "./types";
import type { VectorMemory } from "./vectors";

type GraphSearch = {
  search(query: string, limit: number, tenantId?: string): Promise<GraphHit[]>;
};

export class HybridMemory {
  constructor(
    private readonly config: MageConfig,
    private readonly graph: GraphSearch,
    private readonly vectors: VectorMemory,
  ) {}

  async search(query: string, tenantId = "default"): Promise<HybridHit[]> {
    const budget = this.config.enrichBudgetMs;
    const graphP = withBudget(this.graph.search(query, this.config.graphLimit, tenantId), budget, []);
    const vecP =
      this.config.embedProvider === "none"
        ? Promise.resolve([] as VectorHit[])
        : withBudget(this.vectors.search(query, this.config.vectorTopK, tenantId), budget, []);
    const [graphHits, vecHits] = await Promise.all([graphP, vecP]);

    const out: HybridHit[] = [];
    const seen = new Set<string>();
    for (const g of graphHits) {
      const key = g.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ source: "graph", name: g.name, text: `${g.label}:${g.name} ${g.text}`, score: g.score });
    }
    for (const v of vecHits) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push({ source: "vector", name: v.id, text: v.text, score: v.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, this.config.graphLimit);
  }

  toPromptChunks(hits: HybridHit[]): string[] {
    return hits.map((h) => `- [${h.source}] ${h.text}`.slice(0, 240));
  }
}

const withBudget = async <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
};
