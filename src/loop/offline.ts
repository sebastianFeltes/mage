import { z } from "zod";
import type { MageRuntime } from "./metacog";
import type { Plan } from "../llm/schemas";
import { scriptResultJson } from "../sandbox/script";
import { finalizeResult, type MageResult } from "./result";

const SortInputSchema = z.array(z.number()).min(1);

type OfflineProgram = {
  id: string;
  inputSchema: z.ZodType<number[]>;
  run: (input: number[]) => string;
};

/** Un programa = id + schema + run cerrado. Cero regex de marketing. */
const PROGRAMS: OfflineProgram[] = [
  {
    id: "sort",
    inputSchema: SortInputSchema,
    run: (n) => `return ${JSON.stringify(n)}.slice().sort((a, b) => a - b);`,
  },
];

const EXPLICIT = /^(?:offline:)?([a-zA-Z_][\w]*)\s+(\[[\s\S]*\])\s*$/;

const parseProgramCall = (query: string): { id: string; raw: unknown } | null => {
  const trimmed = query.trim();
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const rec = obj as { program?: unknown; input?: unknown };
      if (typeof rec.program === "string") {
        return { id: rec.program.trim().toLowerCase(), raw: rec.input };
      }
    }
  } catch {
    // no es envelope JSON
  }
  const m = EXPLICIT.exec(trimmed);
  if (!m) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(m[2]!);
  } catch {
    return null;
  }
  return { id: m[1]!.toLowerCase(), raw };
};

/** Si el LLM no está disponible (cuota), intenta un programa verificado local. */
export const tryOfflinePlan = async (query: string, rt: MageRuntime): Promise<MageResult | null> => {
  if (!rt.config.scriptEnabled) return null;
  const call = parseProgramCall(query);
  if (!call) return null;
  const program = PROGRAMS.find((p) => p.id === call.id);
  if (!program) return null;
  const parsed = program.inputSchema.safeParse(call.raw);
  if (!parsed.success) return null;
  return runScriptPlan(rt, program.run(parsed.data), `offline:${program.id}`);
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
