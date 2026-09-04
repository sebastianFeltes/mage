# Mage frente a harnesses de agentes de código

Comparativa de **Mage 0.3.0** con entornos tipo Cursor, Claude Code y Google Antigravity. El objetivo no es coronar un ganador: son categorías distintas que a veces se venden como si fueran lo mismo.

**Audiencia:** equipo técnico que evalúa si Mage es un coding agent, un runtime embebible, o una pieza de un stack más grande.

**Fuentes de Mage:** `README.md`, `docs/ARCHITECTURE.md`, `docs/PRODUCTO.md`, `SECURITY.md`, `src/loop/result.ts`, `src/loop/metacog.ts`, `src/tools/registry.ts`. El resto de productos se describe por su diseño público a septiembre 2026.

---

## 1. Tesis

Mage **no es un harness de coding agent**. Es un **kernel plan+verify**: el LLM no escribe texto libre como respuesta; emite un **plan JSON validado (Zod)**; ese plan se ejecuta en **tools con output tipado**; `finalizeResult` es el único que fabrica `answer`. Sin evidence positiva → `status: refused`. `proposedAnswer` y `confidence` no habilitan responder. El planner **no** escribe memoria.

Cursor, Claude Code y Antigravity son **harnesses de desarrollo de software**: leen el repo, editan archivos, corren tests, revisan diffs y (en distintos grados) orquestan subagentes. Su unidad de éxito es *código que compila y un PR que se puede mergear*. La de Mage es *una afirmación que se puede trazar a una tool o a un fast path determinístico*.

Compararlos como sustitutos es un error de categoría. Compararlos como **capas** es útil: Mage puede vivir *debajo* de un harness (kernel de verificación) o *al lado* (API de consultas verificadas). **No puede reemplazar** a ninguno de ellos para escribir software.

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

Runtime en **Bun**, MIT, autoalojable. Tres superficies: CLI/shell (`mage`), librería (`mage()` / `runMageStream`) y API HTTP (`mage serve` en `127.0.0.1:3920`).

Bucle real (`src/loop/metacog.ts` + `src/loop/result.ts`):

1. Resolver sesión SQLite (`sessionId` + `tenantId`); historial = summary compactado + últimos turnos.
2. **Fast path:** patrones determinísticos → WASM (~2–5 ms, 0 tokens).
3. **Enrich:** hechos del tenant + grafo SQLite (Falkor opcional), presupuesto 25 ms. Default sin embeddings.
4. **Plan:** `streamObject` / `generateObject` contra `PlanSchema` (Zod).
5. **Sandbox:** tools con input/output Zod. Wedge: `kpi.lookup`, `source.cite`, `rule.check`. WASM: `calc`, `hash`, `json_validate`. Si fallan → corrección (hasta 3 intentos).
6. **`finalizeResult`:** sin evidence positiva → `refused`. El texto del modelo no sale.
7. Append de sesión. El loop **no** persiste `memoryCandidates`. Ingest solo por CLI / `POST /v1/memory`.

Tools de producto en el catálogo del planner: wedge + primitivas WASM + `memory.search` (read; hits no cuentan como evidence positiva). Fuera del planner: `memory.ingest`, `script.run`, palíndromo/letras/primo (siguen en dispatch para fast path). **No hay** lectura/escritura de repo, git, tests, browser ni MCP.

Camino feliz: `bun install && bun test && ./bin/mage`. Sin Docker. Falkor solo si `MAGE_GRAPH=falkor`.

Lo que falta no es reabrir el contrato: es **operar un wedge real** (hechos de un cliente, métricas `% answered` vs `% con evidence`). Cloud (Fase 3) no empieza hasta entonces.

### Cursor

IDE (fork de VS Code) con agente, Composer, Tab, agentes en paralelo (worktrees), agentes en la nube, CLI, Bugbot y MCP. Optimizado para **edición supervisada**: el humano sigue en el editor, acepta diffs y mantiene el contexto del proyecto (reglas, skills, indexación). Cerrado, de pago, con modelos propios y de terceros.

### Claude Code

Harness **terminal-first** (también extensiones de editor). El agente lee el filesystem, edita, corre comandos, usa MCP, hooks y subagentes. Encaja en CI/CD y modo headless. Optimizado para **delegar una tarea y volver a un cambio hecho**, no para autocompletar línea a línea.

### Google Antigravity

Plataforma **agent-first** de Google: app de escritorio 2.0 (centro de mando, no IDE), CLI, SDK, extensiones (VS Code / JetBrains / Zed) e IDE original. Orquestación multiagente, artefactos compartidos (planes, diffs, capturas), tareas programadas, gobernanza Gemini Enterprise. Optimizado para **misiones** y operación a escala Google Cloud, no para un kernel mínimo autoalojable.

### Familia cercana (no el foco)

Aider, Cline, Codex CLI, Gemini CLI, OpenHands, Devin: todos son harnesses de *editar código con un LLM*. Compiten entre sí y con Cursor/Claude/Antigravity. Mage no está en ese ranking.

---

## 3. Similitudes

| Idea compartida | Cómo aparece en Mage | Cómo aparece en los harnesses |
|-----------------|----------------------|--------------------------------|
| Bucle agente | Plan → tools → corrección o refuse | Plan → editar/correr → reintentar |
| Tools con contrato | Zod input+output; `dispatch` parsea ambos | JSON schema / MCP / built-ins |
| Sesión multi-turno | SQLite, compaction, `tenantId` | Chat, transcripts, compaction |
| Streaming | SSE (`enrich`, `plan_thought`, `tool_*`, `done`) | Tokens, diffs, tool traces en UI |
| Multi-modelo | Gemini / Anthropic / OpenAI + fallback Ollama opt-in | Router de modelos del producto |
| CLI | `mage` / `mage serve` | `claude`, Cursor CLI, Antigravity CLI |
| Extensibilidad | Host tools del wedge, WASM, `SessionStore` | MCP, hooks, skills, plugins, SDK |

La semejanza termina en el **objeto de la tool**. En Mage la tool *lee un hecho o calcula*. En un harness la tool *toca el mundo del desarrollador* (disco, git, red, browser, tickets).

---

## 4. Diferencias estructurales

| Eje | Mage | Cursor | Claude Code | Antigravity |
|-----|------|--------|-------------|-------------|
| Trabajo que resuelve | Consulta verificada, KPIs, reglas | Escribir y revisar código en el IDE | Tareas autónomas sobre el repo | Misiones / orquestación de agentes |
| Unidad de éxito | Evidence tipada o `refused` | Diff aceptado + app que corre | Tarea cerrada (tests, commit, PR) | Artefactos de misión + agentes en paralelo |
| Salida del LLM | Objeto Zod (`Plan`); nunca es `answer` | Texto + edits + tool calls | Texto + tool calls | Planes, diffs, subagentes |
| Contexto | Facts del tenant + enrich 25 ms + sesión | Índice del repo, reglas, @-mentions | Lectura directa de archivos, compaction | Artefactos compartidos + editor/CLI |
| Memoria de largo plazo | `Fact` ingestido (`tenantId`, `source`) + grafo SQLite | Indexación / memories de producto | CLAUDE.md, transcripts | Artefactos + cuenta unificada |
| Edición de código | No | Sí (núcleo del producto) | Sí (núcleo del producto) | Sí (vía agentes / extensiones) |
| Aislamiento | WASM Extism; `script.run` off | Sandbox del editor / cloud VMs | Permisos de tools + worktrees | Gobernanza Cloud + sandbox de misión |
| Superficie de ataque | Pequeña (localhost, tools fijas, planner sin writes) | Amplia (repo + MCP + cloud) | Amplia (shell + MCP) | Amplia (multi-superficie + empresa) |
| Human-in-the-loop | Bajo (pregunta → respuesta o silencio) | Alto (diffs, Tab, chat) | Medio (delegas, luego revisas) | Medio-alto (mission control) |
| Multiagente | No | Agentes paralelos / cloud | Subagentes, hooks | Diseño central del producto |
| Autoalojamiento | Sí (MIT, BYO keys, SQLite) | No | Parcial (CLI; modelo Anthropic) | No (cuenta Google) |
| Madurez | 0.3.0, kernel cerrado, wedge de ejemplo | Producto masivo | Producto masivo | Producto masivo Google |
| Costo operativo | Bun + SQLite + API LLM (Docker opcional) | Suscripción | Tokens / suscripción | Gemini / Enterprise |
| Embeddible en tu backend | Sí (`import { mage }`) | No | SDK / headless, no es tu runtime | SDK Python sobre *su* harness |

---

## 5. Ventajas de Mage

1. **Verificación como invariante, no como plugin.** `finalizeResult` es el único que fabrica `answer`. El modelo puede proponer `999`; si el ingest dice `1200000`, sale `1200000`. Si no hay tool OK, calla.
2. **Refuse de primera clase.** `status: answered | refused | error`, `evidence[]`, `refusalReason`. Un cliente HTTP puede ignorar `thought`.
3. **Fast path de 0 tokens.** Aritmética, hash, JSON: ~3 ms tras boot. Un harness de código paga un round-trip de modelo para lo mismo, salvo un skill ad-hoc.
4. **Plan estructurado y testeable.** Evals de refuse / injection / poison / grounded corren con `MAGE_PROVIDER=stub`, sin red. CI rojo si alguien rehabilita `proposedAnswer`.
5. **Memoria de dominio, no RAG de juguete.** Hechos con fuente y tenant. Contradicción → conflicto, no pisa. El planner no puede `memory.ingest`.
6. **Presupuestos de latencia.** 25 ms enrich, 50 ms WASM. La memoria no puede bloquear el turno.
7. **Superficie embebible.** Misma semántica en CLI, HTTP y `mage()`. Cursor/Antigravity *son* el producto de superficie; Mage es el motor.
8. **Control y soberanía.** MIT, providers intercambiables, datos en `./data/*.sqlite`. No hay telemetría de repo hacia un vendor.
9. **Superficie estrecha (con `script.run` off).** Un agente de código con shell es, por diseño, un RCE asistido. Mage WASM es un conjunto cerrado de exports. Ventaja de *seguridad y producto regulado*, no de productividad diaria de un developer.
10. **Observabilidad.** SSE por fase, `timings`, métricas en `GET /health` (`answered`, `refused`, `withEvidence`). Encaja en “por qué respondió esto” mejor que un chat de IDE.

---

## 6. Desventajas de Mage

1. **No escribe software.** Sin filesystem, git, tests, linter, browser ni MCP. No es un “Cursor self-hosted”.
2. **Wedge de ejemplo, no de cliente.** `kpi.lookup` / `source.cite` / `rule.check` existen; el JSON de `examples/http-kpi` no es un engagement real. Falta operar 10 hechos de un cliente y medir `% answered` vs `% con evidence`.
3. **Fast path frágil.** Siguen siendo regex sobre la consulta. Fuera de esos patrones, todo pasa por el LLM. No hay compilador de “esto es determinístico”.
4. **Tools de demo todavía compiladas.** Palíndromo, contar letras, primo: ocultas al planner, presentes en el binario. No son el pitch.
5. **Auth mínima.** Token estático `MAGE_API_KEY`, no OAuth ni tenants de facturación. Aislamiento de datos sí (`tenantId`).
6. **`script.run` no es un sandbox de producción.** Subproceso Bun, blocklist, timeout 2 s. Default off. `SECURITY.md` lo marca experimental.
7. **Grafo esquemático.** Tres tipos de nodo, tres relaciones. Los KPIs viven en `Fact`, no en una ontología rica. Falkor es opcional y casi nadie lo necesita en 0.3.0.
8. **Sin IDE, sin diffs, sin Tab.** Mage no acelera *escribir código*.
9. **Sin ecosistema.** No MCP, no marketplace, no cloud agents. Extender es implementar `HostTool` o recompilar WASM.
10. **Cuota y latencia del LLM.** El plan sigue siendo una llamada cloud (salvo stub / Ollama / fast path). Verificar no elimina `planMs`.
11. **Madurez.** Kernel + evals stub (refuse/injection/poison/wedge). No hay SLO ni evals públicas contra harnesses.
12. **WASM de confianza.** Timeout 50 ms no es aislamiento de red completo; los plugins se tratan como código trusted.
13. **Solo Bun.** Fricción en shops Node/Python/Go que quieran embeber el motor sin adoptar el runtime.
14. **Compaction útil, no mágica.** Summary con factIds / evidence ids + últimos turnos. No es un resumen LLM ni un índice de repo.

---

## 7. Pros y contras contra cada harness

### Contra Cursor

**A favor de Mage**

- Embeddible y autoalojado; Cursor es el IDE.
- Un número sale de `kpi.lookup` o `calc`, no del chat. Cursor puede afirmar un KPI mal si no corre un test.
- Memoria de hechos con tenant y fuente, no solo índice de repo.
- Menos privilegios: no toca el working tree.

**En contra de Mage**

- Cero ergonomía de edición. Cursor gana en Tab, Agent, worktrees, cloud agents, reglas, MCP, review de diffs.
- Cero comprensión de *este* codebase más allá de lo que hayas ingestido.
- No hay producto de equipo (billing, privacy mode, Bugbot, PRs).
- El desarrollador que ya paga Cursor no “migra” a Mage; como mucho lo llama por HTTP para verificar un hecho.

**Veredicto:** no compiten. Mage no es un IDE con cerebro; Cursor no es un motor de planes verificados. El solapamiento es “ambos llaman a un LLM con tools”.

### Contra Claude Code

**A favor de Mage**

- Contrato de salida más rígido (Zod Plan + `finalizeResult` vs. texto + tools).
- Fast path y WASM para trabajo determinístico barato.
- Librería en-proceso: no hace falta spawn de un CLI de otro vendor.
- Hechos de negocio con provenance; Claude Code usa el filesystem, mejor para código y peor para ontologías de cliente.

**En contra de Mage**

- Claude Code *hace el trabajo de ingeniería*. Mage responde una pregunta o calla.
- Permisos, hooks, subagentes, GitHub Actions, MCP: un harness de verdad.
- `script.run` es un primitivo peor que “el agente corre `bun test` en el repo con un permission prompt”.
- Portabilidad de Claude Code (cualquier carpeta, CI) supera a “compilá WASM y tené Bun”.

**Veredicto:** la analogía más honesta es **Claude Code : filesystem de un repo :: Mage : facts de un dominio + sandbox de cálculo**. Mismo *shape* de bucle, distinto mundo.

### Contra Google Antigravity

**A favor de Mage**

- Independencia de Google Cloud / Gemini Enterprise.
- Runtime pequeño, auditable, MIT.
- Multi-provider real (Anthropic / OpenAI / Gemini / stub / Ollama), no “model choice dentro de una cuenta Google”.
- Pensado para *no afirmar un KPI sin rastro*, no para orquestar misiones de desarrollo.

**En contra de Mage**

- Antigravity cubre escritorio, CLI, SDK, extensiones de IDE y gobernanza enterprise. Mage cubre un proceso Bun.
- Multiagente, tareas programadas, artefactos (screenshots, recordings): Mage no tiene esa superficie.
- Un CTO que ya está en Google Cloud no reemplaza Antigravity por un SQLite local.
- El SDK de Antigravity construye agentes *sobre su harness*; el de Mage *es* el harness, pero de un dominio estrecho.

**Veredicto:** Antigravity es plataforma de agentes de desarrollo. Mage es un motor de consulta verificada. El SDK de Antigravity es el competidor futuro de “Mage Cloud”, no el IDE.

---

## 8. Cuándo usar cada uno

| Si el problema es… | Usa |
|--------------------|-----|
| Escribir, refactorizar y revisar código con un humano al lado | Cursor (o extensión Antigravity / Claude en el IDE) |
| Delegar una tarea multi-archivo, CI, o un agente headless sobre el repo | Claude Code |
| Orquestar varios agentes, misiones, gobierno Google Cloud | Antigravity |
| Verificar cálculos, hashes, JSON con traza reproducible | Mage (fast path / WASM) |
| Sembrar KPIs de un cliente y preguntar sin que el modelo invente el número | Mage (`ingest` + `kpi.lookup`) |
| Exponer un endpoint “pregunta → `status` + `evidence`” en un producto propio | Mage como librería/HTTP |
| Autocompletar, Tab, inline diff | Cursor; Mage no aplica |
| Sustituir al IDE | Ninguno de los “Mage vs X” — Mage no entra |

Combinación razonable **hoy**:

```
Humano + Cursor/Claude/Antigravity     → produce código
Mage (HTTP o mage())                   → verifica hechos, KPIs, reglas de dominio
SQLite (facts + sesiones)              → memoria del engagement / tenant
```

Combinación razonable **si el wedge está operado**:

```
Harness de código (edita)
    → llama Mage (verify, memory)
        → plan Zod + tools tipadas
            → el harness solo mergea / publica si el kernel verifica
```

Eso es el hueco de producto: **no ser Cursor, ser el compilador de afirmaciones que Cursor no tiene**.

---

## 9. Riesgos de posicionamiento

- **Decir “somos como Cursor pero open source”** destruye la tesis. El catálogo de tools lo desmiente en cinco minutos.
- **Decir “nunca alucina”** es falso. El modelo puede soñar un plan (tool o nombre de KPI equivocado). Mage **calla** si no hay evidence; no es magia. La frase correcta: *no responde sin evidencia, y si responde podés ver el trace*.
- **Inflar WASM como “sandbox de agente de código”** choca con `script.run` (off) y con plugins trusted.
- **Vender el grafo Falkor / vectores FNV como RAG** ensucia evals. El producto son `Fact` ingestidos. Falkor es opcional; embeddings default `none`.
- **Ignorar el harness** deja a Mage como un REPL de `calc` con LLM caro. El valor está en *plan estructurado + hechos de dominio + refuse*, no en competir en SWE-bench.

---

## 10. Resumen ejecutivo

| | Mage 0.3.0 | Harnesses (Cursor / Claude Code / Antigravity) |
|-|------------|------------------------------------------------|
| Categoría | Kernel plan+verify + facts de dominio | Agentes de desarrollo de software |
| Fortaleza | Evidence o silencio, embed, soberanía, tests stub | Editar repos, UX, ecosistema, madurez |
| Debilidad | No hay código, fast path regex, wedge aún de ejemplo | Alucinaciones de hechos, privilegios amplios, vendor lock |
| Relación | Complemento / kernel | Superficie donde vive el developer |

Mage gana si el criterio es **afirmaciones verificables y memoria de hechos autoalojada**. Pierde si el criterio es **hacer software**. Las similitudes (LLM, tools, sesión, stream) son el esqueleto común de cualquier agente en 2026; las diferencias están en *qué se le permite tocar* y *qué cuenta como respuesta válida*.
