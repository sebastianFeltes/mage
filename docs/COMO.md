# Mage — Cómo usarlo

Guía práctica del flujo metacognitivo: memoria (grafo + vectores), LLM, sandbox WASM.

## Requisitos

- [Bun](https://bun.sh) 1.1+
- [Docker](https://docs.docker.com/get-docker/) (para FalkorDB / memoria en grafo)
- API key de un proveedor LLM (esta guía usa **Gemini**)

## 1. Instalación

```bash
cd mage
bun install
bun run build:wasm   # compila plugins/toolkit.wasm (calc, hash, json_validate)
```

### Comando `mage` en la terminal

| Forma | Cuándo |
|-------|--------|
| `./bin/mage` | Desde el repo, sin instalar nada más |
| `bun run mage` | Alias npm |
| `bun link` → `mage` | Global en PATH (ejecutar una vez desde el repo) |

Sin argumentos entras al **shell interactivo** (runtime caliente: WASM + DB ya cargados).

```bash
./bin/mage
# mage shell — consultas, /help para comandos
# mage> /status
# mage> ¿Qué es FastPath?
# mage> /exit
```

Comandos internos del shell: `/help`, `/status`, `/seed`, `/verbose`, `/json`, `/script`, `/exit`.

## 2. Variables de entorno

```bash
cp .env.example .env
```

Edita `.env`:

```env
MAGE_PROVIDER=gemini
GOOGLE_GENERATIVE_AI_API_KEY=tu_clave_aqui

MAGE_FAST_MODEL=gemini-3.6-flash
MAGE_REASON_MODEL=gemini-3.1-pro-preview
MAGE_EMBED_PROVIDER=none          # rápido; usa "gemini" para embeddings cloud

FALKOR_HOST=127.0.0.1
FALKOR_PORT=6379
FALKOR_GRAPH=mage
```

> `.env` está en `.gitignore`. **Nunca** commitees claves API.

## 3. Memoria (SQLite por defecto)

No hace falta Docker. El grafo vive en `./data/facts.sqlite` (`MAGE_GRAPH=sqlite`).

```bash
bun src/cli.ts status
```

Salida esperada:

```
graph: sqlite
vectors: none
```

FalkorDB es opcional: `MAGE_GRAPH=falkor` y `docker compose up -d`. Si el host no responde, `graph: off`. Embeddings semánticos solo si `MAGE_EMBED_PROVIDER` no es `none` (el default no usa FNV como RAG).

## 4. Sembrar datos demo

```bash
bun src/cli.ts seed
# → seed: 3 nodos + relaciones demo
```

Crea en el grafo:

| Nodo | Tipo | Texto |
|------|------|-------|
| Mage | Entidad | Motor metacognitivo en Bun |
| FastPath | Concepto | Respuesta WASM sin LLM |
| WasmTimeout | Hecho | Sandbox limitado a 50ms |

Relaciones:

```
(Mage)-[:DEPENDE_DE]->(FastPath)
(Mage)-[:RELACIONADO_CON]->(WasmTimeout)
(FastPath)-[:PREFIERE]->(WasmTimeout)
```

También escribe nodos/edges en el SQLite de facts. Vectores cloud solo si `MAGE_EMBED_PROVIDER` no es `none`.

## 5. Probar la memoria (sin LLM)

```bash
bun -e "
import { loadConfig } from './src/config.ts';
import { createGraphStore } from './src/memory/sqlite-graph.ts';
import { HybridMemory } from './src/memory/hybrid.ts';
import { VectorMemory } from './src/memory/vectors.ts';

const cfg = loadConfig();
const graph = createGraphStore(cfg);
const vectors = new VectorMemory(cfg);
await graph.connect();
await graph.seed();
await vectors.open();
const hybrid = new HybridMemory(cfg, graph, vectors);
console.log(hybrid.toPromptChunks(await hybrid.search('Mage FastPath')));
"
```

Salida esperada (aprox.):

```
- [graph] Entidad:Mage Motor metacognitivo en Bun
- [graph] Concepto:FastPath Respuesta WASM sin LLM
- [graph] Hecho:WasmTimeout Sandbox limitado a 50ms
```

La búsqueda híbrida corre en **paralelo** (grafo + vectores) con presupuesto de **25 ms** (`MAGE_ENRICH_BUDGET_MS`).

## 6. Flujo completo (memoria + LLM + sandbox)

### Consulta que usa memoria

```bash
bun src/cli.ts --verbose "¿Qué es Mage y cómo se relaciona con FastPath?"
```

### Qué ocurre por dentro

```
Consulta
   │
   ├─► Fast path? (math/hash/json) ──► WASM directo, 0 tokens LLM
   │
   └─► Enriquecimiento (≤25 ms)
   │      ├─ FalkorDB: nodos por nombre + vecinos 1-hop
   │      └─ sqlite-vec: similitud local
   │
   ├─► LLM (gemini-3.6-flash): plan JSON (Zod)
   │      ├─ toolCalls → sandbox WASM (≤50 ms c/u)
   │      └─ proposedAnswer
   │
   ├─► ¿Error sandbox? → autocorrección silenciosa (hasta 3 intentos)
   │
   └─► Respuesta + persistencia async (nodos/relaciones nuevos)
```

### Ejemplo real (con memoria levantada)

```
enrich=4ms   plan=10062ms   sandbox=0ms   attempts=1

Respuesta: Mage es un motor metacognitivo en Bun. FastPath es un mecanismo
WASM que responde sin invocar al LLM...
```

El LLM recibió el contexto del grafo en el prompt; no necesitó llamar `memory.search` como tool porque el enrich ya inyectó los hits.

### Consulta con sandbox

```bash
bun src/cli.ts --verbose 'valida con calc: 0.1+0.2'
# → 0.30000000000000004  (sandbox ~2 ms)
```

### Fast path (sin LLM)

Estas consultas van **directo al sandbox WASM** (~2–5 ms), sin llamar a Gemini:

| Consulta ejemplo | Tool |
|------------------|------|
| `cuánto es (12+8)*3` | `calc` |
| `valida con calc: 500000 + 9` | `calc` |
| `cuantas letras R tiene la palabra foo` | `count_letter` |
| `verifica si anita lava la tina es palindromo` | `is_palindrome` |
| `primer numero primo mayor a 500.000` | `next_prime` |
| `hash de mage` | `hash` |
| `{ "a": 1 }` | `json_validate` |

En `--verbose` verás `tools=calc fastpath` y `sandbox=2ms` (no `sandbox=0`).

```bash
bun src/cli.ts "cuánto es (12+8)*3"
# → 60  (total ~3 ms tras boot)
```

## 7. Salida estructurada

```bash
bun src/cli.ts --json "¿Qué es Mage?"
```

Devuelve `answer`, `plan` (thought, toolCalls, memoryCandidates, relationCandidates) y `timings`.

## 8. API HTTP

```bash
bun src/cli.ts serve          # http://127.0.0.1:3920
# o: bun run serve
```

`MAGE_API_KEY` opcional. Si está seteada, `/v1/*` exige `Authorization: Bearer`. `/health` no. Bind que no sea loopback sin key → el proceso no arranca. CORS cerrado (no `*`). Rate limit 60 req/min/IP en `/v1/query*`. `script.run` no se prende con `serve`.

| Endpoint | Método | Body | Descripción |
|----------|--------|------|-------------|
| `/health` | GET | — | Estado, tools, boot |
| `/v1/query` | POST | `{"query":"..."}` | Respuesta JSON completa |
| `/v1/query/stream` | POST | `{"query":"..."}` | SSE (start → answer → done) |

```bash
curl -s http://127.0.0.1:3920/health | jq
curl -s -X POST http://127.0.0.1:3920/v1/query \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MAGE_API_KEY" \
  -d '{"query":"¿Qué es FastPath?"}' | jq .answer
```

El servidor reutiliza un **runtime caliente** (WASM + DB ya abiertos).

## 9. Shell interactivo

```bash
mage                    # o ./bin/mage
mage --verbose          # shell con timings
mage "consulta única"   # una pregunta y sale
```

Dentro del shell:

```
mage> /status
mage> /seed
mage> /verbose on
mage> cuánto es 7*6
mage> ¿qué es Mage?
mage> /script return [1,2,3].reduce((a,b)=>a+b,0)
mage> /exit
```

También funciona `bun src/cli.ts --repl` (equivalente).

## 10. Interpretar timings

| Campo | Qué mide |
|-------|----------|
| `bootMs` | Carga WASM + conexión DB (solo 1ª vez por proceso) |
| `enrichMs` | Búsqueda híbrida grafo+vectores |
| `planMs` | Llamada LLM (plan o corrección) |
| `sandboxMs` | Ejecución WASM |
| `totalMs` | Latencia total de la consulta |
| `attempts` | Pasadas del bucle (autocorrección) |

## 11. Troubleshooting

| Síntoma | Causa | Solución |
|---------|-------|----------|
| `graph: off` | Pediste Falkor y no está | `MAGE_GRAPH=sqlite` (default) o `docker compose up -d` |
| `gemini-2.5-flash` 404 | Modelo deprecado | Usar `gemini-3.6-flash` en `.env` |
| 503 high demand | Saturación API gratuita | Reintenta; usa fast path (tabla arriba) que no necesita LLM |
| Quota exceeded (429) | Límite free tier Gemini (~20 req) | Ver §15: Ollama, `mage script`, offline quicksort, o esperar |
| Respuesta lenta (~10–45 s) | Latencia cloud LLM | Normal en tier free; fast path evita LLM en math/hash |
| `plugins/toolkit.wasm` missing | WASM no compilado | `bun run build:wasm` |

## 12. Comandos útiles

```bash
bun test                    # tests unitarios + HTTP
bun run build:wasm          # recompilar toolkit AssemblyScript
docker compose down         # apagar FalkorDB
docker compose logs -f      # logs del grafo
```

## 14. script.run — experimental, no es un sandbox

Default **off**. `mage serve` no lo habilita. No forma parte del pitch ni de las recetas HTTP.

Si lo prendés a mano (`MAGE_SCRIPT_ENABLED=1`) corre TypeScript en un subproceso Bun con blocklist y timeout. Eso **no** es aislamiento de producción. El wedge de producto usa tools host + SQLite, no este camino.

## 15. Cuota Gemini agotada

Mage ya no muestra stack trace. Orden de fallback:

1. **Ollama** (`MAGE_FALLBACK_OLLAMA=1`, activo por defecto):
   ```bash
   ollama pull llama3.2
   bun src/cli.ts status   # ollama: llama3.2 @ ...
   ```

2. **Offline** (sin LLM): quicksort/ordena con array `[n,n,n]` → `script.run` automático.

3. **CLI directo**:
   ```bash
   bun src/cli.ts script 'const a=[3,1,4,1,5]; return a.sort((x,y)=>x-y);'
   ```

4. **Esperar** el tiempo que indica el error (~47s en free tier).

## 16. Sesiones multi-turno

Cada consulta puede pertenecer a una **sesión** con historial de turnos user/assistant.

### Variables

| Variable | Default | Descripción |
|----------|---------|-------------|
| `MAGE_SESSION_ENABLED` | `1` | Activar sesiones |
| `MAGE_SESSION_MAX_TURNS` | `20` | Turnos máx. en prompt |
| `MAGE_SESSION_TTL_MS` | `86400000` | TTL in-memory (24h) |
| `MAGE_SESSION_PATH` | `./data/sessions` | Reservado (persistencia Fase 2) |

### Shell

```bash
mage
mage> ¿Qué es Mage según la memoria?
mage> ¿y cómo se relaciona con WasmTimeout?
mage> /history
mage> /new          # nueva sesión
mage> /session      # muestra sessionId
```

### API

```bash
# Crear sesión explícita
curl -s -X POST http://127.0.0.1:3920/v1/sessions | jq

# Consulta con sesión
curl -s -X POST http://127.0.0.1:3920/v1/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"hola","sessionId":"<uuid>"}' | jq .sessionId

# Ver historial
curl -s http://127.0.0.1:3920/v1/sessions/<uuid> | jq .turns
```

Las sesiones viven **en memoria del proceso** — se pierden al reiniciar `mage serve`.

## 17. Streaming SSE

### CLI

```bash
mage --stream "valida con calc: 2**10"
# stderr: [enrich] … [tool] calc ok … [done] 12ms
# stdout: 1024
```

En shell: `/stream on`

### Contrato de eventos

| Evento | Cuándo |
|--------|--------|
| `start` | Inicio de consulta |
| `enrich` | Tras búsqueda memoria |
| `plan_start` | Antes de LLM |
| `plan_thought` | Thought parcial del plan |
| `plan` | Plan JSON completo |
| `tool_start` / `tool_end` | Ejecución sandbox |
| `correction` | Autocorrección |
| `answer` | Respuesta final |
| `done` | `MageResult` completo |
| `error` | Error amigable |
| `ping` | Heartbeat cada 15s |

```bash
curl -N -X POST http://127.0.0.1:3920/v1/query/stream \
  -H 'Content-Type: application/json' \
  -d '{"query":"hash de mage"}'
```

## 18. API reference

| Endpoint | Método | Body | Respuesta |
|----------|--------|------|-----------|
| `/health` | GET | — | `{ ok, graph, tools, bootMs, sessions }` |
| `/v1/sessions` | POST | `{ tenantId? }` | `{ sessionId, tenantId, createdAt }` |
| `/v1/sessions/:id` | GET | `?tenantId=` | `Session` con `turns[]` y `summary` |
| `/v1/sessions/:id` | DELETE | — | `{ ok: true }` |
| `/v1/query` | POST | `{ query, sessionId?, tenantId? }` | `MageResult` |
| `/v1/query/stream` | POST | `{ query, sessionId?, tenantId? }` | SSE |
| `/v1/memory` | POST | `{ tenantId, facts[], source }` | `{ upserted }` |

### MageResult

```json
{
  "status": "answered",
  "answer": "…",
  "sessionId": "uuid",
  "tenantId": "default",
  "evidence": [{ "id": "…", "tool": "kpi.lookup", "output": { "found": true, "value": "1200000" } }],
  "plan": { "thought": "…", "toolCalls": [] },
  "timings": { "bootMs": 0, "enrichMs": 0, "planMs": 0, "sandboxMs": 0, "totalMs": 0, "attempts": 0, "usedReasonModel": false }
}
```

## 19. Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `MAGE_PROVIDER` | `gemini` | `gemini` \| `anthropic` \| `openai` |
| `MAGE_FAST_MODEL` | por proveedor | Modelo rápido (plan) |
| `MAGE_REASON_MODEL` | por proveedor | Modelo razonamiento |
| `GOOGLE_GENERATIVE_AI_API_KEY` | — | API key Gemini |
| `ANTHROPIC_API_KEY` | — | API key Anthropic |
| `OPENAI_API_KEY` | — | API key OpenAI |
| `MAGE_EMBED_PROVIDER` | `none` | `none` \| `gemini` \| `openai` |
| `MAGE_GRAPH` | `sqlite` | `sqlite` \| `falkor` \| `off`. Falkor solo si el host responde |
| `FALKOR_HOST` | `127.0.0.1` | Host FalkorDB (solo con `MAGE_GRAPH=falkor`) |
| `FALKOR_PORT` | `6379` | Puerto FalkorDB |
| `FALKOR_GRAPH` | `mage` | Nombre del grafo |
| `MAGE_VEC_PATH` | `./data/mage.vec.db` | DB vectores |
| `MAGE_PORT` | `3920` | Puerto HTTP |
| `MAGE_HOST` | `127.0.0.1` | Host HTTP |
| `MAGE_API_KEY` | — | Bearer en `/v1/*`. Obligatoria si el bind no es loopback |
| `MAGE_CORS_ORIGINS` | (vacío) | Allowlist CORS; nunca `*` |
| `MAGE_RATE_LIMIT_PER_MIN` | `60` | Rate limit `/v1/query*` por IP |
| `MAGE_REQUEST_TIMEOUT_MS` | `60000` | Timeout de request HTTP |
| `MAGE_WASM_TIMEOUT_MS` | `50` | Timeout WASM |
| `MAGE_ENRICH_BUDGET_MS` | `25` | Presupuesto enrich |
| `MAGE_MAX_ATTEMPTS` | `3` | Reintentos autocorrección |
| `MAGE_SCRIPT_ENABLED` | `0` | script.run experimental (no sandbox; no en serve) |
| `MAGE_SCRIPT_TIMEOUT_MS` | `2000` | Timeout script.run |
| `MAGE_FALLBACK_OLLAMA` | `1` | Fallback a Ollama |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434/v1` | URL Ollama |
| `MAGE_OLLAMA_MODEL` | `llama3.2` | Modelo Ollama |
| `MAGE_SESSION_ENABLED` | `1` | Sesiones multi-turno |
| `MAGE_SESSION_MAX_TURNS` | `20` | Turnos en prompt |
| `MAGE_SESSION_TTL_MS` | `86400000` | TTL sesiones |

## 20. Contribuir

Ver [CONTRIBUTING.md](../CONTRIBUTING.md), [ARCHITECTURE.md](ARCHITECTURE.md) y [SECURITY.md](../SECURITY.md).

```
src/
  cli.ts              # CLI: consulta, shell, serve, status, seed
  cli/shell.ts        # Shell interactivo + comandos /
  server.ts           # API HTTP Bun
  session/            # Sesiones multi-turno (in-memory)
  loop/metacog.ts     # Bucle metacognitivo + eventos
  loop/events.ts      # Contrato MageEvent
  loop/fastpath.ts    # Atajo WASM sin LLM
  memory/graph.ts     # FalkorDB (Cypher)
  memory/vectors.ts   # sqlite-vec
  memory/hybrid.ts    # Búsqueda paralela con presupuesto
  sandbox/pool.ts     # Pool de plugins WASM
  tools/registry.ts   # Catálogo de tools (wasm + host)
plugins/
  toolkit.wasm        # calc, hash, json_validate, …
data/
  mage.vec.db         # vectores locales (auto-creado)
```
