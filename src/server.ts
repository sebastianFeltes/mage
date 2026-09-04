import { getRuntime } from "./runtime";
import { runMage } from "./loop/metacog";
import type { MageEvent } from "./loop/events";
import { MageApiError } from "./llm/provider";
import { FactInputSchema } from "./llm/schemas";
import { SessionTenantMismatchError } from "./session/errors";
import { createSession, deleteSession, getSession, getSessionStore } from "./session/store";
import { loadConfig } from "./config";
import {
  applyCors,
  assertPublicBind,
  bearerMatches,
  corsHeaders,
  requestSignal,
  SlidingWindowLimiter,
} from "./http/guard";
import {
  MAX_FACTS_PER_REQUEST,
  readJsonBody,
  shouldRateLimit,
  validateQuery,
  validateTenantId,
} from "./http/limits";
import { getIdempotent, idempotencyKey, putIdempotent } from "./http/idempotency";

export type ServerOptions = {
  port?: number;
  hostname?: string;
  /** `null` desactiva auth aunque haya `MAGE_API_KEY` (tests). */
  apiKey?: string | null;
  corsOrigins?: string[];
  rateLimitPerMin?: number;
};

const unauthorized = (): Response =>
  Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );

const jsonError = (error: string, status: number): Response => Response.json({ error }, { status });

const parseBody = async (
  req: Request,
): Promise<{ body: Record<string, unknown> } | { error: Response }> => {
  const r = await readJsonBody(req);
  if (!r.ok) {
    return {
      error: jsonError(r.reason === "too_large" ? "payload_too_large" : "JSON inválido", r.reason === "too_large" ? 413 : 400),
    };
  }
  return { body: r.body };
};

export const startServer = async (opts: ServerOptions = {}) => {
  const port = opts.port ?? Number(process.env.MAGE_PORT ?? 3920);
  const hostname = opts.hostname ?? process.env.MAGE_HOST ?? "127.0.0.1";
  const config = loadConfig();
  const apiKey = opts.apiKey === null ? undefined : (opts.apiKey ?? config.apiKey);
  const corsOrigins = opts.corsOrigins ?? config.corsOrigins;
  const rateLimitPerMin = opts.rateLimitPerMin ?? config.rateLimitPerMin;
  assertPublicBind(hostname, apiKey);
  const limiter = new SlidingWindowLimiter(Math.max(1, rateLimitPerMin));

  const server = Bun.serve({
    hostname,
    port,
    async fetch(req, bunServer) {
      const url = new URL(req.url);

      if (req.method === "OPTIONS") {
        const headers = corsHeaders(req, corsOrigins);
        return new Response(null, { status: 204, headers });
      }

      if (url.pathname.startsWith("/v1/") && apiKey) {
        if (!bearerMatches(req.headers.get("Authorization"), apiKey)) {
          return applyCors(unauthorized(), req, corsOrigins);
        }
      }

      if (shouldRateLimit(url.pathname)) {
        const ip = bunServer.requestIP(req)?.address ?? "unknown";
        const limited = limiter.allow(ip);
        if (!limited.ok) {
          return applyCors(
            Response.json(
              { error: "rate_limited" },
              { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
            ),
            req,
            corsOrigins,
          );
        }
      }

      const res = await route(req, url, { requestTimeoutMs: config.requestTimeoutMs });
      return applyCors(res, req, corsOrigins);
    },
  });

  console.log(`mage http://${hostname}:${server.port}`);
  return server;
};

const route = async (
  req: Request,
  url: URL,
  ctx: { requestTimeoutMs: number },
): Promise<Response> => {
  if (req.method === "GET" && url.pathname === "/health") {
    const rt = await getRuntime();
    const store = getSessionStore(rt.config);
    return Response.json({
      ok: true,
      graph: rt.graph.backend,
      tools: rt.registry.list().map((t) => t.name),
      bootMs: rt.bootMs,
      sessions: {
        enabled: rt.config.sessionEnabled,
        count: store.count(),
      },
      metrics: rt.metrics.snapshot(),
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/sessions") {
    const parsed = await parseBody(req);
    if ("error" in parsed) return parsed.error;
    const tenantRaw = parsed.body.tenantId ? String(parsed.body.tenantId) : "default";
    const tenantErr = validateTenantId(tenantRaw);
    if (tenantErr) return jsonError(tenantErr, 400);
    const session = createSession(loadConfig(), tenantRaw.trim());
    return Response.json({
      sessionId: session.id,
      tenantId: session.tenantId,
      createdAt: session.createdAt,
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/v1/sessions/")) {
    const id = url.pathname.slice("/v1/sessions/".length);
    const tenantId = url.searchParams.get("tenantId")?.trim() ?? "";
    const tenantErr = validateTenantId(tenantId);
    if (tenantErr) return jsonError(tenantErr, 400);
    const session = getSession(loadConfig(), id, tenantId);
    if (!session) return jsonError("sesión no encontrada", 404);
    return Response.json(session);
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/v1/sessions/")) {
    const id = url.pathname.slice("/v1/sessions/".length);
    const tenantId = url.searchParams.get("tenantId")?.trim() ?? "";
    const tenantErr = validateTenantId(tenantId);
    if (tenantErr) return jsonError(tenantErr, 400);
    const ok = deleteSession(loadConfig(), id, tenantId);
    if (!ok) return jsonError("sesión no encontrada", 404);
    return Response.json({ ok: true });
  }

  if (req.method === "POST" && url.pathname === "/v1/query") {
    const parsed = await parseBody(req);
    if ("error" in parsed) return parsed.error;
    const body = parsed.body;
    const query = String(body.query ?? "").trim();
    const queryErr = validateQuery(query);
    if (queryErr) return jsonError(queryErr, 400);
    const sessionId = body.sessionId ? String(body.sessionId) : undefined;
    const tenantId = body.tenantId ? String(body.tenantId) : undefined;
    if (tenantId) {
      const tenantErr = validateTenantId(tenantId);
      if (tenantErr) return jsonError(tenantErr, 400);
    }
    const signal = requestSignal(req, ctx.requestTimeoutMs);
    const cacheKey = idempotencyKey(req.headers.get("Idempotency-Key"), query, sessionId, tenantId);
    if (cacheKey) {
      const cached = getIdempotent(cacheKey);
      if (cached) {
        return new Response(cached.body, {
          status: cached.status,
          headers: { "Content-Type": "application/json", "Idempotency-Replayed": "1" },
        });
      }
    }

    try {
      const rt = await getRuntime();
      const result = await runMage(query, rt, { sessionId, tenantId, signal });
      const payload = JSON.stringify(result);
      if (cacheKey) putIdempotent(cacheKey, 200, payload);
      return new Response(payload, { headers: { "Content-Type": "application/json" } });
    } catch (err) {
      if (signal.aborted) {
        return jsonError("request_timeout", 504);
      }
      if (err instanceof SessionTenantMismatchError) {
        return jsonError(err.message, 403);
      }
      if (err instanceof MageApiError) {
        return Response.json({ error: err.message, retryAfterSec: err.retryAfterSec }, { status: 503 });
      }
      throw err;
    }
  }

  if (req.method === "POST" && url.pathname === "/v1/query/stream") {
    const parsed = await parseBody(req);
    if ("error" in parsed) return parsed.error;
    const body = parsed.body;
    const query = String(body.query ?? "").trim();
    const queryErr = validateQuery(query);
    if (queryErr) return jsonError(queryErr, 400);
    const sessionId = body.sessionId ? String(body.sessionId) : undefined;
    const tenantId = body.tenantId ? String(body.tenantId) : undefined;
    if (tenantId) {
      const tenantErr = validateTenantId(tenantId);
      if (tenantErr) return jsonError(tenantErr, 400);
    }
    const signal = requestSignal(req, ctx.requestTimeoutMs);

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (event: string, data: unknown) => {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        const ping = setInterval(() => send("ping", { ts: Date.now() }), 15_000);

        const onEvent = (e: MageEvent) => {
          if (e.type === "done") {
            send("done", e.result);
          } else if (e.type === "error") {
            send("error", { message: e.message, retryAfterSec: e.retryAfterSec });
          } else {
            send(e.type, e);
          }
        };

        try {
          const rt = await getRuntime();
          await runMage(query, rt, { sessionId, tenantId, signal, onEvent });
        } catch (err) {
          if (signal.aborted) {
            send("error", { message: "request_timeout" });
          } else if (err instanceof SessionTenantMismatchError) {
            send("error", { message: err.message });
          } else if (err instanceof MageApiError) {
            send("error", { message: err.message, retryAfterSec: err.retryAfterSec });
          } else {
            send("error", { message: err instanceof Error ? err.message : String(err) });
          }
        } finally {
          clearInterval(ping);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/memory") {
    const parsed = await parseBody(req);
    if ("error" in parsed) return parsed.error;
    const body = parsed.body;
    const factsRaw = body.facts;
    if (!Array.isArray(factsRaw) || factsRaw.length === 0) {
      return jsonError("facts[] requerido", 400);
    }
    if (factsRaw.length > MAX_FACTS_PER_REQUEST) {
      return jsonError(`facts[] máximo ${MAX_FACTS_PER_REQUEST}`, 400);
    }
    const facts = factsRaw.flatMap((f) => {
      const p = FactInputSchema.safeParse(f);
      return p.success ? [p.data] : [];
    });
    if (facts.length === 0) return jsonError("facts inválidos", 400);
    const tenantRaw = body.tenantId ? String(body.tenantId) : "default";
    const tenantErr = validateTenantId(tenantRaw);
    if (tenantErr) return jsonError(tenantErr, 400);
    const source = body.source ? String(body.source) : undefined;
    const rt = await getRuntime();
    const result = rt.facts.ingest({ tenantId: tenantRaw.trim(), source, facts });
    const status = result.conflicts.length > 0 && result.upserted === 0 ? 409 : 200;
    return Response.json(result, { status });
  }

  return Response.json(
    {
      endpoints: [
        "GET /health",
        "POST /v1/sessions",
        "GET /v1/sessions/:id",
        "DELETE /v1/sessions/:id",
        "POST /v1/query",
        "POST /v1/query/stream",
        "POST /v1/memory",
      ],
    },
    { status: 404 },
  );
};
