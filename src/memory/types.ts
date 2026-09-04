export type GraphBackend = "sqlite" | "falkor" | "off";

export type NodeLabel = "Entidad" | "Concepto" | "Hecho";

export type RelationType = "DEPENDE_DE" | "RELACIONADO_CON" | "PREFIERE";

export type GraphHit = {
  label: NodeLabel;
  name: string;
  text: string;
  score: number;
  via?: string;
};

export type VectorHit = {
  id: string;
  text: string;
  score: number;
};

export type HybridHit = {
  source: "graph" | "vector";
  name: string;
  text: string;
  score: number;
};

export type MemoryCandidate = {
  type: NodeLabel;
  name: string;
  props: Record<string, string>;
};

export type RelationCandidate = {
  type: RelationType;
  from: string;
  to: string;
  weight?: number;
};

/** Contrato mínimo para inyectar un grafo fake en tests (ola 2). */
export type GraphStore = {
  backend: GraphBackend;
  isReady: boolean;
  disabledReason: string | null;
  connect(): Promise<void>;
  search(query: string, limit: number, tenantId?: string): Promise<GraphHit[]>;
  commit(candidates: MemoryCandidate[], relations?: RelationCandidate[], tenantId?: string): Promise<void>;
  seed(): Promise<number>;
  close(): Promise<void>;
};
