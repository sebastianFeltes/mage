import { describe, expect, test } from "bun:test";
import { formatHistory } from "../src/llm/prompts";
import type { Turn } from "../src/session/types";

describe("session prompts", () => {
  test("formatHistory vacío", () => {
    expect(formatHistory([])).toBe("");
  });

  test("formatHistory compacto", () => {
    const turns: Turn[] = [
      { id: "1", role: "user", content: "¿Qué es Mage?", ts: 1 },
      { id: "2", role: "assistant", content: "Motor metacognitivo", ts: 2 },
    ];
    const h = formatHistory(turns);
    expect(h).toContain("U: ¿Qué es Mage?");
    expect(h).toContain("A: Motor metacognitivo");
  });

  test("formatHistory trunca turnos largos", () => {
    const turns: Turn[] = [{ id: "1", role: "user", content: "x".repeat(500), ts: 1 }];
    const h = formatHistory(turns);
    expect(h).toContain("…");
  });

  test("formatHistory usa resumen y últimos 6", () => {
    const turns: Turn[] = Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg${i}`,
      ts: i,
    }));
    const h = formatHistory(turns, 6, {
      factIds: ["fact-a"],
      lastStatus: "answered",
      lastEvidenceIds: ["ev-1"],
    });
    expect(h).toContain("Resumen de sesión:");
    expect(h).toContain("facts=fact-a");
    expect(h).toContain("status=answered");
    expect(h).toContain("msg2");
    expect(h).not.toContain("msg0");
    expect(h).not.toContain("msg1");
  });
});
