import { randomUUID } from "node:crypto";
import type { MageConfig } from "../config";
import { applyCompact, normalizeTenant } from "./compact";
import { SqliteSessionStore, resolveSessionDbPath } from "./sqlite";
import { DEFAULT_TENANT, type Session, type SessionStore, type Turn, type TurnRole } from "./types";

export type { SessionStore } from "./types";
export { SESSION_HISTORY_KEEP, DEFAULT_TENANT } from "./types";

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly ttlMs: number;

  constructor(private readonly config: MageConfig) {
    this.ttlMs = config.sessionTtlMs;
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
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string, tenantId?: string): Session | null {
    this.evictExpired();
    const s = this.sessions.get(id);
    if (!s) return null;
    if (Date.now() - s.updatedAt > this.ttlMs) {
      this.sessions.delete(id);
      return null;
    }
    if (tenantId && s.tenantId !== normalizeTenant(tenantId)) return null;
    return s;
  }

  append(id: string, role: TurnRole, content: string, meta?: Turn["meta"]): Turn | null {
    const s = this.get(id);
    if (!s) return null;
    const turn: Turn = { id: randomUUID(), role, content, ts: Date.now(), meta };
    s.turns.push(turn);
    s.updatedAt = turn.ts;
    if (!s.title && role === "user") {
      s.title = content.slice(0, 60);
    }
    return turn;
  }

  list(tenantId?: string): string[] {
    this.evictExpired();
    const tenant = tenantId ? normalizeTenant(tenantId) : undefined;
    return [...this.sessions.values()]
      .filter((s) => !tenant || s.tenantId === tenant)
      .map((s) => s.id);
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  trim(id: string, maxTurns: number): void {
    const s = this.get(id);
    if (!s || s.turns.length <= maxTurns) return;
    s.turns = s.turns.slice(-maxTurns);
    s.updatedAt = Date.now();
  }

  compact(id: string, maxTurns: number, keepRecent?: number): void {
    const s = this.get(id);
    if (!s) return;
    applyCompact(s, maxTurns, keepRecent);
  }

  count(tenantId?: string): number {
    this.evictExpired();
    if (!tenantId) return this.sessions.size;
    const tenant = normalizeTenant(tenantId);
    return [...this.sessions.values()].filter((s) => s.tenantId === tenant).length;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.updatedAt > this.ttlMs) this.sessions.delete(id);
    }
  }
}

export { SqliteSessionStore, resolveSessionDbPath };

let globalStore: SessionStore | null = null;
let globalKey: string | null = null;

const storeKey = (config: MageConfig): string => {
  if (config.sessionStore === "memory") return "memory";
  return `sqlite:${resolveSessionDbPath(config.sessionPath)}`;
};

export const getSessionStore = (config: MageConfig): SessionStore => {
  const key = storeKey(config);
  if (!globalStore || globalKey !== key) {
    globalStore?.close?.();
    globalStore =
      config.sessionStore === "memory" ? new InMemorySessionStore(config) : new SqliteSessionStore(config);
    globalKey = key;
  }
  return globalStore;
};

export const resetSessionStore = (): void => {
  globalStore?.close?.();
  globalStore = null;
  globalKey = null;
};

export const createSession = (config: MageConfig, tenantId = DEFAULT_TENANT): Session =>
  getSessionStore(config).create({ tenantId });
export const getSession = (config: MageConfig, id: string, tenantId?: string): Session | null =>
  getSessionStore(config).get(id, tenantId);
export const deleteSession = (config: MageConfig, id: string): boolean =>
  getSessionStore(config).delete(id);
