# Mage frente a harnesses de agentes de código

Comparativa de **Mage 0.2.0** (Fase 1) con entornos tipo Cursor, Claude Code y Google Antigravity. El objetivo no es coronar un ganador: son categorías distintas que a veces se venden como si fueran lo mismo.

**Audiencia:** equipo técnico que evalúa si Mage es un producto de coding-agent, un runtime embebible, o una pieza de un stack más grande.

**Fuentes de Mage:** `README.md`, `docs/ARCHITECTURE.md`, `docs/COMO.md`, `SECURITY.md`, `src/loop/metacog.ts`, `src/tools/registry.ts`. El resto de productos se describe por su diseño público a septiembre 2026.

---

## 1. Tesis

Mage **no es un harness de coding agent**. Es un **motor metacognitivo**: el LLM no escribe texto libre como respuesta primaria, sino un **plan JSON validado (Zod)**; ese plan se ejecuta en **tools verificables** (WASM / `script.run`); si el sandbox falla, el modelo **autocorrige** (hasta 3 intentos); y cada turno se **enriquece** con memoria híbrida (grafo FalkorDB + vectores sqlite-vec).

Cursor, Claude Code y Antigravity son **harnesses de desarrollo de software**: leen el repo, editan archivos, corren tests, revisan diffs y (en distintos grados) orquestan subagentes. Su unidad de éxito es *código que compila y un PR que se puede mergear*. La de Mage es *una afirmación que se puede trazar a una tool o a un fast path determinístico*.

Compararlos como sustitutos es un error de categoría. Compararlos como **capas** es útil: Mage puede vivir *debajo* de un harness (kernel de verificación) o *al lado* (API de consultas verificadas). Hoy, en Fase 1, **no puede reemplazar** a ninguno de ellos para escribir software.

```
Capa de producto          Ejemplos
───────────────────────   ─────────────────────────────────────────
IDE + agente en el editor Cursor, Antigravity IDE / extensiones
CLI / headless coding     Claude Code, Antigravity CLI, Cursor CLI
Orquestación multiagente  Antigravity 2.0, subagentes Claude, cloud agents Cursor
Motor de plan+verify      Mage (esta capa)
Modelo LLM                Gemini / Claude / GPT / Ollama
```

---

## 2. Qué es cada entorno

### Mage (este repo)

Runtime en **Bun**, MIT, autoalojable. Tres superficies: CLI/shell (`mage`), librería (`mage()` / `runMageStream`) y API HTTP (`mage serve` en `:3920`).

Bucle real (`src/loop/metacog.ts`):

1. Resolver sesión e historial (in-memory, trim por N turnos).
2. **Fast path:** regex → WASM directo (~2–5 ms, 0 tokens).
3. **Enrich:** grafo + vectores en paralelo, presupuesto 25 ms.
4. **Plan:** `streamObject` / `generateObject` contra `PlanSchema` (Zod).
5. **Sandbox:** tools WASM (~50 ms) o `script.run` (opt-in, subproceso Bun).
6. Si falla → corrección; si no hay tools y la confianza es baja → reevaluar con modelo de razonamiento.
7. Respuesta derivada de traces o `proposedAnswer`; persistencia async de hechos al grafo.

Tools de Fase 1: `calc`, `hash`, `json_validate`, `count_letter`, `is_palindrome`, `next_prime`, `memory.search`, y `script.run` si `MAGE_SCRIPT_ENABLED=1`. **No hay** lectura/escritura de repo, git, tests, browser ni MCP.

Roadmap declarado: agentes B2B verificados (Fase 2) y Mage Cloud (Fase 3).

### Cursor

IDE (fork de VS Code) con agente, Composer, Tab, agentes en paralelo (worktrees), agentes en la nube, CLI, Bugbot y MCP. Optimizado para **edición supervisada**: el humano sigue en el editor, acepta diffs y mantiene el contexto del proyecto (reglas, skills, indexación). Cerrado, de pago, con modelos propios y de terceros.

### Claude Code

Harness **terminal-first** (también extensiones de editor). El agente lee el filesystem, edita, corre comandos, usa MCP, hooks y subagentes. Encaja en CI/CD y modo headless. Optimizado para **delegar una tarea y volver a un cambio hecho**, no para autocompletar línea a línea.

### Google Antigravity

Plataforma **agent-first** de Google: app de escritorio 2.0 (centro de mando, no IDE), CLI, SDK, extensiones (VS Code / JetBrains / Zed) e IDE original. Orquestación multiagente, artefactos compartidos (planes, diffs, capturas), tareas programadas, gobernanza Gemini Enterprise. Optimizado para **misiones** y operación a escala Google Cloud, no para un kernel mínimo autoalojado.

### Familia cercana (no el foco)

Aider, Cline, Codex CLI, Gemini CLI, OpenHands, Devin: todos son harnesses de *editar código con un LLM*. Compiten entre sí y con Cursor/Claude/Antigravity. Mage no está en ese ranking.

---

## 3. Similitudes

| Idea compartida | Cómo aparece en Mage | Cómo aparece en los harnesses |
|-----------------|----------------------|--------------------------------|
| Bucle agente | Plan → tools → corrección | Plan → editar/correr → reintentar |
| Tools con contrato | Zod + registry | JSON schema / MCP / built-ins |
| Sesión multi-turno | `sessionId`, historial recortado | Chat, transcripts, compaction |
| Streaming | SSE (`enrich`, `plan_thought`, `tool_*`) | Tokens, diffs, tool traces en UI |
| Multi-modelo | Gemini / Anthropic / OpenAI + fallback Ollama | Router de modelos del producto |
| CLI | `mage` / `mage serve` | `claude`, Cursor CLI, Antigravity CLI |
| Extensibilidad | Tools WASM, host tools, fast path, `SessionStore` | MCP, hooks, skills, plugins, SDK |

La semejanza termina en el **objeto de la tool**. En Mage la tool *calcula o busca memoria*. En un harness la tool *toca el mundo del desarrollador* (disco, git, red, browser, tickets).

---

## 4. Diferencias estructurales

| Eje | Mage | Cursor | Claude Code | Antigravity |
|-----|------|--------|-------------|-------------|
| Trabajo que resuelve | Consulta verificada, hechos, algoritmos | Escribir y revisar código en el IDE | Tareas autónomas sobre el repo | Misiones / orquestación de agentes |
| Unidad de éxito | Trace de sandbox o fast path | Diff aceptado + app que corre | Tarea cerrada (tests, commit, PR) | Artefactos de misión + agentes en paralelo |
| Salida del LLM | Objeto Zod (`Plan`) | Texto + edits + tool calls | Texto + tool calls | Planes, diffs, subagentes |
| Contexto | Enrich 25 ms (grafo+vec) + N turnos | Índice del repo, reglas, @-mentions | Lectura directa de archivos, compaction | Artefactos compartidos + editor/CLI |
| Memoria de largo plazo | Grafo + sqlite-vec (primera clase) | Indexación / memories de producto | CLAUDE.md, transcripts | Artefactos + cuenta unificada |
| Edición de código | No | Sí (núcleo del producto) | Sí (núcleo del producto) | Sí (vía agentes / extensiones) |
| Aislamiento | WASM Extism + script opt-in | Sandbox del editor / cloud VMs | Permisos de tools + worktrees | Gobernanza Cloud + sandbox de misión |
| Superficie de ataque | Pequeña (localhost, tools fijas) | Amplia (repo + MCP + cloud) | Amplia (shell + MCP) | Amplia (multi-superficie + empresa) |
| Human-in-the-loop | Bajo (pregunta → respuesta) | Alto (diffs, Tab, chat) | Medio (delegas, luego revisas) | Medio-alto (mission control) |
| Multiagente | No | Agentes paralelos / cloud | Subagentes, hooks | Diseño central del producto |
| Autoalojamiento | Sí (MIT, BYO keys) | No | Parcial (CLI; modelo Anthropic) | No (cuenta Google) |
| Madurez | Fase 1, prototipo OSS | Producto masivo | Producto masivo | Producto masivo Google |
| Costo operativo | Bun + Docker FalkorDB + API LLM | Suscripción | Tokens / suscripción | Gemini / Enterprise |
| Embeddible en tu backend | Sí (`import { mage }`) | No | SDK / headless, no es tu runtime | SDK Python sobre *su* harness |

---

## 5. Ventajas de Mage

1. **Verificación como invariante, no como plugin.** El camino feliz no es “el modelo dijo 60”, es `calc` o fast path. Las afirmaciones numéricas y algorítmicas tienen un sitio donde fallar de forma observable (`tool_end` con error → corrección).
2. **Fast path de 0 tokens.** Aritmética, hash, palíndromo, primo, JSON: ~3 ms tras boot. Un harness de código paga un round-trip de modelo para lo mismo, salvo que el usuario haya puesto un skill ad-hoc.
3. **Plan estructurado.** `thought`, `confidence`, `assumptions`, `toolCalls`, `memoryCandidates` son el contrato. Eso se loguea, se testea y se sirve por HTTP. Los harnesses exponen traces, pero el producto es el diff, no el objeto de plan.
4. **Memoria híbrida explícita.** Relaciones `DEPENDE_DE` / `PREFIERE` no son un RAG genérico: son un grafo que el enrich inyecta en el prompt. Útil para consultoría, ontologías de cliente y “qué depende de qué”.
5. **Presupuestos de latencia.** 25 ms enrich, 50 ms WASM. El diseño asume que la memoria no puede bloquear el turno. Los coding agents optimizan cobertura del repo, no un SLA de milisegundos en la tool.
6. **Superficie embebible.** Misma semántica en CLI, HTTP y `mage()`. Puedes poner el motor detrás de un producto B2B sin forzar un IDE. Cursor/Antigravity *son* el producto de superficie; Mage es el motor.
7. **Control y soberanía.** MIT, providers intercambiables, Ollama de fallback, datos locales (`./data/mage.vec.db`, FalkorDB). No hay telemetría de repo hacia un vendor.
8. **Sandbox más estrecho (cuando `script.run` está off).** Un agente de código con shell es, por diseño, un RCE asistido. Mage WASM es un conjunto cerrado de exports. Eso es una ventaja de *seguridad y de producto regulado*, no de productividad de un developer diario.
9. **Observabilidad del bucle.** Eventos SSE con fases (`start`, `enrich`, `plan`, `correction`, `done`) y `timings`. Encaja en un dashboard de “por qué respondió esto” mejor que un chat de IDE.
10. **Encaje con el roadmap B2B.** Un agente de consultoría que no puede inventar un KPI es un argumento de venta que Cursor no está tratando de hacer.

---

## 6. Desventajas de Mage

1. **No escribe software.** Sin tools de filesystem, git, tests, linter, browser ni MCP, no hay SWE-bench que valga. No es un “Cursor self-hosted”.
2. **Catálogo de tools de juguete.** Seis primitivas WASM + búsqueda de memoria. El mensaje de producto (“agentes que no alucinan”) es más ambicioso que el toolkit actual.
3. **Fast path frágil.** Son regex sobre la consulta. Fuera de esos patrones, todo pasa por el LLM. No hay compilador de “esto es determinístico”.
4. **Historial largo.** Compaction cubre el prompt; no es un resumen LLM ni un índice de repo.
5. **Auth mínima.** Token estático `MAGE_API_KEY`, no OAuth ni tenants de facturación.
6. **`script.run` no es un sandbox de producción.** Subproceso Bun, allowlist negativa, timeout 2 s. Default off. El propio `SECURITY.md` lo marca como experimental.
7. **Operación.** Bun + WASM compile + API keys. Docker/Falkor es opcional.
8. **Grafo aún esquemático.** Tres tipos de nodo, tres relaciones. Los KPIs viven en `Fact` + `tenantId`, no en una ontología rica.
9. **Sin IDE, sin diffs, sin Tab.** El loop de un desarrollador humano no vive aquí. Mage no acelera el *escribir código*.
10. **Sin ecosistema.** No MCP, no marketplace de skills, no millones de reglas de repo, no cloud agents. Extender es “implementar `HostTool` y recompilar WASM”.
11. **Cuota y latencia del LLM.** El plan sigue siendo una llamada cloud (salvo Ollama/offline). El valor de verificación no elimina el costo del `planMs` (a menudo segundos o decenas).
12. **Madurez.** 0.2.0, un día de changelog denso, CI propio. No hay SLO, ni suite de evals públicas, ni comparación empírica frente a harnesses.
13. **WASM de confianza.** Timeout 50 ms no es aislamiento de red completo; los plugins se tratan como código trusted.
14. **Solo Bun.** Fricción en shops Node/Python/Go que quieran embeber el motor sin adoptar el runtime.

---

## 7. Pros y contras contra cada harness

### Contra Cursor

**A favor de Mage**

- Embeddible y autoalojado; Cursor es el IDE.
- Respuestas numéricas atadas a WASM; Cursor (como cualquier agente de código) puede afirmar un cálculo mal si no corre un test.
- Memoria en grafo de dominio, no solo índice de repo.
- Menos privilegios: no toca el working tree.

**En contra de Mage**

- Cero ergonomía de edición. Cursor gana en Tab, Agent, worktrees, cloud agents, reglas, MCP, review de diffs.
- Cero comprensión de *este* codebase más allá de lo que hayas sembrado en FalkorDB.
- No hay producto de equipo (billing, privacy mode, Bugbot, PRs).
- El desarrollador que ya paga Cursor no “migra” a Mage; como mucho lo llama por HTTP para verificar un hecho.

**Veredicto:** no compiten. Mage no es un IDE con cerebro; Cursor no es un motor de planes verificados. El solapamiento es “ambos llaman a un LLM con tools”.

### Contra Claude Code

**A favor de Mage**

- Contrato de salida más rígido (Zod Plan vs. texto + tools).
- Fast path y WASM para trabajo determinístico barato.
- Librería en-proceso: no hace falta spawn de un CLI de otro vendor.
- Grafo como memoria de dominio; Claude Code usa el filesystem y compaction, que es mejor para código y peor para ontologías de negocio.

**En contra de Mage**

- Claude Code *hace el trabajo de ingeniería*. Mage responde una pregunta.
- Permisos, hooks, subagentes, GitHub Actions, MCP: un harness de verdad.
- `script.run` es un primitivo peor que “el agente corre `bun test` en el repo con un permission prompt”.
- Portabilidad de Claude Code (cualquier carpeta, CI) supera a “levanta FalkorDB y compila WASM”.

**Veredicto:** la analogía más honesta es **Claude Code : filesystem de un repo :: Mage : grafo + sandbox de cálculo**. Mismo *shape* de bucle, distinto mundo.

### Contra Google Antigravity

**A favor de Mage**

- Independencia de Google Cloud / Gemini Enterprise.
- Runtime pequeño, auditable, MIT.
- Multi-provider real (incluido Anthropic/OpenAI/Ollama), no “model choice dentro de una cuenta Google”.
- Pensado para *no alucinar hechos*, no para orquestar misiones de desarrollo.

**En contra de Mage**

- Antigravity cubre escritorio, CLI, SDK, extensiones de IDE y gobernanza enterprise. Mage cubre un proceso Bun.
- Multiagente, tareas programadas, artefactos (screenshots, recordings): Mage no tiene esa superficie.
- Un CTO que ya está en Google Cloud no reemplaza Antigravity por un grafo FalkorDB local.
- El SDK de Antigravity construye agentes *sobre su harness*; el de Mage *es* el harness, pero de un dominio estrecho.

**Veredicto:** Antigravity es plataforma de agentes de desarrollo. Mage es un motor de consulta verificada. El SDK de Antigravity es el competidor futuro de “Mage Cloud”, no el IDE.

---

## 8. Cuándo usar cada uno

| Si el problema es… | Usa |
|--------------------|-----|
| Escribir, refactorizar y revisar código con un humano al lado | Cursor (o extensión Antigravity / Claude en el IDE) |
| Delegar una tarea multi-archivo, CI, o un agente headless sobre el repo | Claude Code |
| Orquestar varios agentes, misiones, gobierno Google Cloud | Antigravity |
| Verificar cálculos, hashes, JSON, algoritmos con traza reproducible | Mage (fast path / WASM / `script.run`) |
| Recordar entidades y relaciones de un dominio (cliente, stack, dependencias) y consultarlas | Mage (grafo + vectores) |
| Exponer un endpoint “pregunta → respuesta con plan y timings” en un producto propio | Mage como librería/HTTP |
| Agente B2B que no puede inventar un número | Mage (hoy prototipo; Fase 2 es la apuesta) |
| Autocompletar, Tab, inline diff | Cursor; Mage no aplica |
| Sustituir al IDE | Ninguno de los “Mage vs X” — Mage no entra |

Combinación razonable **hoy**:

```
Humano + Cursor/Claude/Antigravity     → produce código
Mage (HTTP o mage())                   → verifica hechos, KPIs, reglas de dominio
FalkorDB                               → memoria del engagement / ontología del cliente
```

Combinación razonable **si Fase 2 existe de verdad**:

```
Harness de código (edita)
    → llama tools Mage (verify, memory)
        → plan Zod + WASM
            → el harness solo mergea si el kernel verifica
```

Eso es el hueco de producto: **no ser Cursor, ser el compilador de afirmaciones que Cursor no tiene**.

---

## 9. Riesgos de posicionamiento

- **Decir “somos como Cursor pero open source”** destruye la tesis. El catálogo de tools lo desmiente en cinco minutos.
- **Decir “nunca alucinamos”** es falso: el `proposedAnswer` sigue siendo texto del modelo cuando no hay tools, y el grafo puede persistir basura si el plan inventa `memoryCandidates`.
- **Inflar WASM como “sandbox de agente de código”** choca con `script.run` y con plugins trusted.
- **Ignorar el harness** deja a Mage como un REPL de `calc` con LLM caro. El valor está en *plan estructurado + memoria de dominio + traza*, no en competir en SWE-bench.

---

## 10. Resumen ejecutivo

| | Mage | Harnesses (Cursor / Claude Code / Antigravity) |
|-|------|------------------------------------------------|
| Categoría | Motor plan-verify + memoria híbrida | Agentes de desarrollo de software |
| Fortaleza | Trazas, fast path, embed, soberanía | Editar repos, UX, ecosistema, madurez |
| Debilidad Fase 1 | Tools pobres, no hay código, ops, sesiones volátiles | Alucinaciones de hechos, privilegios amplios, vendor lock |
| Relación | Complemento / kernel futuro | Superficie donde vive el developer |

Mage gana si el criterio es **afirmaciones verificables y memoria de grafo autoalojada**. Pierde si el criterio es **hacer software**. Las similitudes (LLM, tools, sesión, stream) son el esqueleto común de cualquier agente en 2026; las diferencias están en *qué se le permite tocar* y *qué cuenta como respuesta válida*.
