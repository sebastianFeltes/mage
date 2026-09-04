import { FalkorDB } from "falkordb";
import type { MageConfig } from "../config";
import type { GraphHit, GraphStore, MemoryCandidate, NodeLabel, RelationCandidate } from "./types";

type GraphClient = {
  query(cypher: string, params?: Record<string, unknown>): Promise<unknown>;
};

export class GraphMemory implements GraphStore {
  private db: FalkorDB | null = null;
  private graph: GraphClient | null = null;
  private ready = false;
  disabledReason: string | null = null;

  constructor(private readonly config: MageConfig) {}

  get backend(): GraphStore["backend"] {
    return this.ready ? "falkor" : "off";
  }

  get isReady(): boolean {
    return this.ready;
  }

  async connect(): Promise<void> {
    if (this.ready) return;
    if (this.config.graphBackend !== "falkor") {
      this.disabledReason = "MAGE_GRAPH!=falkor";
      this.ready = false;
      return;
    }
    try {
      this.db = await FalkorDB.connect({
        socket: {
          host: this.config.falkorHost,
          port: this.config.falkorPort,
          connectTimeout: 400,
        },
      });
      this.graph = this.db.selectGraph(this.config.falkorGraph) as unknown as GraphClient;
      await this.ensureSchema();
      this.ready = true;
    } catch (err) {
      this.disabledReason = err instanceof Error ? err.message : String(err);
      this.ready = false;
    }
  }

  async search(query: string, limit: number, tenantId = "default"): Promise<GraphHit[]> {
    if (!this.ready || !this.graph) return [];
    const tenant = tenantId.trim() || "default";
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const seen = new Map<string, GraphHit>();
    for (const token of tokens) {
      const hits = await this.searchToken(token, limit);
      for (const h of hits) {
        const prev = seen.get(h.name);
        if (!prev || h.score > prev.score) seen.set(h.name, h);
      }
    }

    const base = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    if (base.length === 0) return base;

    const expanded = await this.expandNeighbors(base.slice(0, 3).map((h) => h.name), limit);
    for (const h of expanded) {
      if (!seen.has(h.name)) seen.set(h.name, h);
    }
    return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async commit(
    candidates: MemoryCandidate[],
    relations: RelationCandidate[] = [],
    tenantId = "default",
  ): Promise<void> {
    if (!this.ready || !this.graph) return;
    const tenant = tenantId.trim() || "default";
    const now = Date.now();
    for (const c of candidates) {
      const text = c.props.text ?? c.name;
      try {
        await this.graph.query(
          `MERGE (n:${c.type} {name: $name, tenantId: $tenant})
           SET n.text = $text, n.source = coalesce(n.source, 'mage'), n.updatedAt = $now`,
          { params: { name: c.name, text, now, tenant } },
        );
      } catch {
        // no bloquear la respuesta
      }
    }
    for (const r of relations) {
      try {
        await this.graph.query(
          `MATCH (a {name: $from}), (b {name: $to})
           MERGE (a)-[rel:${r.type}]->(b)
           SET rel.weight = coalesce($weight, rel.weight, 1.0), rel.updatedAt = $now`,
          { params: { from: r.from, to: r.to, weight: r.weight ?? 1, now } },
        );
      } catch {
        // relación opcional
      }
    }
  }

  async seed(): Promise<number> {
    const demo: MemoryCandidate[] = [
      { type: "Entidad", name: "Mage", props: { text: "Motor epistemico determinista en Bun" } },
      { type: "Concepto", name: "FastPath", props: { text: "Respuesta WASM sin LLM" } },
      { type: "Hecho", name: "WasmTimeout", props: { text: "Sandbox limitado a 50ms" } },
    ];
    const rels: RelationCandidate[] = [
      { type: "DEPENDE_DE", from: "Mage", to: "FastPath" },
      { type: "RELACIONADO_CON", from: "Mage", to: "WasmTimeout", weight: 0.9 },
      { type: "PREFIERE", from: "FastPath", to: "WasmTimeout", weight: 0.8 },
    ];
    await this.commit(demo, rels);
    return demo.length;
  }

  private async searchToken(token: string, limit: number): Promise<GraphHit[]> {
    if (!this.graph) return [];
    const cypher = `
      MATCH (n)
      WHERE coalesce(n.tenantId, 'default') = $tenant AND n.name IS NOT NULL AND (
        toLower(n.name) CONTAINS $q
        OR (n.text IS NOT NULL AND toLower(n.text) CONTAINS $q)
      )
      RETURN labels(n)[0] AS label, n.name AS name, coalesce(n.text, n.name) AS text
      LIMIT $limit
    `;
    try {
      const raw = await this.graph.query(cypher, { params: { q: token, limit, tenant } });
      return rows(raw)
        .map((row) => {
          const rec = record(row);
          return {
            label: asLabel(rec.label),
            name: String(rec.name ?? ""),
            text: String(rec.text ?? ""),
            score: token.length > 3 ? 1 : 0.8,
          };
        })
        .filter((h) => h.name);
    } catch {
      return [];
    }
  }

  private async expandNeighbors(names: string[], limit: number): Promise<GraphHit[]> {
    if (!this.graph || names.length === 0) return [];
    const cypher = `
      UNWIND $names AS seedName
      MATCH (n {name: seedName})-[r]-(m)
      WHERE m.name IS NOT NULL
      RETURN labels(m)[0] AS label, m.name AS name, coalesce(m.text, m.name) AS text,
             type(r) AS rel, seedName AS via
      LIMIT $limit
    `;
    try {
      const raw = await this.graph.query(cypher, { params: { names, limit } });
      return rows(raw).map((row) => {
        const rec = record(row);
        return {
          label: asLabel(rec.label),
          name: String(rec.name ?? ""),
          text: String(rec.text ?? ""),
          score: 0.6,
          via: String(rec.via ?? ""),
        };
      });
    } catch {
      return [];
    }
  }

  private async ensureSchema(): Promise<void> {
    if (!this.graph) return;
    const indexes = [
      "CREATE INDEX FOR (n:Entidad) ON (n.name)",
      "CREATE INDEX FOR (n:Concepto) ON (n.name)",
      "CREATE INDEX FOR (n:Hecho) ON (n.name)",
    ];
    for (const q of indexes) {
      try {
        await this.graph.query(q);
      } catch {
        // ya existe
      }
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        await this.db.close();
      } catch {
        // ignore
      }
    }
    this.db = null;
    this.graph = null;
    this.ready = false;
  }
}

const tokenize = (q: string): string[] =>
  q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .slice(0, 4);

const asLabel = (value: unknown): NodeLabel => {
  if (value === "Entidad" || value === "Concepto" || value === "Hecho") return value;
  return "Concepto";
};

const rows = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && "data" in raw && Array.isArray((raw as { data: unknown[] }).data)) {
    return (raw as { data: unknown[] }).data;
  }
  return [];
};

const record = (row: unknown): Record<string, unknown> => {
  if (Array.isArray(row)) {
    return { label: row[0], name: row[1], text: row[2], rel: row[3], via: row[4] };
  }
  if (row && typeof row === "object") return row as Record<string, unknown>;
  return {};
};
