import type { WasmPool } from "../sandbox/pool";
import { ToolRegistry } from "../tools/registry";
import { classify, type FastIntent } from "./intent";
import { finalizeResult, type Evidence, type MageResult } from "./result";
import type { Plan } from "../llm/schemas";

export type { FastIntent } from "./intent";
export { classify } from "./intent";

export type FastPathHit = {
  plan: Plan;
  answer: string;
  sandboxMs: number;
  output: unknown;
};

export type FastPathInput = Record<string, string>;

type DemoTool = Extract<FastIntent, { kind: "demo" }>["tool"];

const formatCalc = (out: string): string | null => {
  const parsed = JSON.parse(out) as { ok?: boolean; value?: number };
  if (!parsed.ok || parsed.value == null) return null;
  return String(parsed.value);
};

const formatHash = (out: string): string | null => {
  const parsed = JSON.parse(out) as { fnv1a?: string };
  return parsed.fnv1a ? `fnv1a:${parsed.fnv1a}` : null;
};

const formatJson = (out: string): string | null => {
  const parsed = JSON.parse(out) as { ok?: boolean };
  return parsed.ok ? "JSON válido" : null;
};

const DEMO_FORMAT: Record<DemoTool, (out: string, input: FastPathInput) => string | null> = {
  count_letter: (out, i) => {
    const parsed = JSON.parse(out) as { ok?: boolean; count?: number };
    if (!parsed.ok || parsed.count == null) return null;
    return `La palabra "${i.text}" tiene ${parsed.count} letra(s) "${i.letter!.toUpperCase()}"`;
  },
  is_palindrome: (out, i) => {
    const parsed = JSON.parse(out) as { ok?: boolean; palindrome?: boolean; normalized?: string };
    if (!parsed.ok || parsed.palindrome == null) return null;
    return parsed.palindrome
      ? `Sí, "${i.text}" es palíndromo (normalizado: "${parsed.normalized}")`
      : `No, "${i.text}" no es palíndromo (normalizado: "${parsed.normalized}")`;
  },
  next_prime: (out, i) => {
    const parsed = JSON.parse(out) as { ok?: boolean; prime?: number };
    if (!parsed.ok || parsed.prime == null) return null;
    return `El primer número primo mayor a ${i.min} es ${parsed.prime}`;
  },
};

const dispatchIntent = (
  intent: FastIntent,
): { tool: string; input: FastPathInput; thought: string; format: (out: string) => string | null } => {
  switch (intent.kind) {
    case "calc":
      return {
        tool: "calc",
        input: { expr: intent.expr },
        thought: `calc:${intent.expr}`,
        format: formatCalc,
      };
    case "hash":
      return {
        tool: "hash",
        input: { text: intent.text },
        thought: `hash:${intent.text}`,
        format: formatHash,
      };
    case "json":
      return {
        tool: "json_validate",
        input: { json: intent.json },
        thought: "json_validate",
        format: formatJson,
      };
    case "demo":
      return {
        tool: intent.tool,
        input: intent.input,
        thought: `${intent.tool}`,
        format: (out) => DEMO_FORMAT[intent.tool](out, intent.input),
      };
  }
};

export const tryFastPath = async (query: string, pool: WasmPool): Promise<FastPathHit | null> => {
  const intent = classify(query);
  if (!intent) return null;
  const { tool, input, thought, format } = dispatchIntent(intent);
  return runTool(pool, tool, input, thought, format);
};

const runTool = async (
  pool: WasmPool,
  tool: string,
  input: FastPathInput,
  thought: string,
  format: (output: string) => string | null,
): Promise<FastPathHit | null> => {
  const t0 = performance.now();
  try {
    const { output } = await new ToolRegistry(pool).dispatch(tool, input, pool);
    const answer = format(JSON.stringify(output));
    if (!answer) return null;
    return {
      answer,
      output,
      sandboxMs: performance.now() - t0,
      plan: {
        thought: `fastpath:${thought}`,
        confidence: 1,
        assumptions: [],
        toolCalls: [{ tool, input, reason: "determinístico" }],
        proposedAnswer: answer,
        memoryCandidates: [],
        relationCandidates: [],
      },
    };
  } catch {
    return null;
  }
};

export const fastPathResult = (hit: FastPathHit, bootMs: number, enrichMs = 0): MageResult => {
  const call = hit.plan.toolCalls[0];
  const evidence: Evidence[] = call
    ? [
        {
          id: crypto.randomUUID(),
          tool: call.tool,
          input: call.input,
          output: hit.output,
          ms: hit.sandboxMs,
        },
      ]
    : [];
  const base = finalizeResult({
    plan: hit.plan,
    evidence,
    timings: {
      bootMs,
      enrichMs,
      planMs: 0,
      sandboxMs: hit.sandboxMs,
      totalMs: hit.sandboxMs,
      attempts: 0,
      usedReasonModel: false,
    },
  });
  if (base.status === "answered") {
    return { ...base, answer: hit.answer };
  }
  return base;
};
