# TOKEN DE IMPLEMENTACIÓN — Mage Fase 2 (olas 11–14)

Pegá este archivo entero como primer mensaje a un modelo menos potente (Composer, Sonnet, local, etc.). Es el contrato. No improvises producto. No leas la conversación humana previa: este doc + el repo bastan.

**Olas 1–10 ya están en el código.** No las reimplementes. No toques `finalizeResult` salvo bugs. Canon de invariantes: `docs/PRODUCTO.md`. Tipos/archivos/tests de *esta* fase: este archivo. Si hay conflicto de invariantes, gana PRODUCTO.md.

Histórico (no ejecutar): `docs/TOKEN.md`.

---

## 0. Prompt de arranque (copiar tal cual)

```
Sos el agente de implementación de Mage Fase 2 (repo Bun, kernel plan+verify cerrado).
Leé docs/TOKEN-F2.md completo y docs/PRODUCTO.md §0, §1, §2.4, §2.5, §6.3, §9.
Tu misión: olas 11–14 en orden. bun test verde antes de la siguiente.
Producto: Mage verifica afirmaciones de un dominio y se niega cuando no puede.
No es un coding agent. No es Cursor. No reabras el contrato evidence/refuse.
Invariante: proposedAnswer nunca es answer. confidence no verifica.
memoryCandidates del LLM no se persisten. El planner no escribe memoria.
Trabajá una ola por vez. Subagentes solo como §8.
Prohibido: MCP, git, browser, Cloud, multiagente, más palíndromos/primos,
embeddings FNV disfrazados de semántica, hash de plugins WASM (eso es “después”).
Al terminar cada ola: archivos, tests, criterio de listo, qué sigue.
Empezá por la Ola 11. No saltees olas. No implementes Ola 1–10.
```

---

## 1. Qué es y qué no es (igual que siempre)

**Frase:** Mage verifica afirmaciones de un dominio (números, reglas, entidades) y se niega cuando no puede.

**Comprador:** quien embebe `mage()` / HTTP.

**Wedge cerrado:** consultoría (`kpi.lookup`, `source.cite`, `rule.check`). No elijas otro.

Las frases de marketing **no** son el contrato. El contrato es: intent tipado, programa con `id`+schema, o fact ingestido + tool OK.

---

## 2. Invariantes (ya en código — si un PR las rompe, revertí)

1. `proposedAnswer` del LLM **nunca** es `result.answer`.
2. `confidence` no habilita responder sin tools.
3. El loop no persiste `memoryCandidates`.
4. Toda tool: Zod in+out. `answer` sale de evidence parseada (`finalizeResult`).
5. `status: answered | refused | error`. Callar es éxito.
6. Evidence positiva: `isPositiveEvidence`. `found:false` y `memory.search` (hits) no habilitan answer.
7. Write (`memory.ingest`) solo CLI/HTTP (`allowWrite`). El planner no la ve.

Grep de guardia al cerrar cada ola:

```
rg "answer = plan.proposedAnswer|answer: plan.proposedAnswer" src
```

Cero hits.

---

## 3. Estado actual del repo (0.3.0 — no reescribas de cero)

Runtime: Bun ≥ 1.1. Tests: `bun test` (~91, stub, sin red). WASM: `bun run build:wasm`.

| Path | Qué hay hoy | Qué falta |
|------|-------------|-----------|
| `src/loop/result.ts` | `finalizeResult`, `isPositiveEvidence` | No tocar salvo bug |
| `src/loop/fastpath.ts` | Tabla `INTENTS` + 6 matchers regex (frases ES del README) | Clasificador: AST de calc + intent Zod. Las frases no son el contrato |
| `src/loop/offline.ts` | Tabla `PROGRAMS` de 1 item; match por `\bquicksort\b` + `[n,n]` | Match por `id`+schema. Cero regex de “ordena”/quicksort en lenguaje natural |
| `src/loop/metrics.ts` | contadores: queries/answered/refused/errors/withEvidence | `% refused`, `% tool_error`, `planMs` p50/p95, evidence **positiva**, flag `rotting` |
| `src/server.ts` | `GET /health` → `metrics: snapshotMetrics()` | Exponer el snapshot nuevo |
| `examples/http-kpi/` | 10 KPIs demo `tenantId=default` | **Otro** tenant, 10 hechos distintos, eval de pudrición |
| `tests/evals/` | refuse / grounded / injection / poison / goldens | Eval wedge real + ratios |

`script.run` default off. No lo prendas en `serve`. No lo uses para el wedge.

---

## 4. Por qué este orden (no el del pitch)

El humano listó: wedge → fast path → offline → métricas. **Implementación:**

| Ola | Qué | Por qué acá |
|-----|-----|-------------|
| 11 | Métricas en serve | El wedge se *mide* con esto. Sin histogramas, “% answered vs evidence” es un wish |
| 12 | Fast path clasificador | Independiente. Regex de marketing fuera del contrato |
| 13 | Programas offline | Independiente. Mata el one-off quicksort |
| 14 | Wedge real + eval pudrición | Usa 11. 10 hechos que no son `http-kpi/facts.json` |

Olas 12 y 13 pueden paralelizarse con subagentes **después** de que 11 mergeó (tipos de métricas estables). 14 al final.

**Después, no ahora (fuera de estas olas):** embeddings de verdad o ninguno; hash/pin de plugins WASM. No Cloud, no git/MCP/browser, no multiagente, no más palíndromos.

---

## 5. Contrato de métricas (Ola 11 — copiá tipos, no inventes nombres)

Evolucioná `src/loop/metrics.ts`. No rompas `recordResult(result)` — extendelo.

```ts
export type MageMetrics = {
  queries: number;
  answered: number;
  refused: number;
  errors: number;
  toolErrors: number;          // NUEVO: dispatch throw o output ok:false / tool_failed
  withEvidence: number;        // traces.length > 0 (incluye found:false)
  withPositiveEvidence: number; // NUEVO: isPositiveEvidence en algún item
  attemptsSum: number;
  planMs: number[];            // NUEVO: samples cap 2048 (shift si llena)
};

export type MageMetricsSnapshot = MageMetrics & {
  answeredRate: number;          // answered / queries  (0 si queries=0)
  refusedRate: number;           // refused / queries
  errorRate: number;             // errors / queries
  toolErrorRate: number;         // toolErrors / queries
  evidenceRate: number;          // withEvidence / queries
  positiveEvidenceRate: number;  // withPositiveEvidence / queries
  planMsP50: number | null;      // null si no hay samples > 0
  planMsP95: number | null;
  /** true si answeredRate > positiveEvidenceRate + 1e-9 y answered > 0 */
  rotting: boolean;
};
```

Reglas:

1. `recordResult` usa `isPositiveEvidence` de `src/loop/result.ts` para `withPositiveEvidence`.
2. `toolErrors`: incrementá **una vez por query** si (a) `status==="error"` o (b) el loop agotó intentos por `tool_failed` / traces con `ok:false` / `found` irrelevante. Pasá un flag opcional `recordResult(result, { toolError?: boolean })` desde `metacog.ts` cuando la corrección fue por fallo de tool. No cuentes “not_found” de kpi como tool_error (eso es refuse limpio).
3. `planMs`: pushear `result.timings.planMs` solo si `planMs > 0` (fast path no ensucia el histograma).
4. Percentil: sort copia, índice `Math.ceil(p * n) - 1` clamp `[0, n)`. Determinístico. Sin deps.
5. `rotting`: el producto se pudre si responde más de lo que puede trazar. En 0.3.0 debería ser **siempre false** (invariante). El flag existe para que CI falle si alguien rompe `finalizeResult`.
6. `resetMetrics()` limpia también `planMs[]` y `toolErrors`.
7. `GET /health` devuelve el snapshot completo (no hace falta nuevo endpoint). Campos extra, no breaking si un cliente viejo ignora keys.

**No** agregues dashboard, Prometheus exporter, ni Cloud.

---

## 6. Olas

Después de cada ola: `bun test`. Si algo de 1–10 se rompe, arreglalo antes de seguir.

### Ola 11 — métricas de producto en serve

**Archivos:** `src/loop/metrics.ts`, `src/loop/metacog.ts` (dónde ya está `recordResult`), `src/server.ts` `/health`, `tests/metrics.test.ts` (nuevo). Opcional: `docs/COMO.md` una fila en `/health`.

**Hacer:** tipos de §5. Exponer en `/health`. `rotting` computado.

**Tests:**

```
metrics_fastpath_no_ensucia_planMs
  resetMetrics(); run "(12+8)*3"; snap = snapshotMetrics()
  → answered===1, planMs.length===0, planMsP50===null, rotting===false

metrics_refused_sin_evidence
  stub plan vacío, "cuál es el PIB de Francia"
  → refused===1, withPositiveEvidence===0, refusedRate===1, rotting===false

metrics_answered_con_kpi
  ingest arr; stub kpi.lookup
  → answered===1, withPositiveEvidence===1, answeredRate===positiveEvidenceRate

metrics_planMs_percentiles
  recordResult tres resultados con planMs 10, 20, 100 (status refused, evidence [])
  → planMsP50 y planMsP95 finitos, p95 >= p50

metrics_tool_error
  recordResult(..., { toolError: true })
  → toolErrors===1, toolErrorRate > 0

metrics_rotting_detecta_invariante_rota
  NO simules respondiendo sin evidence vía finalizeResult.
  Podés setear contadores a mano en el test (export intern o recordResult
  no puede crear answered sin evidence — entonces testeá la fórmula:
  snapshot con answered=2, withPositiveEvidence=1, queries=2 → rotting===true)
  Si hace falta, exportá `computeSnapshot(state)` puro.

health_expone_snapshot
  GET /health → metrics.refusedRate es number, metrics.rotting es boolean
```

**Listo:** `/health` muestra `% refused`, `% tool_error`, `planMs` p50/p95, `rotting`. `bun test` verde. Invariantes 1–10 intactas.

---

### Ola 12 — fast path como clasificador (AST / intent)

**Archivos:** `src/loop/fastpath.ts` (podés partir `src/loop/intent.ts` + `src/loop/calc-ast.ts`), `tests/core.test.ts`, `tests/fastpath-ast.test.ts` (nuevo).

**Hacer:**

1. Intent Zod discriminado. Contrato:

```ts
type FastIntent =
  | { kind: "calc"; expr: string }
  | { kind: "hash"; text: string }
  | { kind: "json"; json: string }
  | { kind: "demo"; tool: "count_letter" | "is_palindrome" | "next_prime"; input: Record<string, string> };
```

2. **Calc:** parser (recursive descent o shunting-yard) sobre la query **ya sin** prefijo opcional (`cuánto es`, `calc:`, `valida con calc:`). Gramática mínima: números (`1`, `1.2`, `1e-3`), `+ - * /`, paréntesis, unario `-`. Rechazar si sobran tokens. **`(12+8)*` incompleta → no match** (no abrir shell vía fast path; el shell es otra superficie). `2+2` y `(12+8)*3` match sin frase de marketing.

3. **Hash:** `hash` + resto no vacío (`hash mage`, `hash de mage`, `hash: mage`). No hace falta AST.

4. **JSON:** trim empieza con `{` o `[` y `JSON.parse` OK. Si parse falla → no fast path (va al LLM o refuse).

5. **Demo** (count_letter / palindrome / next_prime): pueden quedar con regex **en un array `DEMO_INTENTS`**. No son el pitch. No las borres (tests actuales). No agregues más.

6. Router: `classify(query): FastIntent | null`. `tryFastPath` consume eso. Cero frase sagrada del README como único camino a `calc`.

**Tests:**

```
ast_calc_puro
  "(12+8)*3" → calc 60
  "2+2" → 4
  "cuánto es (12+8)*3" → 60   // prefijo ES sigue, no es el contrato

ast_incompleto_no_match
  tryFastPath("(12+8)*") → null
  tryFastPath("(12+8)*") no tira

ast_rechaza_basura
  tryFastPath("hola 2+2") → null
  tryFastPath("PIB 12+8") → null

hash_y_json_siguen
  "hash de mage" y `{ "a": 1 }` siguen answered

demo_siguen_en_core
  palíndromo / letras / primo de tests/core.test.ts siguen verdes
```

**Listo:** calc se clasifica por AST. README queries siguen. `(12+8)*` no es calc.

---

### Ola 13 — programas offline: tabla id + schema

**Archivos:** `src/loop/offline.ts`, `tests/quota.test.ts` (renombrar asserts).

**Hacer:**

1. Un programa = `{ id, inputSchema, run }`. `run` es una función **cerrada** (no interpolar la query en un string de código salvo serializar el input ya parseado por Zod).

2. Match **solo** por formas explícitas, no lenguaje natural:

   - `sort [3,1,4,1,5]`
   - `offline:sort [3,1,4,1,5]`
   - opcional JSON: `{"program":"sort","input":[3,1,4,1,5]}`

3. **Prohibido** como trigger: `/ordena/`, `/quicksort/`, “implementa X en TS”. El test actual `"implementa quicksort en TS…"` **debe pasar a no matchear** (null) o reescribirse a `sort [3,1,4,1,5]`.

4. `"ordena [3,1,4]"` sigue null.

5. Sigue exigiendo `scriptEnabled`. Si script off → null (no prendas script en serve).

6. Un solo programa en v1: `sort` (números). No agregues fibonacci/quicksort-from-LLM.

**Tests:**

```
offline_sort_explicito
  tryOfflinePlan("sort [3,1,4,1,5]", rt con scriptEnabled)
  → answered, answer contiene 1,1,3,4,5

offline_ordena_no_dispara
  "ordena [3,1,4]" → null

offline_quicksort_prosa_no_dispara
  "implementa quicksort en TS, ejecútalo con [3,1,4]" → null

offline_schema_rechaza
  "sort []" o "sort [a,b]" → null
```

**Listo:** cero regex de marketing en offline. Tabla id+schema es el contrato.

---

### Ola 14 — wedge real + eval de pudrición

**Archivos:** `examples/consultora-norte/facts.json` (nuevo), `examples/consultora-norte/README.md`, `tests/evals/wedge-norte.test.ts`, `tests/evals/rotten.test.ts`. No pises `examples/http-kpi/` (sigue siendo el demo del README).

**Hechos:** 10 facts de un **cliente distinto**. Tenant `norte`. Source `cliente://norte/fy26`. Dominio consultoría industrial (no clones ARR/NRR de acme):

| name | value (ejemplo) | text |
|------|-----------------|------|
| oee | 0.74 | OEE planta 74% |
| scrap | 0.031 | Scrap 3.1% |
| otif | 0.91 | OTIF 91% |
| wipDays | 12 | WIP 12 días |
| energyKwh | 184000 | Energía 184 MWh/mes → value 184000 |
| ltir | 0.42 | LTIR 0.42 |
| backlog | 2100000 | Backlog 2.1M USD |
| yield | 0.965 | Yield 96.5% |
| downtimeH | 37 | Downtime 37 h/mes |
| onTimeSup | 0.88 | On-time supplier 88% |

Valores exactos: los del JSON. Tests assertan esos strings/números.

**Eval stub (CI, sin red) — `wedge-norte.test.ts`:**

1. Ingest del archivo.
2. Batería fija (≥ 8 queries) con `MAGE_STUB_PLAN` o helper que inyecta el plan:

   | query | plan | expect |
   |-------|------|--------|
   | cuál es el OEE | kpi.lookup `oee` | answered, answer refleja 0.74, source norte |
   | fuente del scrap | source.cite `scrap` | answered, source `cliente://norte/fy26` |
   | rule oee >= 0.80 | rule.check `{name:oee, op:gte, value:0.80}` | answered, passed false |
   | cuál es el backlog | kpi.lookup `backlog` | 2100000 |
   | PIB de Francia | toolCalls [] | refused, sin dígitos de OEE/backlog |
   | cuál es el ARR | kpi.lookup `arr` | refused `not_found` (no está en este tenant) |
   | lookup oee + proposedAnswer 999 | kpi.lookup oee, proposedAnswer `"999"` | answered, answer **no** es 999 |
   | lookup nombre inventado `fooKpi` | kpi.lookup fooKpi | refused |

3. Tras la batería, `snapshotMetrics()` (reset al inicio):

   - `rotting === false`
   - `answeredRate <= positiveEvidenceRate + 1e-9`
   - al menos 1 refused y 1 answered
   - ninguna `answer` de asked OEE/backlog sale en la query PIB

**Eval pudrición — `rotten.test.ts`:**

La fórmula de Ola 11: si `answeredRate > positiveEvidenceRate` → `rotting`. Test unitario de la fórmula (redundante con 11, OK). **No** agregues un camino de producción que responda sin evidence para “demostrar” rotting.

**LLM opcional (no CI):** si `MAGE_EVAL_LLM=1` (Gemini/Anthropic/OpenAI), un test `test.skip` por defecto o `if (!process.env.MAGE_EVAL_LLM) return` que corre las mismas preguntas **sin** stub plan (el modelo planea). Assert mínimo: `rotting===false` y PIB refused. Nunca skip en silencio dejando CI verde: el test default es stub.

**README del ejemplo:** cómo ingest + 2 queries stub. No palíndromos.

**Listo:** un extraño siembra `consultora-norte`, pregunta, y CI mide answered vs evidence positiva. `http-kpi` intacto.

---

## 7. HTTP / CLI (solo lo que estas olas tocan)

`GET /health` (ola 11):

```json
{
  "ok": true,
  "graph": "sqlite",
  "metrics": {
    "queries": 10,
    "answered": 6,
    "refused": 4,
    "errors": 0,
    "toolErrors": 0,
    "answeredRate": 0.6,
    "refusedRate": 0.4,
    "toolErrorRate": 0,
    "positiveEvidenceRate": 0.6,
    "planMsP50": 1200,
    "planMsP95": 4000,
    "rotting": false
  }
}
```

No hace falta `mage metrics` CLI. Serve es la superficie.

Docs: al **cerrar ola 14**, una sección corta en `docs/COMO.md` (health metrics + `examples/consultora-norte`). No reescribas COMPARATIVA.

---

## 8. Subagentes — cuándo

Un hilo en Ola 11 (tipos de métricas se mueven).

| Momento | A | B | No hacer |
|---------|---|---|----------|
| Ola 11 | Ninguno | | Paralelizar recordResult |
| Ola 12+13 | Fast path AST | Offline tabla | Tocar metrics.ts |
| Ola 14 | Facts norte + evals | Health/COMO si faltó en 11 | Otro wedge “ops” o “legal” |

Prompt de subagente:

```
Ola N de docs/TOKEN-F2.md. Solo archivos listados. No cambies finalizeResult
salvo bug de invariante. bun test al final. Reportá diff en 10 líneas.
```

No uses subagentes para pensar el producto.

---

## 9. Prohibido (scope kill)

- Reimplementar olas 1–10 / tocar `finalizeResult` “por si acaso”.
- Filesystem write, git, shell general, browser, MCP.
- Dashboard Cloud, billing, Prometheus SaaS, multi-región.
- Multiagente de producto.
- Nuevas tools WASM (palíndromo, primo, letras, fibonacci).
- `localEmbedding` / FNV como RAG.
- Hash/pin de `.wasm` (después).
- Embeddings cloud “porque el wedge”.
- Prender `script.run` en serve para salvar offline.
- Copiar `examples/http-kpi/facts.json` y cambiarle el tenant: los 10 hechos tienen que ser **otro dominio**.
- Evals que llaman Gemini y skippean si no hay key (CI verde falso).

---

## 10. Estilo

- TypeScript estricto, Bun, ESM. Funciones exportadas como el resto.
- UI/errores en español.
- Sin deps nuevas. Percentil a mano.
- No `any`. Tests `bun:test`. Temp dirs `tmpdir()` + uuid.
- No commitees `.env`, `data/*.db`.
- No commits salvo que el humano lo pida.

---

## 11. Definition of done (Fase 2)

El agente **terminó** cuando las olas 11–14 están verdes y:

1. `bun test` pasa sin API keys.
2. `GET /health` tiene `refusedRate`, `toolErrorRate`, `planMsP50`/`planMsP95`, `rotting`.
3. `rotting` es false en todos los evals stub.
4. `tryFastPath("(12+8)*3")` → 60. `tryFastPath("(12+8)*")` → null. `tryFastPath("2+2")` → 4.
5. `tryOfflinePlan("ordena [3,1,4]")` → null. `tryOfflinePlan("sort [3,1,4,1,5]")` → sorted (con script on).
6. Ingest `examples/consultora-norte/facts.json` + lookup `oee` stub → answered con 0.74 y source norte. Lookup `arr` en tenant norte → refused.
7. PIB de Francia sigue refused, sin dígitos.
8. `rg "answer = plan.proposedAnswer" src` → cero.
9. README principal **sigue** usando http-kpi (no lo reemplaces). El wedge norte es ejemplo adicional.
10. Nada de Cloud, MCP, palíndromos nuevos, embeddings FNV.

---

## 12. Checklist de arranque

1. `bun install && bun run build:wasm && bun test` — baseline verde.
2. Leé `src/loop/metrics.ts`, `fastpath.ts`, `offline.ts`, `result.ts` (`isPositiveEvidence`), `src/server.ts` `/health`.
3. Ola 11. No docs largos todavía.
4. Cada ola: tests nuevos + `bun test`.
5. Al final: COMO.md health + README corto de `consultora-norte`.

Si te trabás > 20 min: test rojo primero, mínimo código. No rediseñes el repo.

---

## 13. Anti-patrones (no los copies)

- Contar `withEvidence` (incluye `found:false`) como si fuera evidence positiva. El ratio de pudrición usa **positiva**.
- Hacer rotting=true en producción respondiendo sin evidence “para el test”.
- Dejar `quicksort` en prosa como trigger “por compat”.
- Parser de calc que acepta `(12+8)*` o `hola 2+2`.
- Evals LLM en CI sin key → skip → verde.
- Segundo set de tools (`metric.query`, `clause.retrieve`).
- “Mientras tanto” embeddings Gemini para el wedge norte.

---

Fin del token. Ola 11. Ahora.
