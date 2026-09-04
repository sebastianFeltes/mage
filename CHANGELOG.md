# Changelog

## [Unreleased]

### Docs

- Descripción del motor: **motor epistemico determinista**
- README público con contrato, invariantes y superficie completa
- Retirados `docs/COMPARATIVA.md`, `docs/TOKEN.md` y `docs/TOKEN-F2.md` (internos; no van al repo público)

## [0.3.1] - 2026-09-03

### Added

- Métricas de producto en `GET /health`: `refusedRate`, `toolErrorRate`, `planMs` p50/p95, `positiveEvidenceRate`, `rotting` (store por runtime)
- Fast path calc por AST; `(12+8)*` y `hola 2+2` no matchean
- Offline `sort [n,…]` / `offline:sort` / JSON `{program,input}` — prosa “ordena”/quicksort no dispara
- Wedge `examples/consultora-norte` (tenant `norte`) + eval answered vs evidence positiva

### Docs

- Guía de uso (`docs/COMO.md`): métricas `/health` y wedge `consultora-norte`

## [0.3.0] - 2026-09-03

### Added

- Contrato `status` / `evidence` / `refusalReason`; `finalizeResult` es el único que fabrica `answer`
- Wedge consultoría: `kpi.lookup`, `source.cite`, `rule.check` + `POST /v1/memory` / `mage ingest`
- Provider `stub` y evals CI sin red (refuse, injection, poison, grounded)
- Sesiones SQLite, compaction, `tenantId`
- `MAGE_API_KEY`, rate limit, CORS cerrado, `Idempotency-Key`
- Conflictos de ingest (no pisa un KPI distinto)
- Grafo SQLite aislado por tenant; Falkor opcional
- Métricas en `GET /health`

### Changed

- `proposedAnswer` y `confidence` ya no habilitan respuesta
- Write tools (`memory.ingest`) bloqueadas en el planner
- `memory.search` no cuenta como evidence positiva
- Catálogo del planner sin tools de demo (palíndromo, letras, primo)
- Default `MAGE_GRAPH=sqlite` (sin Docker)
- Prompt deja de ser la policía; el runtime descarta texto sin evidence

### Docs

- README y `docs/COMO.md` alineados a 0.3.0 (SQLite-first, refuse, ingest)

## [0.2.0] - 2026-09-03

### Added

- Sesiones multi-turno con `sessionId` (in-memory por proceso)
- API HTTP: `POST/GET/DELETE /v1/sessions`
- Streaming SSE real: eventos `enrich`, `plan`, `tool_*`, `answer`, `done`
- CLI: comando `mage` / `./bin/mage`, shell con `/new`, `/session`, `/history`, `/stream`
- Flag `--stream` y `--session` en CLI
- `streamObject` en provider LLM con `plan_thought` incremental
- `runMageStream` y `onEvent` en API pública
- Tests: session, events, server-stream (40 tests total)
- CI GitHub Actions
- Documentación OSS: LICENSE (MIT), CONTRIBUTING, SECURITY, ARCHITECTURE

### Changed

- `mage` sin argumentos abre shell interactivo (antes mostraba ayuda)
- `POST /v1/query` y `/v1/query/stream` aceptan `sessionId`
- Prompts incluyen historial reciente de conversación
- FalkorDB healthcheck en docker-compose

## [0.1.0] - 2026-09-03

### Added

- Motor metacognitivo: LLM multi-provider + WASM + memoria híbrida
- Fast path determinístico (calc, hash, palíndromo, primos)
- CLI, HTTP server, script.run, fallback Ollama/cuota
