import type { MageStatus } from "../loop/result";

export type TurnRole = "user" | "assistant" | "system";

export const SESSION_HISTORY_KEEP = 6;
export const DEFAULT_TENANT = "default";

export type SessionSummary = {
  factIds: string[];
  lastStatus?: MageStatus;
  lastEvidenceIds: string[];
};

export type TurnMeta = {
  tools?: string[];
  fastPath?: boolean;
  offline?: boolean;
  status?: MageStatus;
  evidenceIds?: string[];
  factIds?: string[];
};

export type Turn = {
  id: string;
  role: TurnRole;
  content: string;
  ts: number;
  meta?: TurnMeta;
};

export type Session = {
  id: string;
  tenantId: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
  title?: string;
  summary?: SessionSummary;
};

export type SessionStore = {
  create(opts?: { tenantId?: string }): Session;
  get(id: string, tenantId?: string): Session | null;
  append(id: string, role: TurnRole, content: string, meta?: Turn["meta"]): Turn | null;
  list(tenantId?: string): string[];
  delete(id: string): boolean;
  trim(id: string, maxTurns: number): void;
  compact(id: string, maxTurns: number, keepRecent?: number): void;
  count(tenantId?: string): number;
  close?(): void;
};
