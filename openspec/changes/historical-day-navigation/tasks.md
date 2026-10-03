# Tasks: Historical day navigation (CHANGE 2)

**Change:** `historical-day-navigation`
**Status:** Task breakdown only. Nothing in this file is implemented.
**Precondition:** `operational-event-operative-date` (CHANGE 1) is implemented in `851172c` — `fechaOperativa` is a
required, persisted field on `Parada`, `ActividadPlanificada`, `Dano` and `Mantenimiento`, migration 005 is applied,
and both SQLite directions are wired. Treated as satisfied; not re-litigated here.
**Design:** `design.md` (decisions DD1–DD12, §9 files-touched, §10 testing, §11 risks, §12 open questions).
**Specs:** `specs/historical-day-navigation/spec.md`, `specs/operational-repository-contracts/spec.md`,
`specs/operational-recovery-wiring/spec.md`.
**Ticket:** none. No file in `.scratch/estampado-dashboard/issues/` covers this change. Historical ticket numbers
(10.7/10.8, 09) and phase tags (14.1, 14.2) are referenced only where the code already cites them itself.

---

## 0. Reading this file

### Citation convention

Every `file:line` below was verified against the working tree at `c1bf533` before being written. Where the design's
line number had drifted, the **verified current line** is cited and the drift is noted. Three known drifts:

| Design cites | Verified at | Note |
|---|---|---|
| `App.tsx:142-147` (the two open-record `useState` seeds) | `App.tsx:143`, `App.tsx:147` | the two seed expressions, not the block start |
| `App.tsx:755` (`paradaActivaDeOrden`), `App.tsx:842` (`estadoMaquina`) | `App.tsx:754`, `App.tsx:841-845` | one line up |
| `App.test.tsx:947`/`:1087`/`:1799`/`:2215`/`:2258` | `App.test.tsx:948`/`:1088`/`:1800`/`:2216`/`:2259` | all one line up |

A backticked path marked `(read-only)` is only consulted, never edited. A task that would cross a declared boundary
is flagged in §Design defects, not scheduled.

### Traceability legend

| Tag | Meaning |
|---|---|
| `H` | `specs/historical-day-navigation/spec.md` — requirement or scenario |
| `R` | `specs/operational-repository-contracts/spec.md` — requirement or scenario |
| `W` | `specs/operational-recovery-wiring/spec.md` — requirement or scenario |
| `DDn` / `§n` | the decision or design section that specifies the task |

### Declared boundaries (design DD11, §13) — a task crossing any of these is a defect

| # | Boundary | Enforcement |
|---|---|---|
| B1 | No migration; migrations 001–005 byte-identical | Phase 1 guard + gate command `git diff 851172c -- src/domain src-tauri/migrations` |
| B2 | Zero diff in `src/domain/**` | Phase 1 guard (red only when the boundary is crossed) |
| B3 | No change to `IInspeccionRepository` / `ILecturaGolpeRepository` | compile-level: their method lists are untouched; inspections stay reached through `orden.id` |
| B4 | No new `fechaOperativa` predicate on the order-reached ports; they are day-scoped transitively through `Orden.fechaOperativa` | compile-level |
| B5 | No change to the machine-level `get*Abierta` invariants | no phase edits those four port methods; they stay day-free (DD8) |

There is **no strict-TDD discipline in this project** (`openspec/config.yaml` → `apply.tdd: false`,
`apply.test_command: ""`). No task below is a RED-then-GREEN step. Focused Vitest commands are named as the
**verification** of each work unit, not as a test-first contract.

---

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | **1,300 – 1,700** (midpoint ~1,500) — planning estimate, not a diff count |
| 400-line budget risk | **High** — roughly 3.5–4× the review budget |
| Chained PRs recommended | **Yes** |
| Suggested split | 12 work units, one per phase, in the dependency order of §0.3 below |
| Delivery strategy | `ask-on-risk` |
| Chain strategy | **pending** — the user must choose before `sdd-apply` (see risks) |

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

**Why the chain strategy is still `pending`.** The 12 slices are *strictly linear* — WU4 cannot land before WU2 and
WU3, WU8 cannot land before WU7 — so they are not independently landable. Both `stacked-to-main` and
`feature-branch-chain` are defensible, and the choice is a team decision the orchestrator must collect, not one this
plan makes. The recommendation to put to the user is **`feature-branch-chain`**: a linear chain with a single
integration point makes a middle-slice rollback a branch move rather than a `git revert` on main, and the tracker PR
keeps the 12-slice story visible. Per `chained-pr`, the budget constrains how the work is sliced, never the code — no
task below shrinks comments, docs or assertions to fit a slice.

**The one tight slice.** WU4 (parity contract suite) is estimated at 320–380 authored lines, close to the budget. It
ships as one slice; if it lands over 400, the honest response is a `size:exception` request, not a trimmed suite.

### Suggested work units

Focused test commands are `npx vitest run <path>` (project-level `test_command` is empty by contract).
Runtime harness is `N/A` for every unit except WU4, with the reason stated.

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Boundary guard: `src/domain/**` zero diff | PR 1 | `npx vitest run src/__tests__/noDomainDiff.test.ts` | N/A — pure git plumbing, no runtime surface | delete `src/__tests__/noDomainDiff.test.ts`; no production behaviour changes |
| 2 | `listarPorMaquinaYFecha` on 4 ports + 4 in-memory adapters | PR 2 | `npx vitest run src/store/paradasRepository.test.ts src/store/actividadesRepository.test.ts src/store/danosRepository.test.ts src/store/mantenimientoRepository.test.ts` | N/A — pure adapter filtering, no Tauri transport involved | remove the 4 added methods; the day-free `listarPorMaquina` is untouched, so the pre-change read path survives intact |
| 3 | `listarPorMaquinaYFecha` on 4 SQLite adapters | PR 3 | `npx vitest run src/store/sqlite/__tests__/sqliteParadaRepository.test.ts src/store/sqlite/__tests__/sqliteActividadPlanificadaRepository.test.ts src/store/sqlite/__tests__/sqliteDanoRepository.test.ts src/store/sqlite/__tests__/sqliteMantenimientoRepository.test.ts` | N/A — the modelled `fakeSqliteStore` double only; the real-engine proof is WU4 and the Tauri transport stays PENDING (R5/R6) | remove the 4 added methods; no schema, no migration, no persisted-data change (DD11) |
| 4 | One contract factory, both families, real SQLite engine | PR 4 | `npx vitest run src/store/sqlite/__tests__/dayScopedListing.parity.test.ts` | **Real SQLite engine** — `node:sqlite` `DatabaseSync` over migrations 001–005, plus `EXPLAIN QUERY PLAN` on `idx_parada_maquina_fecha`. This is the §3.3/§8 evidence. It is **not** the Tauri plugin transport, which stays PENDING (R5/R6) | delete `src/store/__tests__/dayScopedListingContract.ts`, `src/store/sqlite/__tests__/realSqlite.ts`, `src/store/sqlite/__tests__/dayScopedListing.parity.test.ts`; zero production files touched |
| 5 | Day-scoped `recoverPersistedState` | PR 5 | `npx vitest run src/store/sqlite/__tests__/recovery.test.ts` | N/A — the suite is fake-repository based and says so in its own honesty note (`recovery.test.ts:26-30`) | revert the 4 call sites in `src/store/sqlite/recovery.ts:129,131,133,135-137`; read order, failure propagation and the sources-only contract are untouched |
| 6 | `Raiz` composition root owns the selected day | PR 6 | `npx vitest run src/store/sqlite/__tests__/startup.test.ts` | N/A — the suite fakes the plugin boundary and declares that limit at `startup.test.ts:20-23` | delete `src/Raiz.tsx` and restore the `<App …/>` render in `src/main.tsx:99-113`; steps 1–4 (`main.tsx:63,67-74,79,85-96`) never moved |
| 7 | `App` day plumbing: `hoyReal`, `soloLectura`, day in 8 call sites, 15 handler guards | PR 7 | `npx vitest run src/App.test.tsx src/__tests__/persistence-integration.test.ts src/store/sqlite/__tests__/lecturaWiring.test.ts` | N/A — React/jsdom concern; no store or transport boundary moves | revert the `AppProps` additions, the destructuring rename and the 8 call-site edits; every existing suite is green again because no new assertion was added |
| 8 | Read-only reachability gates in the sections and order views | PR 8 | `npx vitest run src/App.test.tsx` | N/A — reachability is a render concern, asserted through Testing Library | remove `soloLectura` from the 3 previously-ungated prop interfaces and the 3 order-view wraps; `permitirRegistrar` on the 3 `…SectionProps` keeps its current meaning (DD7a) |
| 9 | `SelectorDiaOperativa` + `desplazarDia` + header + CSS | PR 9 | `npx vitest run src/App.test.tsx` | N/A — the control is native HTML; the Tauri runtime is not needed to exercise it | delete `src/ui/SelectorDiaOperativa.tsx`, remove `desplazarDia` from `src/store/clock.ts`, remove the `{onSeleccionarDia && (…)}` block from `App.tsx:886-887` |
| 10 | Four list-derived open-state reads moved onto day-free lookups | PR 10 | `npx vitest run src/App.test.tsx` | N/A — same as WU8 | revert the 2 added `useState` and the 4 conditional derivations; `estadoMaquina` returns to scanning the day-scoped list |
| 11 | Empty-day and today-unchanged suites | PR 11 | `npx vitest run src/App.test.tsx` | N/A — render and DOM-snapshot concerns | test-only slice; deleting it changes no behaviour but loses the guard |
| 12 | Day-change flow through the real recovery seam | PR 12 | `npx vitest run src/__tests__/persistence-integration.test.ts` | N/A — the suite uses in-memory adapters plus the modelled SQLite double | test-only slice, plus the 4 fake objects that gained the new method |

### 0.3 Dependency order

```
WU1 guard  (green before any phase starts)
 ├─> WU2 ports + in-memory ──┬─> WU4 parity (needs WU2 AND WU3)
 │                           └─> WU5 day-scoped recovery ──> WU6 Raiz ──> WU7 App day plumbing
 │                                                                             ├─> WU8  reachability gates
 │                                                                             ├─> WU9  navigator ──┬─> WU11 empty-day suite
 │                                                                             │                    └─> WU12 day-change flow
 │                                                                             └─> WU10 open-record reads
 └─> WU3 SQLite family ──> (joins WU4)
```

**Why WU11 and WU12 hang off WU9, not WU10.** Both drive their scenarios *through the navigator*, so WU9 is their
real entry condition. Neither consumes anything WU10 produces: WU10 changes how four open-state reads are derived,
while WU11 and WU12 only assert rendering and flow. Keeping them siblings rather than successors matters because
**OQ-1** and **OQ-4** originally sat on WU10 (10.3, 10.5) — chaining WU11/WU12 behind them would have parked two
test-only slices behind two unanswered operational questions for no technical reason. **OQ-4 is now CLOSED
(alternative B).** Only OQ-1 remains open, and 10.6 records that its implementation is identical either way, so
nothing in WU10 is blocked. Task 11.2's comment cites 10.4's rationale but
is written from design §10.4, so WU11 may land before or after WU10 and its assertion must hold either way.

---

## Open questions carried into implementation

The design's §12 records four unchecked boxes. Two are the ones the orchestrator flagged; all four are carried here
because each one is attached to a task that would otherwise silently depend on an unanswered decision.
**None of them is answered by this file.**

> ⚠️ **Label collision.** Design §12 reuses the labels `Q1` and `Q2` for *different* questions from the proposal's
> `Q1` and `Q2`, which are **closed** (`Q1 = (a)` persisted `fechaOperativa`; `Q2 = exclusive attribution`). Design
> §6.3 and §11 point at "§12, Q1" to mean *historical open records*, not the closed attribution decision. To keep the
> closed decisions unmistakably closed, this file renames the four carried questions `OQ-1`…`OQ-4`.

| Id | Design ref | Question | State | Attached to |
|---|---|---|---|---|
| **OQ-1** | §12 Q1, flagged in §11 | Is *"on a historical day, show the open record attributed to that day"* the intended reading? The alternative (keep the machine-level `get*Abierta` lookup on every day) would show today's open record on a past day, contradicting exclusive attribution. The design picks the first (§6.3) and says it needs Gerencia-level confirmation. | **Open — decision made in the design, awaiting operational confirmation** | Phase 10 (10.2). The §6.3/§6.4 trade is implemented either way; only the *reasoning* recorded in the code comments depends on the answer. |
| **OQ-2** | §12 Q2 | How far back does navigation go? The design bounds the top at today and leaves the bottom unbounded. `specs/historical-day-navigation/spec.md` requires no lower bound ("nothing in the specs requires one"), so this is **settled by the specs, recorded here so the navigator task does not invent one**. | **Open in §12, closed by the specs** | Phase 9 (9.1). Implement "unbounded past" and do not add a lower bound. |
| **OQ-3** | §12 Q3 | Rename `App`'s `hoy` prop to `fechaOperativa`? Kept as `hoy` per DD12 to avoid a ~40-call-site test diff. | **Deferred / out of scope** | Phase 7 (7.1). The prop name stays; its JSDoc changes. A rename is a mechanical follow-up belonging to a **different change**. Do **not** schedule it here. |
| **OQ-4** | §12 Q4 | An open `parada` under a **different** order is unreachable after day-scoping: `getParadaAbierta(maquinaId, ordenId)` is order-bound (or `ordenId = null`), so no day-free read finds "a `parada` opened under order X while order Y is today's order", and no listing can either. | **CLOSED — alternative B (operational answer: the state IS reachable).** `IParadaRepository` gains `getParadaAbiertaDeMaquina(maquinaId)`, a day-free machine-level open-state query whose only predicate is `machine_id = $1 AND fin IS NULL LIMIT 1`. Port + both adapters + parity landed with the decision. | Phase 10 (10.3) — now unblocked. The App-side consumption of the new lookup is task 10.3, gated on nothing. |

---

## Phase 1: Boundary guard (WU 1)

**Depends on:** nothing. This is the entry gate for the whole change: `851172c` is already the zero-diff baseline at `c1bf533` (verified), so the guard is green on arrival. If it is red, stop — every later phase is blocked.

- [x] 1.1 Create `src/__tests__/noDomainDiff.test.ts` (`// @vitest-environment node`, `execFileSync` from
  `node:child_process` under the project's existing `// @ts-expect-error type error without @types/node package`
  convention, `vite.config.ts:4-5`). Two `git` calls, both name-based and read-only, with
  `const BASE = "851172c"` — the **declared precondition commit, not HEAD** (HEAD has since moved to `c1bf533`;
  the baseline stays because it is the change's precondition, and reverting past it would make the guard green for
  the wrong reason):
  - `git diff --name-only 851172c -- src/domain` → `""` (folds committed + staged + unstaged together)
  - `git ls-files --others --exclude-standard -- src/domain` → `""` (untracked files are the other half of "zero diff")
  **Traces to:** `specs/historical-day-navigation/spec.md:418-423` ("A change to `src/domain/**` fails the change" / "GIVEN a regression guard over
  `src/domain/**` … THEN the guard fails"); design §10.3, §10.5; boundary B1+B2. **File: `src/domain/**` is
  `(read-only)` — the guard only ever reads it.**
- [x] 1.2 Verify the guard starts **green** before any other phase runs:
  `git diff --name-only 851172c -- src/domain src-tauri/migrations` returns empty (already confirmed at `c1bf533`),
  then `npx vitest run src/__tests__/noDomainDiff.test.ts` passes. A red guard here means the precondition itself is
  dirty and every later phase is blocked.
- [x] 1.3 Confirm the guard's rejected alternative is genuinely unavailable, so the choice is recorded rather than
  assumed: a content grep would already fire on the untouched tree — `new Date(` appears throughout `src/domain/**`
  (e.g. `src/domain/actividades.ts` (read-only)), the domain suites are **co-located** `src/domain/*.test.ts` with no
  `src/domain/__tests__/` to hang a `?raw` reader on, and `src/domain/calidad.test.ts:14` (read-only) legitimately
  imports `InMemoryDanoRepository`. A guard that is red on the precondition guards nothing. Record this as a comment
  in the new file, per design §10.3.

**Finish when:** the file exists, both assertions pass, and the gate command
`git diff 851172c -- src/domain src-tauri/migrations` is empty.
**Rollback:** delete the file. No production behaviour is touched.

---

## Phase 2: Port contract + in-memory family (WU 2)

**Depends on:** WU1 green. No code dependency on WU3; the two adapter families are independent and may be written in either order.

- [x] 2.1 Add `listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<T[]>` to exactly four
  ports, with `fechaOperativa` as a **required positional parameter** so a day-free call cannot type-check (DD1):
  `src/store/paradasRepository.ts` (next to `listarPorMaquina` at `:48` and `getParadaAbierta` at `:61`),
  `src/store/actividadesRepository.ts` (next to `:50`, `getActividadAbierta` at `:58`),
  `src/store/danosRepository.ts` (next to `:57`), `src/store/mantenimientoRepository.ts` (next to `:63`).
  Add the JSDoc line stating the day is an equality match on the persisted `fechaOperativa` and is never derived
  from `inicio`/`fin`. **Traces to:** `R:37-49` ("each exposes a machine listing that requires an operational day";
  "WHEN it is type-checked without supplying the operational day THEN compilation fails"); DD1, DD2, DD3; §2.
- [x] 2.2 Do **not** narrow or remove `listarPorMaquina(maquinaId)`. It survives unchanged and complete — it is the
  seam for a future full-history view, and its existing per-adapter assertions must keep asserting full history
  (DD2). **Traces to:** `R:183-198` ("A surviving day-free listing is unchanged").
- [x] 2.3 Implement the four in-memory adapters following the exact shape at
  `src/store/inMemoryParadasRepository.ts:46-51`: filter `p.fechaOperativa === fechaOperativa` **inside the
  adapter** (DD3), sort `a.inicio.localeCompare(b.inicio)`, `.map(structuredClone)` for the defensive copy, `[]` for
  an empty day, never an error. Files: `src/store/inMemoryParadasRepository.ts`,
  `src/store/inMemoryActividadesRepository.ts`, `src/store/inMemoryDanosRepository.ts`,
  `src/store/inMemoryMantenimientoRepository.ts`. **Traces to:** `R:91-96` ("The in-memory adapter filters within
  its own read path"); `R:123-148` (exact day, empty array, `ordenId: null` included, order owned by the adapter);
  `R:150-155` (no business-rule validation added); `H:161-166` (chronological order).
- [x] 2.4 Add the day cases to the four existing in-memory suites — `src/store/paradasRepository.test.ts`,
  `src/store/actividadesRepository.test.ts`, `src/store/danosRepository.test.ts`,
  `src/store/mantenimientoRepository.test.ts` — **adding** cases and keeping every current assertion. Each case
  asserts the day predicate *next to* the surviving full-history assertion, so DD2's guarantee is visible in one
  place. Minimal shape is intentional: the six attribution shapes belong to WU4's shared factory, not here (see
  defect **D4**). **Traces to:** `H:457-462` ("The existing adapter suites keep their coverage … AND no assertion
  is deleted to make the day predicate pass"); `R:193-198`.
- [x] 2.5 Record the ordering caveat in each added method's JSDoc rather than claiming determinism:
  `inicio.localeCompare` is not a total order when two records of the same day share an `inicio`. The day-free
  listing has the same property today; this change adds no determinism claim and removes none (design §3.1).

**Finish when:** `npx tsc --noEmit` is clean, the four in-memory suites pass with the day cases added, and no
existing assertion was touched.
**Rollback:** remove the eight added methods. The day-free `listarPorMaquina` is intact, so the pre-change read path
still works.
**Boundary check:** no `src/domain/**` diff, no migration, `IInspeccionRepository` / `ILecturaGolpeRepository`
untouched (B1–B4).

---

## Phase 3: SQLite family (WU 3)

**Depends on:** WU1 green. No code dependency on WU2 — the SQLite method is one added `WHERE` conjunct over an existing index, and only WU4 needs both families.

- [x] 3.1 Add `listarPorMaquinaYFecha` to the four SQLite adapters — one added `WHERE` conjunct, nothing else
  changes. Follow the exact shape of `src/store/sqlite/sqliteParadaRepository.ts:262-268` (which issues
  `SELECT * FROM parada WHERE machine_id = $1 ORDER BY inicio ASC`): add `AND fecha_operativa = $2`, pass
  `[maquinaId, fechaOperativa]`, keep `ORDER BY inicio ASC`, reuse the existing row mapper unchanged. Files:
  `src/store/sqlite/sqliteParadaRepository.ts`, `src/store/sqlite/sqliteActividadPlanificadaRepository.ts`,
  `src/store/sqlite/sqliteDanoRepository.ts`, `src/store/sqlite/sqliteMantenimientoRepository.ts`.
  **Traces to:** `R:84-89` ("the statement it issues restricts its result by the persisted `fecha_operativa` value …
  the restriction is part of the read, not a filter applied to an already-read full result"); `H:485-490` ("the
  day predicate reads the existing column"); DD3, DD11.
- [x] 3.2 Do not add a column, an index, or a schema change. The predicate is served by the index migration 005
  already declared at `src-tauri/migrations/005_event_fecha_operativa.sql:36-39`
  (`idx_parada_maquina_fecha`, `idx_actividad_maquina_fecha`, `idx_dano_maquina_fecha`,
  `idx_mantenimiento_maquina_fecha`, each on `(machine_id, fecha_operativa)`); the superseded
  `(machine_id, inicio)` indexes at `src-tauri/migrations/004_operational_events.sql:114-117` (read-only) stay and
  keep serving `get*Abierta`. **Traces to:** `H:472-490` ("No migration is added … migrations 001–005 are
  byte-identical"); DD11; boundary B1.
- [x] 3.3 Add day cases to the four existing modelled-double suites —
  `src/store/sqlite/__tests__/sqliteParadaRepository.test.ts` (imports `createFakeSqliteStore` at `:24`),
  `sqliteActividadPlanificadaRepository.test.ts`, `sqliteDanoRepository.test.ts`,
  `sqliteMantenimientoRepository.test.ts` — **adding** cases and keeping every current assertion. Note that
  `fakeSqliteStore` must be taught to honour the new conjunct, otherwise these cases pass vacuously: verify the
  double actually filters, do not accept a case that returns the full history. **Traces to:** `H:457-462`;
  `R:199-211` ("The day-scoped path does not build on the day-free listing").
- [x] 3.4 Do **not** treat the double-based cases as parity evidence. The spec is explicit that parity proved
  solely against a double would not prove the real engine enforces the filter; the real-engine run is WU4 and is
  **added to**, not substituted for, these suites. **Traces to:** `H:425-447`, `H:464-470`.

**Finish when:** `npx tsc --noEmit` is clean, the four SQLite suites pass, `git diff 851172c -- src-tauri/migrations`
is empty.
**Rollback:** remove the four added methods. No schema, no migration, no persisted-data change.

---

## Phase 4: One contract factory, both families, real SQLite engine (WU 4)

**Depends on:** WU2 **and** WU3 both complete — the whole point of this slice is one contract suite run against two adapter families. Also requires a host with a working `node:sqlite` `DatabaseSync`; if unavailable, this slice is **blocked**, not deferred to N/A.

- [x] 4.1 Create the directory `src/store/__tests__/` — it does not exist yet — and in it
  `src/store/__tests__/dayScopedListingContract.ts`: **one** exported factory
  `describeDayScopedListingContract<T>(familia, crearCaso)` that runs every day-scoped listing case against
  whichever family `crearCaso` builds, so a shape cannot pass in one family and fail in the other (DD10).
  **Traces to:** `H:435-440` ("it runs every case against the in-memory family and against the SQLite family AND
  both families pass every case"); DD10; design §8.
- [x] 4.2 The factory MUST cover the six attribution shapes for **each of the four** event types (DD8, design §8):
  (1) a record with an order; (2) a record with **no** order (`ordenId: null` — must still be visible on its day);
  (3) a midnight-crossing record (`inicio` 23:50 → `fin` 00:10 next day); (4) an **open** record spanning midnight
  (`fin: null`, `inicio` the previous day); (5) two records with **identical `inicio`** but different
  `fechaOperativa`, each day returning only its own; (6) a day with no records → `[]`, not an error. For every
  case also assert chronological order is preserved and that the day-free `listarPorMaquina` still returns the
  machine's full history (DD2). **Traces to:** `H:449-455` ("Parity covers the attribution shapes, not only the happy
  path"); `H:203-241` (exclusive attribution); `H:168-201` (records with no order).
- [x] 4.3 Assert the exact-match semantics, not a loose date match: a record whose `inicio`/`fin` both fall on `D-1`
  while `fechaOperativa = D` is **not** returned for `D-1`; a still-open record matches only its own day; a
  persisted `jornada` takes no part in the decision (no window, overlap or "still open" predicate anywhere).
  **Traces to:** `R:157-181`; `H:203-241`.
- [x] 4.4 Create `src/store/sqlite/__tests__/realSqlite.ts`: a `DatabaseSync` shim over `node:sqlite` implementing
  only the two methods the adapters use — `select<T>(sql, binds)` and `execute(sql, binds)` — plus `close()`. Migrations
  001–005 are applied in-process via `?raw` imports, following the exact pattern at
  `src/store/sqlite/__tests__/migration005.test.ts:36-41`. The **shim must inject only a `Database`**; the SQLite
  adapter classes run **unmodified**, which is what makes the run evidence about the adapter rather than about a
  re-implementation of it. **Traces to:** `H:442-447`; design §8 "The real SQLite side", §11.
- [x] 4.5 The shim must handle the two `node:sqlite` behaviours the design recorded empirically: `$1`/`$2` binds are
  **named** to `node:sqlite`, so a ~12-line rewrite maps `$N` → `?` before preparing (or binds
  `{'1': …, '2': …}`); and the environment container refuses to bundle the builtin, so the test file opens with
  `// @vitest-environment node`. TypeScript accepts the import under the project's existing
  `// @ts-expect-error type error without @types/node package` convention (`vite.config.ts:4-5`) — `npx tsc --noEmit`
  must still pass. **Traces to:** design §8 table; `H:464-470` ("the guardrails pass").
- [x] 4.6 Create `src/store/sqlite/__tests__/dayScopedListing.parity.test.ts`, opening with
  `// @vitest-environment node`, calling `describeDayScopedListingContract` twice — once for `"in-memory"`, once for
  `"sqlite"` over the real engine. **Traces to:** `H:435-447`.
- [x] 4.7 Assert the index is actually used: `EXPLAIN QUERY PLAN SELECT * FROM parada WHERE machine_id = ? AND
  fecha_operativa = ?` reports `SEARCH parada USING INDEX idx_parada_maquina_fecha (machine_id=? AND
  fecha_operativa=?)`. The design observed exactly this plan in-session; the suite turns that observation into
  evidence. **Traces to:** `H:485-490`; DD11; design §3.3, §11 ("Index assumptions wrong").
- [x] 4.8 Give the new suite the same two honesty blocks `migration005.test.ts:14-33` already uses: a
  *"WHAT THIS SUITE IS NOT"* block stating it does not run the Tauri migration, and a
  *"SEPARATE EVIDENCE, NOT CLAIMED HERE"* block pointing at `src-tauri/migrations/validate_r56.py` (read-only) with
  its own caveat (a Python `sqlite3` script; `executescript` autocommit vs sqlx's per-migration transaction — not
  equivalent to the runtime). The suite claims real-engine enforcement of the predicate and explicitly claims
  nothing about the Tauri transport, which stays PENDING (R5/R6). Do not touch the existing honesty notes at
  `recovery.test.ts:26-30` or `startup.test.ts:20-23`. **Traces to:** `H:464-470` ("the suites that cannot exercise
  the real Tauri runtime keep the project's honesty note, so no suite claims runtime verification it does not have");
  design §8 "Honesty note".

**Finish when:** `npx vitest run src/store/sqlite/__tests__/dayScopedListing.parity.test.ts` passes for both
families, `npx tsc --noEmit` is clean, and the `EXPLAIN QUERY PLAN` assertion holds.
**Rollback:** delete the three new files. Zero production files are touched by this phase.
**Runtime harness evidence:** the real `node:sqlite` engine over migrations 001–005 is this phase's harness. It is
**not** the Tauri plugin transport; R5/R6 runtime validation remains open on a Tauri-capable host.

---

## Phase 5: Day-scoped recovery (WU 5)

**Depends on:** WU2 (the four day-scoped methods must exist before the call sites can be repointed). Independent of WU3 and WU4.

- [x] 5.1 Repoint the four production calls in `src/store/sqlite/recovery.ts` — `:129` (paradas), `:131`
  (actividades), `:133` (danos), `:135-137` (mantenimientos) — from `listarPorMaquina(maquinaId)` to
  `listarPorMaquinaYFecha(maquinaId, fechaOperativa)`, using the `fechaOperativa` that already arrives as the
  function's **ninth** parameter (`recovery.ts:108`). **Traces to:** `W:36-49` ("Recovery uses the day-scoped
  machine listings"; "Recovery passes the day to the day-scoped listings"); DD3; design §4.
- [x] 5.2 Rewrite the three places inside `recovery.ts` that write down the *old* contract, because leaving them
  would document a behaviour the code no longer has:
  - `recovery.ts:30-32` — the file header's *"The four machine-event lists carry the machine's FULL history:
    recovery applies NO date predicate (a future 'read a past day' feature adds it to the ports, never to
    recovery)."* is now **contradicted outright**, and the parenthetical is actively misleading because this IS
    that feature and it does go to the ports. Rewrite to state the four lists are scoped to the requested day.
  - `recovery.ts:51-52` — *"No new columns, no new repository methods; `IOrderRepository` never queries
    `lectura_golpe`."* Scopes the claim: no new **columns**; `IOrderRepository` still gains nothing; the four
    machine-event ports gain `listarPorMaquinaYFecha`.
  - `recovery.ts:126-127` — the inline comment above the `parada` read, *"…SIN predicado de fecha (D2e)…"*, becomes
    *"…acotada a `fechaOperativa` (D2e)…"*. This is the third copy and the one a reader actually sees next to the
    call.
  **Traces to:** design §4 (first three bullets); `W:36-49`.
- [x] 5.3 Re-point the four `RecoveryState` field comments at `recovery.ts:86-89` — each names the method it comes
  from, so all four rename and `paradas`'s *"(historial completo)"* goes with them. The field **types** and the
  interface's **shape** do not change. **Traces to:** `W:66-71` ("Recovery returns sources only").
- [x] 5.4 Change **nothing else** in recovery. The read order stays sequential and fixed (D2e): jornada → orden →
  lecturas → paradas → actividades → daños → mantenimientos → inspecciones; no `Promise.all`. A read failure still
  **propagates** — no new `catch`, no downgrade to an empty list. No derived value is computed. The single declared
  dependency on `orden` (guarding lecturas and inspecciones) is unchanged, and `inspecciones` still reaches
  `inspeccionRepository.listarPorOrden(orden.id)` with **no day** (`recovery.ts:141-143`) — B3 holds.
  **Traces to:** `W:51-64` ("Recovery's read order remains the fixed order"; "Inspections remain order-reached");
  `W:66-71`; `W:211-216`; DD8.
- [x] 5.5 Re-point `src/store/sqlite/__tests__/recovery.test.ts`, changing nothing else:
  1. the white-box header line at `:16` — *"routes the four machine-event lists through `listarPorMaquina(maquinaId)`
     with NO date predicate"* — names `listarPorMaquinaYFecha(maquinaId, fechaOperativa)`;
  2. the four fakes at `:216`, `:225`, `:233`, `:245` gain `listarPorMaquinaYFecha: vi.fn(…)`; they are
     `satisfies I…Repository`, so the build fails until they do, and each **keeps** `listarPorMaquina` for DD2;
  3. the failure-injection option `fallaLecturaDano` moves from `listarPorMaquina` to `listarPorMaquinaYFecha`
     (`:186-187`, `:233-235`) — otherwise `I6` (`:732`) would stop injecting and start passing **vacuously**;
  4. assertions re-point — `H1` (`:518-521`), `I1` (`:591-594`), `I6` (`:746-748`) and the sequential-order array in
     `I2` (`:615-618`).
  **Traces to:** `W:36-49`; `W:51-56`; `W:232-238`; `W:225-231`; design §10.2 item 1–4.
- [x] 5.6 Rewrite `I4` **precisely, not by blanket inversion** (design §10.2 item 5). Its title and premise comment
  (`recovery.test.ts:654`, `:657` — *"el recovery no filtra por fecha"*) change, and its eight method assertions
  (`:682-688`) become `listarPorMaquinaYFecha` with `(MAQUINA, FECHA)`. Its body needs **no** assertion change: the
  four records deliberately set `inicio` to Jan/Feb/Mar/Dec while `createParada`/`createActividad`/`createDano`/
  `createMantenimiento` default `fechaOperativa: FECHA` (`recovery.test.ts:57`, `:94-155`), so all four are still
  returned and `toEqual(paradas)` stands. **Then add the new property:** one record gains
  `fechaOperativa: "2026-12-31"` and is asserted **absent**. The surviving half of the original case (an `inicio`
  outside the day is still returned when `fechaOperativa` matches) is exactly the spec's *"a midnight-crossing
  record stays on its registered day"* / *"`inicio` and `fin` are untouched by day scoping"* and must be **kept,
  not deleted**. The full-history guarantee `I4` used to carry moves to the per-adapter suites (DD2, task 2.4).
  **Traces to:** `H:210-241`; `H:236-241`; design §10.2 item 5.
- [x] 5.7 Keep `I2` (read order), `I3` (the order-less case), `I5` (sources only) and `I6` (failure propagation)
  structurally intact — they must still pass unmodified. **Traces to:** `W:51-64`; `W:211-238`.

**Finish when:** `npx vitest run src/store/sqlite/__tests__/recovery.test.ts` passes, `npx tsc --noEmit` is clean, and
no assertion was deleted to make the change pass.
**Rollback:** revert the four call sites at `recovery.ts:129,131,133,135-137` and the comment rewrites. Read order,
failure propagation and the sources-only contract never moved.

---

## Phase 6: `Raiz` composition root (WU 6)

**Depends on:** WU5 (the recovery seam must already accept the selected day, otherwise `Raiz` has nothing to pass it to).

- [x] 6.1 Create `src/Raiz.tsx` as a **new, exported module** — it cannot live inside `src/main.tsx`, which calls
  `void main()` at import time (`main.tsx:126`), so a test importing it from there would re-run the whole startup.
  Export the `LosOchosRepositorios` interface (the eight port types) and `RaizProps` (`repos`, `estadoInicial`,
  `fechaOperativaInicial`). Inside: **one** `useState` value holding `{ fechaOperativa, estado }` as a pair, so the
  day and its data can never disagree, plus `cargando` and `errorDia`. **Traces to:** `H:61-98`; `H:99-125`;
  DD4, DD5; design §5.2.
- [x] 6.2 Implement `seleccionarDia(fechaOperativa)` with an early return when the day is unchanged or a load is
  in flight, then `await recoverPersistedState(…, fechaOperativa, "M1")` (ADR 0003, explicit exactly as
  `main.tsx:95` passes it) and a **single** `setVista({ fechaOperativa, estado })` — atomic, and only after recovery
  resolved. Re-selecting the displayed day skips recovery entirely.
  **Traces to:** `H:112-117` ("Re-reading the same day is idempotent"); `H:105-110` ("the same eight sources are
  re-read … AND the same machine and the same repository instances are used"); `H:119-124` ("Navigating does not
  change unrelated state … nothing was written to storage as a consequence of the navigation"); DD4, DD5.
- [x] 6.3 Give `seleccionarDia` a `catch`, not only a `finally` — stated once, because it is the *only* new failure
  behaviour in the change. On a rejected read: (1) the rejection is consumed, so no unhandled promise rejection
  escapes; (2) `vista` is left untouched, so the selection and the rendered data still agree (DD5's atomicity holds
  in the failure direction too); (3) `errorDia` is set and rendered by `App` as
  `<p className="selector-dia__error" role="alert">` in the header, next to the navigator. The `finally` re-enables
  the controls; the next call clears `errorDia` first, so the attempt is retryable. Recovery itself still rejects —
  only this caller catches. **Traces to:** `H:119-124`; design §5.2, §11 ("A day change rejects and the operario
  sees a blank or half-loaded day").

  **Split across WU6/WU7, and here is exactly where the seam is.** WU6 delivered
  clauses (1), (2) and the `setErrorDia` half of (3) inside `Raiz`. The
  `<p className="selector-dia__error" role="alert">` RENDER of clause (3) needs
  `App.tsx`, which is not this phase's surface: it lands with **7.7**, the task
  that declares `errorCambioDia` on `AppProps` and renders the navigator and
  the alert inside one `{onSeleccionarDia && (…)}` block. Until 7.7 lands,
  `Raiz` holds `errorDia` and no DOM shows it — the error is not yet *visible*,
  only *captured*.
- [x] 6.4 Render `<App key={vista.fechaOperativa} … />`. The `key` is the load-bearing part (DD5): `App` holds ten
  `useState` values seeded from `estadoInicial` (`App.tsx:143-147` and the surrounding seeds at `:120-151`), so
  without a remount a day change leaves the previous day's rows mounted until the async loaders resolve. The remount
  makes *"The UI state never holds another day's rows"* structural instead of something each loader must remember.
  **Traces to:** `H:147-152` ("The UI state never holds another day's rows … whether seeded or loaded afterwards");
  `H:94-99` ("A selection survives a re-render and is not replaced by the clock"); DD5.
- [x] 6.5 Edit `src/main.tsx` so **steps 1–4 stay byte-identical** — `initDatabase` (`main.tsx:63`), the eight
  repositories (`:67-74`), `materializarPrograma` (`:79`), `recoverPersistedState(..., fechaOperativaHoy(), "M1")`
  (`:85-96`) — inside the same `try` with the same `InicializacionFallida` fallback (`:114-123`). **Only step 5
  changes**: the render at `:99-113` mounts `<Raiz …/>` instead of `<App …/>` with a resolved state. **Traces to:**
  `W:73-99` ("Startup passes the selected day to recovery"; "The app uses the same selected day as its view"; "The
  first paint matches the recovered day … AND no state was seeded from a different day"); DD4, design §5.1.
- [x] 6.6 Re-point `src/store/sqlite/__tests__/startup.test.ts` in its **two independent groups**:
  1. *The fakes.* The four port objects at `:140` (parada), `:152` (actividad), `:163` (dano), `:175`
     (mantenimiento) are annotated `: IParadaRepository` etc., so each gains `listarPorMaquinaYFecha`. Their
     `bitacora.push("<dom>:listarPorMaquina")` tags at `:145`, `:157`, `:168`, `:180` rename with them, the
     failure-injection spy at `:361-365` targets `listarPorMaquinaYFecha` and pushes
     `parada:listarPorMaquinaYFecha:error`, and the two tag assertions at `:581-582` rename to match — otherwise
     the failure case **passes for the wrong reason** (the tag simply never appears). One comment needs rewording:
     `:531` says the machine domains are recovered as *"historial completo de la máquina, vacío en día vacío"*; the
     four `toEqual([])` assertions above it still hold, but the reason is now "empty day, day-scoped read".
     **Executed in WU5 (group 1 only):** "The fakes" was pulled forward because re-pointing recovery alone turns the startup failure-injection case red, and the slice must be green before it commits; group 2 ("The root") remains Phase 6.
  2. *The root.* `Raiz` is what `main()` renders, so `elemento.props.children` is `<Raiz>`: the root-type assertions
     at `:485` and `:526` assert `RaizDelArranque` (imported next to `AppDelArranque` at `:399`); the eight
     repository-identity assertions at `:502-509` become `props.repos.repository` … `props.repos.mantenimientoRepository`;
     and the three failure-screen negatives at `:554`, `:570`, `:590` swap `AppDelArranque` → `RaizDelArranque`.
     As written they would **pass by accident** — `InicializacionFallida` is neither `App` nor `Raiz` — so leaving
     them means the suite no longer asserts the success screen is what is absent. `props.estadoInicial` keeps its
     name, so the assertions at `:487-499` and `:527` stand unmodified.
  **Traces to:** `W:80-99`; `W:232-238` ("A recovery failure propagates to the failure screen … AND `App` is never
  mounted"); design §5.2 "Consequence for `startup.test.ts`", §10.2.

**Finish when:** `npx vitest run src/store/sqlite/__tests__/startup.test.ts` passes, `npx tsc --noEmit` is clean, and
the suite's honesty note at `startup.test.ts:20-23` is unedited.
**Rollback:** delete `src/Raiz.tsx` and restore the `<App …/>` render at `main.tsx:99-113`. Steps 1–4 never moved.

---

## Phase 7: `App` day plumbing (WU 7)

**Depends on:** WU6 (`Raiz` owns and supplies the selected day; `App` cannot be plumbed before its caller exists).

- [x] 7.1 Update `App`'s `hoy` JSDoc (`App.tsx:99`) from *"En runtime se usa el día de hoy"* to *"the selected
  operational day; the navigator owns it"*. **The prop name stays `hoy`** — see **OQ-3**, this is deferred to a
  different change. **Traces to:** `H:86-90` ("The selected day is displayed"); `H:92-98`; DD12.
- [x] 7.2 Add one optional prop to `AppProps`, declared immediately after `hoy` (`App.tsx:100`):
  `fechaOperativaHoy?: string` — the **injected read-only reference** and the navigator's upper bound, defaulting to
  the local-calendar clock. The import it names is `fechaOperativaHoy` from `./store/fixtures` (`App.tsx:30` →
  `src/store/fixtures.ts:27-29` → `src/store/clock.ts:37-39`). **Traces to:** `H:126-128` ("`max` blocks future
  days"); `H:326-344`; design §5.3, DD7.
- [x] 7.3 Destructure it **renamed**: `fechaOperativaHoy: hoyReal = fechaOperativaHoy()`. The pattern's *key* is
  `fechaOperativaHoy` but its *binding* is `hoyReal`, so the pattern introduces no local with that name and the call
  inside it resolves to the module import. The rename is **load-bearing, not cosmetic**: with the same name on both
  sides (`{ a = f(), f = f() }`) V8 throws `ReferenceError: Cannot access 'f' before initialization` at
  parameter-evaluation time — a `ReferenceError` on every `App` mount. Record that reasoning as a comment so the
  next reader does not "tidy" it back. **Traces to:** design §5.3 (verified in-session, not assumed).
- [x] 7.4 Derive `soloLectura` **exactly once**, in the destructuring block: `const soloLectura = hoy !== hoyReal;`.
  This value is the *only* place it is computed in the whole change. No loader, handler, section or module may
  recompute it, and **no code may write `hoy !== fechaOperativaHoy()`** — that expression reads the module import,
  ignores the injected prop, and would make every fixture-injected mount read-only. Every other consumer receives it
  as a prop. **Traces to:** `H:319-324` ("A read-only day can never produce a write"); `H:353-364`; `H:373-378`;
  DD7; design §5.3, §5.4 item 2.
- [x] 7.5 Add the selected day to the **four mount loaders and four `recargar*()` helpers** — in the call **and** in
  the dependency array. All eight current call sites are at `App.tsx:206, 218, 246, 267, 305, 309, 314, 325`; a
  forgotten dependency array is the specific way this feature silently reverts to full history and overwrites the
  day-scoped seed. `cargarOrden` (`:182`) and `cargarJornada` (`:229`) already depend on `hoy` and already pass it —
  unchanged. `cargarInspecciones` (`:283`) stays keyed on `orden?.id` with no day, because the order already carries
  it (B3, B4). **Traces to:** `W:101-134` ("The four machine-event loaders use the day-scoped listings with the
  selected day"; "Changing the selected day re-runs the mount loaders"); `W:175-201` ("A successful write triggers a
  re-seed with the selected day"); DD6; design §11 (first risk row).
- [x] 7.6 Add the `soloLectura` guard as the **first statement** of all 15 write handlers — `handleIniciar`
  (`App.tsx:359`), `handleRegistrarLectura` (`:386`), `handleFinalizar` (`:423`), `handleRegistrarParada` (`:449`),
  `handleCerrarParada` (`:470`), `handleRegistrarActividad` (`:495`), `handleCerrarActividad` (`:515`),
  `handleRegistrarDano` (`:553`), `handleCerrarDano` (`:583`), `handleRegistrarInspeccion` (`:605`),
  `handleDevolverInspeccion` (`:626`), `handleAutorizarInspeccion` (`:655`), `handleRegistrarMantenimiento`
  (`:683`), `handleCerrarMantenimiento` (`:712`), `handleCambiarFinJornada` (`:539`). The guard reads the
  **already-computed** prop — it recomputes nothing. The message is a plain refusal
  (`["no se puede registrar en un día que no es hoy"]`), returned as the handler's domain-error array, so the shape
  every caller already handles is reused. **Traces to:** `H:319-324`; `H:278-285` ("Hidden is the required
  behaviour"); design §5.4 item 6, §6.2, §11.
- [x] 7.7 Add the three defaulted navigator props to `AppProps`: `onSeleccionarDia?: (fechaOperativa: string) =>
  void`, `cargandoDia?: boolean` (default `false`), `errorCambioDia?: string | null` (default `null`). The header
  renders the navigator and the `role="alert"` message **inside one `{onSeleccionarDia && (…)}` block** after the
  existing `Fecha operativa: {hoy}` span (`App.tsx:886`), which stays. `Raiz` always defines `onSeleccionarDia`;
  no existing `App` mount does, so their DOM is byte-identical to today's (asserted in Phase 11).
  **Traces to:** `H:61-98`; `H:326-344`; design §5.4 item 5, §7.
- [x] 7.8 Add `fechaOperativaHoy` to **all 44 fixture-injected `App` mounts** across three files, so each test states
  its assumption — *"for this test, that fixture day IS today"* — instead of depending on the machine's clock:
  - `src/App.test.tsx` — 37 mounts: 33 direct JSX mounts plus the four helpers `renderApp`
    (`src/App.test.tsx:53-54`), `renderAppConActividades` (`:57`, day at `:62`), `renderAppConTiempo` (`:779`, day at
    `:795`), `renderAppConMantenimiento` (`:1646-1657`, day at `:1654`). Each helper is edited **once** and covers
    all its callers.
  - `src/__tests__/persistence-integration.test.ts` — 4: the `appDe` helper (`:223`, day at `:228`) and `:486`,
    `:703`, `:792`.
  - `src/store/sqlite/__tests__/lecturaWiring.test.ts` — 3: `createElement(App, {…})` at `:176-181`, `:231-236`,
    `:269-274`.
  Nothing else in the repository mounts `App`; only `src/main.tsx` does, and it goes through `Raiz`, which always
  passes both props. **Traces to:** `H:353-364` ("Today's write paths stay reachable"); `H:380-385` ("The operario
  never has to navigate to work"); design §5.3 (the 44-mount table), §11 (third risk row).
- [ ] 7.9 Verify with the **existing** suites, unmodified: `npx tsc --noEmit` plus
  `npx vitest run src/App.test.tsx src/__tests__/persistence-integration.test.ts
  src/store/sqlite/__tests__/lecturaWiring.test.ts`. Not one existing assertion moves — that is this phase's
  entire proof. **Traces to:** `H:353-371`; `H:380-385`; design §6.1 case (a) and case (b), which reduce
  arithmetically to today's exact expressions.

**Finish when:** all three suites pass with zero new cases, and no existing assertion was changed.

> **7.9 status: NOT met (recorded, not papered over).** Baseline at `851172c`/working-tree HEAD is **107/107 green**
> in `src/App.test.tsx`; after 7.1–7.8 it is **102 passed / 5 failed** (case count unchanged, zero assertions edited).
> `tsc --noEmit` is clean, `persistence-integration` + `lecturaWiring` + `noDomainDiff` are green (18/18), and
> `git diff 851172c -- src/domain src-tauri/migrations` is empty. The five failures are all **cross-day records
> hidden by the 7.5 day-scoped listing** — the §6.4 exposure, visible between Phase 7 and Phase 10:
> 1. `una actividad abierta de la máquina no bloquea finalizar la orden` — `A3_LIMPIEZA_ABIERTA` (`2026-09-15`) vs mount `2026-09-11` → planned fix **10.1** (card list).
> 2. `una parada abierta sin orden determina PARADA` — parada `2026-09-10` vs mount `2026-09-11` → planned fix **10.3**.
> 3. `los loaders de montaje re-leen el repositorio para el hoy inyectado (el seed stale pierde)` — both seed and repo paradas `2026-09-10` vs mount `2026-09-11` → planned fix **10.3**.
> 4. `un daño abierto preexistente de la máquina bloquea registrar otro` — `DANO_3_ABIERTO` (`2026-09-15`); `handleRegistrarDano` passes the day-scoped `danos` to `registrarDano` (`src/domain/danos.ts:212`) → **no Phase 10 task covers this** (10.1 widens only `comenzarActividad`'s argument).
> 5. `ya hay un mantenimiento abierto: registrar otro muestra error del dominio` — `MANT_4_ABIERTO` (`2026-09-15`); same shape through `registrarMantenimiento` (`src/domain/mantenimiento.ts:195`) → **no Phase 10 task covers this either.**
>
> Failures 4 and 5 are the two this plan did not schedule: the write-path domain guards filter a *list*, and the day-free
> `getDanoAbierto`/`getMantenimientoAbierto` reads that already exist are consumed only for the banner, never as the
> domain's argument. 10.1's union pattern is the template.
>
> **DECIDED (orchestrator, verified against the working tree — not papered over): extend Phase 10 with 10.7 and 10.8.**
> The alternative considered was "accept these two as a separate task", and it was rejected on evidence, not taste:
> `registrarDano` enforces *"ya hay un daño abierto para la máquina"* by filtering `fin === null` over the list it is
> handed (`src/domain/danos.ts:208-215`), and `handleRegistrarDano` (`src/App.tsx:597`, call at `:609`) hands it the
> **day-scoped** `danos` state. `registrarMantenimiento` is the identical shape (`src/domain/mantenimiento.ts:189-197`,
> call at `src/App.tsx:743`). So a record opened on day *A* and still open on day *B* stops blocking a second one **on
> today** — a real machine-invariant break introduced by 7.5, and for maintenance a direct violation of the CONTEXT.md
> rule *"One open maintenance per machine at a time"*. The plan's own DD8 states why: the machine-level `get*Abierta`
> lookups stay day-free so that *"today behaves exactly as today"*. Phase 10 applied that rule to `comenzarActividad`
> (10.1) and simply missed these two write paths — an inconsistency in the plan, not a design fork. Nothing here is an
> architectural change: 10.7/10.8 add **no** port method, **no** domain rule and **no** new read (the day-free open
> record is already in `App` state), so DD8 and the "no second source of truth" rule are untouched. **They are scheduled
> as Phase 10 tasks, not a separate change, because they are the same bug class as 10.1 and splitting them would leave
> WU7's gate red for no gain.**
**Rollback:** revert the `AppProps` additions, the destructuring rename, the 8 call-site edits and the 44 mount
edits. The `hoy` prop and every existing test return to their pre-change shape.
**Boundary check:** no `src/domain/**` diff, no migration, no change to the two order-reached ports (B1–B4).

---

## Phase 8: Read-only reachability gates (WU 8)

**Depends on:** WU7 (`soloLectura` must already be threaded through `App`).

- [x] 8.1 Declare `soloLectura: boolean` as a **required** member on the three previously-ungated prop interfaces, so
  a call site that forgets it does not compile: `ActividadesProps` (`src/ui/ActividadesSection.tsx:15`),
  `ResumenTiempoProps` (`src/ui/ResumenTiempoSection.tsx:10`) and `ParadasSectionProps`
  (`src/ui/ParadasSection.tsx:12`). One JSDoc line each: *"true when the selected day is not today: every write
  control is hidden."* `OrderAvailableProps` (`src/ui/OrderAvailable.tsx:22-35`),
  `OrderInProductionProps` (`src/ui/OrderInProduction.tsx:35-56`), `OrderFinishedProps`
  (`src/ui/OrderFinished.tsx:21-30`) and the inline intersection `EmptyDay` takes (`src/ui/EmptyDay.tsx:11`) all
  `extends` / `&` those interfaces, so all four order views receive it for free. **Traces to:** `H:278-292`;
  design §6.1, DD7, DD7a.
- [x] 8.2 Gate both write controls in `src/ui/ParadasSection.tsx` and `src/ui/ActividadesSection.tsx` and hide the
  fin control in `src/ui/ResumenTiempoSection.tsx` behind `!soloLectura`. **Hidden, not disabled** — a control that
  is present and fails silently, or present and reports a validation error, is prohibited.
  **Traces to:** `H:278-285`; `H:287-294`; `H:295-302`; `H:303-310`; design §11 (second risk row).
- [x] 8.3 In `src/ui/OrderAvailable.tsx`, destructure `soloLectura` from `actividadesProps` after `:42` and wrap the
  whole `start-form` (`OrderAvailable.tsx:61-92`) in `{!soloLectura && (…)}`. `onIniciar` stays **required and
  always passed** — no `undefined`, no optional-prop widening; the guard is on the rendered form, not on the prop.
  **Traces to:** `H:303-310` ("the control to start production is absent"); design §6.1 "Order sections".
- [x] 8.4 In `src/ui/OrderInProduction.tsx`, destructure after `:69`, then wrap **both** write blocks in
  `{!soloLectura && (…)}`: the `Registrar lectura` form (`:146-175`) and the `.finish-section` (`:193-214`).
  **Traces to:** `H:303-310` ("the control to register a reading and the control to finalize production are absent
  for an `orden` in production"); design §6.1.
- [x] 8.5 Pass `soloLectura` to `ParadasSection` explicitly. It is the only child `App` never spreads in directly:
  `src/ui/OrderInProduction.tsx:177-185` lists its props by hand, right next to
  `fechaOperativa={actividadesProps.fechaOperativa}` (`:178`), so `soloLectura` is written there the same way.
  `OrderFinished` and `EmptyDay` need **no** change — they already render no write controls of their own.
  **Traces to:** `H:287-294`; `H:295-302`; design §5.4 item 7, §6.1.
- [x] 8.6 Compose the two gates at `App` **only**, keeping them as two distinct names and never merging them
  (DD7a — the `App` call sites at `:897-939` are flat JSX spreads where *later wins*, so one name cannot carry two
  gates): add `soloLectura` to `propsActividades` (`App.tsx:761-771`) and, defensively, to `propsResumenTiempo`
  (`:814-818`, because a required member must not be satisfied by an accident of spread order); then change
  `permitirRegistrar` to `!soloLectura && orden?.estado !== "finished"` on `danosProps` (`:774-787`, member at
  `:783`), `inspeccionProps` (`:790-797`, member at `:793`) and `mantenimientoProps` (`:800-812`, member at `:808`).
  On today (`soloLectura === false`) this reduces to `true && orden?.estado !== "finished"` — **byte-identical to
  today's expression**, which is why no existing assertion moves. **Traces to:** `H:278-292`; `H:353-364`;
  design §6.1 (including the three-case proof), DD7a.
- [x] 8.7 JSDoc-only pass on the three sections that keep `permitirRegistrar` and change **zero** behaviour:
  `src/ui/DanoSection.tsx:7-30`, `src/ui/InspeccionTelaSection.tsx:58-73`,
  `src/ui/MantenimientoSection.tsx:16-30` — one comment line each pointing at the composition rule of design §6.1.
  No statement, no prop, no condition. Two **field comments** in this pass do stop being true and must be reworded:
  `src/ui/DanoSection.tsx:18` (*"Todos los daños de la máquina: historial (cerrados) + abiertos"*) and
  `src/ui/ActividadesSection.tsx:25` (*"Todas las actividades de la máquina (abiertas y cerradas)…"*) both describe a
  full-history list that is now the selected day's list. Documentation only.
  **Traces to:** design §6.1 Gate B; §9 "JSDoc-only".
- [x] 8.8 Add the read-only cases to `src/App.test.tsx` — control **absence**, not disabled state: no control to
  register a `parada`, `ActividadPlanificada`, `Dano`, `Mantenimiento` or `InspeccionTela` is reachable on a past day;
  no closure control for an open `parada` / `Dano` / in-progress `Mantenimiento`; no start / reading / finalize
  control; and, for each of the 15 handlers, a direct call on a past day returns the refusal and the store is
  untouched. Plus: the read-only view still shows everything the day recorded, only the controls are gone; and
  returning to today restores every control and the writes succeed. **Traces to:** `H:287-317`; `H:319-324`;
  `H:373-378`; design §10.4, §6.2, §11 (second and fourth risk rows).

**Finish when:** `npx vitest run src/App.test.tsx` passes, `npx tsc --noEmit` is clean, and no existing assertion
moved — case (a) and case (b) of design §6.1 are unchanged.
**Rollback:** remove `soloLectura` from the three interfaces and the three order-view wraps. `permitirRegistrar`
keeps its current meaning on the three `…SectionProps`, so the pre-change behaviour returns exactly.

> **8.x status: implemented; the first "Finish when" clause is still unmet for 7.9's reason, not a new one.**
> `npx tsc --noEmit` is clean (0 errors). `src/App.test.tsx` is **112 cases: 107 passed / 5 failed**, and the 5 are
> **byte-for-byte the same failures 7.9 recorded** — same names, same messages, verified by diffing every `FAIL` line
> against the pre-8.x baseline. `git diff -- src/domain src-tauri` is empty. The case count necessarily rose from 107 to
> 112 because 8.8 adds 5 cases; the invariant that matters is that **no pre-existing case changed**, and that held.
> **The suite cannot be green until Phase 10 lands**, for exactly the reason 7.9 documents — so the first clause is
> deferred to WU10, not waived. Two deviations recorded rather than hidden:
> (a) the JSDoc line in 8.1 is written in **Spanish**, not the English quoted in design §6.1, because every comment in
> those four files is Spanish and CONTEXT.md fixes the vocabulary; (b) `OrderAvailable`'s `soloLectura` destructure sits
> after the state hooks rather than literally "after `:42`" — the spec's line number is pre-Phase-7.
> 8.8's closure-control cases were proven **non-vacuous**: temporarily reverting `permitirRegistrar` made the
> "Cerrar daño" case fail with `+ Received: <button class="danos__boton-cerrar">Cerrar daño</button>`, and the gate was
> restored. A test that cannot fail proves nothing.

---

## Phase 9: Day navigator (WU 9)

**Depends on:** WU7 (the navigator renders inside `App`'s header and calls back through `App`).

- [x] 9.1 Create `src/ui/SelectorDiaOperativa.tsx` with a native `<nav aria-label="Día operativo">` containing: a
  `<button type="button">` with `aria-label="Día operativo anterior"` and a `←` glyph in an `aria-hidden` span; a
  labelled `<input type="date">` (`value={fechaOperativa}`, `max={hoy}`); and a
  `<button type="button">` with `aria-label="Día operativo siguiente"` and a `→` glyph, `disabled={disabled || esHoy}`.
  Props: `fechaOperativa`, `hoy` (the **injected** read-only reference — the `App` prop from task 7.2, not a fresh
  clock read), `disabled`, `onSeleccionar`. **Traces to:** `H:326-344` ("The selection resolves to a single date …
  no second day is included"; "No range or multi-day control exists"); DD9; design §7.
- [x] 9.2 Add `desplazarDia(fecha, delta)` to `src/store/clock.ts`, next to `fechaOperativaDe` (`:32-34`) and the
  `en-CA` constant (`:24`), so the convention lives in one module: `Date.setDate(getDate() + n)` on a `YYYY-MM-DD`
  string parsed as **local midnight**, formatted back with the same `en-CA` shape. **No UTC arithmetic, no
  `toISOString()`** — the project already rejected UTC for this field (CHANGE 1, DD9). `max={hoy}` plus "next"
  disabled at today makes "exactly one day, never a range" structural: `<input type="date">` has no
  start-and-end affordance. **Traces to:** `H:326-344`; `H:126-128`; design §7; DD9.
- [x] 9.3 Add the navigator's CSS (`.selector-dia`, `.selector-dia__campo`, `.selector-dia__error`) to `src/App.css`,
  which currently has **zero** `.selector-dia*` rules (754 lines). Keep it to layout only — no behavioural style.
  **Traces to:** design §7, §9.
- [x] 9.4 Wire the navigator into `App`'s header (`App.tsx:884-887`) immediately after the existing
  `Fecha operativa: {hoy}` span (`:886`), inside the `{onSeleccionarDia && (…)}` block from task 7.7, with the
  `role="alert"` error paragraph directly after the `<nav>` and **inside the same block** — so neither can appear
  on a direct `App` mount. `cargandoDia` disables both arrows and the input for the whole in-flight window, so a
  second click cannot queue a second `seleccionarDia`. **Traces to:** `H:86-90`; `H:92-98`; design §7.
- [x] 9.5 Add the navigation cases to `src/App.test.tsx`: the default selection is today; `←`, `→` and the date
  input each load the right day; `→` is disabled at today and `max` is today; a change remounts and shows no
  previous-day row; no control accepts a start and an end date. **Traces to:** `H:71-77`; `H:86-98`;
  `H:332-344`; `H:346-351`; design §10.4 "Navigation and read-only".
- [x] 9.6 State **OQ-2** in the component's JSDoc rather than answering it in code: the upper bound is today and the
  lower bound is unbounded past. `specs/historical-day-navigation/spec.md` requires no lower bound, so no minimum-date logic is invented here. If a
  lower bound is later wanted, it belongs to a change that records it as a domain rule. **Traces to:** design §12 Q2.

**Finish when:** `npx vitest run src/App.test.tsx` passes, `npx tsc --noEmit` is clean, and the three native
elements need no custom focus/keyboard/formatting test of their own.
**Rollback:** delete `src/ui/SelectorDiaOperativa.tsx`, remove `desplazarDia` from `src/store/clock.ts`, remove the
`{onSeleccionarDia && (…)}` block from `App.tsx:886-887` and the `.selector-dia*` rules from `src/App.css`.

> **9.x status: implemented; the first "Finish when" clause is unmet for 7.9's standing reason.**
> `npx tsc --noEmit` is clean. `src/App.test.tsx` is **118 cases: 113 passed / 5 failed** — the same five, byte-for-byte
> identical `FAIL` lines (verified by diff, not by eye). `src/store/clock.test.ts` **12/12**;
> `persistence-integration` + `lecturaWiring` **16/16**; `git diff -- src/domain src-tauri` is empty. The three native
> elements needed no custom focus/keyboard/formatting test, as the clause anticipated — they are `<nav>`, two
> `<button type="button">` and `<input type="date">`, so the browser supplies the semantics.
> The last clause **is** met. Recorded deviations, none hidden:
> (a) 9.6's JSDoc is **Spanish**, not the English the spec quotes, matching the file's language;
> (b) the 9.5 cases drive a **local harness mirroring `Raiz`'s composition** rather than importing `Raiz`, because
> `Raiz`'s `seleccionarDia` needs `recoverPersistedState` over all eight ports — **this is not a coverage shortcut**:
> WU12 is the phase that exercises the day change through the real recovery seam, so 9.5 covering `App`'s navigator
> contract and WU12 covering the seam is the intended split, not a gap;
> (c) 9.5 gained a seventh concern beyond the spec's list — `cargandoDia` disabling both arrows and the input for the
> whole in-flight window, which 9.4 states as a hard constraint but 9.5's case list did not name;
> (d) 6 `desplazarDia` cases were added to the **pre-existing** `src/store/clock.test.ts` (orchestrator-authorised, not
> in the spec) covering delta 0, both month boundaries, a year boundary, a leap day and a DST transition — DD9 forbids
> UTC for this field and this is the arithmetic that would silently regress.

---

## Phase 10: Six list-derived open-state reads (WU 10) — carries **OQ-1** and **OQ-4**

**Depends on:** WU7. **OQ-4 is CLOSED (alternative B)** and the `getParadaAbiertaDeMaquina` port method, both adapters, their suites and the cross-adapter parity suite landed with the decision — 10.3 and 10.5 are therefore unblocked. Only **OQ-1** (historical open-record interpretation) is still open, and 10.6 records that the implementation is the same either way: only the recorded rationale depends on the answer.

The machine-level `get*Abierta` lookups stay **day-free** (DD8), because they express a machine-level invariant and an
open record legitimately spans days — day-scoping them would hide a genuinely open record from **today's** dashboard,
a violation of *"today behaves exactly as today"*. The consequence is that four places in `App` which derive "is
something open" by filtering a **list** are narrowed by day-scoping, and on today a record opened yesterday and still
open disappears. The four read-path call sites of the day-free lookups that this replaces are the two mount loaders
(`App.tsx:247`, `:268`) and the two `recargar*` helpers (`:315`, `:326`). The other four (`App.tsx:474`, `:518`,
`:584`, `:716`) sit inside write handlers, unreachable on a historical day because every handler opens with the task
7.6 guard.

> ⚠️ **Correction to the paragraph above, added by the WU7 verification (7.9) and NOT present in the original plan.**
> The claim that those write-handler sites need no change is **wrong**, and the reason it is wrong matters: it reasons
> about a *historical* day, while the break is on **today**. The 7.6 guard makes the argument unreachable when
> `soloLectura === true`, but on today (`soloLectura === false`) the handler runs and passes a day-scoped list to a
> domain guard that filters `fin === null` — so a record opened yesterday and still open disappears from the machine's
> current operational state. Four of the eight are genuinely display-only (`paradaActivaDeOrden`, and the three
> close-handlers that re-read the port directly), but the two covered by 10.7/10.8 are **domain-level exposures of the
> same class as 10.1**. "Unreachable on a historical day" was never sufficient justification; the correct test is
> "unreachable **or harmless** when the day changes", and these two fail the second half.

- [x] 10.1 `actividadesAbiertas` (`App.tsx:757-759`) becomes state rather than a filter. `cargarActividades`
  (`:217`, call at `:218`) and `recargarActividades` (`:308`, call at `:309`) additionally read
  `getActividadAbierta("M1", tipo)` — the port method **already exists** (`src/store/actividadesRepository.ts:58`)
  and is **already called in the write path** (`App.tsx:518`), so nothing new is invented. The card list and
  `comenzarActividad`'s argument both use `soloLectura ? actividades.filter(a => a.fin === null) : the day-free set`,
  and the day's own open records are unioned in so they are never dropped. **This is a domain-level exposure, not
  just a display one:** `comenzarActividad(actividades, input)` is called at `App.tsx:498` and its guard *"ya hay
  una actividad abierta de tipo …"* (`src/domain/actividades.ts:127-137`) filters `fin === null` over its argument —
  so a `limpieza` left open overnight would otherwise stop blocking a second one.
  ⚠️ **Design defect D1:** the design says "for the two values of `TipoActividadPlanificada`", but the type has
  **four** (`cambio_diseno`, `limpieza`, `almuerzo`, `pausa` — `src/domain/types.ts:112-116` (read-only)).
  Implement over **all four** and record the deviation; do not narrow to two.
  **Traces to:** `H:353-364` ("Today's derived values are unchanged"); design §6.4 item 1, §11 (fifth risk row).
- [x] 10.2 `paradaActivaDeOrden` (`App.tsx:754`) reads `getParadaAbierta("M1", orden.id)` fetched alongside the
  day-scoped list in `cargarParadas` (`:205`, call at `:206`) and `recargarParadas` (`:304`, call at `:305`) — the
  same call `handleRegistrarParada` already makes at `App.tsx:474`, so the guard and the card now read one source
  instead of two. **Traces to:** `H:353-364`; design §6.4 item 2.
- [x] 10.3 `paradaAbiertaMaquina` (`App.tsx:836-838`) becomes
  `paradaAbiertaDeMaquina ?? paradaAbierta(paradas, "M1", null)`, where `paradaAbiertaDeMaquina` is fetched **day-free** in
  the same two places through the **new** `getParadaAbiertaDeMaquina("M1")` (OQ-4, alternative B — the port method, both
  adapters, their suites and the cross-adapter parity suite already landed with the decision). This adds two `useState`
  values to `App` and four lookups split across four functions.
  One lookup replaces the two `getParadaAbierta` calls: it also reaches a `parada` left open under a *previous* order,
  which neither of them could. The port JSDoc is the contract — the lookup answers "¿qué está abierto AHORA?" and is
  consulted **only** when `!soloLectura`, so a historical day keeps answering from its own list and no record is shown on
  two days. **Traces to:** `H:353-364`; design §6.4 item 3, §12 Q4.
- [x] 10.4 The two `useState` **seeds** at `App.tsx:143` and `App.tsx:147` **keep their expression** unchanged. They
  are an optimisation the loaders immediately supersede (which already re-read `:247` / `:268` on mount), and
  changing them would require `RecoveryState` to grow four open-record fields — a contract change to a module this
  design otherwise leaves alone. State the one-paint difference in the code comment rather than hiding it. It is not
  observable through Testing Library, because `render()` flushes effects. **Traces to:** design §6.4 item 4, §10.4
  "Today's DOM unchanged" (the honest qualification).
- [x] 10.5 Add the cross-midnight case to `src/App.test.tsx` — the case design §6.4 exists for: seed a `dano`, a
  `mantenimiento`, a `parada` and a `limpieza` on day *D* with `fin: null`, inject `fechaOperativaHoy = D + 1`,
  mount on *D + 1*, then assert (a) each open card is visible, (b) `estadoMaquina` still reads `parada`, (c)
  registering a second `limpieza` is refused by `comenzarActividad`'s guard, and (d) after navigating to *D* the
  same records are visible there and **not** on *D + 1* — the day-scoped list and the day-free lookup each answer
  the same records are visible there and **not** on *D + 1* — the day-scoped list and the day-free lookup each answer
  their own question. ✅ **OQ-4 is CLOSED (alternative B), so assertion (b) is no longer limited**: add the
  **different-order variant** — a `parada` opened on *D* under order X, the order switches to Y, the `parada` stays open
  on *D + 1* — and assert `estadoMaquina` still reads `parada` there, that the day-scoped listing for *D + 1* omits it,
  and that its `fechaOperativa` is still *D*. **Traces to:** `H:353-364`; `H:366-371`; `H:217-228`; design §10.4
  "Open records across midnight", §6.3, §6.4.
- [x] 10.6 Record **OQ-1** next to the derivation it justifies: a code comment on the `soloLectura ?` conditionals
  states that on a historical day the open state is derived from **that day's own list** with the existing pure
  functions (`danoAbierto`, `mantenimientoAbierto`, `paradaAbierta` — all already imported and already called this
  way at `App.tsx:143`, `:147`), because the machine-level lookups would answer "what is open *now*", a different
  day. The alternative reading — keep `get*Abierta` on every day — is what OQ-1 asks Gerencia to confirm. **The
  implementation is the same either way; only the recorded rationale depends on the answer.**
  **Traces to:** `H:126-152`; `H:411-416`; design §6.3, §11 (ninth risk row), §12 Q1.
- [x] 10.7 `handleRegistrarDano` (`App.tsx:597`, call at `:609`) stops handing `registrarDano` the day-scoped `danos`
  state as its `danosExistentes`. The domain enforces *"ya hay un daño abierto para la máquina. Cierre el daño actual
  antes de registrar otro"* by filtering `fin === null` over that argument (`src/domain/danos.ts:208-215`), so after
  7.5 a `dano` opened on a previous day and still open no longer blocks a second one **on today**. Pass the union of
  the day's list and the day-free open record that is **already in state**: `[...danos, ...(danoAbiertoDeMaquina ?
  [danoAbiertoDeMaquina] : [])]`. **No new read** — `recargarDanos` already fetches `getDanoAbierto("M1")` day-free
  at `:349` and stores it at `:353`; a duplicate entry is harmless because the guard only `.find()`s. **No
  `soloLectura` branch**: the 7.6 guard at `:598` returns before the argument is ever built, so on a historical day
  the expression is unreachable — which is exactly why this is a today-only fix. **Traces to:** design §6.4 item 1,
  DD8; tasks.md 7.9 failure 4 (*"un daño abierto preexistente de la máquina bloquea registrar otro"*).
- [x] 10.8 `handleRegistrarMantenimiento` (`App.tsx:732`, call at `:743`) gets the identical treatment:
  `registrarMantenimiento` filters `fin === null` over its `existentes` argument
  (`src/domain/mantenimiento.ts:189-197`) and the day-free open record is already in state as
  `mantenimientoAbiertoDeMaquina` (`App.tsx:179-182`, set day-free at `:363` from the read at `:360`). CONTEXT.md
  records *"One open maintenance per machine at a time (temporary operational restriction, relaxable if the flow
  requires it)"*, so this is a documented machine invariant, not a UI preference. Same union, same absence of a
  `soloLectura` branch (the 7.6 guard at `:733` returns first). **Traces to:** design §6.4 item 1, DD8; tasks.md 7.9
  failure 5 (*"ya hay un mantenimiento abierto: registrar otro muestra error del dominio"*).

> **10.7/10.8 need no new test.** Both are already covered by the two existing App cases named above, which fail today
> and must pass once the union lands — they are the day-*A*-record-blocks-on-day-*B* case for these two domains. Adding
> a duplicate case would be the "new cases" that 7.9 forbids.
- [x] 10.9 `mantAbierto` (`App.tsx:1078`) stops deriving `DashboardHome`'s maintenance card from the day-scoped
  `mantenimientos`. **Added by the orchestrator after the WU10 implementation**, on the same reasoning that produced
  10.7/10.8: `mantenimientoAbierto(mantenimientos, "M1")` filters `fin === null` over a list 7.5 narrowed, so on today an
  open `mantenimiento` started on *D* is missing from the card on *D + 1*. It is the **display** member of the class
  10.1–10.3 and 10.7/10.8 handle, and it is the **only** remaining instance: `DashboardHome` takes `estadoMaquina`,
  `paradaAbierta`, `mantenimientoAbierto`, `calidad` and `resumenTiempo` and has no damage card, so the `dano` side has
  no equivalent. Left unfixed it is not merely an omission — it is a **self-contradiction inside one rendered day**,
  because `MantenimientoSection`'s banner already answers from the day-free `mantenimientoAbiertoDeMaquina` and would
  say "Mantenimiento activo" while the card above it said nothing. Derive it from `mantenimientoAbiertoDeMaquina`
  (already in state, set day-free) under the same `soloLectura ? … :` shape 10.6 documents, so a historical day still
  answers from its own list and no record is shown on two days. Extend 10.5's cross-midnight case with one assertion
  that the `DashboardHome` maintenance card renders the open record on *D + 1* — that assertion is RED before this task
  and GREEN after, which is what makes 10.9 non-vacuous. **Traces to:** design §6.4, DD8; tasks.md 7.9 class.

**Finish when:** `npx vitest run src/App.test.tsx` passes — which requires all five of 7.9's failures to be green,
since 7.9 is this work unit's own gate — no existing assertion moved, and OQ-4's limitation is written down in code
rather than papered over.
**Rollback:** remove the two added `useState` values and the four conditional derivations. `estadoMaquina` returns
to scanning the day-scoped list and the two seeds are untouched.
**Boundary check:** zero `src/domain/**` diff — the `comenzarActividad` guard is *consumed*, never modified.

> **10.x status: COMPLETE. The red window is closed.** `src/App.test.tsx` is **120 passed / 0 failed** (verified by
> the orchestrator, not only by the implementer: exit 0, zero `FAIL` lines). All five of 7.9's failures are green, and
> the 113 cases that were already passing still pass unmodified. `npx tsc --noEmit` is clean;
> `git diff -- src/domain src-tauri src/store src/ui` is **empty** — the boundary check held. Full suite: **1115 passed
> across 38 files**.
>
> **The "118" arithmetic in the finish-when clause was wrong and was not met as written.** The file held exactly 118
> `it(` blocks, of which 5 were red; 10.5 mandates new cases, so 118-green was unsatisfiable. The honest number is
> **120** = 118 + the two 10.5 cases. Recorded rather than papered over.
>
> **A spec snippet was wrong and was NOT transcribed (this is the important finding).** 10.3 specifies
> `paradaAbiertaDeMaquina ?? paradaAbierta(paradas, "M1", null)`, but `paradaAbierta` filters
> `p.ordenId === ordenId` with `ordenId` defaulting to `null` (`src/domain/paradas.ts:277-282`) — so that literal
> matches **only paradas without an order** and would have silently dropped every order-bound open `parada`,
> reintroducing the precise regression OQ-4 was closed to fix. The implementation uses an explicit
> `find(fin === null && maquinaId === "M1")` instead, with the reason in a code comment. **Transcribing a spec snippet
> without reading the function it calls is how this class of bug ships.**
>
> Other recorded deviations, none hidden:
> - **10.1 implements over FOUR `TipoActividadPlanificada` values, not two** — design defect **D1**, as 10.1 anticipated.
> - **Three new `useState` values, not the two the phase text predicted.** Recorded, because the count is a prediction,
>   not a requirement.
> - **10.7/10.8 needed no new test**, exactly as their note said: the two red cases were already their specification.
> - **10.9 was added by the orchestrator** after the implementation surfaced the `DashboardHome` maintenance card as the
>   last instance of the class (`App.tsx:1078`, now `soloLectura ? … : mantenimientoAbiertoDeMaquina ?? …`). Its
>   assertion was observed **RED** first — the card was genuinely absent, `0` `dashboard-home__mantenimiento` nodes in
>   the failure dump — which is what makes it non-vacuous. Case count stayed 120 because the assertion extends the
>   existing 10.5 case rather than adding one.
> - 10.4 held: the two seeds at `App.tsx:178`/`:181` keep their expressions, with the one-paint difference stated in a
>   comment rather than hidden.
> - **D2**: design §6.3's `soloLectura ? danoAbierto(…)` snippet is stale; the `dano`/`mantenimiento` seeds stay
>   unconditional, which is what tasks.md D2 already prescribes.

---

## Phase 11: Empty-day and today-unchanged suites (WU 11)

**Depends on:** WU9 — the empty-day scenarios are driven through the navigator. Independent of WU8, WU10, **OQ-1** and **OQ-4**.

- [x] 11.1 Add the four empty-day scenarios from `specs/historical-day-navigation/spec.md:249-277`, each asserted **through the navigator**, not only
  at startup: (1) a fully empty day renders the no-order state — navigate to a day with no `orden`, `EmptyDay`
  renders, no error, no failure screen; (2) an empty day fabricates nothing — no `orden`, `lectura`, `parada`,
  `actividad`, `Dano` or `mantenimiento` appears and the fake store's write methods have **zero** calls after the
  render; (3) a day with events but no order — two activities and one `parada` on *D*: `EmptyDay` renders **and**
  those three rows are visible, with no row from another day; (4) the `jornada` of the selected day is used — *D*
  has no persisted `jornada`, the existing default reads, and `jornadaRepository` gained **no write call**.
  **Traces to:** `H:243-277`; `H:168-201`; design §10.4 "Empty days".
- [x] 11.2 Add the "today's DOM is byte-identical" assertion: for every direct
  `<App hoy={…} fechaOperativaHoy={…}/>` mount the rendered output matches the pre-change rendering — no
  `SelectorDiaOperativa`, no alert, no extra element in the header, because `onSeleccionarDia` is `undefined`. This
  is what makes *"A selected day equal to today behaves exactly as today"* checkable rather than a claim. Carry the
  one honest qualification from design §10.4 into a comment: with an open record carried over from a previous day the
  two `useState` seeds at `App.tsx:143` / `:147` are one paint behind their loaders (task 10.4) — stated, not
  papered over, and not observable through Testing Library. **Traces to:** `H:353-364`; `H:366-371`;
  `H:380-385`; design §10.4.
- [x] 11.3 Add the day-scoped loader assertions: the selected day reaches every one of the eight machine-event call
  sites, and the `cancelled`-flag pattern still prevents a `setState` after unmount.
  **Traces to:** `W:108-114`; `W:123-134`; `W:225-231`.

**Finish when:** `npx vitest run src/App.test.tsx` passes with these cases green and no existing case modified.
**Rollback:** test-only — delete the added cases. No behaviour changes.

> **11.x status: COMPLETE. Test-only, as specified — no production file was touched.**
> `src/App.test.tsx` is **128 passed / 0 failed** (verified independently by the orchestrator: exit 0, zero `FAIL`
> lines, `tsc --noEmit` clean, `it(` count 128 == 128 cases). 8 cases added: four for 11.1, one for 11.2, three for
> 11.3. `git diff -- src/App.tsx src/ui src/store src/domain src-tauri src/Raiz.tsx` is **empty**. The lone `-1` in the
> diffstat is the pre-existing missing trailing newline on the last line, now POSIX-correct; no assertion moved.
>
> **11.2 was NOT satisfied with a snapshot.** A committed pre-change DOM baseline does not exist in this repo, and a
> fresh `toMatchSnapshot()` would have passed trivially while proving nothing. Instead the expected header was derived
> from the **pre-change source itself** — `git show 851172c:src/App.tsx:884-887` — giving the exact child set
> `["h1.app__titulo", "span.app__fecha"]` plus its `outerHTML`. This is what makes *"a selected day equal to today
> behaves exactly as today"* checkable rather than asserted. It also carries the design §10.4 qualification as a
> comment: the two seeds stay one paint behind their loaders, which Testing Library cannot observe.
>
> **Falsifiability was proven, not claimed.** Two temporary mutations were made and reverted with `git checkout`:
> removing `if (cancelled) return;` from `cargarParadas` turned 11.3.3 RED on `dashboard-home__parada`, and pointing
> `cargarParadas`/`cargarActividades` at `fechaOperativaHoy` turned 11.1.3 RED (activities 0 ≠ 2). A green test that
> has never been seen red is a claim, not evidence.
>
> **Two honest limits, recorded rather than hidden:**
> - **11.3.2 is unobservable.** React 19 removed the setState-after-unmount warning entirely, so "unmount with a
>   pending read throws nothing" cannot distinguish a guarded read from an unguarded one. It is kept as a
>   regression tripwire with a comment saying exactly that; **11.3.3** — a stale response after `hoy` changes must not
>   leak the old day's `parada` — is the half that genuinely exercises the `cancelled` guard.
> - **"every direct `<App/>` mount" collides with "no existing case modified."** Retrofitting 11.2 into each existing
>   direct-mount case would have violated the no-modification rule, so it is one dedicated case instead. The tension is
>   recorded here rather than resolved by quietly rewriting existing cases.

---

## Phase 12: Day-change flow through the real recovery seam (WU 12)

**Depends on:** WU9 (it navigates) and WU7. Independent of WU8, WU10, **OQ-1** and **OQ-4**.

- [x] 12.1 Add `listarPorMaquinaYFecha` to the four repository fakes in
  `src/__tests__/persistence-integration.test.ts` at `:173`, `:181`, `:188`, `:196`, keeping their
  `listarPorMaquina`. **Traces to:** design §9, §10.2 item 3.
- [x] 12.2 Add the real day-change flow: materialise two days of orders and events, navigate between them, assert
  each view shows only its own rows, and assert **no write reaches the store from a historical day**. This is the
  integration-level counterpart of `specs/historical-day-navigation/spec.md:105-124` (same sources re-read for the new day; nothing written as a
  consequence of navigating) and of `specs/historical-day-navigation/spec.md:319-324` (a read-only day can never produce a write). It exercises the
  real `recoverPersistedState` seam, not a fake, so it is the only place the two new callers — startup and
  `Raiz.seleccionarDia` — are covered together. **Traces to:** `H:105-124`; `H:319-324`; `W:73-99`;
  `W:175-201`; design §10.2 item 3.
- [x] 12.3 Confirm the failure-propagation discipline end to end: a rejected day-scoped read inside recovery at
  startup still renders `InicializacionFallida` and `App` never mounts, while a rejected day change leaves the
  previous day on screen with the `role="alert"` message. **Traces to:** `W:232-238`; design §5.2.

**Finish when:** `npx vitest run src/__tests__/persistence-integration.test.ts` passes with the new flow green.
**Rollback:** test-only — delete the added flow and the 4 fake methods.

> **12.x status: COMPLETE. Test-only, as specified — no production file was touched.**
> `src/__tests__/persistence-integration.test.ts` is **16 passed / 16**; the full root suite is **1128 passed across 38
> files** (1115 + 8 from Phase 11 + 5 from here — the arithmetic reconciles exactly). `tsc --noEmit` clean.
> `git diff -- src/App.tsx src/ui src/store src/domain src-tauri src/Raiz.tsx` is **empty**. The 14 deletions are all
> accounted for and **none of them is an assertion**: one import, three doc-comment lines, one function signature, and
> the nine `async () => []` fake stubs replaced by real seeded, date-filtering implementations.
>
> **12.1 was stale as written, and the staleness was the real task.** `listarPorMaquinaYFecha` **already existed** on
> all four fakes — the earlier interface extension had added it — but every one of them was `async () => []`. The port
> signature already matched the spec while the *behaviour* was a stub, so a test written against it would have been
> green and meaningless. Each fake now holds seeded rows and applies `fechaOperativa === fecha` **inside the fake**,
> never in the caller; `listarPorMaquina` stays alongside it and is asserted non-empty for both days so the day-free
> path cannot regress to `[]`.
>
> **Falsifiability demonstrated, with the leak made visible.** The seed `SEMILLA_DOS_DIAS` includes three *fantasma*
> records whose `fechaOperativa` is `DIA_B` but whose `inicio` falls inside `DIA_A`, because otherwise "a record from
> another day" cannot exist and the predicate is untestable. Dropping the `parada` and `actividad` date predicates
> produced `expected [ 'par-a', 'par-b', 'par-fantasma' ] to deeply equal [ 'par-a' ]` and a `DIA_B` parada rendering
> inside `Historial de paradas` on `2026-09-11`. Both mutations were reverted and re-verified.
>
> **Write-surface accounting, stated rather than assumed.** The pre-existing `noEscrito` covers **10** methods
> (`insert`/`update` across the five operational ports) and still throws on any call. It does **not** cover
> `saveOrder`, `materializeOrder`, `reserveSequence`, `completeLecture` or `guardarJornada`. 12.2 closes that gap with
> `vigilarEscrituras()` — **15** spies, plus an executable assertion that the spied name list equals exactly those 15 so
> it cannot rot silently, plus a byte-for-byte `JSON.stringify` comparison of `almacen.ordenes` and `almacen.lecturas`
> before and after navigating. Those five use a no-op rather than `noEscrito` deliberately: a floating rejection would
> abort the navigation instead of being *observed*.
>
> **12.3 asserts both directions in both halves.** A rejected day change keeps `DIA_B`'s markers on screen *and* shows
> `role="alert"` with the wrapped cause; a rejected startup renders `InicializacionFallida` with the message and proves
> `App` never mounted (no `h1` "Dashboard de Estampado", `dashboard-home` testid null, no date field, no `.selector-dia`).
> 12.3b drives the **real** `main.tsx`, `Raiz`, `recoverPersistedState`, `materializarPrograma` and the eight real
> `Sqlite*` repositories over a fake `Database`, mocking only `store/sqlite/database` — so `vi.resetModules()` is not
> needed and no React-identity mismatch is introduced.
>
> **Three limits recorded honestly:**
> - `.paradas__historial` and `.inspecciones__historial` are double-filtered by `ordenId` in `App.tsx:923`, so their day
>   scoping is proven at **port** level, not through the DOM; only actividad/daño/mantenimiento leaks are UI-visible.
>   The `fantasma` parada carries `DIA_A`'s own order id, which is what makes the parada case UI-falsifiable anyway.
> - `ParadasSection` only renders inside `OrderInProduction`, so the seeded orders are forced to
>   `estado: "in_production"` after `materializarPrograma` — otherwise half the UI assertions would be vacuously green.
> - The default Vitest reporter does not stream to a redirected file, so the full suite looks hung when piped;
>   `--reporter=dot` is the reliable way to watch it.

---

## Final gate (all phases, after WU 12)

- [x] G.1 `npm run test` — the full root suite, including the new `src/__tests__/noDomainDiff.test.ts`.
- [x] G.2 `npx tsc --noEmit` in `.`.
- [ ] G.3 `cargo check` in `src-tauri`.

> **G.3 is UNMET, and it is NOT a code failure — it is this machine's Rust toolchain.** `cargo check` exits 101 while
> compiling the *build scripts* of `libc` and `quote`, not this crate's code: the installed toolchain targets
> `aarch64-linux-android` and the linker cannot resolve `-lunwind` or `-llog` (Android/Bionic libraries), which are not
> present on this host. No Android sysroot is installed.
>
> This gate **cannot** be caused by this change, and that is provable rather than asserted: `git diff 851172c --
> src-tauri` is **empty** — the entire change touches **zero Rust files** and zero migrations. Nothing in this change is
> even compiled by `cargo check`.
>
> **Left unticked on purpose.** Ticking it would make the plan claim Rust verification that does not exist. The honest
> state is: the TypeScript side is fully verified (G.1 1128/1128, G.2 clean), the Rust side is **unchanged from its
> baseline** and therefore **unverified in this environment**. Re-running it needs a host Rust toolchain, or an Android
> NDK sysroot for the configured target.
>
> G.1 ✅ `npm run test` — **38 files, 1128 passed, 0 failed**, exit 0. Reaches 1128 exactly: 1115 at the end of Phase 10,
> + 8 from Phase 11, + 5 from Phase 12.
> G.2 ✅ `npx tsc --noEmit` — clean, exit 0.
> G.4 ✅ `git diff 851172c -- src/domain src-tauri/migrations` — **empty**. The B1/B2 boundary never moved; the domain
> and the migrations are byte-identical to the baseline.
> G.5 ✅ both HONESTY NOTE blocks are intact and still declare their scope: `recovery.test.ts` still says its cases
> "do NOT execute the real SQLite repositories… which is PENDING", `startup.test.ts` still says real Tauri/SQLite startup
> "remains PENDING runtime validation", and `dayScopedListing.parity.test.ts:22` still carries R5/R6 as PENDING. The
> diffs in those two files are *factual corrections* — recovery genuinely is day-scoped now, and `main.tsx` genuinely
> mounts `Raiz` instead of `App` — plus a **new** disclosure in `startup.test.ts` explaining that `App` is mocked and is
> therefore not the subject of that suite. Honesty went up, not down.
- [x] G.4 `git diff 851172c -- src/domain src-tauri/migrations` is **empty** (B1 + B2). Verified green at `c1bf533`
  before this change started, so it needs no baseline exception.
- [x] G.5 No suite claims runtime verification it does not have: the honesty notes at
  `src/store/sqlite/__tests__/recovery.test.ts:26-30` and `src/store/sqlite/__tests__/startup.test.ts:20-23` are
  unedited, and the WU 4 suite carries its own two blocks naming what it does not cover (R5/R6 stays PENDING).
  **Traces to:** `H:464-470`; `W:232-238`.

---

## Design defects and observations found while planning

Recorded, **not repaired** — the design, proposal and specs are frozen for this phase. Each item is flagged so
`sdd-apply` does not silently paper over it.

| # | Where | Finding | Disposition in this plan |
|---|---|---|---|
| **D1** | design §6.4 item 1 | *"for the two values of `TipoActividadPlanificada`"* — the type has **four** values (`cambio_diseno`, `limpieza`, `almuerzo`, `pausa`, `src/domain/types.ts:112-116` (read-only)). | Task 10.1 implements over all four and records the deviation. The design is not edited. |
| **D2** | design §6.3, illustrative snippet | The snippet `soloLectura ? danoAbierto(danos, "M1") : (await loadDanoAbierto())` is stale: since Phase 14.2 the machine open records live in `useState` (`App.tsx:143`, `:147`, consumed at `:781` and `:806`), and §6.4 item 4 **explicitly keeps those two seeds unchanged**. The snippet therefore contradicts §6.4 item 4 and would reintroduce a render-body port read that the current code deliberately removed. | Read §6.3's snippet as **illustrative only**. Phase 10 follows §6.4, the specific section. Flagged, not repaired. |
| **D3** | design §6.3, §11, §12 | `§12 Q1` and `§12 Q2` **reuse the labels** `Q1` / `Q2` for different questions from the proposal's `Q1` / `Q2`, which are **closed**. A reader following "see §12, Q1" could conclude the closed attribution decision was reopened — exactly what the orchestrator forbade. | This file renames the carried questions `OQ-1`…`OQ-4` with an explicit disambiguation note. The design's §12 boxes stay as they are. |
| **D4** | design §10.1 vs §9 | §10.1 says every day case runs through the shared factory; §9 separately schedules *"+day cases per family"* on the eight per-adapter suites — the same coverage in two places. Verified: those suites instantiate the real adapter class and contain **no** `satisfies I…Repository` port object, so they need no compile change and the factory is the coverage the spec actually requires (`H:435-447`). | Tasks 2.4 and 3.3 schedule a **minimal** per-adapter day case (which keeps DD2's full-history assertion adjacent to the day assertion); task 4.1–4.3 owns the six attribution shapes. Redundancy flagged. |
| **D5** | design §12 Q4 | *"Needs an operational answer before the parity suite is written for it."* — but §8's parity suite enumerates six **listing** shapes and never exercises `getParadaAbierta`, so the Q4 gate is mis-placed: it belongs to the `estadoMaquina` / cross-midnight unit, not the parity unit. | **OQ-4** is attached to task 10.3 (and 10.5), not to WU 4. Task 4.2 is explicitly told not to widen the factory to cover Q4. Flagged. |
| **D6** | design §8, §9 | `src/store/__tests__/` **does not exist** in the working tree, yet the factory is placed there. | Task 4.1 creates the directory. Not a defect — recorded so the implementer does not assume it is there. |
| **D7** | design §3.3 | The superseded `(machine_id, inicio)` indexes are cited as *"migration 004 (`:114-117`)"* with no filename. | Verified: `src-tauri/migrations/004_operational_events.sql:114-117` (read-only). Task 3.2 cites the full path. |
| **D8** | design §5.3, §9 vs the tree | Design says 44 fixture-injected `App` mounts. Verified: `src/App.test.tsx` has exactly 37 `hoy=` occurrences (33 direct + 4 helpers), plus 4 in `persistence-integration.test.ts` and 3 in `lecturaWiring.test.ts` = **44**. | Confirmed, no change needed. Line numbers for two helpers had drifted by one; task 7.8 cites the verified lines. |

### D-numbering is local to this file — an independent audit exists

A separate structural audit of `design.md` (Engram obs **2283**, "5 blocking contradictions found") ran
independently of this plan and produced a **disjoint** set of findings. Its five items are numbered `(1)`–`(5)` there,
**not** `D1`–`D8`, so **no `D`-number above refers to an audit item and no audit item appears in the table above.**
Every one of the five is nevertheless neutralised by a task here, so the design's blocking problems are all covered —
just under different labels:

| Audit item | Its finding | Neutralised by |
|---|---|---|
| (1) | §6.1's plan to pass `undefined` into required props fails `tsc` and leaves the control *visible*, while §9 calls `Order*.tsx` "not touched" — and `ParadasSection`'s new required `permitirRegistrar` forces an edit at `OrderInProduction.tsx:177` anyway. | Tasks 8.1, 8.3, 8.5 — `soloLectura` is a **required** member, `onIniciar` stays **required and always passed** (no `undefined`, no optional-prop widening), and `OrderInProduction.tsx:177-185`'s hand-written prop list is edited deliberately rather than by accident. |
| (2) | Adding `permitirRegistrar` to `propsActividades` collides with 3 same-name keys in `App`'s **flat JSX spreads** (later spread wins), silently flipping it to `false` on finished orders and breaking the finished-order case at `App.test.tsx:608`. | Tasks 8.4–8.6 — explicit ordering per spread group; a required member "must not be satisfied by an accident of spread order" (`:814-818`), and the three sections that legitimately keep `permitirRegistrar` get a JSDoc-only pass (task 8.7) instead of a colliding rename. |
| (3) | `soloLectura` defined **two contradictory ways**: §5.3 line 257 `hoy !== hoyReal` vs §5.4 line 267 `hoy !== fechaOperativaHoy()`, the latter reading the module clock and defeating the injectable prop. | Task 7.4 — derived **exactly once** as `hoy !== hoyReal`, with an explicit prohibition on writing `hoy !== fechaOperativaHoy()` anywhere. |
| (4) | §10.3's suggested domain guard pattern `new Date(` fires **immediately**: domain non-test files already use it (`actividades.ts:177`, `danos.ts:64`). | Task 1.3 — the `git`-based guard is chosen *because* the content grep is unavailable on an untouched tree, and that rejection is recorded in the new file. |
| (5) | Line 262's claim that `startup.test.ts` "only asserts `app.type` and `props.estadoInicial`" is false — it asserts 8 repository props at `:502-509`. | Task 6.6 — re-points the suite in its **two independent groups** rather than assuming a single assertion. |

All four of the audit's spot-checked citations re-verified here against the tree and are accurate:
`src/domain/actividades.ts:177` and `src/domain/danos.ts:64` both contain `new Date(` (read-only);
`src/store/sqlite/__tests__/startup.test.ts:502-509` asserts exactly eight repository props;
`src/App.test.tsx:608` is the `registra una actividad en orden finalizada` case;
`src/ui/OrderInProduction.tsx:177-185` is the hand-written `ParadasSection` prop list.

---

## Archive-time concerns (not implementation work)

- [ ] A.1 **Superseded text — carry the `spec-report.md` observation forward.** The pending
  `operational-event-operative-date` delta's `operational-repository-contracts` spec contains an ADDED requirement
  *"No port signature changes in this change"* whose scenario asserts that `listarPorMaquina` accepts only
  `maquinaId`. That was correct for its own change and is **superseded** by this change's *"Exactly four
  machine-event ports gain a day-scoped listing"*. When `operational-event-operative-date` is archived, that scenario
  MUST NOT be promoted as-is; the promoted state is the day-scoped contract. **No task in this plan touches the other
  change's file** — the delta records the interaction and leaves the other change alone, exactly as
  `specs/operational-repository-contracts/spec.md:213-221` states. **Traces to:** `R:213-221`; `spec-report.md:22-23`.
- [ ] A.2 A stray method name survives inside this change's own recovery-wiring spec:
  `specs/operational-recovery-wiring/spec.md:186` (read-only) reads *"THEN it calls `paradaRepository.listarPorMaquina`
  with the day-scoped listing for `(machineId="M1", fechaOperativa=D)`"* — the intent is the day-scoped listing, the
  name is the day-free one. Implementation follows the intent (task 7.5). The archive-time spec sync should correct
  the stray name. Out of scope here: the specs are frozen for this phase.
- [ ] A.3 At archive time, confirm no task of this change promoted design §12's `Q1`/`Q2` labels into the promoted
  specs (see defect **D3**), and that the four `OQ-*` questions are either answered or restated as explicit
  follow-up items.
