import { describe, expect, test } from "bun:test";
import { startServer } from "../src/server";
import { resetRuntime } from "../src/runtime";

describe("http server", () => {
  test("health y query fastpath", async () => {
    resetRuntime();
    const server = await startServer({ port: 0, apiKey: null });
    const port = server.port;
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/health`);
    expect(health.ok).toBe(true);
    const h = (await health.json()) as { ok: boolean; tools: string[] };
    expect(h.ok).toBe(true);
    expect(h.tools).toContain("calc");

    const res = await fetch(`${base}/v1/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "cuánto es 2+2" }),
    });
    const body = (await res.json()) as { answer: string; status: string; timings: { planMs: number } };
    expect(body.status).toBe("answered");
    expect(body.answer).toBe("4");
    expect(body.timings.planMs).toBe(0);

    server.stop(true);
    resetRuntime();
  });
});
