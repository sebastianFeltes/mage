#!/usr/bin/env bun
import { stderr as errOut, stdin as input, stdout as output } from "node:process";
import { readFile } from "node:fs/promises";
import { runMage, type MageResult, type MageRuntime } from "./loop/metacog";
import type { MageEvent } from "./loop/events";
import { MageApiError } from "./llm/provider";
import { getRuntime } from "./runtime";
import { startServer } from "./server";
import { formatStatusLines, runShell, type ShellState } from "./cli/shell";
import { createSession } from "./session/store";

const help = `mage — motor epistemico determinista (Bun)

Uso:
  mage                    shell interactivo (runtime caliente)
  mage "consulta"         una consulta y sale
  mage serve|status|seed|ingest|script ...

Instalación del comando:
  ./bin/mage              desde el repo (sin instalar)
  bun run mage            alias npm
  bun link                mage global en PATH (desde este directorio)

Shell (dentro de mage):
  /help /status /seed /new /session /history /clear
  /verbose /json /stream /script /exit

Flags:
  --repl       shell (igual que sin argumentos)
  --verbose    timings en stderr
  --stream     progreso en stderr (fases del bucle)
  --json       salida estructurada
  --session ID reutilizar sesión existente
  --port N     puerto HTTP (default 3920)
  --help       esta ayuda

Fast path (sin LLM): "cuánto es (12+8)*3", "hash de mage", JSON literal.
Ingest: mage ingest --file facts.json
`;

const CMDS = ["serve", "status", "seed", "script", "ingest"] as const;

const fmtMs = (n: number): string => `${n < 10 ? n.toFixed(1) : Math.round(n)}ms`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}

const cmd = argv.find((a) => !a.startsWith("-") && (CMDS as readonly string[]).includes(a));
const verbose = argv.includes("--verbose") || argv.includes("-v");
const stream = argv.includes("--stream") || argv.includes("-s");
const asJson = argv.includes("--json");
const repl = argv.includes("--repl");
const portFlag = argv.findIndex((a) => a === "--port");
const sessionFlag = argv.findIndex((a) => a === "--session");
const port = portFlag >= 0 ? Number(argv[portFlag + 1]) : undefined;
const sessionArg = sessionFlag >= 0 ? argv[sessionFlag + 1] : undefined;
const query = argv
  .filter(
    (a, i) =>
      !a.startsWith("-") &&
      a !== cmd &&
      i !== portFlag + 1 &&
      i !== sessionFlag + 1 &&
      a !== sessionArg,
  )
  .join(" ")
  .trim();

const formatStreamEvent = (e: MageEvent): string | null => {
  switch (e.type) {
    case "enrich":
      return `[enrich] ${e.hits} hits ${fmtMs(e.ms)}`;
    case "plan_start":
      return `[plan] ${e.model} attempt ${e.attempt}`;
    case "tool_start":
      return `[tool] ${e.tool}…`;
    case "tool_end":
      return e.ok ? `[tool] ${e.tool} ok ${fmtMs(e.ms)}` : `[tool] ${e.tool} fail`;
    case "correction":
      return `[correction] attempt ${e.attempt}`;
    case "refuse":
      return `[refuse] ${e.reason}`;
    case "done":
      return `[done] ${e.result.status} ${fmtMs(e.result.timings.totalMs)}`;
    default:
      return null;
  }
};

const print = (result: MageResult, json: boolean, verboseFlag: boolean): void => {
  if (json) {
    output.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  if (result.status === "refused") {
    errOut.write(`refused: ${result.refusalReason ?? "no_evidence"}\n`);
  } else {
    output.write(result.answer + "\n");
  }
  if (verboseFlag) {
    const t = result.timings;
    const offline = result.plan.thought.startsWith("offline:") ? " offline" : "";
    const fast = t.planMs === 0 && t.attempts === 0 && !offline ? " fastpath" : "";
    const tools = result.plan.toolCalls.map((c) => c.tool).join(",") || "ninguna";
    const sid = result.sessionId ? ` session=${result.sessionId}` : "";
    errOut.write(
      `status=${result.status} boot=${fmtMs(t.bootMs)} enrich=${fmtMs(t.enrichMs)} plan=${fmtMs(t.planMs)} sandbox=${fmtMs(t.sandboxMs)} total=${fmtMs(t.totalMs)} attempts=${t.attempts} tools=${tools}${t.usedReasonModel ? " reason" : ""}${fast}${offline}${sid}\n`,
    );
  }
};

const runQuery = async (rt: MageRuntime, q: string, opts: { sessionId?: string; stream?: boolean }) => {
  const onEvent =
    opts.stream
      ? (e: MageEvent) => {
          const line = formatStreamEvent(e);
          if (line) errOut.write(line + "\n");
        }
      : undefined;

  let sessionId = opts.sessionId;
  if (!sessionId && rt.config.sessionEnabled) {
    sessionId = createSession(rt.config).id;
  }

  const result = await runMage(q, rt, { sessionId, onEvent });
  print(result, asJson, verbose);
  return result;
};

if (cmd === "serve") {
  await startServer({ port });
} else if (cmd === "status") {
  const rt = await getRuntime();
  const { apiKey: _secret, ...safeConfig } = rt.config;
  console.log(asJson ? JSON.stringify({ ...safeConfig, apiKeySet: Boolean(_secret), graph: rt.graph.backend, bootMs: rt.bootMs }, null, 2) : formatStatusLines(rt).join("\n"));
} else if (cmd === "seed") {
  const rt = await getRuntime();
  if (!rt.graph.isReady) {
    console.error(`grafo no disponible: ${rt.graph.disabledReason ?? "desconocido"}`);
    process.exit(1);
  }
  const n = await rt.graph.seed();
  await rt.vectors.upsert([
    { type: "Entidad", name: "Mage", props: { text: "Motor epistemico determinista en Bun" } },
    { type: "Concepto", name: "FastPath", props: { text: "Respuesta WASM sin LLM" } },
  ]);
  console.log(`seed: ${n} nodos + relaciones demo`);
} else if (cmd === "ingest") {
  const rt = await getRuntime();
  const fileIdx = argv.indexOf("--file");
  const filePath = fileIdx >= 0 ? argv[fileIdx + 1] : undefined;
  if (!filePath) {
    console.error("uso: mage ingest --file facts.json");
    process.exit(1);
  }
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    const { parseIngestJson } = await import("./memory/ingest");
    const req = parseIngestJson(raw);
    if (req.facts.length === 0) {
      console.error("facts[] vacío");
      process.exit(1);
    }
    const result = rt.facts.ingest(req);
    if (asJson) console.log(JSON.stringify(result));
    else {
      console.log(`ingest: ${result.upserted} hechos`);
      if (result.conflicts.length > 0) {
        console.error(`conflictos: ${result.conflicts.map((c) => c.name).join(", ")}`);
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else if (cmd === "script") {
  const rt = await getRuntime();
  const fileIdx = argv.indexOf("--file");
  let code = "";
  if (fileIdx >= 0) {
    code = await readFile(argv[fileIdx + 1]!, "utf8");
  } else {
    code = argv.filter((a, i) => !a.startsWith("-") && a !== "script" && i !== fileIdx + 1).join(" ").trim();
  }
  if (!code) {
    console.error("uso: mage script '<código>' | mage script --file path.ts");
    process.exit(1);
  }
  try {
    const result = await rt.script.run({ code });
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.stdout) output.write(result.stdout);
      if (result.stderr) console.error(result.stderr);
      if (!result.ok) process.exit(result.exitCode || 1);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else {
  const rt = await getRuntime();
  const shellState: ShellState = {
    verbose,
    json: asJson,
    stream,
    sessionId: sessionArg,
  };

  if (repl || !query) {
    if (rt.graph.disabledReason && verbose) {
      console.error(`grafo off: ${rt.graph.disabledReason} (docker compose up -d)`);
    }
    await runShell(rt, shellState, print);
  } else {
    if (rt.graph.disabledReason && verbose) {
      console.error(`grafo off: ${rt.graph.disabledReason} (docker compose up -d)`);
    }
    try {
      const result = await runQuery(rt, query, { sessionId: sessionArg, stream });
      if (result.status === "error") process.exit(1);
    } catch (err) {
      if (err instanceof MageApiError) {
        console.error(`error: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  }
}
