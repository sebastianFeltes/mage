import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { MageConfig } from "../config";
import { SandboxError, SandboxTimeout } from "./runner";

export type ScriptRunInput = {
  code: string;
  stdin?: string;
};

export type ScriptRunResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  ms: number;
};

const BLOCKED = [
  /\bBun\.spawn\b/,
  /\bBun\.write\b/,
  /\bBun\.file\b/,
  /\bchild_process\b/,
  /\bDeno\.(?:run|spawn)\b/,
  /\bfetch\s*\(/,
  /\baxios\b/,
  /\bhttp\.request\b/,
  /\bWebSocket\b/,
  /\bprocess\.env\b/,
  /\bwriteFile\b|\bappendFile\b|\bunlink\s*\(/,
  /\brmSync\b|\bunlinkSync\b/,
  /\beval\s*\(/,
  /\/proc\//,
];

const MAX_CODE = 32_000;
const MAX_OUT = 64_000;

export class ScriptRunner {
  constructor(private readonly config: MageConfig) {}

  get enabled(): boolean {
    return this.config.scriptEnabled;
  }

  async run(input: ScriptRunInput): Promise<ScriptRunResult> {
    if (!this.config.scriptEnabled) {
      throw new SandboxError("script.run", "script deshabilitado (MAGE_SCRIPT_ENABLED=1)");
    }
    const code = input.code?.trim();
    if (!code) throw new SandboxError("script.run", "code vacío");
    if (code.length > MAX_CODE) throw new SandboxError("script.run", "code demasiado largo");

    for (const rule of BLOCKED) {
      if (rule.test(code)) {
        throw new SandboxError("script.run", `código bloqueado por política: ${rule}`);
      }
    }

    const workDir = join(tmpdir(), `mage-script-${randomUUID()}`);
    const scriptPath = join(workDir, "main.ts");
    const t0 = performance.now();

    await mkdir(workDir, { recursive: true });
    const wrapped = wrapUserCode(code);
    await writeFile(scriptPath, wrapped, "utf8");

    try {
      const proc = Bun.spawn([process.execPath, "run", scriptPath], {
        cwd: workDir,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: workDir,
          MAGE_SANDBOX: "1",
          NO_COLOR: "1",
        },
        stdin: input.stdin ? new Blob([input.stdin]) : undefined,
        stdout: "pipe",
        stderr: "pipe",
      });

      const result = await withTimeout(
        Promise.all([proc.exited, readStream(proc.stdout), readStream(proc.stderr)]),
        this.config.scriptTimeoutMs,
        "script.run",
        () => proc.kill(),
      );

      const [exitCode, stdout, stderr] = result;
      const out = truncate(stdout);
      const err = truncate(stderr);
      const ms = performance.now() - t0;

      return {
        ok: exitCode === 0,
        exitCode,
        stdout: out,
        stderr: err,
        ms,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export const scriptResultJson = (r: ScriptRunResult): string => JSON.stringify(r);

const wrapUserCode = (code: string): string => `// mage sandbox
const __mage = {
  input: typeof Bun !== "undefined" && Bun.stdin
    ? await new Response(Bun.stdin.stream()).text()
    : "",
};

async function __mage_main() {
${indent(code)}
}

try {
  const __result = await __mage_main();
  if (__result !== undefined) {
    console.log(typeof __result === "string" ? __result : JSON.stringify(__result));
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
`;

const indent = (code: string): string =>
  code
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");

const readStream = async (stream: ReadableStream<Uint8Array> | null): Promise<string> => {
  if (!stream) return "";
  return await new Response(stream).text();
};

const truncate = (s: string): string =>
  s.length > MAX_OUT ? s.slice(0, MAX_OUT) + "\n...[truncado]" : s;

const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  tool: string,
  onTimeout?: () => void,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new SandboxTimeout(tool, ms));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
};
