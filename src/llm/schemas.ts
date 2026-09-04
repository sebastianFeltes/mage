import { z } from "zod";

/** Schemas compactos: menos tokens = menor TTFT. */

export const ToolCallSchema = z.object({
  tool: z.string(),
  input: z.unknown(),
  reason: z.string(),
});

export const MemoryCandidateSchema = z.object({
  type: z.enum(["Entidad", "Concepto", "Hecho"]),
  name: z.string(),
  props: z.record(z.string(), z.string()).default({}),
});

export const RelationCandidateSchema = z.object({
  type: z.enum(["DEPENDE_DE", "RELACIONADO_CON", "PREFIERE"]),
  from: z.string(),
  to: z.string(),
  weight: z.number().min(0).max(1).optional(),
});

export const PlanSchema = z.object({
  thought: z.string(),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string()).default([]),
  toolCalls: z.array(ToolCallSchema).default([]),
  proposedAnswer: z.string().nullable(),
  refuse: z.boolean().optional(),
  refuseReason: z.string().optional(),
  memoryCandidates: z.array(MemoryCandidateSchema).default([]),
  relationCandidates: z.array(RelationCandidateSchema).default([]),
});

export const CorrectionSchema = PlanSchema.extend({
  fix: z.string(),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;
export type RelationCandidate = z.infer<typeof RelationCandidateSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Correction = z.infer<typeof CorrectionSchema>;

export const CalcInputSchema = z.object({
  expr: z.string(),
});

export const JsonValidateInputSchema = z.object({
  json: z.string(),
});

export const HashInputSchema = z.object({
  text: z.string(),
});

export const CountLetterInputSchema = z.object({
  text: z.string(),
  letter: z.string().min(1).max(1),
});

export const IsPalindromeInputSchema = z.object({
  text: z.string(),
});

export const NextPrimeInputSchema = z.object({
  min: z.union([z.string(), z.number()]),
});

export const ScriptRunInputSchema = z.object({
  code: z.string().min(1).max(32_000),
  stdin: z.string().optional(),
});

export const MemorySearchInputSchema = z.object({
  query: z.string(),
});

export const KpiLookupInputSchema = z.object({
  name: z.string().min(1),
});

export const KpiLookupOutputSchema = z.object({
  found: z.boolean(),
  name: z.string(),
  value: z.string().optional(),
  text: z.string(),
  source: z.string(),
});

export const SourceCiteInputSchema = z.object({
  name: z.string().min(1),
});

export const SourceCiteOutputSchema = z.object({
  found: z.boolean(),
  source: z.string(),
  verifiedBy: z.enum(["ingest", "human", "tool"]),
  createdAt: z.number(),
});

export const RuleCheckInputSchema = z.object({
  name: z.string().min(1),
  op: z.enum(["eq", "gte", "lte"]),
  value: z.string(),
});

export const RuleCheckOutputSchema = z.object({
  ok: z.boolean(),
  actual: z.string().optional(),
  passed: z.boolean(),
});

export const FactInputSchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
  value: z.string().optional(),
  source: z.string().optional(),
  verifiedBy: z.enum(["ingest", "human", "tool"]).optional(),
  expiresAt: z.number().optional(),
  id: z.string().optional(),
  tenantId: z.string().optional(),
});

export const MemoryIngestInputSchema = z.object({
  facts: z.array(FactInputSchema).min(1),
  tenantId: z.string().optional(),
  source: z.string().optional(),
});

export const FactConflictSchema = z.object({
  name: z.string(),
  reason: z.string(),
  existingValue: z.string().optional(),
  incomingValue: z.string().optional(),
});

export const MemoryIngestOutputSchema = z.object({
  upserted: z.number(),
  conflicts: z.array(FactConflictSchema).default([]),
});

export const CalcOutputSchema = z.object({
  ok: z.literal(true),
  value: z.number(),
});

export const HashOutputSchema = z.object({
  ok: z.literal(true),
  fnv1a: z.string(),
});

export const JsonValidateOutputSchema = z.object({
  ok: z.literal(true),
});

export const CountLetterOutputSchema = z.object({
  ok: z.literal(true),
  count: z.number(),
});

export const IsPalindromeOutputSchema = z.object({
  ok: z.literal(true),
  palindrome: z.boolean(),
  normalized: z.string(),
});

export const NextPrimeOutputSchema = z.object({
  ok: z.literal(true),
  prime: z.number(),
});

export const HybridHitSchema = z.object({
  source: z.enum(["graph", "vector"]),
  name: z.string(),
  text: z.string(),
  score: z.number(),
});

export const MemorySearchOutputSchema = z.object({
  ok: z.literal(true),
  hits: z.array(HybridHitSchema),
});

export const ScriptRunOutputSchema = z.object({
  ok: z.boolean(),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  ms: z.number(),
});

export type CalcOutput = z.infer<typeof CalcOutputSchema>;
export type HashOutput = z.infer<typeof HashOutputSchema>;
export type JsonValidateOutput = z.infer<typeof JsonValidateOutputSchema>;
export type MemorySearchOutput = z.infer<typeof MemorySearchOutputSchema>;
export type ScriptRunOutput = z.infer<typeof ScriptRunOutputSchema>;
