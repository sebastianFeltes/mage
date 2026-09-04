# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| 0.2.x   | :x:                |
| < 0.2   | :x:                |

## Reporting a Vulnerability

**No abras un issue público** para vulnerabilidades de seguridad.

Reporta por email o issue privado al mantenedor del repositorio con:

- Descripción del problema
- Pasos para reproducir
- Impacto estimado

Responderemos en un plazo de 7 días.

## Consideraciones de seguridad de Mage

### API HTTP

`mage serve` escucha en `127.0.0.1` por defecto.

- Si `MAGE_API_KEY` está seteada, todo `/v1/*` exige `Authorization: Bearer <key>`. `/health` no.
- Si `MAGE_HOST` no es loopback y no hay API key, el proceso **no arranca**.
- CORS: lista vacía o allowlist. Nunca `Access-Control-Allow-Origin: *`.
- Rate limit in-memory: 60 req/min/IP en `/v1/query` y `/v1/query/stream`.

No es un open proxy. Bind público sin key es un error de configuración.

Write tools (`memory.ingest`) no están en el catálogo del planner y `dispatch` las rechaza sin `allowWrite`. El loop no persiste `memoryCandidates` del LLM.

### `script.run` (experimental, no sandbox)

`MAGE_SCRIPT_ENABLED` default `0`. `mage serve` no lo prende. Subproceso Bun con blocklist: no es aislamiento de producción. No habilitarlo en recetas de serve ni en hosts públicos.

### Secretos

- Nunca commitear `.env` ni API keys.
- `mage status --json` no imprime `MAGE_API_KEY`.
- Rotar claves si se exponen accidentalmente.

### WASM sandbox

Las tools WASM tienen timeout (~50 ms) pero no aislamiento de red completo.
Tratar plugins WASM como código de confianza.
