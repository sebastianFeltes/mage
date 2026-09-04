import type { MageResult } from "./result";

export type MageMetrics = {
  queries: number;
  answered: number;
  refused: number;
  errors: number;
  withEvidence: number;
  attemptsSum: number;
};

const zero = (): MageMetrics => ({
  queries: 0,
  answered: 0,
  refused: 0,
  errors: 0,
  withEvidence: 0,
  attemptsSum: 0,
});

let state: MageMetrics = zero();

export const recordResult = (result: MageResult): void => {
  state.queries += 1;
  state.attemptsSum += result.timings.attempts;
  if (result.evidence.length > 0) state.withEvidence += 1;
  if (result.status === "answered") state.answered += 1;
  else if (result.status === "refused") state.refused += 1;
  else state.errors += 1;
};

export const snapshotMetrics = (): MageMetrics & { evidenceRate: number; answeredRate: number } => {
  const q = state.queries || 1;
  return {
    ...state,
    evidenceRate: state.withEvidence / q,
    answeredRate: state.answered / q,
  };
};

export const resetMetrics = (): void => {
  state = zero();
};
