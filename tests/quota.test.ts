import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { isQuotaError, parseRetryAfterSec } from "../src/llm/provider";
import { tryOfflinePlan } from "../src/loop/offline";
import { createRuntime } from "../src/loop/metacog";

describe("quota errors", () => {
  test("detecta quota exceeded", () => {
    const err = new Error("Quota exceeded for metric: generate_content_free_tier_requests");
    expect(isQuotaError(err)).toBe(true);
  });

  test("parsea retry after", () => {
    const err = new Error("Please retry in 46.798257044s.");
    expect(parseRetryAfterSec(err)).toBe(47);
  });
});

describe("offline programas verificados", () => {
  test("ordena sin LLM", async () => {
    const rt = await createRuntime({ ...loadConfig(), scriptEnabled: true });
    const result = await tryOfflinePlan(
      "implementa quicksort en TS, ejecútalo con script.run con [3,1,4,1,5]",
      rt,
    );
    expect(result).not.toBeNull();
    expect(result!.answer).toContain("1,1,3,4,5");
    expect(result!.plan.toolCalls[0]?.tool).toBe("script.run");
  });

  test("ordena genérico no dispara programa", async () => {
    const rt = await createRuntime({ ...loadConfig(), scriptEnabled: true });
    const result = await tryOfflinePlan("ordena [3,1,4]", rt);
    expect(result).toBeNull();
  });
});
