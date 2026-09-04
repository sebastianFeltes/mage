export class SandboxTimeout extends Error {
  constructor(
    readonly tool: string,
    readonly ms: number,
  ) {
    super(`sandbox timeout ${ms}ms: ${tool}`);
    this.name = "SandboxTimeout";
  }
}

export class SandboxError extends Error {
  constructor(
    readonly tool: string,
    readonly detail: string,
    readonly exitCode = 1,
  ) {
    super(detail);
    this.name = "SandboxError";
  }
}

export type SandboxResult = {
  ok: boolean;
  output: string;
  ms: number;
};

type PluginLike = {
  call(name: string, input: string | Uint8Array): Promise<unknown>;
};

export type CreatePlugin = (
  wasm: string | Uint8Array,
  opts: { useWasi: false; runInWorker: false },
) => Promise<PluginLike>;

export class WasmSandbox {
  private plugin: PluginLike | null = null;
  private warming: Promise<PluginLike> | null = null;

  constructor(
    private readonly wasmPath: string,
    private readonly timeoutMs: number,
    private readonly createPlugin: CreatePlugin,
  ) {}

  async warm(): Promise<void> {
    await this.load();
  }

  async run(exportName: string, input: string): Promise<SandboxResult> {
    const plugin = await this.load();
    const t0 = performance.now();
    try {
      const raw = await withTimeout(
        plugin.call(exportName, input),
        this.timeoutMs,
        exportName,
      );
      const output = decodeCall(raw);
      const ms = performance.now() - t0;
      const ok = !output.includes('"ok":false');
      if (!ok) {
        throw new SandboxError(exportName, output, 1);
      }
      return { ok: true, output, ms };
    } catch (err) {
      if (err instanceof SandboxTimeout || err instanceof SandboxError) throw err;
      throw new SandboxError(exportName, err instanceof Error ? err.message : String(err));
    }
  }

  private load(): Promise<PluginLike> {
    if (this.plugin) return Promise.resolve(this.plugin);
    if (this.warming) return this.warming;
    this.warming = this.createPlugin(this.wasmPath, {
      useWasi: false,
      runInWorker: false,
    }).then((p) => {
      this.plugin = p;
      return p;
    });
    return this.warming;
  }
}

const withTimeout = <T>(promise: Promise<T>, ms: number, tool: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SandboxTimeout(tool, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
};

const decodeCall = (raw: unknown): string => {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
  if (typeof raw === "object" && raw !== null && "text" in raw && typeof (raw as { text: unknown }).text === "function") {
    return (raw as { text: () => string }).text();
  }
  if (typeof raw === "object" && raw !== null && "bytes" in raw) {
    const bytes = (raw as { bytes: () => Uint8Array }).bytes();
    return new TextDecoder().decode(bytes);
  }
  return String(raw);
};
