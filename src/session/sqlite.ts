import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MageConfig } from "../config";
import { applyCompact, normalizeTenant } from "./compact";
import { DEFAULT_TENANT, type Session, type SessionStore, type SessionSummary, type Turn, type TurnRole } from "./types";

export const resolveSessionDbPath = (sessionPath: string): string => {
  if (sessionPath.endsWith(".sqlite") || sessionPath.endsWith(".db")) return sessionPath;
  return join(sessionPath, "sessions.sqlite");
};

type SessionRow = {
  id: string;
  tenant_id: string | null;
  created_at: number;
  updated_at: number;
  title: string | null;
  summary: string | null;
};

type TurnRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  ts: number;
  meta: string | null;
};

export class SqliteSessionStore implements SessionStore {
  private readonly db: Database;
  private readonly ttlMs: number;
  readonly path: string;

  constructor(config: MageConfig) {
    this.ttlMs = config.sessionTtlMs;
    this.path = resolveSessionDbPath(config.sessionPath);
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new Database(this.path);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA synchronous=NORMAL");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.db.exec("PRAGMA busy_timeout=5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        title TEXT
      );
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        ts INTEGER NOT NULL,
        meta TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_turns_session_ts ON turns(session_id, ts);
    `);
    this.migrate();
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions(tenant_id)");
  }

  create(opts?: { tenantId?: string }): Session {
    this.evictExpired();
    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      tenantId: normalizeTenant(opts?.tenantId),
      createdAt: now,
      updatedAt: now,
      turns: [],
    };
    this.db
      .query(
        "INSERT INTO sessions (id, tenant_id, created_at, updated_at, title, summary) VALUES (?, ?, ?, ?, NULL, NULL)",
      )
      .run(session.id, session.tenantId, session.createdAt, session.updatedAt);
    return session;
  }

  get(id: string, tenantId?: string): Session | null {
    this.evictExpired();
    const row = this.db
      .query("SELECT id, tenant_id, created_at, updated_at, title, summary FROM sessions WHERE id = ?")
      .get(id) as SessionRow | null | undefined;
    if (!row) return null;
    if (Date.now() - row.updated_at > this.ttlMs) {
      this.delete(id);
      return null;
    }
    const tenant = row.tenant_id || DEFAULT_TENANT;
    if (tenantId && tenant !== normalizeTenant(tenantId)) return null;
    return this.hydrate(row);
  }

  append(id: string, role: TurnRole, content: string, meta?: Turn["meta"]): Turn | null {
    const s = this.get(id);
    if (!s) return null;
    const turn: Turn = { id: randomUUID(), role, content, ts: Date.now(), meta };
    const title = !s.title && role === "user" ? content.slice(0, 60) : s.title ?? null;
    this.db
      .query("INSERT INTO turns (id, session_id, role, content, ts, meta) VALUES (?, ?, ?, ?, ?, ?)")
      .run(turn.id, id, role, content, turn.ts, meta ? JSON.stringify(meta) : null);
    this.db.query("UPDATE sessions SET updated_at = ?, title = ? WHERE id = ?").run(turn.ts, title, id);
    return turn;
  }

  list(tenantId?: string): string[] {
    this.evictExpired();
    if (tenantId) {
      const rows = this.db
        .query("SELECT id FROM sessions WHERE tenant_id = ? ORDER BY updated_at DESC")
        .all(normalizeTenant(tenantId)) as { id: string }[];
      return rows.map((r) => r.id);
    }
    const rows = this.db.query("SELECT id FROM sessions ORDER BY updated_at DESC").all() as { id: string }[];
    return rows.map((r) => r.id);
  }

  delete(id: string, tenantId: string): boolean {
    const res = this.db
      .query("DELETE FROM sessions WHERE id = ? AND tenant_id = ?")
      .run(id, normalizeTenant(tenantId));
    return res.changes > 0;
  }

  trim(id: string, maxTurns: number): void {
    const s = this.get(id);
    if (!s || s.turns.length <= maxTurns) return;
    const drop = s.turns.length - maxTurns;
    this.db
      .query(
        `DELETE FROM turns WHERE id IN (
           SELECT id FROM turns WHERE session_id = ? ORDER BY rowid ASC LIMIT ?
         )`,
      )
      .run(id, drop);
    this.db.query("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now(), id);
  }

  compact(id: string, maxTurns: number, keepRecent?: number): void {
    const s = this.get(id);
    if (!s) return;
    if (!applyCompact(s, maxTurns, keepRecent)) return;
    const keepIds = new Set(s.turns.map((t) => t.id));
    const drop = this.db
      .query("SELECT id FROM turns WHERE session_id = ?")
      .all(id) as { id: string }[];
    for (const row of drop) {
      if (!keepIds.has(row.id)) this.db.query("DELETE FROM turns WHERE id = ?").run(row.id);
    }
    this.db
      .query("UPDATE sessions SET updated_at = ?, summary = ? WHERE id = ?")
      .run(s.updatedAt, JSON.stringify(s.summary ?? null), id);
  }

  count(tenantId?: string): number {
    this.evictExpired();
    if (tenantId) {
      const row = this.db
        .query("SELECT COUNT(*) AS n FROM sessions WHERE tenant_id = ?")
        .get(normalizeTenant(tenantId)) as { n: number };
      return row.n;
    }
    const row = this.db.query("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }

  private hydrate(row: SessionRow): Session {
    const turns = this.db
      .query(
        "SELECT id, session_id, role, content, ts, meta FROM turns WHERE session_id = ? ORDER BY rowid ASC",
      )
      .all(row.id) as TurnRow[];
    return {
      id: row.id,
      tenantId: row.tenant_id || DEFAULT_TENANT,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      title: row.title ?? undefined,
      summary: parseSummary(row.summary),
      turns: turns.map((t) => ({
        id: t.id,
        role: asRole(t.role),
        content: t.content,
        ts: t.ts,
        meta: parseMeta(t.meta),
      })),
    };
  }

  private migrate(): void {
    const cols = this.db.query("PRAGMA table_info(sessions)").all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("tenant_id")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'");
    }
    if (!names.has("summary")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN summary TEXT");
    }
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.ttlMs;
    this.db.query("DELETE FROM sessions WHERE updated_at < ?").run(cutoff);
  }
}

const asRole = (value: string): TurnRole => {
  if (value === "user" || value === "assistant" || value === "system") return value;
  return "user";
};

const parseMeta = (raw: string | null): Turn["meta"] | undefined => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Turn["meta"];
  } catch {
    return undefined;
  }
};

const parseSummary = (raw: string | null): SessionSummary | undefined => {
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw) as SessionSummary;
    return {
      factIds: Array.isArray(o.factIds) ? o.factIds.map(String) : [],
      lastStatus: o.lastStatus,
      lastEvidenceIds: Array.isArray(o.lastEvidenceIds) ? o.lastEvidenceIds.map(String) : [],
    };
  } catch {
    return undefined;
  }
};
