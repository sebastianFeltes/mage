import { describe, expect, test } from "bun:test";
import { parseSlashCommand } from "../src/cli/shell";

describe("shell slash commands", () => {
  test("parsea help y exit", () => {
    expect(parseSlashCommand("/help")?.kind).toBe("help");
    expect(parseSlashCommand(":?")?.kind).toBe("help");
    expect(parseSlashCommand("/exit")?.kind).toBe("exit");
  });

  test("toggle verbose", () => {
    expect(parseSlashCommand("/verbose on")).toEqual({ kind: "verbose", on: true });
    expect(parseSlashCommand("/v off")).toEqual({ kind: "verbose", on: false });
    expect(parseSlashCommand("/verbose")).toEqual({ kind: "verbose", on: undefined });
  });

  test("script con código", () => {
    expect(parseSlashCommand("/script return 1+1")).toEqual({
      kind: "script",
      code: "return 1+1",
    });
  });

  test("comandos de sesión", () => {
    expect(parseSlashCommand("/new")?.kind).toBe("new");
    expect(parseSlashCommand("/session")?.kind).toBe("session");
    expect(parseSlashCommand("/history 10")).toEqual({ kind: "history", n: 10 });
    expect(parseSlashCommand("/clear")?.kind).toBe("clear");
    expect(parseSlashCommand("/stream on")).toEqual({ kind: "stream", on: true });
  });

  test("no slash → null", () => {
    expect(parseSlashCommand("hola")).toBeNull();
  });
});
