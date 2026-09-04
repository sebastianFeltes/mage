# Mage

Mage verifica afirmaciones de un dominio (números, reglas, entidades) y **se niega cuando no puede**. No es un coding agent ni un chat.

Si responde, hay evidence tipada (`kpi.lookup`, `calc`, …). Si no hay rastro, `status: refused`. El modelo puede soñar un número: el runtime lo tira.

MIT. Bun. Sin Docker para el camino feliz.

## Probar en 2 minutos (sin API key)

Hace falta [Bun](https://bun.sh) ≥ 1.1.

```bash
git clone https://github.com/sebastianFeltes/mage.git && cd mage
bun install && bun run build:wasm
bun test                          # 91 tests, sin red
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
| Kernel plan JSON → tools → evidence o refuse | Cursor / Claude Code / Antigravity |
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

Fast path (sin LLM): `(12+8)*3`, `cuánto es 2+2`, `hash de mage`, un JSON literal.

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
```

- Loopback por defecto. Si `MAGE_HOST` no es local, hace falta `MAGE_API_KEY`.
- Con key, `/v1/*` exige `Authorization: Bearer …` (`/health` no).
- `Idempotency-Key` en `POST /v1/query` (TTL 5 min).
- `script.run` está **off**. No es un sandbox. No lo prendas en `serve`.

## Librería

```typescript
import { mage } from "mage";

const r = await mage("cuál es el ARR", { tenantId: "acme" });
if (r.status === "answered") console.log(r.answer, r.evidence);
else console.log("calló", r.refusalReason);
```

## Memoria

- **Hechos (`Fact`)** con `tenantId`, `source`, `value`. Ingest por CLI/HTTP. El planner **no** puede escribir.
- Contradicción (mismo nombre, otro valor) → conflicto, no pisa.
- Grafo SQLite opcional, aislado por tenant. FalkorDB solo si `MAGE_GRAPH=falkor`.
- Embeddings: default `none` (no hay “semántica” FNV).

## Tests

```bash
bun test
```

Evals de refuse / injection / poison / grounded corren con `MAGE_PROVIDER=stub`, sin Gemini.

## Docs

- [Cómo usarlo](docs/COMO.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [Producto (invariantes)](docs/PRODUCTO.md)
- [Comparativa vs harnesses de código](docs/COMPARATIVA.md)
- [Contribuir](CONTRIBUTING.md)
- [Seguridad](SECURITY.md)

## Licencia

[MIT](LICENSE)

Repo: [sebastianFeltes/mage](https://github.com/sebastianFeltes/mage)
