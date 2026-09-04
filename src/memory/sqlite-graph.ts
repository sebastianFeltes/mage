import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MageConfig } from "../config";
import { GraphMemory } from "./graph";
import type {
  GraphBackend,
  GraphHit,
  GraphStore,
  MemoryCandidate,
  NodeLabel,
  RelationCandidate,
} from "./types";

type NodeRow = { tenant_id: string; name: string; label: string; text: string };

const DEFAULT_GRAPH_TENANT = "default";

/** Grafo local en el mismo SQLite de facts. Default de producto; no requiere Docker. */
export class SqliteGraphMemory implements GraphStore {
  readonly backend: GraphBackend = "sqlite";
  disabledReason: string | null = null;
  private db: Database | null = null;
  private useFts = false;

  constructor(private readonly config: MageConfig) {}

  get isReady(): boolean {
    return this.db !== null;
  }

  async connect(): Promise<void> {
    if (this.db) return;
    mkdirSync(dirname(this.config.factsPath), { recursive: true });
    const db = new Database(this.config.factsPath);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA synchronous=NORMAL");
    db.exec("PRAGMA busy_timeout=5000");
    migrateGraphSchema(db);
    this.useFts = tryFts(db);
    this.db = db;
  }

  async search(query: string, limit: number, tenantId = DEFAULT_GRAPH_TENANT): Promise<GraphHit[]> {
    if (!this.db) return [];
    const tenant = tenantId.trim() || DEFAULT_GRAPH_TENANT;
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const seen = new Map<string, GraphHit>();
    for (const token of tokens) {
      for (const h of this.searchToken(token, limit, tenant)) {
        const prev = seen.get(h.name);
        if (!prev || h.score > prev.score) seen.set(h.name, h);
      }
    }
    const base = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    if (base.length === 0) return base;
    for (const h of this.expandNeighbors(base.slice(0, 3).map((x) => x.name), limit, tenant)) {
      if (!seen.has(h.name)) seen.set(h.name, h);
    }
    return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async commit(
    candidates: MemoryCandidate[],
    relations: RelationCandidate[] = [],
    tenantId = DEFAULT_GRAPH_TENANT,
  ): Promise<void> {
    if (!this.db) return;
    const tenant = tenantId.trim() || DEFAULT_GRAPH_TENANT;
    const now = Date.now();
    const nodeStmt = this.db.query(
      `INSERT INTO graph_nodes (tenant_id, name, label, text, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, name) DO UPDATE SET label = excluded.label, text = excluded.text, updated_at = excluded.updated_at`,
    );
    const edgeStmt = this.db.query(
      `INSERT INTO graph_edges (tenant_id, from_name, to_name, type, weight, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, from_name, to_name, type) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at`,
    );
    for (const c of candidates) {
      const text = c.props.text ?? c.name;
      nodeStmt.run(tenant, c.name, c.type, text, now);
      if (this.useFts) this.upsertFts(tenant, c.name, text);
    }
    for (const r of relations) {
      edgeStmt.run(tenant, r.from, r.to, r.type, r.weight ?? 1, now);
    }
  }

  async seed(tenantId = DEFAULT_GRAPH_TENANT): Promise<number> {
    const demo: MemoryCandidate[] = [
      { type: "Entidad", name: "Mage", props: { text: "Motor metacognitivo en Bun" } },
      { type: "Concepto", name: "FastPath", props: { text: "Respuesta WASM sin LLM" } },
      { type: "Hecho", name: "WasmTimeout", props: { text: "Sandbox limitado a 50ms" } },
    ];
    await this.commit(demo, [
      { type: "DEPENDE_DE", from: "Mage", to: "FastPath" },
      { type: "RELACIONADO_CON", from: "Mage", to: "WasmTimeout", weight: 0.9 },
      { type: "PREFIERE", from: "FastPath", to: "WasmTimeout", weight: 0.8 },
    ], tenantId);
    return demo.length;
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private searchToken(token: string, limit: number, tenant: string): GraphHit[] {
    if (!this.db) return [];
    const score = token.length > 3 ? 1 : 0.8;
    if (this.useFts) {
      const ftsHits = this.searchFts(token, limit, tenant);
      if (ftsHits.length > 0) return ftsHits.map((h) => ({ ...h, score }));
    }
    const like = `%${escapeLike(token)}%`;
    const rows = this.db
      .query(
        `SELECT tenant_id, name, label, text FROM graph_nodes
         WHERE tenant_id = ?
           AND (lower(name) LIKE ? ESCAPE '\\' OR lower(text) LIKE ? ESCAPE '\\')
         LIMIT ?`,
      )
      .all(tenant, like, like, limit) as NodeRow[];
    return rows.map((r) => ({
      label: asLabel(r.label),
      name: r.name,
      text: r.text,
      score,
    }));
  }

  private searchFts(token: string, limit: number, tenant: string): GraphHit[] {
    if (!this.db) return [];
    const q = ftsQuery(token);
    if (!q) return [];
    try {
      const rows = this.db
        .query(
          `SELECT n.tenant_id, n.name, n.label, n.text
           FROM graph_fts f
           JOIN graph_nodes n ON n.tenant_id = f.tenant_id AND n.name = f.name
           WHERE f.tenant_id = ? AND graph_fts MATCH ?
           LIMIT ?`,
        )
        .all(tenant, q, limit) as NodeRow[];
      return rows.map((r) => ({
        label: asLabel(r.label),
        name: r.name,
        text: r.text,
        score: 1,
      }));
    } catch {
      return [];
    }
  }

  private upsertFts(tenant: string, name: string, text: string): void {
    if (!this.db) return;
    this.db.query(`DELETE FROM graph_fts WHERE tenant_id = ? AND name = ?`).run(tenant, name);
    this.db.query(`INSERT INTO graph_fts (tenant_id, name, text) VALUES (?, ?, ?)`).run(tenant, name, text);
  }

  private expandNeighbors(names: string[], limit: number, tenant: string): GraphHit[] {
    if (!this.db || names.length === 0) return [];
    const placeholders = names.map(() => "?").join(",");
    const rows = this.db
      .query(
        `SELECT n.tenant_id, n.name, n.label, n.text, e.from_name AS via
         FROM graph_edges e
         JOIN graph_nodes n ON n.tenant_id = e.tenant_id AND n.name = e.to_name
         WHERE e.tenant_id = ? AND e.from_name IN (${placeholders})
         UNION
         SELECT n.tenant_id, n.name, n.label, n.text, e.to_name AS via
         FROM graph_edges e
         JOIN graph_nodes n ON n.tenant_id = e.tenant_id AND n.name = e.from_name
         WHERE e.tenant_id = ? AND e.to_name IN (${placeholders})
         LIMIT ?`,
      )
      .all(tenant, ...names, tenant, ...names, limit) as (NodeRow & { via: string })[];
    return rows.map((r) => ({
      label: asLabel(r.label),
      name: r.name,
      text: r.text,
      score: 0.6,
      via: r.via,
    }));
  }
}

export class OffGraphMemory implements GraphStore {
  readonly backend: GraphBackend = "off";
  readonly isReady = false;

  constructor(readonly disabledReason: string | null) {}

  async connect(): Promise<void> {}
  async search(): Promise<GraphHit[]> {
    return [];
  }
  async commit(): Promise<void> {}
  async seed(): Promise<number> {
    return 0;
  }
  async close(): Promise<void> {}
}

export const createGraphStore = (config: MageConfig): GraphStore => {
  if (config.graphBackend === "off") return new OffGraphMemory("MAGE_GRAPH=off");
  if (config.graphBackend === "falkor") return new GraphMemory(config);
  return new SqliteGraphMemory(config);
};

const tryFts = (db: Database): boolean => {
  try {
    const info = db.query(`PRAGMA table_info(graph_fts)`).all() as { name: string }[];
    if (info.length > 0 && !info.some((c) => c.name === "tenant_id")) {
      db.exec(`DROP TABLE graph_fts`);
    }
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS graph_fts USING fts5(tenant_id, name, text)`);
    return true;
  } catch {
    return false;
  }
};

const migrateGraphSchema = (db: Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, name)
    );
    CREATE TABLE IF NOT EXISTS graph_edges (
      tenant_id TEXT NOT NULL,
      from_name TEXT NOT NULL,
      to_name TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, from_name, to_name, type)
    );
  `);

  const nodeCols = db.query(`PRAGMA table_info(graph_nodes)`).all() as { name: string }[];
  const hasTenant = nodeCols.some((c) => c.name === "tenant_id");
  if (hasTenant || nodeCols.length === 0) return;

  db.exec(`ALTER TABLE graph_nodes RENAME TO graph_nodes_legacy`);
  db.exec(`ALTER TABLE graph_edges RENAME TO graph_edges_legacy`);
  db.exec(`
    CREATE TABLE graph_nodes (
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, name)
    );
    CREATE TABLE graph_edges (
      tenant_id TEXT NOT NULL,
      from_name TEXT NOT NULL,
      to_name TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, from_name, to_name, type)
    );
    INSERT INTO graph_nodes (tenant_id, name, label, text, updated_at)
      SELECT 'default', name, label, text, updated_at FROM graph_nodes_legacy;
    INSERT INTO graph_edges (tenant_id, from_name, to_name, type, weight, updated_at)
      SELECT 'default', from_name, to_name, type, weight, updated_at FROM graph_edges_legacy;
    DROP TABLE graph_nodes_legacy;
    DROP TABLE graph_edges_legacy;
    DROP TABLE IF EXISTS graph_fts;
  `);
};

const tokenize = (q: string): string[] =>
  q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .slice(0, 4);

const escapeLike = (s: string): string => s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

const ftsQuery = (token: string): string | null => {
  const clean = token.replace(/["'*()]/g, "").trim();
  return clean.length > 1 ? `"${clean}"` : null;
};

const asLabel = (value: unknown): NodeLabel => {
  if (value === "Entidad" || value === "Concepto" || value === "Hecho") return value;
  return "Concepto";
};
