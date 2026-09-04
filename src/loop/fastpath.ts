import type { WasmPool } from "../sandbox/pool";
import { ToolRegistry } from "../tools/registry";
import { finalizeResult, type Evidence, type MageResult } from "./result";
import type { Plan } from "../llm/schemas";

export type FastPathHit = {
  plan: Plan;
  answer: string;
  sandboxMs: number;
  output: unknown;
};

export type FastPathInput = Record<string, string>;

type Matcher = (query: string) => FastPathInput | null;

type Intent = {
  tool: string;
  match: Matcher;
  thought: (input: FastPathInput) => string;
  format: (output: string, input: FastPathInput) => string | null;
};

const CALC_PREFIX = /^(?:cu[aá]nto\s+es|calc(?:ula)?|eval(?:uar)?|valida\s+con\s+calc)\s*[:=]?\s*/i;
const CALC_EXPR = /^[\d\s+\-*/().,sqrt]+$/i;
const HASH_PREFIX = /^hash(?:\s+de)?(?:\s+|:\s*)/i;
const COUNT_LETTER =
  /cu[aá]ntas?\s+letras?\s+["']?([a-zA-ZáéíóúñÁÉÍÓÚÑ])["']?\s+tiene\s+(?:la\s+)?palabra\s+["']?([\p{L}\p{N}]+)["']?\s*\??$/iu;
const PALINDROME = /(?:verifica\s+si|es)\s+["']?(.+?)["']?\s+es\s+pal[ií]ndromo/i;
const NEXT_PRIME = /primer[o]?\s+n[uú]mero\s+primo\s+mayor\s+a\s+([\d.,]+)/i;

const normalize = (query: string): string => query.trim().replace(/[?¿]+$/g, "").trim();

export const matchCalc = (query: string): { expr: string } | null => {
  let expr = normalize(query).replace(CALC_PREFIX, "").trim();
  if (!expr) return null;
  expr = expr.replace(/,/g, ".");
  if (!CALC_EXPR.test(expr)) return null;
  if (!/[+\-*/()]/.test(expr)) return null;
  return { expr };
};

export const matchHash = (query: string): { text: string } | null => {
  const q = normalize(query);
  if (!HASH_PREFIX.test(q)) return null;
  const text = q.replace(HASH_PREFIX, "").trim();
  return text ? { text } : null;
};

export const matchJsonLiteral = (query: string): { json: string } | null => {
  const q = query.trim();
  if (!(q.startsWith("{") || q.startsWith("["))) return null;
  return { json: q };
};

export const matchCountLetter = (query: string): { text: string; letter: string } | null => {
  const m = normalize(query).match(COUNT_LETTER);
  if (!m) return null;
  return { letter: m[1]!, text: m[2]! };
};

export const matchPalindrome = (query: string): { text: string } | null => {
  const m = normalize(query).match(PALINDROME);
  if (!m) return null;
  const text = m[1]!.trim();
  return text ? { text } : null;
};

export const matchNextPrime = (query: string): { min: string } | null => {
  const m = normalize(query).match(NEXT_PRIME);
  if (!m) return null;
  const min = m[1]!.replace(/\./g, "").replace(/,/g, ".");
  return min ? { min } : null;
};

const INTENTS: Intent[] = [
  {
    tool: "count_letter",
    match: matchCountLetter,
    thought: (i) => `count_letter:${i.letter}`,
    format: (out, i) => {
      const parsed = JSON.parse(out) as { ok?: boolean; count?: number };
      if (!parsed.ok || parsed.count == null) return null;
      return `La palabra "${i.text}" tiene ${parsed.count} letra(s) "${i.letter!.toUpperCase()}"`;
    },
  },
  {
    tool: "is_palindrome",
    match: matchPalindrome,
    thought: (i) => `palindrome:${i.text}`,
    format: (out, i) => {
      const parsed = JSON.parse(out) as { ok?: boolean; palindrome?: boolean; normalized?: string };
      if (!parsed.ok || parsed.palindrome == null) return null;
      return parsed.palindrome
        ? `Sí, "${i.text}" es palíndromo (normalizado: "${parsed.normalized}")`
        : `No, "${i.text}" no es palíndromo (normalizado: "${parsed.normalized}")`;
    },
  },
  {
    tool: "next_prime",
    match: matchNextPrime,
    thought: (i) => `next_prime:${i.min}`,
    format: (out, i) => {
      const parsed = JSON.parse(out) as { ok?: boolean; prime?: number };
      if (!parsed.ok || parsed.prime == null) return null;
      return `El primer número primo mayor a ${i.min} es ${parsed.prime}`;
    },
  },
  {
    tool: "hash",
    match: matchHash,
    thought: (i) => `hash:${i.text}`,
    format: (out) => {
      const parsed = JSON.parse(out) as { fnv1a?: string };
      return parsed.fnv1a ? `fnv1a:${parsed.fnv1a}` : null;
    },
  },
  {
    tool: "json_validate",
    match: matchJsonLiteral,
    thought: () => "json_validate",
    format: (out) => {
      const parsed = JSON.parse(out) as { ok?: boolean };
      return parsed.ok ? "JSON válido" : null;
    },
  },
  {
    tool: "calc",
    match: matchCalc,
    thought: (i) => `calc:${i.expr}`,
    format: (out) => {
      const parsed = JSON.parse(out) as { ok?: boolean; value?: number };
      if (!parsed.ok || parsed.value == null) return null;
      return String(parsed.value);
    },
  },
];

export const tryFastPath = async (query: string, pool: WasmPool): Promise<FastPathHit | null> => {
  const q = query.trim();
  if (!q) return null;
  for (const intent of INTENTS) {
    const input = intent.match(q);
    if (!input) continue;
    const hit = await runTool(pool, intent.tool, input, intent.thought(input), (out) =>
      intent.format(out, input),
    );
    if (hit) return hit;
  }
  return null;
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
  return finalizeResult({
    plan: hit.plan,
    evidence,
    draft: hit.answer,
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
};
