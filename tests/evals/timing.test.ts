import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config";
import { createRuntime, runMage } from "../../src/loop/metacog";
import { resetSessionStore } from "../../src/session/store";

/** 50ms: CI (GitHub-hosted) es más lento que el 20ms de producto en máquina local. */
const FASTPATH_BUDGET_MS = 50;

describe("eval_fastpath_timing", () => {
  test("(12+8)*3 post-warm dentro del umbral", async () => {
    resetSessionStore();
    const rt = await createRuntime({
      ...loadConfig(),
      provider: "stub",
      fallbackOllama: false,
      sessionStore: "memory",
    });
    await runMage("(12+8)*3", rt);

    const result = await runMage("(12+8)*3", rt);
    expect(result.status).toBe("answered");
    expect(result.answer).toBe("60");
    expect(result.timings.sandboxMs).toBeLessThan(FASTPATH_BUDGET_MS);
    const totalSinBoot = result.timings.totalMs - result.timings.bootMs;
    expect(totalSinBoot).toBeLessThan(FASTPATH_BUDGET_MS);
  });
});
