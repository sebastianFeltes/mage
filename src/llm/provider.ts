import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { embed, generateObject, streamObject } from "ai";
import type { ZodType } from "zod";
import type { EmbedProvider, MageConfig, ProviderName } from "../config";
import { isStubProvider, resolveStub } from "./stub";

type LanguageModel = Parameters<typeof generateObject>[0]["model"];

const google = createGoogleGenerativeAI();
const anthropic = createAnthropic();
const openai = createOpenAI();

export type LlmProvider = ProviderName | "ollama";

export class MageApiError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "MageApiError";
  }
}

const ollamaClient = (baseUrl: string) =>
  createOpenAI({
    baseURL: baseUrl.replace(/\/$/, ""),
    apiKey: "ollama",
  });

export const languageModel = (provider: LlmProvider, model: string, config: MageConfig): LanguageModel => {
  switch (provider) {
    case "stub":
      throw new MageApiError("provider stub no llama red");
    case "gemini":
      return google(model);
    case "anthropic":
      return anthropic(model);
    case "openai":
      return openai(model);
    case "ollama":
      return ollamaClient(config.ollamaBaseUrl)(model);
  }
};

const GEMINI_FALLBACKS = ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"];

export type ModelTier = { provider: LlmProvider; models: string[] };

export const modelTiers = (config: MageConfig, primary: string, heavy = false): ModelTier[] => {
  const tiers: ModelTier[] = [];
  const cloudModels =
    config.provider === "gemini"
      ? [primary, ...GEMINI_FALLBACKS.filter((m) => m !== primary)]
      : [primary];
  if (heavy && !cloudModels.includes(config.reasonModel)) cloudModels.push(config.reasonModel);
  tiers.push({ provider: config.provider, models: cloudModels });

  if (config.fallbackOllama) {
    tiers.push({ provider: "ollama", models: [config.ollamaModel] });
  }
  return tiers;
};

/** @deprecated use modelTiers */
export const modelChain = (config: MageConfig, primary: string, heavy = false): string[] =>
  modelTiers(config, primary, heavy)[0]!.models;

export async function objectFromModel<T>(opts: {
  config: MageConfig;
  tiers: ModelTier[];
  schema: ZodType<T>;
  system: string;
  prompt: string;
  schemaName: string;
  onPartial?: (partial: Partial<T>) => void;
  signal?: AbortSignal;
}): Promise<T> {
  if (isStubProvider(opts.config.provider)) {
    return resolveStub(opts.schema, opts.schemaName);
  }

  let lastErr: unknown;
  let quotaHits = 0;

  for (const tier of opts.tiers) {
    for (const modelName of tier.models) {
      try {
        if (opts.onPartial) {
          const { partialObjectStream, object } = streamObject({
            model: languageModel(tier.provider, modelName, opts.config),
            schema: opts.schema,
            schemaName: opts.schemaName,
            system: opts.system,
            prompt: opts.prompt,
            temperature: 0,
            abortSignal: opts.signal,
          });
          let lastThought = "";
          for await (const partial of partialObjectStream) {
            const p = partial as Partial<T> & { thought?: string };
            if (p.thought && p.thought !== lastThought) {
              const delta = p.thought.slice(lastThought.length);
              if (delta) opts.onPartial({ thought: delta } as Partial<T>);
              lastThought = p.thought;
            }
          }
          return (await object) as T;
        }

        const { object } = await generateObject({
          model: languageModel(tier.provider, modelName, opts.config),
          schema: opts.schema,
          schemaName: opts.schemaName,
          system: opts.system,
          prompt: opts.prompt,
          temperature: 0,
          maxRetries: 0,
          abortSignal: opts.signal,
        });
        return object as T;
      } catch (err) {
        lastErr = err;
        if (isQuotaError(err)) {
          quotaHits++;
          break;
        }
        if (isConnectionError(err)) break;
        if (!isTransientApiError(err)) throw toMageApiError(err);
      }
    }
  }

  throw toMageApiError(lastErr, quotaHits > 0);
}

export const isQuotaError = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("quota") ||
    msg.includes("Quota exceeded") ||
    msg.includes("rate-limit") ||
    msg.includes("RATE_LIMIT") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    (msg.includes("429") && msg.includes("limit"))
  );
};

export const parseRetryAfterSec = (err: unknown): number | null => {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/retry in ([\d.]+)s/i);
  return m ? Math.ceil(Number(m[1])) : null;
};

const isConnectionError = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("Cannot connect to API") ||
    msg.includes("Unable to connect") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  );
};

const isTransientApiError = (err: unknown): boolean => {
  if (isQuotaError(err)) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("503") || msg.includes("high demand") || msg.includes("UNAVAILABLE");
};

const toMageApiError = (err: unknown, quota = false): MageApiError => {
  const msg = err instanceof Error ? err.message : String(err);
  const retry = parseRetryAfterSec(err);

  if (quota || isQuotaError(err)) {
    return new MageApiError(
      `Cuota del proveedor cloud agotada.${retry ? ` Reintenta en ~${retry}s.` : ""} ` +
        `Opciones: esperar, configurar Ollama (MAGE_FALLBACK_OLLAMA=1 + ollama pull ${process.env.MAGE_OLLAMA_MODEL ?? "llama3.2"}), ` +
        `otra API key (OpenAI/Anthropic), o consultas fast path / mage script.`,
      err,
      retry ?? undefined,
    );
  }
  if (isConnectionError(err)) {
    return new MageApiError(
      "Sin conexión al proveedor cloud ni a Ollama. Verifica red/API key o arranca Ollama local (ollama serve).",
      err,
    );
  }
  if (msg.includes("503") || msg.includes("high demand")) {
    return new MageApiError(
      "Gemini saturado (503). Reintenta en unos segundos o usa fast path / mage script.",
      err,
    );
  }
  if (err instanceof MageApiError) return err;
  return new MageApiError(msg, err);
};

export const embedText = async (
  config: MageConfig,
  text: string,
): Promise<Float32Array> => {
  if (config.embedProvider === "none") {
    return localEmbedding(text);
  }
  const model = embedModel(config.embedProvider, config.embedModel);
  const { embedding } = await embed({ model, value: text });
  return Float32Array.from(embedding);
};

const embedModel = (provider: Exclude<EmbedProvider, "none">, model: string) => {
  if (provider === "gemini") return google.embedding(model);
  return openai.embedding(model);
};

export const localEmbedding = (text: string, dims = 64): Float32Array => {
  const out = new Float32Array(dims);
  const bytes = new TextEncoder().encode(text);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619) >>> 0;
    out[h % dims] += 1;
    out[(h >>> 8) % dims] -= 0.5;
  }
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += out[i]! * out[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) out[i] = out[i]! / norm;
  return out;
};
