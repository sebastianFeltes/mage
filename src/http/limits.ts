/** Límites HTTP — endurecimiento DoS en `mage serve`. */

export const MAX_QUERY_LENGTH = 16_384;
export const MAX_JSON_BODY_BYTES = 1_048_576;
export const MAX_FACTS_PER_REQUEST = 500;
export const MAX_TENANT_ID_LENGTH = 128;

export type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: "too_large" | "invalid_json" };

export const readJsonBody = async (
  req: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<JsonBodyResult> => {
  const cl = req.headers.get("content-length");
  if (cl) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > maxBytes) return { ok: false, reason: "too_large" };
  }
  const raw = await req.text();
  if (raw.length > maxBytes) return { ok: false, reason: "too_large" };
  if (!raw.trim()) return { ok: false, reason: "invalid_json" };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "invalid_json" };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
};

export const validateQuery = (query: string): string | null => {
  const t = query.trim();
  if (!t) return "query requerida";
  if (t.length > MAX_QUERY_LENGTH) return "query demasiado larga";
  return null;
};

export const validateTenantId = (tenantId: string): string | null => {
  const t = tenantId.trim();
  if (!t) return "tenantId requerido";
  if (t.length > MAX_TENANT_ID_LENGTH) return "tenantId demasiado largo";
  return null;
};

export const shouldRateLimit = (pathname: string): boolean =>
  pathname === "/v1/query" ||
  pathname === "/v1/query/stream" ||
  pathname === "/v1/memory" ||
  pathname === "/v1/sessions" ||
  pathname.startsWith("/v1/sessions/");
