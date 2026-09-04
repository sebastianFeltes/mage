import { describe, test } from "bun:test";
import { runPoisonNoWrite } from "../memory-poison.test";

describe("eval_poison", () => {
  test("memoryCandidates del plan no se persisten", runPoisonNoWrite);
});
