import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../src/config";
import { createRuntime, runMage } from "../../src/loop/metacog";
import { resetSessionStore } from "../../src/session/store";
import { assertGolden, type Golden } from "./compare";

const stubRuntime = () =>
  createRuntime({
    ...loadConfig(),
    provider: "stub",
    fallbackOllama: false,
    sessionStore: "memory",
  });

describe("evals goldens", () => {
  test("fast path y refuse coinciden con traces estables", async () => {
    resetSessionStore();
    const rt = await stubRuntime();
    const dir = join(import.meta.dir, "goldens");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const golden = (await Bun.file(join(dir, file)).json()) as Golden;
      const result = await runMage(golden.query, rt);
      assertGolden(golden, result);
    }
  });
});
