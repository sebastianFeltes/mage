import {
  KpiLookupInputSchema,
  MemoryIngestInputSchema,
  RuleCheckInputSchema,
  SourceCiteInputSchema,
} from "../llm/schemas";
import { DEFAULT_FACT_TENANT, type FactStore } from "../memory/ingest";

export type WedgeHost = {
  facts: FactStore;
  tenantId: string;
};

export const runWedgeTool = (name: string, input: unknown, host: WedgeHost): unknown | null => {
  const tenantId = host.tenantId || DEFAULT_FACT_TENANT;
  if (name === "kpi.lookup") {
    const { name: kpi } = KpiLookupInputSchema.parse(input);
    const fact = host.facts.lookup(tenantId, kpi);
    if (!fact) return { found: false, name: kpi, text: "", source: "" };
    return {
      found: true,
      name: fact.name,
      value: fact.value,
      text: fact.text,
      source: fact.source,
    };
  }
  if (name === "source.cite") {
    const { name: kpi } = SourceCiteInputSchema.parse(input);
    const fact = host.facts.lookup(tenantId, kpi);
    if (!fact) return { found: false, source: "", verifiedBy: "ingest" as const, createdAt: 0 };
    return {
      found: true,
      source: fact.source,
      verifiedBy: fact.verifiedBy,
      createdAt: fact.createdAt,
    };
  }
  if (name === "rule.check") {
    const { name: kpi, op, value } = RuleCheckInputSchema.parse(input);
    const fact = host.facts.lookup(tenantId, kpi);
    if (!fact || fact.value == null || fact.value === "") {
      return { ok: false, passed: false };
    }
    const passed = compareValue(fact.value, op, value);
    return { ok: true, actual: fact.value, passed };
  }
  if (name === "memory.ingest") {
    const data = MemoryIngestInputSchema.parse(input);
    return host.facts.ingest({
      tenantId: data.tenantId ?? tenantId,
      source: data.source,
      facts: data.facts,
    });
  }
  return null;
};

const compareValue = (actual: string, op: "eq" | "gte" | "lte", expected: string): boolean => {
  const a = Number(actual);
  const b = Number(expected);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    if (op === "eq") return a === b;
    if (op === "gte") return a >= b;
    return a <= b;
  }
  if (op === "eq") return actual === expected;
  return false;
};
