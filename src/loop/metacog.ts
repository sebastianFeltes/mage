import { resolve } from "node:path";
import { loadConfig, type MageConfig } from "../config";
import { modelTiers, objectFromModel, MageApiError } from "../llm/provider";
import {
  CORRECTION_SYSTEM,
  formatContext,
  formatCorrectionPrompt,
  formatHistory,
  formatPlanPrompt,
  PLAN_SYSTEM,
} from "../llm/prompts";
import { CorrectionSchema, PlanSchema, type Plan } from "../llm/schemas";
import { createGraphStore } from "../memory/sqlite-graph";
import { HybridMemory } from "../memory/hybrid";
import type { GraphStore } from "../memory/types";
import { FactStore } from "../memory/ingest";
import { VectorMemory } from "../memory/vectors";
import { WasmPool } from "../sandbox/pool";
import { ScriptRunner } from "../sandbox/script";
import { SandboxError, SandboxTimeout } from "../sandbox/runner";
import { getSessionStore } from "../session/store";
import { SESSION_HISTORY_KEEP, type SessionSummary, type Turn } from "../session/types";
import { ToolRegistry, type HostContext } from "../tools/registry";
import { BUILTIN_WASM_TOOLS } from "../tools/builtin";
import { emitEvent, type MageEvent, type MageEventHandler } from "./events";
import { fastPathResult, tryFastPath } from "./fastpath";
import { tryOfflinePlan } from "./offline";
import {
  finalizeResult,
  type Evidence,
  type MageResult,
  type MageTimings,
} from "./result";
import { recordResult } from "./metrics";

export type { Evidence, MageResult, MageStatus, MageTimings } from "./result";

export type RunMageOptions = {
  sessionId?: string;
  tenantId?: string;
  onEvent?: MageEventHandler;
  signal?: AbortSignal;
};

export type MageRuntime = {
  config: MageConfig;
  pool: WasmPool;
  script: ScriptRunner;
  registry: ToolRegistry;
  graph: GraphStore;
  vectors: VectorMemory;
  hybrid: HybridMemory;
  facts: FactStore;
  bootMs: number;
};

const hostCtx = (rt: MageRuntime, tenantId: string): HostContext => ({
  memorySearch: async (q) => {
    const hits = await rt.hybrid.search(q, tenantId);
    const facts = rt.facts.search(tenantId, q);
    const factHits = facts.map((f) => ({
      source: "graph" as const,
      name: f.name,
      text: `[fact] ${f.name}${f.value ? ` value=${f.value}` : ""} ${f.text} (source:${f.source})`,
      score: 1,
    }));
    return [...factHits, ...hits];
  },
  script: rt.script,
  facts: rt.facts,
  tenantId,
  allowWrite: false,
});

export const createRuntime = async (
  config = loadConfig(),
  createPlugin?: ConstructorParameters<typeof WasmPool>[2],
): Promise<MageRuntime> => {
  const t0 = performance.now();
  const pluginsDir = resolve(import.meta.dir, "../../plugins");
  const builtinWasm = resolve(pluginsDir, "toolkit.wasm");
  const loader =
    createPlugin ??
    ((await import("@extism/extism")).default as ConstructorParameters<typeof WasmPool>[2]);

  const pool = new WasmPool(
    pluginsDir,
    config.wasmTimeoutMs,
    loader,
    builtinWasm,
    BUILTIN_WASM_TOOLS.map((t) => ({ ...t, wasmPath: builtinWasm })),
  );
  const graph = createGraphStore(config);
  const vectors = new VectorMemory(config);
  const hybrid = new HybridMemory(config, graph, vectors);
  const facts = new FactStore(config);
  const script = new ScriptRunner(config);

  await Promise.all([pool.warm(), graph.connect(), vectors.open()]);
  const registry = new ToolRegistry(pool);

  return { config, pool, script, registry, graph, vectors, hybrid, facts, bootMs: performance.now() - t0 };
};

const resolveSession = (
  rt: MageRuntime,
  sessionId: string | undefined,
  tenantId: string,
): { id: string; history: Turn[]; summary?: SessionSummary } => {
  if (!rt.config.sessionEnabled) {
    return { id: sessionId ?? "", history: [] };
  }
  const store = getSessionStore(rt.config);
  if (sessionId) {
    const existing = store.get(sessionId, tenantId);
    if (existing) return { id: existing.id, history: existing.turns, summary: existing.summary };
  }
  const created = store.create({ tenantId });
  return { id: created.id, history: [], summary: created.summary };
};

const recordTurn = (
  rt: MageRuntime,
  sessionId: string,
  role: Turn["role"],
  content: string,
  meta?: Turn["meta"],
): void => {
  if (!rt.config.sessionEnabled || !sessionId) return;
  const store = getSessionStore(rt.config);
  store.append(sessionId, role, content, meta);
  store.compact(sessionId, rt.config.sessionMaxTurns, SESSION_HISTORY_KEEP);
};

const factIdsFromResult = (rt: MageRuntime, tenantId: string, result: MageResult): string[] => {
  const ids: string[] = [];
  for (const e of result.evidence) {
    const rec = e.output && typeof e.output === "object" && !Array.isArray(e.output)
      ? (e.output as { name?: string; found?: boolean })
      : null;
    if (!rec?.name || rec.found === false) continue;
    const fact = rt.facts.lookup(tenantId, rec.name);
    if (fact) ids.push(fact.id);
  }
  return ids;
};

const assistantMeta = (
  rt: MageRuntime,
  tenantId: string,
  result: MageResult,
  extra?: Turn["meta"],
): Turn["meta"] => ({
  ...extra,
  status: result.status,
  evidenceIds: result.evidence.map((e) => e.id),
  factIds: factIdsFromResult(rt, tenantId, result),
});

const emitFinished = (emit: (e: MageEvent) => void, result: MageResult): void => {
  if (result.status === "refused") {
    emit({ type: "refuse", reason: result.refusalReason ?? "no_evidence" });
  } else if (result.status === "answered") {
    emit({ type: "answer", answer: result.answer });
  }
  emit({ type: "done", result });
};

export const runMage = async (
  query: string,
  runtime?: MageRuntime,
  opts?: RunMageOptions,
): Promise<MageResult> => {
  const rt = runtime ?? (await createRuntime());
  const emit = (e: MageEvent) => emitEvent(opts?.onEvent, e);
  const total0 = performance.now();
  const tenantId = opts?.tenantId?.trim() || "default";
  const { id: sessionId, history: priorHistory, summary } = resolveSession(rt, opts?.sessionId, tenantId);

  emit({ type: "start", query, sessionId: sessionId || undefined });
  recordTurn(rt, sessionId, "user", query);

  const historyBlock = formatHistory(priorHistory, SESSION_HISTORY_KEEP, summary);

  const fast = await tryFastPath(query, rt.pool);
  if (fast) {
    const base = fastPathResult(fast, rt.bootMs);
    const result: MageResult = {
      ...base,
      sessionId: sessionId || undefined,
      tenantId,
      timings: { ...base.timings, totalMs: performance.now() - total0 },
    };
    recordTurn(rt, sessionId, "assistant", result.answer, assistantMeta(rt, tenantId, result, {
      fastPath: true,
      tools: fast.plan.toolCalls.map((c) => c.tool),
    }));
    emitFinished(emit, result);
    recordResult(result);
    return result;
  }

  const enrich0 = performance.now();
  const hits = await rt.hybrid.search(query, tenantId);
  const factChunks = rt.facts.promptChunks(tenantId);
  const enrichMs = performance.now() - enrich0;
  emit({ type: "enrich", hits: hits.length + factChunks.length, ms: enrichMs });
  const context = formatContext(factChunks);

  let planMs = 0;
  let sandboxMs = 0;
  let attempts = 0;
  let usedReasonModel = false;

  const planOnce = async (heavy: boolean, previous?: Plan, traces?: string[]): Promise<Plan> => {
    const t = performance.now();
    const primary = heavy ? rt.config.reasonModel : rt.config.fastModel;
    const tiers = modelTiers(rt.config, primary, heavy);
    const modelName = tiers[0]?.models[0] ?? primary;
    emit({ type: "plan_start", model: modelName, attempt: attempts + 1 });

    const plan =
      previous && traces
        ? await objectFromModel({
            config: rt.config,
            tiers,
            schema: CorrectionSchema,
            schemaName: "Correction",
            system: CORRECTION_SYSTEM,
            prompt: formatCorrectionPrompt(query, previous, traces, historyBlock),
            signal: opts?.signal,
            onPartial: opts?.onEvent
              ? (p) => {
                  const thought = (p as { thought?: string }).thought;
                  if (thought) emit({ type: "plan_thought", delta: thought });
                }
              : undefined,
          })
        : await objectFromModel({
            config: rt.config,
            tiers,
            schema: PlanSchema,
            schemaName: "Plan",
            system: PLAN_SYSTEM,
            prompt: formatPlanPrompt(query, context, rt.registry.catalogLine(), historyBlock),
            signal: opts?.signal,
            onPartial: opts?.onEvent
              ? (p) => {
                  const thought = (p as { thought?: string }).thought;
                  if (thought) emit({ type: "plan_thought", delta: thought });
                }
              : undefined,
          });
    planMs += performance.now() - t;
    attempts++;
    if (heavy) usedReasonModel = true;
    emit({ type: "plan", plan });
    return plan;
  };

  let plan: Plan;
  try {
    plan = await planOnce(false);
  } catch (err) {
    const offline = await tryOfflinePlan(query, rt);
    if (offline) {
      const result: MageResult = {
        ...offline,
        sessionId: sessionId || undefined,
        timings: {
          ...offline.timings,
          enrichMs,
          totalMs: performance.now() - total0,
        },
      };
      recordTurn(rt, sessionId, "assistant", result.answer, assistantMeta(rt, tenantId, result, {
        offline: true,
        tools: result.plan.toolCalls.map((c) => c.tool),
      }));
      emitFinished(emit, result);
      recordResult(result);
      return result;
    }
    if (err instanceof MageApiError) {
      emit({
        type: "error",
        message: err.message,
        retryAfterSec: err.retryAfterSec,
      });
      throw err;
    }
    throw err;
  }

  let evidence: Evidence[] = [];

  for (;;) {
    if (plan.toolCalls.length > 0) {
      const t = performance.now();
      const batch: Evidence[] = [];
      const traces = await Promise.all(
        plan.toolCalls.map(async (call) => {
          emit({ type: "tool_start", tool: call.tool, input: call.input });
          const t0 = performance.now();
          try {
            const { output } = await rt.registry.dispatch(
              call.tool,
              call.input,
              rt.pool,
              hostCtx(rt, tenantId),
            );
            const ms = performance.now() - t0;
            emit({ type: "tool_end", tool: call.tool, ok: true, output, ms });
            batch.push({
              id: crypto.randomUUID(),
              tool: call.tool,
              input: call.input,
              output,
              ms,
            });
            return { ok: true as const, line: `${call.tool} ok: ${JSON.stringify(output)}` };
          } catch (err) {
            const ms = performance.now() - t0;
            const error = err instanceof Error ? err.message : String(err);
            emit({ type: "tool_end", tool: call.tool, ok: false, error, ms });
            return { ok: false as const, line: formatErr(call.tool, err) };
          }
        }),
      );
      sandboxMs += performance.now() - t;
      const failed = traces.some((x) => !x.ok);
      const traceLines = traces.map((x) => x.line);

      if (failed && attempts < rt.config.maxAttempts) {
        emit({ type: "correction", attempt: attempts + 1, reason: "tool_failed" });
        plan = await planOnce(attempts >= 2, plan, traceLines);
        continue;
      }
      evidence = batch;
      break;
    }

    break;
  }

  const timings: MageTimings = {
    bootMs: rt.bootMs,
    enrichMs,
    planMs,
    sandboxMs,
    totalMs: performance.now() - total0,
    attempts,
    usedReasonModel,
  };

  const result = finalizeResult({
    plan,
    evidence,
    draft: plan.proposedAnswer,
    timings,
    sessionId: sessionId || undefined,
    tenantId,
    graphDisabled: rt.graph.disabledReason ?? undefined,
  });

  recordTurn(rt, sessionId, "assistant", result.answer, assistantMeta(rt, tenantId, result, {
    tools: plan.toolCalls.map((c) => c.tool),
  }));
  emitFinished(emit, result);
  recordResult(result);
  return result;
};

export async function* runMageStream(
  query: string,
  runtime?: MageRuntime,
  opts?: Omit<RunMageOptions, "onEvent">,
): AsyncGenerator<MageEvent> {
  const queue: MageEvent[] = [];
  let finished = false;
  let runError: unknown;

  const onEvent = (e: MageEvent) => {
    queue.push(e);
  };

  const runPromise = runMage(query, runtime, { ...opts, onEvent })
    .then(() => {
      finished = true;
    })
    .catch((err) => {
      runError = err;
      finished = true;
    });

  while (!finished || queue.length > 0) {
    if (queue.length > 0) {
      yield queue.shift()!;
    } else if (!finished) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  await runPromise;
  if (runError) throw runError;
}

const formatErr = (tool: string, err: unknown): string => {
  if (err instanceof SandboxTimeout) return `${tool} timeout ${err.ms}ms`;
  if (err instanceof SandboxError) return `${tool} error: ${err.detail}`;
  return `${tool} error: ${err instanceof Error ? err.message : String(err)}`;
};
