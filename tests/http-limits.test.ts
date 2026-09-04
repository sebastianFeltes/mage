import { afterAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/server";
import { resetRuntime } from "../src/runtime";
import { resetSessionStore } from "../src/session/store";
import { MAX_FACTS_PER_REQUEST, MAX_QUERY_LENGTH } from "../src/http/limits";

describe("http limits", () => {
  let base = "";
  let server: Awaited<ReturnType<typeof startServer>> | undefined;

  afterAll(() => {
    server?.stop();
    resetRuntime();
    resetSessionStore();
  });

  const boot = async (rateLimitPerMin = 60) => {
    resetRuntime();
    resetSessionStore();
    server?.stop();
    server = await startServer({ port: 0, hostname: "127.0.0.1", apiKey: null, rateLimitPerMin });
    const addr = server.address;
    const port = typeof addr === "object" && addr ? addr.port : 3920;
    base = `http://127.0.0.1:${port}`;
  };

  test("query demasiado larga → 400", async () => {
    await boot();
    const res = await fetch(`${base}/v1/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "x".repeat(MAX_QUERY_LENGTH + 1) }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("query demasiado larga");
  });

  test("facts[] excede máximo → 400", async () => {
    await boot();
    const facts = Array.from({ length: MAX_FACTS_PER_REQUEST + 1 }, (_, i) => ({
      name: `k${i}`,
      text: "t",
    }));
    const res = await fetch(`${base}/v1/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facts }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("facts[] máximo");
  });

  test("rate limit en POST /v1/memory → 429", async () => {
    await boot(2);
    const body = JSON.stringify({
      facts: [{ name: "x", text: "y", value: "1" }],
    });
    const headers = { "Content-Type": "application/json" };
    expect((await fetch(`${base}/v1/memory`, { method: "POST", headers, body })).status).toBe(200);
    expect((await fetch(`${base}/v1/memory`, { method: "POST", headers, body })).status).toBe(200);
    const limited = await fetch(`${base}/v1/memory`, { method: "POST", headers, body });
    expect(limited.status).toBe(429);
  });
});
