import {
  DEFAULT_TENANT,
  SESSION_HISTORY_KEEP,
  type Session,
  type SessionSummary,
  type Turn,
} from "./types";

export const emptySummary = (): SessionSummary => ({
  factIds: [],
  lastEvidenceIds: [],
});

export const mergeSummary = (base: SessionSummary | undefined, extra: SessionSummary): SessionSummary => {
  const factIds = [...new Set([...(base?.factIds ?? []), ...extra.factIds])];
  return {
    factIds,
    lastStatus: extra.lastStatus ?? base?.lastStatus,
    lastEvidenceIds: extra.lastEvidenceIds.length > 0 ? extra.lastEvidenceIds : (base?.lastEvidenceIds ?? []),
  };
};

export const summaryFromTurns = (turns: Turn[]): SessionSummary => {
  const factIds = new Set<string>();
  let lastStatus: SessionSummary["lastStatus"];
  let lastEvidenceIds: string[] = [];
  for (const t of turns) {
    for (const id of t.meta?.factIds ?? []) factIds.add(id);
    if (t.role === "assistant" && t.meta?.status) lastStatus = t.meta.status;
    if (t.meta?.evidenceIds && t.meta.evidenceIds.length > 0) {
      lastEvidenceIds = t.meta.evidenceIds;
    }
  }
  return { factIds: [...factIds], lastStatus, lastEvidenceIds };
};

export const applyCompact = (
  session: Session,
  maxTurns: number,
  keepRecent = SESSION_HISTORY_KEEP,
): boolean => {
  if (session.turns.length <= maxTurns) return false;
  const keep = Math.min(keepRecent, maxTurns, session.turns.length);
  const dropped = session.turns.slice(0, session.turns.length - keep);
  session.summary = mergeSummary(session.summary, summaryFromTurns(dropped));
  session.turns = session.turns.slice(-keep);
  session.updatedAt = Date.now();
  return true;
};

export const normalizeTenant = (tenantId?: string): string => tenantId?.trim() || DEFAULT_TENANT;
