# Ejemplo: KPIs de un cliente

Mage verifica cifras de un dominio. Sembrás hechos con fuente; si no hay evidencia, calla.

```bash
# desde la raíz del repo
bun install && bun run build:wasm
./bin/mage ingest --file examples/http-kpi/facts.json
```

Con stub (sin red):

```bash
MAGE_PROVIDER=stub MAGE_STUB_PLAN='{"thought":"lookup","confidence":1,"toolCalls":[{"tool":"kpi.lookup","input":{"name":"arr"},"reason":"kpi"}],"proposedAnswer":null}' \
  ./bin/mage "cuál es el ARR"
# → 1200000  status=answered  source=cliente://acme/q4
```

HTTP:

```bash
./bin/mage serve
curl -s -X POST http://127.0.0.1:3920/v1/memory \
  -H 'Content-Type: application/json' \
  -d @examples/http-kpi/facts.json

curl -s -X POST http://127.0.0.1:3920/v1/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"cuál es el ARR","tenantId":"default"}'
```

Sin semilla, `kpi.lookup arr` → `status: refused`, `refusalReason: not_found`.
