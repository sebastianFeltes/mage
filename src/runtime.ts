import { loadConfig } from "./config";
import { createRuntime, type MageRuntime } from "./loop/metacog";
import { resetMetrics } from "./loop/metrics";
import { resetIdempotency } from "./http/idempotency";

let cached: MageRuntime | null = null;
let booting: Promise<MageRuntime> | null = null;

/** Runtime singleton: amortiza boot WASM + DB entre requests HTTP/REPL. */
export const getRuntime = async (): Promise<MageRuntime> => {
  if (cached) return cached;
  if (booting) return booting;
  booting = createRuntime(loadConfig()).then((rt) => {
    cached = rt;
    return rt;
  });
  return booting;
};

export const resetRuntime = (): void => {
  cached = null;
  booting = null;
  resetMetrics();
  resetIdempotency();
};
