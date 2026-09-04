import type { GraphHit, GraphStore, MemoryCandidate, RelationCandidate } from "./types";

type Node = {
  tenantId: string;
  label: GraphHit["label"];
  name: string;
  text: string;
};

const DEFAULT_TENANT = "default";

const nodeKey = (tenantId: string, name: string): string => `${tenantId}\0${name}`;

/** Grafo en memoria para tests e inyección. No habla con Falkor. */
export class InMemoryGraphMemory implements GraphStore {
  readonly backend = "sqlite" as const;
  disabledReason: string | null = null;
  private readonly nodes = new Map<string, Node>();
  private readonly edges: Array<RelationCandidate & { tenantId: string }> = [];

  get isReady(): boolean {
    return true;
  }

  async connect(): Promise<void> {}

  async search(query: string, limit: number, tenantId = DEFAULT_TENANT): Promise<GraphHit[]> {
    const tenant = tenantId.trim() || DEFAULT_TENANT;
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const hits: GraphHit[] = [];
    for (const n of this.nodes.values()) {
      if (n.tenantId !== tenant) continue;
      const hay = `${n.name} ${n.text}`.toLowerCase();
      if (!hay.includes(q) && !n.name.toLowerCase().includes(q)) continue;
      hits.push({ label: n.label, name: n.name, text: n.text, score: 1 });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  async commit(
    candidates: MemoryCandidate[],
    relations: RelationCandidate[] = [],
    tenantId = DEFAULT_TENANT,
  ): Promise<void> {
    const tenant = tenantId.trim() || DEFAULT_TENANT;
    for (const c of candidates) {
      this.nodes.set(nodeKey(tenant, c.name), {
        tenantId: tenant,
        label: c.type,
        name: c.name,
        text: c.props.text ?? c.name,
      });
    }
    this.edges.push(...relations.map((r) => ({ ...r, tenantId: tenant })));
  }

  async seed(): Promise<number> {
    const demo: MemoryCandidate[] = [
      { type: "Entidad", name: "Mage", props: { text: "Motor metacognitivo en Bun" } },
      { type: "Concepto", name: "FastPath", props: { text: "Respuesta WASM sin LLM" } },
      { type: "Hecho", name: "WasmTimeout", props: { text: "Sandbox limitado a 50ms" } },
    ];
    await this.commit(demo, [
      { type: "DEPENDE_DE", from: "Mage", to: "FastPath" },
    ]);
    return demo.length;
  }

  async close(): Promise<void> {
    this.nodes.clear();
    this.edges.length = 0;
  }
}