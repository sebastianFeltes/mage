import type { Plan } from "./schemas";
import { SESSION_HISTORY_KEEP, type SessionSummary, type Turn } from "../session/types";

export const PLAN_SYSTEM = `Eres el planificador de Mage. Responde SOLO el JSON del schema.
Tools de dominio (lectura): kpi.lookup {name}, source.cite {name}, rule.check {name, op, value}, memory.search {query}.
Primitivas: calc {expr}, hash {text}, json_validate {json}.
Si la consulta pide un hecho o cifra, llená toolCalls. Si no aplica ninguna tool, toolCalls=[].
proposedAnswer es un borrador; el runtime lo ignora.
Usa el historial reciente y el resumen de sesión para resolver referencias.
thought breve.`;

export const CORRECTION_SYSTEM = `Corrige el plan. El sandbox falló. No expliques al usuario el error.
Ajusta toolCalls o proposedAnswer. JSON del schema.`;

export const formatContext = (chunks: string[]): string => {
  if (chunks.length === 0) return "";
  return `\nHechos ingestidos:\n${chunks.join("\n")}`;
};

export const formatHistory = (
  turns: Turn[],
  maxTurns = SESSION_HISTORY_KEEP,
  summary?: SessionSummary,
): string => {
  const parts: string[] = [];
  if (summary && (summary.factIds.length > 0 || summary.lastStatus || summary.lastEvidenceIds.length > 0)) {
    const bits: string[] = [];
    if (summary.lastStatus) bits.push(`status=${summary.lastStatus}`);
    if (summary.factIds.length > 0) bits.push(`facts=${summary.factIds.join(",")}`);
    if (summary.lastEvidenceIds.length > 0) bits.push(`evidence=${summary.lastEvidenceIds.join(",")}`);
    parts.push(`Resumen de sesión: ${bits.join(" ")}`);
  }
  if (turns.length === 0) return parts.length > 0 ? `\n${parts.join("\n")}` : "";
  const recent = turns.slice(-maxTurns);
  const lines = recent.map((t) => {
    const prefix = t.role === "user" ? "U" : t.role === "assistant" ? "A" : "S";
    const content = t.content.length > 400 ? t.content.slice(0, 400) + "…" : t.content;
    return `${prefix}: ${content}`;
  });
  parts.push(`Historial reciente:\n${lines.join("\n")}`);
  return `\n${parts.join("\n")}`;
};

export const formatPlanPrompt = (
  query: string,
  context: string,
  tools: string,
  history = "",
): string => `Tools: ${tools}${history}\nConsulta: ${query}${context}`;

export const formatCorrectionPrompt = (
  query: string,
  previous: Plan,
  traces: string[],
  history = "",
): string =>
  `${history ? history + "\n" : ""}Consulta: ${query}\nPlan previo: ${JSON.stringify(previous)}\nErrores:\n${traces.join("\n")}`;
