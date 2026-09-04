import { z } from "zod";
import {
  CalcInputSchema,
  CalcOutputSchema,
  CountLetterInputSchema,
  CountLetterOutputSchema,
  HashInputSchema,
  HashOutputSchema,
  IsPalindromeInputSchema,
  IsPalindromeOutputSchema,
  JsonValidateInputSchema,
  JsonValidateOutputSchema,
  MemoryIngestInputSchema,
  MemoryIngestOutputSchema,
  MemorySearchInputSchema,
  MemorySearchOutputSchema,
  NextPrimeInputSchema,
  NextPrimeOutputSchema,
  RuleCheckInputSchema,
  RuleCheckOutputSchema,
  ScriptRunInputSchema,
  ScriptRunOutputSchema,
  SourceCiteInputSchema,
  SourceCiteOutputSchema,
  KpiLookupInputSchema,
  KpiLookupOutputSchema,
} from "../llm/schemas";
import type { HybridHit } from "../memory/types";
import type { FactStore } from "../memory/ingest";
import type { ScriptRunner } from "../sandbox/script";
import { SandboxError } from "../sandbox/runner";
import type { WasmPool } from "../sandbox/pool";
import { runWedgeTool } from "./wedge";

export type ToolKind = "wasm" | "host";
export type ToolSideEffect = "none" | "read" | "write";

export type ToolManifest = {
  name: string;
  kind: ToolKind;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
  sideEffects: ToolSideEffect;
  idempotent: boolean;
  timeoutMs?: number;
};

export type HostContext = {
  memorySearch: (query: string) => Promise<HybridHit[]>;
  script: ScriptRunner;
  facts?: FactStore;
  tenantId?: string;
  /** Solo CLI/HTTP. El planner nunca escribe memoria. */
  allowWrite?: boolean;
};

/** Tools de demo / write: no van al prompt del planner. Siguen en dispatch (fast path). */
const HIDDEN_FROM_PLANNER = new Set([
  "memory.ingest",
  "count_letter",
  "is_palindrome",
  "next_prime",
  "script.run",
]);

export type DispatchResult = {
  output: unknown;
};

const wasm = (
  name: string,
  description: string,
  input: z.ZodType,
  output: z.ZodType,
): ToolManifest => ({
  name,
  kind: "wasm",
  description,
  input,
  output,
  sideEffects: "none",
  idempotent: true,
});

const BUILTIN_TOOLS: ToolManifest[] = [
  wasm("calc", "aritmética: {expr}", CalcInputSchema, CalcOutputSchema),
  wasm("json_validate", "JSON válido: {json}", JsonValidateInputSchema, JsonValidateOutputSchema),
  wasm("hash", "fnv1a: {text}", HashInputSchema, HashOutputSchema),
  wasm("count_letter", "contar letra: {text, letter}", CountLetterInputSchema, CountLetterOutputSchema),
  wasm("is_palindrome", "palíndromo: {text}", IsPalindromeInputSchema, IsPalindromeOutputSchema),
  wasm("next_prime", "primo > min: {min}", NextPrimeInputSchema, NextPrimeOutputSchema),
  {
    name: "script.run",
    kind: "host",
    description: "ejecutar TS/Bun aislado: {code, stdin?} → stdout/stderr",
    input: ScriptRunInputSchema,
    output: ScriptRunOutputSchema,
    sideEffects: "none",
    idempotent: false,
  },
  {
    name: "memory.search",
    kind: "host",
    description: "búsqueda híbrida: {query}",
    input: MemorySearchInputSchema,
    output: MemorySearchOutputSchema,
    sideEffects: "read",
    idempotent: true,
  },
  {
    name: "kpi.lookup",
    kind: "host",
    description: "KPI ingestido: {name} → valor y fuente",
    input: KpiLookupInputSchema,
    output: KpiLookupOutputSchema,
    sideEffects: "read",
    idempotent: true,
  },
  {
    name: "source.cite",
    kind: "host",
    description: "provenance de un hecho: {name}",
    input: SourceCiteInputSchema,
    output: SourceCiteOutputSchema,
    sideEffects: "read",
    idempotent: true,
  },
  {
    name: "rule.check",
    kind: "host",
    description: "regla sobre KPI: {name, op: eq|gte|lte, value}",
    input: RuleCheckInputSchema,
    output: RuleCheckOutputSchema,
    sideEffects: "read",
    idempotent: true,
  },
  {
    name: "memory.ingest",
    kind: "host",
    description: "escribir hechos (solo CLI/HTTP, no el planner)",
    input: MemoryIngestInputSchema,
    output: MemoryIngestOutputSchema,
    sideEffects: "write",
    idempotent: true,
  },
];

const PluginOutputSchema = z.unknown();

export class ToolRegistry {
  private readonly host = new Map<string, ToolManifest>();
  private readonly wasm = new Map<string, ToolManifest>();

  constructor(pool?: WasmPool) {
    for (const t of BUILTIN_TOOLS) {
      if (t.kind === "host") this.host.set(t.name, t);
      else this.wasm.set(t.name, t);
    }
    if (pool) this.syncWasm(pool);
  }

  syncWasm(pool: WasmPool): void {
    for (const b of pool.bindings()) {
      if (this.wasm.has(b.name)) continue;
      this.wasm.set(b.name, {
        name: b.name,
        kind: "wasm",
        description: `plugin wasm: ${b.exportName}`,
        input: z.record(z.string(), z.unknown()),
        output: PluginOutputSchema,
        sideEffects: "none",
        idempotent: true,
      });
    }
  }

  list(): ToolManifest[] {
    return [...this.host.values(), ...this.wasm.values()];
  }

  catalogLine(): string {
    return this.list()
      .filter((t) => t.sideEffects !== "write" && !HIDDEN_FROM_PLANNER.has(t.name))
      .map((t) => `${t.name}(${t.description})`)
      .join("; ");
  }

  async dispatch(
    name: string,
    input: unknown,
    pool: WasmPool,
    host?: HostContext,
  ): Promise<DispatchResult> {
    const hostTool = this.host.get(name);
    if (hostTool) {
      if (!host) throw new SandboxError(name, "host context requerido");
      if (hostTool.sideEffects === "write" && !host.allowWrite) {
        throw new SandboxError(name, "write tool no permitida en el planner");
      }
      const parsed = hostTool.input.safeParse(input);
      if (!parsed.success) throw new SandboxError(name, parsed.error.message);
      if (name === "memory.search") {
        const { query } = MemorySearchInputSchema.parse(parsed.data);
        const hits = await host.memorySearch(query);
        return { output: assertOutput(name, { ok: true, hits }, hostTool.output) };
      }
      if (name === "script.run") {
        const data = ScriptRunInputSchema.parse(parsed.data);
        const result = await host.script.run(data);
        return { output: assertOutput(name, result, hostTool.output) };
      }
      if (host.facts) {
        const wedge = runWedgeTool(name, parsed.data, {
          facts: host.facts,
          tenantId: host.tenantId ?? "default",
        });
        if (wedge !== null) return { output: assertOutput(name, wedge, hostTool.output) };
      }
      throw new SandboxError(name, `host tool sin handler: ${name}`);
    }

    const wasmTool = this.wasm.get(name);
    if (!wasmTool) throw new SandboxError(name, `tool desconocida: ${name}`);
    const parsed = wasmTool.input.safeParse(input);
    if (!parsed.success) throw new SandboxError(name, parsed.error.message);
    const result = await pool.run(name, JSON.stringify(parsed.data));
    return { output: parseJsonOutput(name, result.output, wasmTool.output) };
  }
}

export async function dispatchTool(
  name: string,
  input: unknown,
  pool: WasmPool,
  host?: HostContext,
  registry = new ToolRegistry(pool),
): Promise<DispatchResult> {
  return registry.dispatch(name, input, pool, host);
}

const assertOutput = (tool: string, data: unknown, schema: z.ZodType): unknown => {
  const checked = schema.safeParse(data);
  if (!checked.success) throw new SandboxError(tool, `output inválido: ${checked.error.message}`);
  return checked.data;
};

const parseJsonOutput = (tool: string, raw: string, schema: z.ZodType): unknown => {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new SandboxError(tool, "JSON de output inválido");
  }
  return assertOutput(tool, data, schema);
};
