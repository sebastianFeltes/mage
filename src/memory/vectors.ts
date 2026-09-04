import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MageConfig } from "../config";
import { embedText } from "../llm/provider";
import { normalizeTenant } from "../session/compact";
import type { MemoryCandidate, VectorHit } from "./types";

const chunkId = (tenantId: string, name: string): string => `${normalizeTenant(tenantId)}:${name}`;

export class VectorMemory {
  private db: Database | null = null;
  private hasVec = false;
  private embedCache = new Map<string, Float32Array>();

  constructor(private readonly config: MageConfig) {}

  async open(): Promise<void> {
    if (this.db) return;
    mkdirSync(dirname(this.config.vecPath), { recursive: true });
    const db = new Database(this.config.vecPath);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA synchronous=NORMAL");
    db.exec("PRAGMA temp_store=MEMORY");
    db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        embedding BLOB NOT NULL,
        text TEXT NOT NULL
      )
    `);
    this.migrate(db);
    this.db = db;
    try {
      const sqliteVec = await import("sqlite-vec");
      sqliteVec.load(db);
      db.query("select vec_version() as v").get();
      this.hasVec = true;
    } catch {
      this.hasVec = false;
    }
  }

  async search(query: string, k: number, tenantId = "default"): Promise<VectorHit[]> {
    if (!this.db || this.config.embedProvider === "none") return [];
    const tenant = normalizeTenant(tenantId);
    try {
      const qv = await this.embedCached(query);
      const blob = Buffer.from(qv.buffer);
      if (this.hasVec) {
        try {
          const rows = this.db
            .query(
              `SELECT id, text, vec_distance_cosine(embedding, ?) AS dist
               FROM chunks
               WHERE tenant_id = ?
               ORDER BY dist
               LIMIT ?`,
            )
            .all(blob, tenant, k) as { id: string; text: string; dist: number }[];
          return rows.map((r) => ({
            id: r.id,
            text: r.text,
            score: 1 - r.dist,
          }));
        } catch {
          // cosine JS
        }
      }
      return this.jsSearch(qv, k, tenant);
    } catch {
      return [];
    }
  }

  async upsert(candidates: MemoryCandidate[], tenantId = "default"): Promise<void> {
    if (!this.db || candidates.length === 0 || this.config.embedProvider === "none") return;
    const tenant = normalizeTenant(tenantId);
    const stmt = this.db.query(
      `INSERT INTO chunks (id, tenant_id, embedding, text) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET embedding = excluded.embedding, text = excluded.text, tenant_id = excluded.tenant_id`,
    );
    for (const c of candidates) {
      const text = `${c.type}:${c.name} ${c.props.text ?? ""}`.trim();
      const vec = await this.embedCached(text);
      stmt.run(chunkId(tenant, c.name), tenant, Buffer.from(vec.buffer), text);
    }
  }

  private jsSearch(qv: Float32Array, k: number, tenantId: string): VectorHit[] {
    if (!this.db) return [];
    const rows = this.db
      .query(`SELECT id, embedding, text FROM chunks WHERE tenant_id = ?`)
      .all(tenantId) as {
      id: string;
      embedding: Uint8Array | Buffer;
      text: string;
    }[];
    const scored: VectorHit[] = [];
    for (const row of rows) {
      const ev = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        Math.floor(row.embedding.byteLength / 4),
      );
      scored.push({ id: row.id, text: row.text, score: cosine(qv, ev) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  private migrate(db: Database): void {
    const cols = db.query("PRAGMA table_info(chunks)").all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("tenant_id")) {
      db.exec("ALTER TABLE chunks ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'");
      db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_tenant ON chunks(tenant_id)");
    }
  }

  private async embedCached(text: string): Promise<Float32Array> {
    const hit = this.embedCache.get(text);
    if (hit) return hit;
    const vec = await embedText(this.config, text);
    if (this.embedCache.size > 256) this.embedCache.clear();
    this.embedCache.set(text, vec);
    return vec;
  }
}

const cosine = (a: Float32Array, b: Float32Array): number => {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
};
