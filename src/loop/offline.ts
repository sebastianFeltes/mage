import { z } from "zod";
import type { MageRuntime } from "./metacog";
import type { Plan } from "../llm/schemas";
import { scriptResultJson } from "../sandbox/script";
import { finalizeResult, type MageResult } from "./result";

const NumberArraySchema = z.array(z.number()).min(1);

type OfflineProgram = {
  id: string;
  match: (query: string) => number[] | null;
  inputSchema: z.ZodType<number[]>;
  code: (n: number[]) => string;
};

const extractNumberArray = (query: string): number[] | null => {
  const m = query.match(/\[(-?[\d.]+(?:\s*,\s*-?[\d.]+)*)\]/);
  if (!m) return null;
  const nums = m[1]!.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  return nums.length > 0 ? nums : null;
};

/** Programas verificados: match explícito + schema. No generar código desde /ordena/. */
const PROGRAMS: OfflineProgram[] = [
  {
    id: "sort",
    match: (query) => {
      if (!/\bquicksort\b|\bquick\s*sort\b/i.test(query)) return null;
      return extractNumberArray(query);
    },
    inputSchema: NumberArraySchema,
    code: (n) => `
const input = ${JSON.stringify(n)};
return input.slice().sort((a, b) => a - b);
`,
  },
];

/** Si el LLM no está disponible (cuota), intenta un programa verificado local. */
export const tryOfflinePlan = async (query: string, rt: MageRuntime): Promise<MageResult | null> => {
  if (!rt.config.scriptEnabled) return null;
  for (const program of PROGRAMS) {
    const raw = program.match(query);
    if (!raw) continue;
    const parsed = program.inputSchema.safeParse(raw);
    if (!parsed.success) continue;
    const result = await runScriptPlan(rt, program.code(parsed.data), `offline:${program.id}`);
    if (result) return result;
  }
  return null;
};

const runScriptPlan = async (rt: MageRuntime, code: string, tag: string): Promise<MageResult | null> => {
  const t0 = performance.now();
  try {
    const result = await rt.script.run({ code });
    const stdout = result.stdout.trim();
    const output = {
      ok: result.ok,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      ms: result.ms,
    };
    const plan: Plan = {
      thought: tag,
      confidence: 1,
      assumptions: ["LLM no disponible; programa verificado con script.run"],
      toolCalls: [{ tool: "script.run", input: { code }, reason: "fallback cuota" }],
      proposedAnswer: stdout || scriptResultJson(result),
      memoryCandidates: [],
      relationCandidates: [],
    };
    const sandboxMs = performance.now() - t0;
    return finalizeResult({
      plan,
      evidence: [
        {
          id: crypto.randomUUID(),
          tool: "script.run",
          input: { code },
          output,
          ms: sandboxMs,
        },
      ],
      draft: plan.proposedAnswer,
      timings: {
        bootMs: rt.bootMs,
        enrichMs: 0,
        planMs: 0,
        sandboxMs,
        totalMs: sandboxMs,
        attempts: 0,
        usedReasonModel: false,
      },
      graphDisabled: rt.graph.disabledReason ?? undefined,
    });
  } catch {
    return null;
  }
};
