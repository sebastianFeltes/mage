import { describe, expect, test } from "bun:test";
import { computeSnapshot, type MageMetrics } from "../../src/loop/metrics";

const base = (over: Partial<MageMetrics>): MageMetrics => ({
  queries: 0,
  answered: 0,
  refused: 0,
  errors: 0,
  toolErrors: 0,
  withEvidence: 0,
  withPositiveEvidence: 0,
  attemptsSum: 0,
  planMs: [],
  ...over,
});

describe("eval_pudrición", () => {
  test("rotting si answeredRate > positiveEvidenceRate", () => {
    const rotten = computeSnapshot(
      base({ queries: 2, answered: 2, withEvidence: 2, withPositiveEvidence: 1, attemptsSum: 2 }),
    );
    expect(rotten.answeredRate).toBeGreaterThan(rotten.positiveEvidenceRate);
    expect(rotten.rotting).toBe(true);
  });

  test("no rotting si answeredRate <= positiveEvidenceRate", () => {
    const ok = computeSnapshot(
      base({ queries: 2, answered: 1, refused: 1, withEvidence: 2, withPositiveEvidence: 1, attemptsSum: 2 }),
    );
    expect(ok.answeredRate).toBeLessThanOrEqual(ok.positiveEvidenceRate + 1e-9);
    expect(ok.rotting).toBe(false);
  });
});
