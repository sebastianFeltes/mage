---
name: mage-producto
description: >-
  Implements Mage's verification-kernel product (refuse without evidence, typed
  tools, Fact memory, KPI wedge, SQLite sessions). Use when the user asks to
  complete Mage, follow docs/TOKEN.md or docs/PRODUCTO.md, implement olas,
  invariants, refuse/evidence, wedge KPI, or finish the product end-to-end.
---

# Mage producto decente

Antes de tocar código, leé [docs/TOKEN.md](../../../docs/TOKEN.md) y [docs/PRODUCTO.md](../../../docs/PRODUCTO.md). El token manda en tipos, archivos, tests y orden. PRODUCTO.md manda en invariantes.

## Misión

Mage verifica afirmaciones de un dominio y se niega cuando no puede. No es un coding agent.

## Invariantes (romperlas = revertir)

1. `proposedAnswer` nunca es `result.answer`.
2. `confidence` no habilita responder sin tools.
3. El loop no persiste `memoryCandidates` del plan.
4. Toda tool tiene input+output Zod; answer sale de evidence parseada.
5. `status: answered | refused | error`. Callar es éxito.

## Cómo trabajar

1. Una ola por vez (`docs/TOKEN.md` §6). `bun test` verde antes de la siguiente.
2. Olas 1–3 en un solo hilo (tipos se mueven). Subagentes solo como §8 del token.
3. Tests de invariantes con `MAGE_PROVIDER=stub`, sin red.
4. Wedge cerrado: `kpi.lookup`, `source.cite`, `rule.check`. Ingest solo por CLI/HTTP.
5. No agregues filesystem write, git, MCP, browser, Cloud, multiagente de producto, ni más WASM de demo.

## Arranque

```
bun install && bun run build:wasm && bun test
```

Empezá por Ola 1: `src/loop/result.ts` + `finalizeResult` + stub provider.

Al cerrar una ola, reportá archivos, tests y criterio de listo. No saltees olas.
