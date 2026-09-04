import { loadConfig } from "./config";
import { createRuntime, runMage, runMageStream, type RunMageOptions } from "./loop/metacog";
import type { MageResult } from "./loop/result";
import { getRuntime, resetRuntime } from "./runtime";
import { startServer } from "./server";
import { modelTiers, objectFromModel, MageApiError } from "./llm/provider";
import {
  createSession,
  deleteSession,
  getSession,
  getSessionStore,
  resetSessionStore,
} from "./session/store";
import { SESSION_HISTORY_KEEP, type Session, type SessionSummary, type Turn } from "./session/types";
import type { MageEvent } from "./loop/events";

export {
  loadConfig,
  createRuntime,
  runMage,
  runMageStream,
  getRuntime,
  resetRuntime,
  startServer,
  modelTiers,
  objectFromModel,
  MageApiError,
  createSession,
  deleteSession,
  getSession,
  getSessionStore,
  resetSessionStore,
};
export type { MageResult, Evidence, MageStatus, MageTimings } from "./loop/result";
export type { Session, SessionSummary, Turn, MageEvent };

export type MageOptions = {
  planOnly?: boolean;
  runtime?: Awaited<ReturnType<typeof createRuntime>>;
  sessionId?: string;
  tenantId?: string;
  onEvent?: RunMageOptions["onEvent"];
  signal?: AbortSignal;
};

export const mage = async (query: string, opts: MageOptions = {}): Promise<MageResult> => {
  const runtime = opts.runtime ?? (await getRuntime());
  if (opts.planOnly) {
    const { PlanSchema } = await import("./llm/schemas");
    const { formatContext, formatHistory, formatPlanPrompt, PLAN_SYSTEM } = await import("./llm/prompts");
    const tenantId = opts.tenantId?.trim() || "default";
    const sess =
      opts.sessionId && runtime.config.sessionEnabled
        ? getSession(runtime.config, opts.sessionId, tenantId)
        : null;
    const history = sess ? formatHistory(sess.turns, SESSION_HISTORY_KEEP, sess.summary) : "";
    const factChunks = runtime.facts.promptChunks(tenantId);
    const plan = await objectFromModel({
      config: runtime.config,
      tiers: modelTiers(runtime.config, runtime.config.fastModel),
      schema: PlanSchema,
      schemaName: "Plan",
      system: PLAN_SYSTEM,
      prompt: formatPlanPrompt(
        query,
        formatContext(factChunks),
        runtime.registry.catalogLine(),
        history,
      ),
      signal: opts.signal,
    });
    return {
      status: "refused",
      answer: "",
      refusalReason: "plan_only",
      evidence: [],
      plan,
      timings: {
        bootMs: runtime.bootMs,
        enrichMs: 0,
        planMs: 0,
        sandboxMs: 0,
        totalMs: 0,
        attempts: 1,
        usedReasonModel: false,
      },
      sessionId: opts.sessionId,
      tenantId,
      graphDisabled: runtime.graph.disabledReason ?? undefined,
    };
  }
  return runMage(query, runtime, {
    sessionId: opts.sessionId,
    tenantId: opts.tenantId,
    onEvent: opts.onEvent,
    signal: opts.signal,
  });
};
