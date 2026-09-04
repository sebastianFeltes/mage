import { timingSafeEqual } from "node:crypto";

export const isLoopbackHost = (host: string): boolean => {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "127.0.0.1" ||
    h === "localhost" ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1" ||
    h === "::ffff:127.0.0.1"
  );
};

export const assertPublicBind = (hostname: string, apiKey: string | undefined): void => {
  if (!isLoopbackHost(hostname) && !apiKey) {
    throw new Error("MAGE_API_KEY requerida cuando MAGE_HOST no es loopback");
  }
};

export const bearerMatches = (header: string | null, key: string): boolean => {
  if (!header) return false;
  const m = /^Bearer\s+(\S+)/i.exec(header.trim());
  if (!m?.[1]) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(key);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

export const parseCorsOrigins = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "*");
};

export const corsHeaders = (req: Request, allowed: string[]): Record<string, string> => {
  const origin = req.headers.get("Origin");
  if (!origin || allowed.length === 0) return {};
  if (!allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    Vary: "Origin",
  };
};

export const applyCors = (res: Response, req: Request, allowed: string[]): Response => {
  const extra = corsHeaders(req, allowed);
  const keys = Object.keys(extra);
  if (keys.length === 0) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs = 60_000,
  ) {}

  allow(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
    const cutoff = now - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      const oldest = arr[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      return { ok: false, retryAfterSec };
    }
    arr.push(now);
    this.hits.set(key, arr);
    return { ok: true };
  }
}

export const requestSignal = (req: Request, timeoutMs: number): AbortSignal => {
  if (timeoutMs <= 0) return req.signal;
  const timeout = AbortSignal.timeout(timeoutMs);
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([req.signal, timeout]);
  }
  return timeout;
};
