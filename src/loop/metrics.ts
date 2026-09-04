import { isPositiveEvidence, type MageResult } from "./result";

const PLAN_MS_CAP = 2048;

export type MageMetrics = {
  queries: number;
  answered: number;
  refused: number;
  errors: number;
  toolErrors: number;
  withEvidence: number;
  withPositiveEvidence: number;
  attemptsSum: number;
  planMs: number[];
};

export type MageMetricsSnapshot = MageMetrics & {
  answeredRate: number;
  refusedRate: number;
  errorRate: number;
  toolErrorRate: number;
  evidenceRate: number;
  positiveEvidenceRate: number;
  planMsP50: number | null;
  planMsP95: number | null;
  rotting: boolean;
};

export type RecordResultOpts = {
  toolError?: boolean;
};

const zero = (): MageMetrics => ({
  queries: 0,
  answered: 0,
  refused: 0,
  errors: 0,
  toolErrors: 0,
  withEvidence: 0,
  withPositiveEvidence: 0,
  attemptsSum: 0,
  planMs: [],
});

const percentile = (samples: number[], p: number): number | null => {
  const n = samples.length;
  if (n === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sorted[idx]!;
};

const rate = (n: number, queries: number): number => (queries === 0 ? 0 : n / queries);

/** Snapshot puro: tests de pudrición pueden pasar un estado inventado sin romper finalizeResult. */
export const computeSnapshot = (s: MageMetrics): MageMetricsSnapshot => {
  const answeredRate = rate(s.answered, s.queries);
  const positiveEvidenceRate = rate(s.withPositiveEvidence, s.queries);
  return {
    ...s,
    planMs: [...s.planMs],
    answeredRate,
    refusedRate: rate(s.refused, s.queries),
    errorRate: rate(s.errors, s.queries),
    toolErrorRate: rate(s.toolErrors, s.queries),
    evidenceRate: rate(s.withEvidence, s.queries),
    positiveEvidenceRate,
    planMsP50: percentile(s.planMs, 0.5),
    planMsP95: percentile(s.planMs, 0.95),
    rotting: s.answered > 0 && answeredRate > positiveEvidenceRate + 1e-9,
  };
};

/** Un store por runtime: serve y tests no se pisan. */
export class MetricsStore {
  private state: MageMetrics = zero();

  record(result: MageResult, opts?: RecordResultOpts): void {
    const s = this.state;
    s.queries += 1;
    s.attemptsSum += result.timings.attempts;
    if (result.evidence.length > 0) s.withEvidence += 1;
    if (result.evidence.some(isPositiveEvidence)) s.withPositiveEvidence += 1;
    if (result.status === "answered") s.answered += 1;
    else if (result.status === "refused") s.refused += 1;
    else s.errors += 1;
    if (opts?.toolError || result.status === "error") s.toolErrors += 1;
    if (result.timings.planMs > 0) {
      if (s.planMs.length >= PLAN_MS_CAP) s.planMs.shift();
      s.planMs.push(result.timings.planMs);
    }
  }

  snapshot(): MageMetricsSnapshot {
    return computeSnapshot(this.state);
  }

  reset(): void {
    this.state = zero();
  }
}

const processMetrics = new MetricsStore();

export const recordResult = (result: MageResult, opts?: RecordResultOpts): void => {
  processMetrics.record(result, opts);
};

export const snapshotMetrics = (): MageMetricsSnapshot => processMetrics.snapshot();

export const resetMetrics = (): void => {
  processMetrics.reset();
};
