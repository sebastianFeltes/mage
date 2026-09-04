import type { Plan } from "../llm/schemas";
import type { MageResult } from "./result";

export type MageEvent =
  | { type: "start"; query: string; sessionId?: string }
  | { type: "enrich"; hits: number; ms: number }
  | { type: "plan_start"; model: string; attempt: number }
  | { type: "plan_thought"; delta: string }
  | { type: "plan"; plan: Plan }
  | { type: "tool_start"; tool: string; input: unknown }
  | { type: "tool_end"; tool: string; ok: boolean; output?: unknown; error?: string; ms: number }
  | { type: "correction"; attempt: number; reason: string }
  | { type: "refuse"; reason: string }
  | { type: "answer"; answer: string; delta?: string }
  | { type: "done"; result: MageResult }
  | { type: "error"; message: string; retryAfterSec?: number };

export type MageEventHandler = (event: MageEvent) => void;

export const emitEvent = (handler?: MageEventHandler, event?: MageEvent): void => {
  if (handler && event) handler(event);
};
