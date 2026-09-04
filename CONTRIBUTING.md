# Contributing to Mage

Gracias por tu interés en contribuir a Mage.

## Desarrollo local

```bash
cd mage
bun install
bun run build:wasm
bun test                 # stub, sin API key ni Docker
cp .env.example .env     # solo si vas a pegarle a un LLM
```

## Flujo de trabajo

1. Abre un issue para discutir cambios grandes.
2. Crea una rama desde `main`: `feat/nombre` o `fix/nombre`.
3. Asegúrate de que `bun test` pasa.
4. Abre un Pull Request con descripción clara del **por qué** del cambio.

## Convenciones

- **Bun** como runtime; no añadir Node.js como dependencia de ejecución.
- Mantener schemas Zod compactos (menos tokens = menor latencia).
- Tests para lógica nueva; mocks para APIs externas (no requerir API keys en CI).
- Español o inglés en docs/comentarios — ser consistente dentro de cada archivo.

## Áreas donde ayudar

- Nuevas tools WASM (AssemblyScript en `wasm/`)
- Patrones fast path en `src/loop/fastpath.ts`
- Tests de integración con FalkorDB
- Documentación y ejemplos

Ver [docs/COMO.md](docs/COMO.md) y [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
