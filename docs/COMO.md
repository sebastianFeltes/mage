# Mage — Cómo usarlo

Guía práctica del **motor epistemico determinista**. Camino feliz: Bun, SQLite, sin Docker. El LLM es opcional (stub o fast path).

Versión 0.3.1. Frase de producto: Mage verifica afirmaciones de un dominio y se niega cuando no puede.

## Requisitos

- [Bun](https://bun.sh) ≥ 1.1
- API key de un LLM **solo** si vas a planear en lenguaje natural (Gemini / Anthropic / OpenAI). Para clonar y ver el contrato: stub, sin key.
- Docker **no** hace falta. FalkorDB es opcional (`MAGE_GRAPH=falkor`).

## 1. Probar en 2 minutos (sin API key)

```bash
git clone https://github.com/sebastianFeltes/mage.git && cd mage
bun install && bun run build:wasm
bun test                          # sin red
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

Sin semilla, el mismo plan → `refused` / `not_found`.

### Comando `mage`

| Forma | Cuándo |
|-------|--------|
| `./bin/mage` | Desde el repo |
| `bun run mage` | Alias npm |
| `bun link` → `mage` | Global en PATH (una vez desde el repo) |

Sin argumentos: **shell** (runtime caliente). `ingest --file` y la aritmética no llaman al LLM.

```bash
./bin/mage
# mage> /status
# mage> ingest --file examples/http-kpi/facts.json
# mage> 12-3
# mage> /exit
```

## 2. Variables de entorno

```bash
cp .env.example .env
```

Mínimo para un LLM:

```env
MAGE_PROVIDER=gemini
GOOGLE_GENERATIVE_AI_API_KEY=tu_clave_aqui
MAGE_FAST_MODEL=gemini-3.6-flash
MAGE_EMBED_PROVIDER=none
MAGE_GRAPH=sqlite
```

`.env` está en `.gitignore`. **Nunca** commitees claves.

`proposedAnswer` del modelo **nunca** es la respuesta. Sin tool OK, Mage calla.

## 3. Memoria de producto: ingest, no el grafo demo

La memoria que importa es **`Fact`**: `name`, `value`, `source`, `tenantId`. La escribe un humano o `POST /v1/memory`. El planner no puede `memory.ingest`.

```bash
./bin/mage ingest --file examples/http-kpi/facts.json
# ingest: 10 hechos
```

Contradicción (mismo `name`, otro `value`) → conflicto, **no pisa**.

`./bin/mage seed` siembra 3 nodos de grafo (Mage / FastPath / WasmTimeout). Es demo de grafo, no el wedge. Para un colega, usá ingest.

Grafo: SQLite en `./data` (`MAGE_GRAPH=sqlite`). Falkor: `MAGE_GRAPH=falkor` y `docker compose up -d`. Si el host no responde, `graph: off`. Embeddings solo si `MAGE_EMBED_PROVIDER` no es `none`.

```bash
./bin/mage status
# graph: sqlite
# vectors: none
```

## 4. Flujo de una consulta

```
Consulta
   │
   ├─► Fast path? (calc AST / hash / JSON) ──► WASM, 0 tokens
   │
   └─► Enrich (≤25 ms): facts del tenant + grafo SQLite
   │
   ├─► LLM: plan JSON (Zod). proposedAnswer es borrador, no answer
   │      toolCalls → dispatch (input+output Zod)
   │      planner no ve memory.ingest ni tools de demo
   │
   ├─► ¿Tool falló? → corrección (hasta 3 intentos)
   │
   └─► finalizeResult
          evidence positiva → status: answered
          si no            → status: refused
```

El loop **no** persiste `memoryCandidates` del plan.

### Fast path (sin LLM)

| Consulta ejemplo | Tool |
|------------------|------|
| `cuánto es (12+8)*3` / `(12+8)*3` | `calc` (AST; `(12+8)*` no matchea) |
| `valida con calc: 0.1+0.2` | `calc` |
| `hash de mage` | `hash` |
| `{ "a": 1 }` | `json_validate` |

Palíndromo / contar letras / primo siguen compilados para el fast path; **no** son el pitch. En `--verbose` verás `tools=calc fastpath`.

```bash
./bin/mage "(12+8)*3"
# → 60
```

### Consulta con sandbox (LLM o stub)

```bash
./bin/mage --verbose 'valida con calc: 0.1+0.2'
# → 0.30000000000000004
```

## 5. Shell interactivo

```bash
./bin/mage
./bin/mage --verbose
./bin/mage --json "cuál es el ARR"
```

Dentro:

```
/help               esta ayuda
/status             proveedor, grafo, tools, session
/ingest --file f    sembrar hechos (sin LLM)
/seed               nodos demo en grafo
/new  /clear        nueva sesión
/session            sessionId actual
/history [n]        últimos n turnos
/verbose [on|off]   timings en stderr
/json [on|off]      salida estructurada
/stream [on|off]    progreso en stderr
/script <código>    Bun aislado (si MAGE_SCRIPT_ENABLED=1)
/exit               salir
```

`ingest --file examples/http-kpi/facts.json` también funciona **sin** `/`. `clear` sin barra nueva sesión. Líneas que empiezan con `--` no van al LLM: los flags (`--json`, `--verbose`) van al invocar `mage`, no en el prompt.

También: `exit`, `quit`. Equivalente: `bun src/cli.ts --repl`.

## 6. Salida estructurada

```bash
./bin/mage --json "cuál es el PIB de Francia"
```

`MageResult`: `status`, `answer`, `refusalReason`, `evidence`, `plan`, `timings`, `sessionId`, `tenantId`. Un cliente puede ignorar `thought`.

```json
{
  "status": "refused",
  "answer": "",
  "refusalReason": "no_evidence",
  "evidence": [],
  "plan": { "thought": "…", "toolCalls": [] },
  "timings": { "bootMs": 0, "enrichMs": 0, "planMs": 0, "sandboxMs": 0, "totalMs": 0, "attempts": 1, "usedReasonModel": false }
}
```

## 7. API HTTP

```bash
./bin/mage serve          # http://127.0.0.1:3920
```

Loopback por defecto. Si `MAGE_HOST` no es local, hace falta `MAGE_API_KEY`. Con key, `/v1/*` exige `Authorization: Bearer` (`/health` no). CORS cerrado (nunca `*`). Rate limit 60 req/min/IP en `/v1/query*`, `/v1/memory` y `/v1/sessions*`. Payload: query ≤ 16 KiB, body ≤ 1 MiB, ingest ≤ 500 facts. `Idempotency-Key` en `POST /v1/query` (TTL 5 min). `script.run` **no** se prende con `serve`.

| Endpoint | Método | Body | Descripción |
|----------|--------|------|-------------|
| `/health` | GET | — | Estado, tools, boot, `metrics` (`refusedRate`, `toolErrorRate`, `planMsP50`/`P95`, `rotting`) |
| `/v1/query` | POST | `{ query, sessionId?, tenantId? }` | `MageResult` |
| `/v1/query/stream` | POST | igual | SSE (`done` = mismo `MageResult`) |
| `/v1/memory` | POST | `{ tenantId, source, facts[] }` | `{ upserted, conflicts }` |
| `/v1/sessions` | POST | `{ tenantId? }` | `{ sessionId, tenantId, createdAt }` |
| `/v1/sessions/:id` | GET | `?tenantId=` **requerido** | sesión + `turns[]` + `summary` |
| `/v1/sessions/:id` | DELETE | `?tenantId=` **requerido** | `{ ok: true }` |

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

El snapshot de `metrics` incluye `refusedRate`, `toolErrorRate`, `planMsP50` / `planMsP95` y `rotting`. `rotting` es true si el motor responde más de lo que puede trazar (`answeredRate > positiveEvidenceRate`). En operación sana es **false**.

Otro wedge, otro tenant (no pisa `http-kpi`): `examples/consultora-norte/` — 10 hechos de planta (`oee`, `scrap`, `otif`, …), `tenantId=norte`. Ingest + queries stub en el README de ese directorio.

Con key: `-H "Authorization: Bearer $MAGE_API_KEY"`. El servidor reutiliza un runtime caliente.

## 8. Librería

```typescript
import { mage } from "mage";

const r = await mage("cuál es el ARR", { tenantId: "acme" });
if (r.status === "answered") console.log(r.answer, r.evidence);
else console.log("calló", r.refusalReason);
```

## 9. Interpretar timings

| Campo | Qué mide |
|-------|----------|
| `bootMs` | Carga WASM + DB (1ª vez por proceso) |
| `enrichMs` | Facts + grafo (presupuesto 25 ms) |
| `planMs` | Llamada LLM (0 en fast path / stub local) |
| `sandboxMs` | Ejecución de tools |
| `totalMs` | Latencia de la consulta |
| `attempts` | Pasadas del bucle |

## 10. Sesiones multi-turno

Viven en SQLite (`MAGE_SESSION_PATH`, default `./data/sessions.sqlite`). Reiniciar `mage serve` **no** borra el historial. Al pasar el máximo de turnos se compacta: `summary` (factIds, lastStatus, lastEvidenceIds) + últimos 6 turnos en el prompt.

| Variable | Default | Descripción |
|----------|---------|-------------|
| `MAGE_SESSION_ENABLED` | `1` | Activar sesiones |
| `MAGE_SESSION_STORE` | `sqlite` | `sqlite` \| `memory` |
| `MAGE_SESSION_PATH` | `./data/sessions.sqlite` | Archivo SQLite |
| `MAGE_SESSION_MAX_TURNS` | `20` | Umbral de compaction |
| `MAGE_SESSION_TTL_MS` | `86400000` | TTL |

```bash
mage> /history
mage> /new
mage> /session
```

```bash
curl -s -X POST http://127.0.0.1:3920/v1/sessions
curl -s -X POST http://127.0.0.1:3920/v1/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"hola","sessionId":"<uuid>"}'
```

## 11. Streaming SSE

```bash
./bin/mage --stream "valida con calc: 2**10"
# stderr: [enrich] … [tool] calc … [done]
# stdout: 1024
```

En shell: `/stream on`. El evento `done` es el contrato (mismo `MageResult` que sync).

| Evento | Cuándo |
|--------|--------|
| `start` | Inicio |
| `enrich` | Tras memoria |
| `plan_start` / `plan_thought` / `plan` | LLM |
| `tool_start` / `tool_end` | Tools |
| `correction` | Reintento |
| `answer` / `refuse` | Resultado |
| `done` | `MageResult` completo |
| `error` | Error amigable |
| `ping` | Heartbeat 15s |

```bash
curl -N -X POST http://127.0.0.1:3920/v1/query/stream \
  -H 'Content-Type: application/json' \
  -d '{"query":"hash de mage"}'
```

## 12. script.run — experimental, no es un sandbox

Default **off**. `mage serve` no lo habilita. No forma parte del pitch ni de las recetas HTTP.

Si lo prendés (`MAGE_SCRIPT_ENABLED=1`) corre TypeScript en un subproceso Bun con blocklist y timeout. Eso **no** es aislamiento de producción. El wedge usa host tools + SQLite.

## 13. Sin LLM o con cuota agotada

Orden, sin stack trace:

1. **Stub** (tests y demo del contrato): `MAGE_PROVIDER=stub` + `MAGE_STUB_PLAN=…` como en §1.
2. **Fast path / ingest:** math, hash, JSON, `mage ingest` — 0 tokens.
3. **Otra key** (OpenAI / Anthropic) o esperar el retry de Gemini.
4. **Ollama** (opt-in): `ollama pull llama3.2`, `MAGE_FALLBACK_OLLAMA=1`, servicio en `127.0.0.1:11434`. Mage sigue usando Gemini/OpenAI/Anthropic como primario y cae a llama si el cloud falla. Si Ollama no está corriendo, apagá el fallback (`MAGE_FALLBACK_OLLAMA=0`): si no, Gemini va a fallar igual.

`mage script` solo si habilitaste `script.run` a mano.

## 14. Troubleshooting

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `graph: off` | Pediste Falkor y no está | Default `MAGE_GRAPH=sqlite`; o `docker compose up -d` |
| `refused: no_evidence` | Sin tool OK / sin fact | Esperado. Sembrar con ingest o preguntar algo del wedge |
| `ingest` en el shell iba al LLM | Versión vieja o path `example/` | `examples/http-kpi/facts.json`; comando interceptado en 0.3 |
| Quota exceeded (429) | Free tier Gemini | §13: stub, fast path, otra key, Ollama |
| `gemini-2.5-flash` 404 | Modelo deprecado | `gemini-3.6-flash` |
| Respuesta lenta (10–45 s) | Latencia cloud | Normal en free; fast path evita LLM |
| `plugins/toolkit.wasm` missing | WASM no compilado | `bun run build:wasm` |
| Bind no loopback sin key | Guard de boot | `MAGE_API_KEY` o `MAGE_HOST=127.0.0.1` |

```bash
bun test
bun run build:wasm
./bin/mage status
```

## 15. Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `MAGE_PROVIDER` | `gemini` | `gemini` \| `anthropic` \| `openai` \| `stub` |
| `MAGE_FAST_MODEL` | por proveedor | Modelo de plan |
| `MAGE_REASON_MODEL` | por proveedor | Modelo de razonamiento |
| `GOOGLE_GENERATIVE_AI_API_KEY` | — | Gemini |
| `ANTHROPIC_API_KEY` | — | Anthropic |
| `OPENAI_API_KEY` | — | OpenAI |
| `MAGE_EMBED_PROVIDER` | `none` | `none` \| `gemini` \| `openai` |
| `MAGE_GRAPH` | `sqlite` | `sqlite` \| `falkor` \| `off` |
| `FALKOR_HOST` / `PORT` / `GRAPH` | localhost:6379 / `mage` | Solo con `MAGE_GRAPH=falkor` |
| `MAGE_FACTS_PATH` | `./data/facts.sqlite` | Hechos |
| `MAGE_VEC_PATH` | `./data/mage.vec.db` | Vectores (si hay embed) |
| `MAGE_PORT` / `MAGE_HOST` | `3920` / `127.0.0.1` | HTTP |
| `MAGE_API_KEY` | — | Bearer `/v1/*`. Obligatoria si el bind no es loopback |
| `MAGE_CORS_ORIGINS` | (vacío) | Allowlist; nunca `*` |
| `MAGE_RATE_LIMIT_PER_MIN` | `60` | `/v1/query*` por IP |
| `MAGE_REQUEST_TIMEOUT_MS` | `60000` | Timeout HTTP |
| `MAGE_WASM_TIMEOUT_MS` | `50` | Timeout WASM |
| `MAGE_ENRICH_BUDGET_MS` | `25` | Presupuesto enrich |
| `MAGE_MAX_ATTEMPTS` | `3` | Reintentos |
| `MAGE_SCRIPT_ENABLED` | `0` | script.run; no en serve |
| `MAGE_SCRIPT_TIMEOUT_MS` | `2000` | Timeout script |
| `MAGE_FALLBACK_OLLAMA` | `1` | Tras fallo cloud, intenta Ollama (hace falta `ollama serve` + modelo) |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434/v1` | API compatible OpenAI |
| `MAGE_OLLAMA_MODEL` | `llama3.2` | Modelo local |
| `MAGE_SESSION_ENABLED` | `1` | Sesiones |
| `MAGE_SESSION_STORE` | `sqlite` | `sqlite` \| `memory` |
| `MAGE_SESSION_PATH` | `./data/sessions.sqlite` | Archivo de sesiones |
| `MAGE_SESSION_MAX_TURNS` | `20` | Compaction |
| `MAGE_SESSION_TTL_MS` | `86400000` | TTL |

## 16. Mapa del repo

```
src/
  cli.ts              # consulta, ingest, seed, serve, status
  cli/shell.ts        # shell: /ingest, /status, …
  server.ts           # HTTP /v1
  loop/metacog.ts     # bucle
  loop/result.ts      # finalizeResult (único que fabrica answer)
  loop/fastpath.ts    # atajo WASM (calc por AST)
  loop/metrics.ts     # snapshot /health (rotting)
  memory/ingest.ts    # Fact store
  memory/sqlite-graph.ts
  tools/wedge.ts      # kpi.lookup, source.cite, rule.check
  tools/registry.ts   # Zod in/out; planner sin writes
  session/sqlite.ts   # sesiones persistentes
plugins/
  toolkit.wasm
examples/
  http-kpi/           # wedge demo del README
  consultora-norte/   # wedge industrial (tenant norte)
data/                 # sqlite local (gitignore)
```

## 17. Contribuir

Ver [CONTRIBUTING.md](../CONTRIBUTING.md), [ARCHITECTURE.md](ARCHITECTURE.md), [PRODUCTO.md](PRODUCTO.md) y [SECURITY.md](../SECURITY.md).
