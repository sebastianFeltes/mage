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

    const created = await fetch(`${base}/v1/sessions`, { method: "POST" });
    const { sessionId } = (await created.json()) as { sessionId: string };
    expect(sessionId).toBeTruthy();

    const q1 = await fetch(`${base}/v1/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hash de mage", sessionId }),
    });
    const r1 = (await q1.json()) as { sessionId: string; answer: string };
    expect(r1.sessionId).toBe(sessionId);
    expect(r1.answer.length).toBeGreaterThan(0);

    const got = await fetch(`${base}/v1/sessions/${sessionId}`);
    const session = (await got.json()) as { turns: unknown[] };
    expect(session.turns.length).toBeGreaterThanOrEqual(2);

    const del = await fetch(`${base}/v1/sessions/${sessionId}`, { method: "DELETE" });
    expect((await del.json()).ok).toBe(true);
  });
});
