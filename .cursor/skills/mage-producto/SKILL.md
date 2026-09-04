---
name: mage-producto
description: >-
  Implements Mage's verification-kernel product (refuse without evidence, typed
  tools, Fact memory, KPI wedge, SQLite sessions). Use when the user asks to
  complete Mage, follow docs/TOKEN.md, docs/TOKEN-F2.md or docs/PRODUCTO.md,
  implement olas 1–10 or Fase 2 (11–14), invariants, refuse/evidence, wedge KPI,
  fast path AST, offline programs, serve metrics, or operate a real wedge.
---

# Mage producto decente

Antes de tocar código, leé [docs/PRODUCTO.md](../../../docs/PRODUCTO.md).
Trabajo **nuevo:** [docs/TOKEN-F2.md](../../../docs/TOKEN-F2.md) (olas 11–14).
Histórico 1–10: [docs/TOKEN.md](../../../docs/TOKEN.md) — no reimplementar.

Canon: PRODUCTO.md manda invariantes. TOKEN-F2.md manda tipos, archivos y tests de Fase 2.

## Misión

Mage verifica afirmaciones de un dominio y se niega cuando no puede. No es un coding agent.

## Invariantes (romperlas = revertir)

1. `proposedAnswer` nunca es `result.answer`.
2. `confidence` no habilita responder sin tools.
3. El loop no persiste `memoryCandidates` del plan.
4. Toda tool tiene input+output Zod; answer sale de evidence parseada.
5. `status: answered | refused | error`. Callar es éxito.

## Cómo trabajar

1. Una ola por vez (`docs/TOKEN-F2.md` §6). `bun test` verde antes de la siguiente.
2. No reimplementes olas 1–10. No toques `finalizeResult` salvo bug de invariante.
3. Tests con `MAGE_PROVIDER=stub`, sin red. LLM live solo si el token lo marca opt-in.
4. Wedge cerrado: `kpi.lookup`, `source.cite`, `rule.check`. Ingest solo por CLI/HTTP.
5. No agregues filesystem write, git, MCP, browser, Cloud, multiagente de producto, ni más WASM de demo.

## Arranque

```
bun install && bun run build:wasm && bun test
```

Empezá por Ola 11: `src/loop/metrics.ts` + snapshot en `GET /health`.

Al cerrar una ola, reportá archivos, tests y criterio de listo. No saltees olas.
