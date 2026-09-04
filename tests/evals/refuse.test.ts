import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config";
import { createRuntime, runMage } from "../../src/loop/metacog";
import { resetSessionStore } from "../../src/session/store";

const stubRuntime = () =>
  createRuntime({
    ...loadConfig(),
    provider: "stub",
    fallbackOllama: false,
    sessionStore: "memory",
  });

describe("eval_refuse", () => {
  test("plan vacío no inventa un número", async () => {
    resetSessionStore();
    const rt = await stubRuntime();
    const result = await runMage("cuál es el PIB de Francia", rt);
    expect(result.status).toBe("refused");
    expect(result.answer).toBe("");
    expect(/\d/.test(result.answer)).toBe(false);
    expect(result.evidence).toEqual([]);
  });
});
