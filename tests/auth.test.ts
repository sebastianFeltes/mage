import { afterAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/server";
import { resetRuntime } from "../src/runtime";
import { resetSessionStore } from "../src/session/store";
import {
  assertPublicBind,
  bearerMatches,
  isLoopbackHost,
  parseCorsOrigins,
} from "../src/http/guard";

const KEY = "ola8-test-key";

describe("http auth", () => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined;

  afterAll(() => {
    server?.stop(true);
    resetRuntime();
    resetSessionStore();
  });

  test("query sin bearer con key seteada → 401", async () => {
    resetRuntime();
    resetSessionStore();
    server = await startServer({ port: 0, hostname: "127.0.0.1", apiKey: KEY });
    const base = `http://127.0.0.1:${server.port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);

    const naked = await fetch(`${base}/v1/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "cuánto es 2+2" }),
    });
    expect(naked.status).toBe(401);
    const body = (await naked.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  test("fast path con bearer → 200", async () => {
    resetRuntime();
    resetSessionStore();
    server?.stop(true);
    server = await startServer({ port: 0, hostname: "127.0.0.1", apiKey: KEY });
    const base = `http://127.0.0.1:${server.port}`;

    const res = await fetch(`${base}/v1/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({ query: "cuánto es 2+2" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; answer: string };
    expect(body.status).toBe("answered");
    expect(body.answer).toBe("4");
  });

  test("bind no loopback sin key → refuse boot", async () => {
    await expect(startServer({ port: 0, hostname: "0.0.0.0", apiKey: null })).rejects.toThrow(
      /MAGE_API_KEY/,
    );
  });
});

describe("http cors y rate limit", () => {
  test("CORS nunca es *", async () => {
    expect(parseCorsOrigins("*")).toEqual([]);
    expect(parseCorsOrigins("https://app.example, *")).toEqual(["https://app.example"]);
    resetRuntime();
    const server = await startServer({
      port: 0,
      hostname: "127.0.0.1",
      apiKey: null,
      corsOrigins: ["https://app.example"],
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const ok = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: { Origin: "https://app.example" },
    });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.example");
    server.stop(true);
    resetRuntime();
  });

  test("rate limit en /v1/query → 429", async () => {
    resetRuntime();
    resetSessionStore();
    const server = await startServer({
      port: 0,
      hostname: "127.0.0.1",
      apiKey: KEY,
      rateLimitPerMin: 2,
    });
    const base = `http://127.0.0.1:${server.port}`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    };
    const body = JSON.stringify({ query: "cuánto es 1+1" });
    const a = await fetch(`${base}/v1/query`, { method: "POST", headers, body });
    const b = await fetch(`${base}/v1/query`, { method: "POST", headers, body });
    const c = await fetch(`${base}/v1/query`, { method: "POST", headers, body });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(429);
    server.stop(true);
    resetRuntime();
    resetSessionStore();
  });
});

describe("http guards", () => {
  test("loopback y bearer", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
    assertPublicBind("127.0.0.1", undefined);
    expect(() => assertPublicBind("0.0.0.0", undefined)).toThrow(/MAGE_API_KEY/);
    assertPublicBind("0.0.0.0", "k");
    expect(bearerMatches("Bearer secret", "secret")).toBe(true);
    expect(bearerMatches("Bearer nope", "secret")).toBe(false);
    expect(bearerMatches(null, "secret")).toBe(false);
  });
});
