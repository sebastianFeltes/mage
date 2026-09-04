# Ejemplo: consultora norte (planta industrial)

Otro cliente, otro dominio. No es el demo `http-kpi`. Tenant `norte`, fuente `cliente://norte/fy26`.

```bash
# desde la raíz del repo
bun install && bun run build:wasm
./bin/mage ingest --file examples/consultora-norte/facts.json
```

Con stub (sin red). `serve` lee `MAGE_STUB_PLAN`; las queries van con `tenantId=norte`.

```bash
# 1. OEE
MAGE_PROVIDER=stub MAGE_STUB_PLAN='{"thought":"lookup","confidence":1,"toolCalls":[{"tool":"kpi.lookup","input":{"name":"oee"},"reason":"kpi"}],"proposedAnswer":"999"}' \
  ./bin/mage serve
```

En otra terminal:

```bash
curl -s -X POST http://127.0.0.1:3920/v1/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"cuál es el OEE","tenantId":"norte"}'
# → 0.74  status=answered  source=cliente://norte/fy26  (el 999 no sale)
```

```bash
# 2. fuente del scrap (reiniciá serve con este plan)
MAGE_PROVIDER=stub MAGE_STUB_PLAN='{"thought":"cite","confidence":1,"toolCalls":[{"tool":"source.cite","input":{"name":"scrap"},"reason":"cite"}],"proposedAnswer":null}' \
  ./bin/mage serve
```

```bash
curl -s -X POST http://127.0.0.1:3920/v1/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"fuente del scrap","tenantId":"norte"}'
# → source=cliente://norte/fy26
```

`kpi.lookup arr` en este tenant → `status: refused`, `refusalReason: not_found`. El ARR de acme no vive acá.

CLI `mage "cuál es el OEE"` usa tenant `default`; para norte pasá `tenantId` por HTTP o `mage()`.
