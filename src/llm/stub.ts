import type { ZodType } from "zod";

export const STUB_EMPTY_PLAN = {
  thought: "stub",
  confidence: 0,
  assumptions: [] as string[],
  toolCalls: [] as { tool: string; input: unknown; reason: string }[],
  proposedAnswer: null,
  memoryCandidates: [] as unknown[],
  relationCandidates: [] as unknown[],
};

export const isStubProvider = (provider?: string): boolean =>
  provider === "stub" || process.env.MAGE_PROVIDER === "stub";

export const resolveStub = <T>(schema: ZodType<T>, schemaName: string): T => {
  const raw = process.env.MAGE_STUB_PLAN;
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (schemaName === "Correction" && parsed.fix == null) parsed.fix = "stub";
    return schema.parse(parsed);
  }
  const empty = schemaName === "Correction" ? { ...STUB_EMPTY_PLAN, fix: "stub" } : STUB_EMPTY_PLAN;
  return schema.parse(empty);
};
