import { isCompleteCalcExpr } from "./calc-ast";

export type FastIntent =
  | { kind: "calc"; expr: string }
  | { kind: "hash"; text: string }
  | { kind: "json"; json: string }
  | { kind: "demo"; tool: "count_letter" | "is_palindrome" | "next_prime"; input: Record<string, string> };

const CALC_PREFIX = /^(?:cu[aá]nto\s+es|calc(?:ula)?|eval(?:uar)?|valida\s+con\s+calc)\s*[:=]?\s*/i;
const HASH_PREFIX = /^hash(?:\s+de)?(?:\s+|:\s*)/i;
const COUNT_LETTER =
  /cu[aá]ntas?\s+letras?\s+["']?([a-zA-ZáéíóúñÁÉÍÓÚÑ])["']?\s+tiene\s+(?:la\s+)?palabra\s+["']?([\p{L}\p{N}]+)["']?\s*\??$/iu;
const PALINDROME = /(?:verifica\s+si|es)\s+["']?(.+?)["']?\s+es\s+pal[ií]ndromo/i;
const NEXT_PRIME = /primer[o]?\s+n[uú]mero\s+primo\s+mayor\s+a\s+([\d.,]+)/i;

const normalize = (query: string): string => query.trim().replace(/[?¿]+$/g, "").trim();

type DemoTool = Extract<FastIntent, { kind: "demo" }>["tool"];

type DemoIntent = {
  tool: DemoTool;
  match: (query: string) => Record<string, string> | null;
};

/** Demos del README. No son el pitch. No agregar más. */
const DEMO_INTENTS: DemoIntent[] = [
  {
    tool: "count_letter",
    match: (query) => {
      const m = normalize(query).match(COUNT_LETTER);
      if (!m) return null;
      return { letter: m[1]!, text: m[2]! };
    },
  },
  {
    tool: "is_palindrome",
    match: (query) => {
      const m = normalize(query).match(PALINDROME);
      if (!m) return null;
      const text = m[1]!.trim();
      return text ? { text } : null;
    },
  },
  {
    tool: "next_prime",
    match: (query) => {
      const m = normalize(query).match(NEXT_PRIME);
      if (!m) return null;
      const min = m[1]!.replace(/\./g, "").replace(/,/g, ".");
      return min ? { min } : null;
    },
  },
];

export const matchCalc = (query: string): { expr: string } | null => {
  let expr = normalize(query).replace(CALC_PREFIX, "").trim();
  if (!expr) return null;
  expr = expr.replace(/,/g, ".");
  if (!isCompleteCalcExpr(expr)) return null;
  return { expr };
};

export const matchHash = (query: string): { text: string } | null => {
  const q = normalize(query);
  if (!HASH_PREFIX.test(q)) return null;
  const text = q.replace(HASH_PREFIX, "").trim();
  return text ? { text } : null;
};

export const matchJsonLiteral = (query: string): { json: string } | null => {
  const json = query.trim();
  if (!(json.startsWith("{") || json.startsWith("["))) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as { program?: unknown };
      if (typeof rec.program === "string") return null;
    }
  } catch {
    return null;
  }
  return { json };
};

export const classify = (query: string): FastIntent | null => {
  const q = query.trim();
  if (!q) return null;

  for (const demo of DEMO_INTENTS) {
    const input = demo.match(q);
    if (input) return { kind: "demo", tool: demo.tool, input };
  }

  const hash = matchHash(q);
  if (hash) return { kind: "hash", text: hash.text };

  const json = matchJsonLiteral(q);
  if (json) return { kind: "json", json: json.json };

  const calc = matchCalc(q);
  if (calc) return { kind: "calc", expr: calc.expr };

  return null;
};
