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
  test("offline_sort_explicito", async () => {
    const rt = await createRuntime({ ...loadConfig(), scriptEnabled: true });
    const result = await tryOfflinePlan("sort [3,1,4,1,5]", rt);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("answered");
    expect(result!.answer).toContain("1,1,3,4,5");
    expect(result!.plan.toolCalls[0]?.tool).toBe("script.run");
  });

  test("offline_ordena_no_dispara", async () => {
    const rt = await createRuntime({ ...loadConfig(), scriptEnabled: true });
    const result = await tryOfflinePlan("ordena [3,1,4]", rt);
    expect(result).toBeNull();
  });

  test("offline_quicksort_prosa_no_dispara", async () => {
    const rt = await createRuntime({ ...loadConfig(), scriptEnabled: true });
    const result = await tryOfflinePlan("implementa quicksort en TS, ejecútalo con [3,1,4]", rt);
    expect(result).toBeNull();
  });

  test("offline_schema_rechaza", async () => {
    const rt = await createRuntime({ ...loadConfig(), scriptEnabled: true });
    expect(await tryOfflinePlan("sort []", rt)).toBeNull();
    expect(await tryOfflinePlan("sort [a,b]", rt)).toBeNull();
  });

  test("offline_sort_prefijo_y_json", async () => {
    const rt = await createRuntime({ ...loadConfig(), scriptEnabled: true });
    const a = await tryOfflinePlan("offline:sort [3,1,4,1,5]", rt);
    expect(a?.answer).toContain("1,1,3,4,5");
    const b = await tryOfflinePlan('{"program":"sort","input":[3,1,4,1,5]}', rt);
    expect(b?.answer).toContain("1,1,3,4,5");
  });
});
