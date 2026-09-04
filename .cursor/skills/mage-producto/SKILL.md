---
name: mage-producto
description: >-
  Implements Mage's deterministic epistemic engine (refuse without evidence,
  typed tools, Fact memory, KPI wedge, SQLite sessions). Use when the user asks
  to complete Mage, follow docs/PRODUCTO.md, implement invariants, refuse/evidence,
  wedge KPI, fast path AST, offline programs, serve metrics, or operate a real wedge.
---

# Mage — motor epistemico determinista

Antes de tocar código, leé [docs/PRODUCTO.md](../../../docs/PRODUCTO.md). Ese archivo manda invariantes.

## Misión

Mage verifica afirmaciones de un dominio y se niega cuando no puede. No es un coding agent.

## Invariantes (romperlas = revertir)

1. `proposedAnswer` nunca es `result.answer`.
2. `confidence` no habilita responder sin tools.
3. El loop no persiste `memoryCandidates` del plan.
4. Toda tool tiene input+output Zod; answer sale de evidence parseada.
5. `status: answered | refused | error`. Callar es éxito.

## Cómo trabajar

1. `bun test` verde antes de mergear.
2. No toques `finalizeResult` salvo bug de invariante.
3. Tests con `MAGE_PROVIDER=stub`, sin red.
4. Wedge cerrado: `kpi.lookup`, `source.cite`, `rule.check`. Ingest solo por CLI/HTTP.
5. No agregues filesystem write, git, MCP, browser, Cloud, multiagente de producto, ni más WASM de demo.

## Arranque

```
bun install && bun run build:wasm && bun test
```
