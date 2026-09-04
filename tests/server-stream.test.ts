import { afterAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/server";
import { resetRuntime } from "../src/runtime";
import { resetSessionStore } from "../src/session/store";

describe("http stream", () => {
  let base = "";
  let server: ReturnType<typeof Bun.serve> | Awaited<ReturnType<typeof startServer>>;

  afterAll(() => {
    server?.stop();
    resetRuntime();
    resetSessionStore();
  });

  test("SSE parseable con eventos", async () => {
    resetRuntime();
    resetSessionStore();
    server = await startServer({ port: 0, hostname: "127.0.0.1", apiKey: null });
    const addr = server.address;
    const port = typeof addr === "object" && addr ? addr.port : 3920;
    base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/v1/query/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "cuánto es 3+3" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("event: start");
    expect(text).toContain("event: answer");
    expect(text).toContain("event: done");
    expect(text).toContain("6");
    expect(text).toContain('"status":"answered"');
  });
});

describe("http sessions", () => {
  let base = "";
  let server: ReturnType<typeof Bun.serve> | Awaited<ReturnType<typeof startServer>>;

  afterAll(() => {
    server?.stop();
    resetRuntime();
    resetSessionStore();
  });

  test("CRUD sesiones y multi-turn", async () => {
    resetRuntime();
    resetSessionStore();
    server = await startServer({ port: 0, hostname: "127.0.0.1", apiKey: null });
    const addr = server.address;
    const port = typeof addr === "object" && addr ? addr.port : 3920;
    base = `http://127.0.0.1:${port}`;

    const created = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(created.status).toBe(200);
    const { sessionId, tenantId } = (await created.json()) as { sessionId: string; tenantId: string };
    expect(sessionId).toBeTruthy();
    expect(tenantId).toBe("default");

    const q1 = await fetch(`${base}/v1/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hash de mage", sessionId, tenantId }),
    });
    const r1 = (await q1.json()) as { sessionId: string; answer: string };
    expect(r1.sessionId).toBe(sessionId);
    expect(r1.answer.length).toBeGreaterThan(0);

    const noTenant = await fetch(`${base}/v1/sessions/${sessionId}`);
    expect(noTenant.status).toBe(400);

    const got = await fetch(`${base}/v1/sessions/${sessionId}?tenantId=${tenantId}`);
    const session = (await got.json()) as { turns: unknown[] };
    expect(session.turns.length).toBeGreaterThanOrEqual(2);

    const wrongTenant = await fetch(`${base}/v1/sessions/${sessionId}?tenantId=other`);
    expect(wrongTenant.status).toBe(404);

    const delNoTenant = await fetch(`${base}/v1/sessions/${sessionId}`, { method: "DELETE" });
    expect(delNoTenant.status).toBe(400);

    const del = await fetch(`${base}/v1/sessions/${sessionId}?tenantId=${tenantId}`, { method: "DELETE" });
    expect((await del.json()).ok).toBe(true);
  });
});

describe("http session tenant", () => {
  let base = "";
  let server: ReturnType<typeof Bun.serve> | Awaited<ReturnType<typeof startServer>>;

  afterAll(() => {
    server?.stop();
    resetRuntime();
    resetSessionStore();
  });

  test("query con sessionId de otro tenant → 403", async () => {
    resetRuntime();
    resetSessionStore();
    server = await startServer({ port: 0, hostname: "127.0.0.1", apiKey: null });
    const addr = server.address;
    const port = typeof addr === "object" && addr ? addr.port : 3920;
    base = `http://127.0.0.1:${port}`;

    const created = await fetch(`${base}/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "acme" }),
    });
    const { sessionId } = (await created.json()) as { sessionId: string };

    const res = await fetch(`${base}/v1/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "cuánto es 1+1", sessionId, tenantId: "globex" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("session_tenant_mismatch");
  });
});
