import { stderr as errOut, stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { MageEvent } from "../loop/events";
import type { MageResult, MageRuntime } from "../loop/metacog";
import { runMage } from "../loop/metacog";
import { MageApiError } from "../llm/provider";
import { createSession, getSession, getSessionStore } from "../session/store";

export type ShellState = {
  verbose: boolean;
  json: boolean;
  stream: boolean;
  sessionId?: string;
};

export type SlashCmd =
  | { kind: "help" }
  | { kind: "exit" }
  | { kind: "status" }
  | { kind: "seed" }
  | { kind: "verbose"; on?: boolean }
  | { kind: "json"; on?: boolean }
  | { kind: "stream"; on?: boolean }
  | { kind: "script"; code: string }
  | { kind: "new" }
  | { kind: "session" }
  | { kind: "history"; n?: number }
  | { kind: "clear" }
  | { kind: "unknown"; raw: string };

const BOOL = (s: string): boolean | undefined => {
  if (s === "on" || s === "1" || s === "true") return true;
  if (s === "off" || s === "0" || s === "false") return false;
  return undefined;
};

export const parseSlashCommand = (line: string): SlashCmd | null => {
  const t = line.trim();
  if (!t.startsWith("/") && !t.startsWith(":")) return null;
  const body = t.slice(1).trim();
  if (!body || body === "?" || body === "help") return { kind: "help" };
  if (body === "exit" || body === "quit" || body === "q") return { kind: "exit" };
  if (body === "status") return { kind: "status" };
  if (body === "seed") return { kind: "seed" };
  if (body === "new") return { kind: "new" };
  if (body === "session") return { kind: "session" };
  if (body === "clear") return { kind: "clear" };

  const [head, ...rest] = body.split(/\s+/);
  const tail = rest.join(" ").trim();

  if (head === "verbose" || head === "v") {
    return { kind: "verbose", on: rest[0] ? BOOL(rest[0]) : undefined };
  }
  if (head === "json" || head === "j") {
    return { kind: "json", on: rest[0] ? BOOL(rest[0]) : undefined };
  }
  if (head === "stream") {
    return { kind: "stream", on: rest[0] ? BOOL(rest[0]) : undefined };
  }
  if (head === "script" || head === "s") {
    return { kind: "script", code: tail };
  }
  if (head === "history" || head === "h") {
    const n = rest[0] ? Number(rest[0]) : 6;
    return { kind: "history", n: Number.isFinite(n) ? n : 6 };
  }

  return { kind: "unknown", raw: body };
};

const fmtMs = (n: number): string => `${n < 10 ? n.toFixed(1) : Math.round(n)}ms`;

export const formatStatusLines = (rt: MageRuntime, state?: ShellState): string[] => {
  const lines = [
    `provider: ${rt.config.provider}`,
    `model: ${rt.config.fastModel}`,
    `graph: ${rt.graph.backend}`,
    `vectors: ${rt.config.embedProvider}`,
    `script: ${rt.config.scriptEnabled ? `on (${rt.config.scriptTimeoutMs}ms)` : "off"}`,
    `ollama: ${rt.config.fallbackOllama ? `${rt.config.ollamaModel} @ ${rt.config.ollamaBaseUrl}` : "off"}`,
    `sessions: ${rt.config.sessionEnabled ? "on" : "off"}`,
    `tools: ${rt.registry.list().map((t) => t.name).join(", ")}`,
    `boot: ${fmtMs(rt.bootMs)}`,
  ];
  if (state?.sessionId) lines.push(`session: ${state.sessionId}`);
  return lines;
};

const ensureSession = (rt: MageRuntime, state: ShellState): string => {
  if (!rt.config.sessionEnabled) return "";
  if (state.sessionId && getSession(rt.config, state.sessionId)) return state.sessionId;
  const s = createSession(rt.config);
  state.sessionId = s.id;
  return s.id;
};

export const shellBanner = (rt: MageRuntime, state: ShellState): string => {
  if (rt.config.sessionEnabled && !state.sessionId) {
    state.sessionId = createSession(rt.config).id;
  }
  const graph = rt.graph.backend;
  const flags = [
    state.verbose ? "verbose" : null,
    state.json ? "json" : null,
    state.stream ? "stream" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const flagLine = flags ? `  modo: ${flags}\n` : "";
  const sessionLine = state.sessionId ? `  session: ${state.sessionId}\n` : "";
  return (
    `mage shell — consultas, /help para comandos\n` +
    `  graph: ${graph}  script: ${rt.config.scriptEnabled ? "on" : "off"}  boot: ${fmtMs(rt.bootMs)}\n` +
    sessionLine +
    flagLine
  );
};

export const shellHelp = `Comandos internos:
  /help              esta ayuda
  /status            proveedor, grafo, tools, session
  /seed              datos demo en grafo+vectores
  /new               nueva sesión
  /session           muestra sessionId actual
  /history [n]       últimos n turnos (default 6)
  /clear             nueva sesión sin salir
  /verbose [on|off]  timings en stderr
  /json [on|off]     salida estructurada
  /stream [on|off]   progreso en stderr
  /script <código>   ejecutar Bun aislado (sin LLM)
  /exit              salir

Consulta normal: escribe en lenguaje natural y Enter.
También: exit, quit`;

const formatStreamEvent = (e: MageEvent): string | null => {
  switch (e.type) {
    case "enrich":
      return `[enrich] ${e.hits} hits ${fmtMs(e.ms)}`;
    case "plan_start":
      return `[plan] ${e.model} attempt ${e.attempt}`;
    case "plan_thought":
      return `[thought] ${e.delta}`;
    case "tool_start":
      return `[tool] ${e.tool}…`;
    case "tool_end":
      return e.ok ? `[tool] ${e.tool} ok ${fmtMs(e.ms)}` : `[tool] ${e.tool} fail: ${e.error}`;
    case "correction":
      return `[correction] attempt ${e.attempt}`;
    case "refuse":
      return `[refuse] ${e.reason}`;
    case "answer":
      return null;
    case "done":
      return `[done] ${e.result.status} ${fmtMs(e.result.timings.totalMs)}`;
    default:
      return null;
  }
};

type PrintFn = (result: MageResult, json: boolean, verbose: boolean) => void;

export const runShell = async (
  rt: MageRuntime,
  state: ShellState,
  print: PrintFn,
): Promise<void> => {
  output.write(shellBanner(rt, state));
  const rl = createInterface({ input, output });

  const prompt = (): void => {
    output.write("mage> ");
  };

  const runQuery = async (q: string): Promise<void> => {
    const sessionId = ensureSession(rt, state);
    const onEvent = state.stream
      ? (e: MageEvent) => {
          const line = formatStreamEvent(e);
          if (line) errOut.write(line + "\n");
        }
      : undefined;

    try {
      const result = await runMage(q, rt, { sessionId, onEvent });
      if (result.sessionId) state.sessionId = result.sessionId;
      print(result, state.json, state.verbose);
    } catch (err) {
      if (err instanceof MageApiError) console.error(`error: ${err.message}`);
      else console.error(err instanceof Error ? err.message : err);
    }
  };

  prompt();
  for await (const line of rl) {
    const q = line.trim();
    if (!q) {
      prompt();
      continue;
    }
    if (q === "exit" || q === "quit") break;

    const slash = parseSlashCommand(q);
    if (slash) {
      switch (slash.kind) {
        case "help":
          output.write(shellHelp + "\n");
          break;
        case "exit":
          rl.close();
          return;
        case "status":
          output.write(formatStatusLines(rt, state).join("\n") + "\n");
          break;
        case "seed":
          if (!rt.graph.isReady) {
            console.error(`grafo no disponible: ${rt.graph.disabledReason ?? "desconocido"}`);
          } else {
            const n = await rt.graph.seed();
            await rt.vectors.upsert([
              { type: "Entidad", name: "Mage", props: { text: "Motor metacognitivo en Bun" } },
              { type: "Concepto", name: "FastPath", props: { text: "Respuesta WASM sin LLM" } },
            ]);
            output.write(`seed: ${n} nodos + relaciones demo\n`);
          }
          break;
        case "new":
        case "clear":
          state.sessionId = createSession(rt.config).id;
          output.write(`nueva sesión: ${state.sessionId}\n`);
          break;
        case "session":
          output.write(`session: ${state.sessionId ?? "(ninguna)"}\n`);
          break;
        case "history": {
          const sid = state.sessionId;
          if (!sid) {
            output.write("(sin sesión)\n");
            break;
          }
          const session = getSession(rt.config, sid);
          if (!session) {
            output.write("(sesión no encontrada)\n");
            break;
          }
          const n = slash.n ?? 6;
          const turns = session.turns.slice(-n);
          for (const t of turns) {
            const p = t.role === "user" ? "U" : "A";
            output.write(`${p}: ${t.content.slice(0, 200)}${t.content.length > 200 ? "…" : ""}\n`);
          }
          break;
        }
        case "verbose":
          state.verbose = slash.on ?? !state.verbose;
          output.write(`verbose: ${state.verbose ? "on" : "off"}\n`);
          break;
        case "json":
          state.json = slash.on ?? !state.json;
          output.write(`json: ${state.json ? "on" : "off"}\n`);
          break;
        case "stream":
          state.stream = slash.on ?? !state.stream;
          output.write(`stream: ${state.stream ? "on" : "off"}\n`);
          break;
        case "script":
          if (!slash.code) {
            console.error("uso: /script return 1+1");
          } else {
            try {
              const result = await rt.script.run({ code: slash.code });
              if (state.json) {
                output.write(JSON.stringify(result, null, 2) + "\n");
              } else {
                if (result.stdout) output.write(result.stdout);
                if (!result.stdout && result.ok) output.write("(ok, sin stdout)\n");
                if (result.stderr) console.error(result.stderr);
              }
            } catch (err) {
              console.error(err instanceof Error ? err.message : err);
            }
          }
          break;
        case "unknown":
          console.error(`comando desconocido: /${slash.raw}  (prueba /help)`);
          break;
      }
      prompt();
      continue;
    }

    await runQuery(q);
    prompt();
  }
  rl.close();
};
