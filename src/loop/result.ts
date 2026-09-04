import type { Plan } from "../llm/schemas";

export type MageStatus = "answered" | "refused" | "error";

export type Evidence = {
  id: string;
  tool: string;
  input: unknown;
  output: unknown;
  ms: number;
};

export type MageTimings = {
  bootMs: number;
  enrichMs: number;
  planMs: number;
  sandboxMs: number;
  totalMs: number;
  attempts: number;
  usedReasonModel: boolean;
};

export type MageResult = {
  status: MageStatus;
  answer: string;
  refusalReason?: string;
  evidence: Evidence[];
  plan: Plan;
  timings: MageTimings;
  sessionId?: string;
  tenantId?: string;
  graphDisabled?: string;
};

const asRecord = (output: unknown): Record<string, unknown> | null => {
  if (output == null || typeof output !== "object" || Array.isArray(output)) return null;
  return output as Record<string, unknown>;
};

/** Hidrata answer desde campos canónicos del último output tipado. El draft del LLM no verifica. */
export const answerFromOutput = (output: unknown): string => {
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output) as unknown;
      if (parsed !== output) return answerFromOutput(parsed);
    } catch {
      return output;
    }
    return output;
  }
  if (typeof output === "number" || typeof output === "boolean") return String(output);
  if (output == null) return "";

  const rec = asRecord(output);
  if (!rec) return JSON.stringify(output);

  if (rec.value != null) return String(rec.value);
  if (typeof rec.stdout === "string" && rec.stdout.length > 0) return rec.stdout.trim();
  if (typeof rec.fnv1a === "string" && rec.fnv1a.length > 0) return `fnv1a:${rec.fnv1a}`;
  if (typeof rec.count === "number") return String(rec.count);
  if (typeof rec.prime === "number") return String(rec.prime);
  if (typeof rec.palindrome === "boolean") {
    return rec.normalized != null ? String(rec.palindrome) : String(rec.palindrome);
  }
  if (rec.result != null) {
    if (typeof rec.result === "string" || typeof rec.result === "number" || typeof rec.result === "boolean") {
      return String(rec.result);
    }
    return JSON.stringify(rec.result);
  }
  if (typeof rec.passed === "boolean") {
    return rec.actual != null ? JSON.stringify({ passed: rec.passed, actual: rec.actual }) : String(rec.passed);
  }
  if (rec.ok === true) return JSON.stringify(output);
  return JSON.stringify(output);
};

/**
 * Una tool afirma algo verificable. `memory.search` (hits) y `found:false` no cuentan.
 * Default deny: un objeto desconocido no habilita answer. Strings crudos no cuentan.
 */
export const isPositiveOutput = (output: unknown): boolean => {
  if (typeof output === "string") {
    try {
      return isPositiveOutput(JSON.parse(output));
    } catch {
      return false;
    }
  }
  if (typeof output === "number" || typeof output === "boolean") return true;

  const rec = asRecord(output);
  if (!rec) return false;
  if (rec.found === false) return false;
  if (rec.ok === false) return false;
  if (Array.isArray(rec.hits)) return false;
  if (rec.found === true) return true;
  if (rec.value != null && String(rec.value) !== "") return true;
  if (typeof rec.stdout === "string" && rec.stdout.length > 0) return true;
  if (typeof rec.fnv1a === "string" && rec.fnv1a.length > 0) return true;
  if (typeof rec.count === "number") return true;
  if (typeof rec.prime === "number") return true;
  if (typeof rec.palindrome === "boolean") return true;
  if (rec.result != null) return true;
  if (typeof rec.passed === "boolean" && rec.ok === true) return true;
  if (rec.ok === true) return true;
  return false;
};

export const isPositiveEvidence = (e: Evidence): boolean => isPositiveOutput(e.output);

export function finalizeResult(args: {
  plan: Plan;
  evidence: Evidence[];
  draft?: string | null;
  timings: MageTimings;
  sessionId?: string;
  tenantId?: string;
  graphDisabled?: string;
}): MageResult {
  const { plan, evidence, timings, sessionId, tenantId, graphDisabled } = args;
  const base = {
    plan,
    evidence,
    timings,
    ...(sessionId ? { sessionId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(graphDisabled ? { graphDisabled } : {}),
  };

  if (evidence.length === 0) {
    return {
      ...base,
      status: "refused",
      answer: "",
      refusalReason: "no_evidence",
    };
  }

  const positive = evidence.filter(isPositiveEvidence);
  if (positive.length === 0) {
    const notFound = evidence.some((e) => asRecord(e.output)?.found === false);
    return {
      ...base,
      status: "refused",
      answer: "",
      refusalReason: notFound ? "not_found" : "no_evidence",
    };
  }

  const last = positive.at(-1)!;
  const answer = answerFromOutput(last.output);

  return {
    ...base,
    status: "answered",
    answer,
  };
}
