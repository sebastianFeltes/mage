# Mage

**Motor epistemico determinista.** Verifica afirmaciones de un dominio (números, reglas, entidades) y **se niega cuando no puede**. No es un coding agent ni un chat.

El LLM propone un plan JSON. El runtime es quien afirma. Si responde, hay evidence tipada (`kpi.lookup`, `calc`, …). Si no hay rastro, `status: refused`. El modelo puede soñar un número: Mage lo tira.

MIT. Bun. Sin Docker para el camino feliz.

## Cómo funciona

```
consulta
  ├─ fast path (AST / hash / JSON) → WASM, ~3 ms, 0 tokens
  ├─ enrich (≤25 ms): Facts del tenant + grafo SQLite
  ├─ plan Zod → tools con input/output tipado
  └─ finalizeResult
        evidence positiva → status: answered
        si no            → status: refused
```

Invariantes (romperlas es un bug):

1. `proposedAnswer` del modelo **nunca** es `result.answer`.
2. `confidence` no habilita responder sin tools.
3. El planner **no** escribe memoria. Ingest solo por CLI o `POST /v1/memory`.
4. Toda tool tiene Zod de entrada y salida. `answer` sale del output parseado.
5. `status: answered | refused | error`. Callar es éxito.

## Características

| Área | Qué hay |
|------|---------|
| Contrato | `status`, `answer`, `refusalReason`, `evidence[]`, `plan`, `timings` |
| Fast path | Calc por AST (`(12+8)*3` sí, `(12+8)*` no), `hash`, JSON literal — 0 tokens |
| Wedge | `kpi.lookup`, `source.cite`, `rule.check` sobre Facts ingestidos |
| Primitivas WASM | `calc`, `hash`, `json_validate` (Extism, timeout 50 ms) |
| Memoria | `Fact` con `tenantId` + `source`. Contradicción → conflicto, no pisa |
| Superficies | CLI (`mage`), HTTP (`mage serve`), librería (`import { mage }`) |
| Sesiones | SQLite, compaction, aisladas por tenant |
| HTTP | `/v1/query`, `/v1/query/stream` (SSE), `/v1/memory`, `/v1/sessions`, `/health` |
| Auth | Loopback por defecto. Fuera de localhost exige `MAGE_API_KEY`. CORS cerrado, rate limit, `Idempotency-Key` |
| Providers | Gemini / Anthropic / OpenAI + stub (tests) + fallback Ollama opt-in |
| Métricas | `% answered` / `% refused` / `planMs` p50/p95 / `rotting` en `GET /health` |
| Evals | Refuse, injection, poison, grounded, wedge — `bun test`, sin red |

## Probar en 2 minutos (sin API key)

Hace falta [Bun](https://bun.sh) ≥ 1.1.

```bash
git clone https://github.com/sebastianFeltes/mage.git && cd mage
bun install && bun run build:wasm
bun test                          # 118 tests, sin red
./bin/mage "(12+8)*3"             # → 60   fast path WASM, 0 tokens
MAGE_PROVIDER=stub ./bin/mage "cuál es el PIB de Francia"
# stderr: refused: no_evidence
```

Hechos de un cliente (el valor de producto):

```bash
./bin/mage ingest --file examples/http-kpi/facts.json
MAGE_PROVIDER=stub MAGE_STUB_PLAN='{"thought":"lookup","confidence":1,"toolCalls":[{"tool":"kpi.lookup","input":{"name":"arr"},"reason":"kpi"}],"proposedAnswer":"999"}' \
  ./bin/mage "cuál es el ARR"
# → 1200000   (el 999 del modelo no sale)
```

Sin semilla, el mismo plan → `refused` / `not_found`. Otro tenant, otro dominio: [`examples/consultora-norte`](examples/consultora-norte/).

## Con un LLM de verdad

```bash
cp .env.example .env
# MAGE_PROVIDER=gemini|anthropic|openai  + la API key correspondiente
# o: ollama pull llama3.2  (fallback local, MAGE_FALLBACK_OLLAMA=1)
./bin/mage
```

`proposedAnswer` del modelo **nunca** es la respuesta. Sin tool OK, Mage calla.

## Qué es / qué no es

| Sí | No |
|----|----|
| Motor epistemico determinista: plan JSON → tools → evidence o refuse | Cursor / Claude Code / un coding agent |
| KPIs ingestidos con fuente (`source`) | Editar repos, git, browser, MCP |
| Fast path WASM para aritmética/hash/JSON | “Nunca alucina” (calla; no es magia) |
| HTTP + librería `mage()` embebible | Cloud dashboard, multiagente |

## CLI

| Comando | Qué hace |
|---------|----------|
| `mage` | Shell interactivo |
| `mage "consulta"` | Una pregunta y sale |
| `mage ingest --file facts.json` | Sembrar hechos (única escritura de memoria) |
| `mage status` | Runtime: `graph: sqlite`, tools, provider |
| `mage serve` | HTTP en `127.0.0.1:3920` |
| `mage seed` | Nodos demo en el grafo (opcional) |

Flags: `--json`, `--verbose`, `--stream`, `--session ID`. Fast path (sin LLM): `(12+8)*3`, `cuánto es 2+2`, `hash de mage`, un JSON literal.

## HTTP

`POST /v1/query` → `MageResult`: `status`, `answer`, `refusalReason`, `evidence`, `plan`, `timings`, `sessionId`, `tenantId`.

```bash
./bin/mage serve
curl -s -X POST http://127.0.0.1:3920/v1/memory \
  -H 'Content-Type: application/json' \
  -d @examples/http-kpi/facts.json

curl -s -X POST http://127.0.0.1:3920/v1/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"(12+8)*3"}'

curl -s http://127.0.0.1:3920/health
```

- Loopback por defecto. Si `MAGE_HOST` no es local, hace falta `MAGE_API_KEY`.
- Con key, `/v1/*` exige `Authorization: Bearer …` (`/health` no).
- `Idempotency-Key` en `POST /v1/query` (TTL 5 min).
- Stream: `POST /v1/query/stream` (SSE; el evento `done` es el mismo `MageResult`).
- `script.run` está **off**. No es un sandbox. No lo prendas en `serve`.

## Librería

```typescript
import { mage } from "mage";

const r = await mage("cuál es el ARR", { tenantId: "acme" });
if (r.status === "answered") console.log(r.answer, r.evidence);
else console.log("calló", r.refusalReason);
```

También: `runMage`, `runMageStream`, `createRuntime`, `startServer`, sesiones.

## Memoria

- **Hechos (`Fact`)** con `tenantId`, `source`, `value`. Ingest por CLI/HTTP. El planner **no** puede escribir.
- Contradicción (mismo nombre, otro valor) → conflicto, no pisa.
- Grafo SQLite opcional, aislado por tenant. FalkorDB solo si `MAGE_GRAPH=falkor`.
- Embeddings: default `none` (no hay “semántica” FNV).

## Tests

```bash
bun test
```

118 tests. Evals de refuse / injection / poison / grounded / wedge corren con `MAGE_PROVIDER=stub`, sin Gemini.

## Docs

- [Cómo usarlo](docs/COMO.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [Contrato de producto](docs/PRODUCTO.md)
- [Contribuir](CONTRIBUTING.md)
- [Seguridad](SECURITY.md)

## Licencia

[MIT](LICENSE)

Repo: [sebastianFeltes/mage](https://github.com/sebastianFeltes/mage)
