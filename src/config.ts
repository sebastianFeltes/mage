import { parseCorsOrigins } from "./http/guard";
import type { GraphBackend } from "./memory/types";

export type ProviderName = "gemini" | "anthropic" | "openai" | "stub";
export type EmbedProvider = ProviderName | "none";

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return value === "1" || value === "true";
};

const num = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const graphBackend = (value: string | undefined): GraphBackend => {
  if (value === "falkor" || value === "off") return value;
  return "sqlite";
};

const provider = (value: string | undefined): ProviderName => {
  if (value === "stub" || value === "anthropic" || value === "openai" || value === "gemini") return value;
  if (process.env.ANTHROPIC_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return "anthropic";
  }
  if (process.env.OPENAI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return "openai";
  }
  return "gemini";
};

export type MageConfig = {
  provider: ProviderName;
  fastModel: string;
  reasonModel: string;
  embedProvider: EmbedProvider;
  embedModel: string;
  falkorHost: string;
  falkorPort: number;
  falkorGraph: string;
  vecPath: string;
  wasmTimeoutMs: number;
  enrichBudgetMs: number;
  maxAttempts: number;
  fastPathConfidence: number;
  vectorTopK: number;
  graphLimit: number;
  scriptEnabled: boolean;
  scriptTimeoutMs: number;
  fallbackOllama: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  sessionEnabled: boolean;
  sessionMaxTurns: number;
  sessionTtlMs: number;
  sessionPath: string;
  sessionStore: "sqlite" | "memory";
  factsPath: string;
  graphBackend: GraphBackend;
  apiKey?: string;
  corsOrigins: string[];
  rateLimitPerMin: number;
  requestTimeoutMs: number;
};

const FAST_MODELS: Record<ProviderName, string> = {
  gemini: "gemini-3.6-flash",
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  stub: "stub",
};

const REASON_MODELS: Record<ProviderName, string> = {
  gemini: "gemini-3.1-pro-preview",
  anthropic: "claude-sonnet-4-5-20250929",
  openai: "gpt-4o",
  stub: "stub",
};

const EMBED_MODELS: Record<Exclude<EmbedProvider, "none">, string> = {
  gemini: "gemini-embedding-001",
  openai: "text-embedding-3-small",
  anthropic: "text-embedding-3-small",
};

export const loadConfig = (): MageConfig => {
  const p = provider(process.env.MAGE_PROVIDER);
  const embedRaw = process.env.MAGE_EMBED_PROVIDER;
  const embedProvider: EmbedProvider =
    embedRaw === "none" || embedRaw === "gemini" || embedRaw === "openai" || embedRaw === "anthropic"
      ? embedRaw
      : "none";

  return {
    provider: p,
    fastModel: process.env.MAGE_FAST_MODEL || FAST_MODELS[p],
    reasonModel: process.env.MAGE_REASON_MODEL || REASON_MODELS[p],
    embedProvider,
    embedModel:
      process.env.MAGE_EMBED_MODEL ||
      (embedProvider === "none" ? "local-fnv" : EMBED_MODELS[embedProvider]),
    falkorHost: process.env.FALKOR_HOST || "127.0.0.1",
    falkorPort: num(process.env.FALKOR_PORT, 6379),
    falkorGraph: process.env.FALKOR_GRAPH || "mage",
    vecPath: process.env.MAGE_VEC_PATH || "./data/mage.vec.db",
    wasmTimeoutMs: num(process.env.MAGE_WASM_TIMEOUT_MS, 50),
    enrichBudgetMs: num(process.env.MAGE_ENRICH_BUDGET_MS, 25),
    maxAttempts: num(process.env.MAGE_MAX_ATTEMPTS, 3),
    fastPathConfidence: num(process.env.MAGE_FAST_PATH_CONFIDENCE, 0.5),
    vectorTopK: num(process.env.MAGE_VECTOR_TOP_K, 5),
    graphLimit: num(process.env.MAGE_GRAPH_LIMIT, 8),
    scriptEnabled: bool(process.env.MAGE_SCRIPT_ENABLED, false),
    scriptTimeoutMs: num(process.env.MAGE_SCRIPT_TIMEOUT_MS, 2000),
    fallbackOllama: bool(process.env.MAGE_FALLBACK_OLLAMA, true),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1",
    ollamaModel: process.env.MAGE_OLLAMA_MODEL || "llama3.2",
    sessionEnabled: bool(process.env.MAGE_SESSION_ENABLED, true),
    sessionMaxTurns: num(process.env.MAGE_SESSION_MAX_TURNS, 20),
    sessionTtlMs: num(process.env.MAGE_SESSION_TTL_MS, 86_400_000),
    sessionPath: process.env.MAGE_SESSION_PATH || "./data/sessions.sqlite",
    sessionStore: process.env.MAGE_SESSION_STORE === "memory" ? "memory" : "sqlite",
    factsPath: process.env.MAGE_FACTS_PATH || "./data/facts.sqlite",
    graphBackend: graphBackend(process.env.MAGE_GRAPH),
    apiKey: process.env.MAGE_API_KEY?.trim() || undefined,
    corsOrigins: parseCorsOrigins(process.env.MAGE_CORS_ORIGINS),
    rateLimitPerMin: num(process.env.MAGE_RATE_LIMIT_PER_MIN, 60),
    requestTimeoutMs: num(process.env.MAGE_REQUEST_TIMEOUT_MS, 60_000),
  };
};
