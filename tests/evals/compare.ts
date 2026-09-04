import { expect } from "bun:test";
import type { MageResult } from "../../src/loop/result";

export type Golden = {
  query: string;
  status: "answered" | "refused" | "error";
  tools: string[];
  answer?: string;
};

/** Compara campos estables. No timings, no ids, no sessionId. */
export const assertGolden = (golden: Golden, result: MageResult): void => {
  expect(result.status).toBe(golden.status);
  const tools = result.evidence.map((e) => e.tool);
  expect(tools).toEqual(golden.tools);
  if (golden.answer !== undefined) {
    expect(result.answer).toBe(golden.answer);
  }
  if (result.status === "refused") {
    expect(result.answer).toBe("");
    expect(/\d/.test(result.answer)).toBe(false);
  }
};
