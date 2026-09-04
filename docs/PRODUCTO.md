# Contrato de producto

Mage es un **motor epistemico determinista**: verifica afirmaciones de un dominio y se niega cuando no puede. El LLM propone un plan; el runtime es quien afirma.

No escribe código. No es un chat. No es un coding agent.

## Invariantes (si fallan, no hay motor)

1. **Sin evidencia no hay `answer`.** `proposedAnswer` del modelo no es respuesta. Solo traces de tools o un fast path determinístico. Si no hay rastro, `status: refused`.
2. **`confidence` no verifica.** Es metadata del plan, no un pase para hablar.
3. **La memoria no se escribe con ficción.** `memoryCandidates` del LLM no se persisten. Ingest solo por CLI o `POST /v1/memory`.
4. **Toda tool devuelve un valor tipado.** Zod de input y output. `answer` se hidrata de esos campos. `finalizeResult` es el único que fabrica la respuesta.
5. **Rechazar es un resultado de primera clase.** `status: answered | refused | error`, `evidence[]`, `refusalReason`. Callar es éxito.

## Superficie

Tres formas, misma semántica: CLI (`mage`), HTTP (`mage serve`), librería (`mage()`).

Wedge cerrado: `kpi.lookup`, `source.cite`, `rule.check` sobre Facts ingestidos (`tenantId` + `source`).

## Qué no entra

Estas cosas diluyen la idea:

1. Editar archivos, git, MCP, browser, “somos un coding agent”.
2. Dashboard Cloud, billing, multi-region.
3. Multiagente / subagentes.
4. Más tools WASM de Programming 101 para el README.
5. Marketplace de plugins.
6. Embeddings cloud “porque RAG”.
7. Inflar el grafo con tipos de relación inventados.

La frase correcta no es “nunca alucina”. Es: **no responde sin evidencia, y si responde podés ver el trace**.
