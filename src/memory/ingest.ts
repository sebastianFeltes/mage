import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MageConfig } from "../config";
import { FactInputSchema } from "../llm/schemas";

export type FactVerifiedBy = "ingest" | "human" | "tool";

export type Fact = {
  id: string;
  tenantId: string;
  name: string;
  text: string;
  value?: string;
  source: string;
  verifiedBy: FactVerifiedBy;
  createdAt: number;
  expiresAt?: number;
};

export type FactInput = {
  name: string;
  text: string;
  value?: string;
  source?: string;
  verifiedBy?: FactVerifiedBy;
  expiresAt?: number;
  id?: string;
  tenantId?: string;
};

export type IngestRequest = {
  tenantId?: string;
  source?: string;
  facts: FactInput[];
};

export type FactConflict = {
  name: string;
  reason: string;
  existingValue?: string;
  incomingValue?: string;
};

export type IngestResult = {
  upserted: number;
  conflicts: FactConflict[];
};

type FactRow = {
  id: string;
  tenant_id: string;
  name: string;
  text: string;
  value: string | null;
  source: string;
  verified_by: string;
  created_at: number;
  expires_at: number | null;
};

const DEFAULT_TENANT = "default";

export class FactStore {
  private readonly db: Database;
  readonly path: string;

  constructor(config: MageConfig) {
    this.path = config.factsPath;
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new Database(this.path);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA synchronous=NORMAL");
    this.db.exec("PRAGMA busy_timeout=5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        value TEXT,
        source TEXT NOT NULL,
        verified_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        UNIQUE(tenant_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_facts_tenant_name ON facts(tenant_id, name);
    `);
  }

  ingest(req: IngestRequest): IngestResult {
    const tenantId = req.tenantId?.trim() || DEFAULT_TENANT;
    const defaultSource = req.source?.trim() || "";
    let upserted = 0;
    const conflicts: FactConflict[] = [];
    const now = Date.now();
    const insert = this.db.query(
      `INSERT INTO facts (id, tenant_id, name, text, value, source, verified_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const update = this.db.query(
      `UPDATE facts SET text = ?, value = ?, source = ?, verified_by = ?, expires_at = ?
       WHERE tenant_id = ? AND name = ?`,
    );

    for (const raw of req.facts) {
      const parsed = FactInputSchema.safeParse(raw);
      if (!parsed.success) continue;
      const f = parsed.data;
      const source = (f.source ?? defaultSource).trim();
      if (!source) continue;
      const rowTenant = f.tenantId?.trim() || tenantId;
      const incomingValue = f.value;
      const row = this.getRow(rowTenant, f.name);
      const existing = row ? toFact(row) : null;
      if (existing && !expired(existing)) {
        const same =
          existing.text === f.text &&
          (existing.value ?? undefined) === (incomingValue ?? undefined) &&
          existing.source === source;
        if (same) continue;
        conflicts.push({
          name: f.name,
          reason: "contradiction",
          existingValue: existing.value,
          incomingValue,
        });
        continue;
      }
      if (existing) {
        update.run(
          f.text,
          incomingValue ?? null,
          source,
          f.verifiedBy ?? "ingest",
          f.expiresAt ?? null,
          rowTenant,
          f.name,
        );
        upserted++;
        continue;
      }
      insert.run(
        f.id ?? randomUUID(),
        rowTenant,
        f.name,
        f.text,
        incomingValue ?? null,
        source,
        f.verifiedBy ?? "ingest",
        now,
        f.expiresAt ?? null,
      );
      upserted++;
    }
    return { upserted, conflicts };
  }

  lookup(tenantId: string, name: string): Fact | null {
    const row = this.getRow(tenantId, name);
    if (!row) return null;
    const fact = toFact(row);
    if (expired(fact)) return null;
    return fact;
  }

  private getRow(tenantId: string, name: string): FactRow | null {
    const row = this.db
      .query(
        `SELECT id, tenant_id, name, text, value, source, verified_by, created_at, expires_at
         FROM facts WHERE tenant_id = ? AND name = ?`,
      )
      .get(tenantId, name) as FactRow | null | undefined;
    return row ?? null;
  }

  listForPrompt(tenantId: string, limit = 12): Fact[] {
    const rows = this.db
      .query(
        `SELECT id, tenant_id, name, text, value, source, verified_by, created_at, expires_at
         FROM facts WHERE tenant_id = ? AND source != ''
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(tenantId, limit) as FactRow[];
    return rows.map(toFact).filter((f) => f.source && !expired(f));
  }

  search(tenantId: string, query: string, limit = 8): Fact[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const like = `%${q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    const rows = this.db
      .query(
        `SELECT id, tenant_id, name, text, value, source, verified_by, created_at, expires_at
         FROM facts
         WHERE tenant_id = ? AND source != ''
           AND (lower(name) LIKE ? ESCAPE '\\' OR lower(text) LIKE ? ESCAPE '\\')
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(tenantId, like, like, limit) as FactRow[];
    return rows.map(toFact).filter((f) => f.source && !expired(f));
  }

  promptChunks(tenantId: string): string[] {
    return this.listForPrompt(tenantId).map((f) => {
      const val = f.value ? ` value=${f.value}` : "";
      return `- [fact] ${f.name}${val} ${f.text} (source:${f.source})`.slice(0, 240);
    });
  }

  close(): void {
    this.db.close();
  }
}

export const DEFAULT_FACT_TENANT = DEFAULT_TENANT;

export const parseIngestJson = (raw: unknown): IngestRequest => {
  if (Array.isArray(raw)) {
    return { facts: raw as FactInput[] };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const facts = Array.isArray(o.facts) ? (o.facts as FactInput[]) : [];
    return {
      tenantId: typeof o.tenantId === "string" ? o.tenantId : undefined,
      source: typeof o.source === "string" ? o.source : undefined,
      facts,
    };
  }
  return { facts: [] };
};

const toFact = (row: FactRow): Fact => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  text: row.text,
  value: row.value ?? undefined,
  source: row.source,
  verifiedBy: asVerified(row.verified_by),
  createdAt: row.created_at,
  expiresAt: row.expires_at ?? undefined,
});

const asVerified = (v: string): FactVerifiedBy => {
  if (v === "human" || v === "tool" || v === "ingest") return v;
  return "ingest";
};

const expired = (f: Fact): boolean => f.expiresAt != null && f.expiresAt < Date.now();
