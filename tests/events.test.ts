import { describe, expect, test } from "bun:test";
import { createRuntime, runMage } from "../src/loop/metacog";
import { loadConfig } from "../src/config";
import { resetSessionStore } from "../src/session/store";

describe("mage events", () => {
  test("fast path emite start, answer, done", async () => {
    resetSessionStore();
    const rt = await createRuntime(loadConfig());
    const events: string[] = [];
    await runMage("cuánto es 2+2", rt, {
      onEvent: (e) => events.push(e.type),
    });
    expect(events).toContain("start");
    expect(events).toContain("answer");
    expect(events).toContain("done");
  });

  test("asigna sessionId", async () => {
    resetSessionStore();
    const rt = await createRuntime(loadConfig());
    const r1 = await runMage("hash de test", rt);
    expect(r1.sessionId).toBeTruthy();

    const r2 = await runMage("hash de otro", rt, { sessionId: r1.sessionId });
    expect(r2.sessionId).toBe(r1.sessionId);
  });
});
