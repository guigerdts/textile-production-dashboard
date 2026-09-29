# Tasks: SQLite Persistence — Phase 2 (Operational Domains)

Change: `sqlite-persistence-phase-2`
Artifact store: `openspec`
In-scope projects: `.` (frontend, TypeScript) and `src-tauri` (Rust shell)
Derived from: `proposal.md`, `design.md` (APPROVED), and the three approved specs
`operational-events-schema` / `operational-repository-contracts` / `operational-recovery-wiring`

This document schedules work only. It implements nothing, opens no PR, and makes no commit.
The domain rules of tickets 02–08 are closed and no task below changes one.

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | **≈ 4,100 authored changed lines** (additions + deletions), across 14 work units |
| 400-line budget risk | **High** — certain to exceed, in aggregate and in 6 of 14 units individually |
| Chained PRs recommended | **Yes** |
| Suggested split | 14 chained PRs (1 → 2 → … → 14), see Suggested Work Units |
| Delivery strategy | `ask-on-risk` |
| Chain strategy | `pending` — team decision, must be chosen before `sdd-apply` |
| Work units over 400 | C2, D2, E2, F2, G1*, G2 — *G1 is at ~300 after the correction below; the 5 over-budget units are C2, D2, E2, F2, G2 |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

> `Decision needed before apply: Yes` is derived from the received `ask-on-risk` strategy. The
> orchestrator MUST put three questions to the user before `sdd-apply` starts: (1) the chain
> strategy, (2) whether the 5 over-budget units are accepted as `size:exception` or split further,
> (3) the base-boundary model. Nothing below may be implemented as one oversized unit.

### Suggested Work Units

| # | Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | A1 — 004 DDL | 5 tables, 59 columns, 5 FKs, 11 indexes exist and are registered | PR 1 | `npm run test` (green, no new test in this unit) | `cargo check` in `src-tauri` + byte-equality of canonical vs mirror via `cmp` | Revert 4 files; 001–003 untouched, nothing consumed 004 yet |
| 2 | A2 — 004 SQL contract | The 12 schema requirements are machine-enforced | PR 2 (base = PR 1) | `npx vitest run src/store/sqlite/__tests__/migration004.test.ts` | N/A — cannot execute real Tauri DDL in this environment; honesty note required | Revert 1 test file; DB state unchanged |
| 3 | B — parada port async | The reference async port + in-memory pattern + the parada-only App landing, proven before any adapter | PR 3 | `npx vitest run src/store/paradasRepository.test.ts` | N/A — no runtime seam; `main.tsx` still wires in-memory | Revert 7 files (3 store + App.tsx + App.test.tsx + ParadasSection.tsx + OrderInProduction.tsx); port is sync again, App calls restored |
| 4 | S — shared FK fake store | The D2b double: shape matching + 5 real FKs, used by 5 suites and the R2 guard | PR 4 | `npx vitest run src/store/sqlite/__tests__/fakeSqliteStore.test.ts` | N/A — the double *models* SQLite, never executes it | Revert 2 files; each suite falls back to its own `vi.hoisted` fake |
| 5 | C1 — actividad port async + actividades App landing | 5 async port methods, identical in-memory behaviour, actividades async landing | PR 5 | `npx vitest run src/store/actividadesRepository.test.ts` | N/A — no runtime seam | Revert 7 files (3 store + App.tsx + App.test.tsx + the actividades UI pass-through files resolved by CORRECTION 6); port is sync again, App calls restored |
| 6 | C2 — actividad adapter | First SQLite operational adapter; sets the shape for D/E/F2 | PR 6 (base = PR 5) | `npx vitest run src/store/sqlite/__tests__/sqliteActividadPlanificadaRepository.test.ts` | N/A — real migration application is a Tauri binary step, pending | Revert 2 files; port stays async and in-memory still serves |
| 7 | D1 — daño port async **+ the daño-only App/UI landing** | 6 async port methods, identical in-memory behaviour, and the async consumers they break (`App.tsx`, `src/ui/DanoSection.tsx`, `src/App.test.tsx`) | PR 7 | `npx vitest run src/store/danosRepository.test.ts src/App.test.tsx` | N/A — no runtime seam | Revert 7 files (3 store + `src/domain/calidad.test.ts` + `App.tsx` + `App.test.tsx` + `src/ui/DanoSection.tsx`); port is sync again, App/UI calls restored — **the 3 store files and the 3 consumers must revert as one set**, never the store alone |
| 8 | D2 — daño adapter | 14 columns, independent 0/1 flags, 2 FKs | PR 8 (base = PR 7) | `npx vitest run src/store/sqlite/__tests__/sqliteDanoRepository.test.ts` | N/A — FK behaviour is modelled, not proven per connection (R5) | Revert 2 files |
| 9 | E1 — inspección port async | 4 async port methods; `validarId` preserved | PR 9 | `npx vitest run src/store/inMemoryInspeccionRepository.test.ts` | N/A — no runtime seam | Revert 3 files |
| 10 | E2 — inspección adapter | 5-item checklist tuple + full resolution union, both directions | PR 10 (base = PR 9) | `npx vitest run src/store/sqlite/__tests__/sqliteInspeccionTelaRepository.test.ts` | N/A — corrupt-row mapping errors are unit-level | Revert 2 files |
| 11 | F1 — mantenimiento port async | 5 async port methods | PR 11 | `npx vitest run src/store/mantenimientoRepository.test.ts` | N/A — no runtime seam | Revert 3 files |
| 12 | F2 — mantenimiento adapter | 10 columns, no `orden_id`, no `duracion`, update in place | PR 12 (base = PR 11) | `npx vitest run src/store/sqlite/__tests__/sqliteMantenimientoRepository.test.ts` | N/A — no runtime seam | Revert 2 files |
| 13 | G1 — recovery + startup | `recoverPersistedState`, 8 sources, 8 adapters constructed once, failure screen intact | PR 13 (base = PR 12) | `npx vitest run src/store/sqlite/__tests__/recovery.test.ts src/store/sqlite/__tests__/startup.test.ts` | N/A — `cargo check` covers the Rust side; real DB load needs the binary | Revert 6 files; falls back to the in-memory wiring (pre-change state) |
| 14 | G2 — App + UI | 11 async handlers, Approach A, render reads lifted, 6 UI files await | PR 14 (base = PR 13) | `npx vitest run src/App.test.tsx src/__tests__/persistence-integration.test.ts` | **RUNTIME PROBE — explicit, non-blocking** (see Verification strategy) | Revert 9 files; falls back to the in-memory wiring |

**No PR in this plan may be created until a chain strategy is chosen.** Under
`feature-branch-chain`, PR 1 targets the tracker branch and each later PR targets the immediate
parent branch; if a child diff shows previous slices, the base is wrong — retarget before review.

---

## Deviations from the design's slice table — READ BEFORE APPLY

These are **corrections**, not re-opened decisions. No D1–D3 / D2a–D2j decision is touched; the
corrections make the slice table consistent with decisions the design already made.

### CORRECTION 1 — `fakeSqliteStore.ts` must move out of slice G

**Conflict.** D2b states the shared double is *"used by the five new SQLite adapter suites and by
the restart-survival suite"*. The design's slice table places `fakeSqliteStore.ts` in **slice G**,
but slices C2/D2/E2/F2 (the five adapter suites) come **before** G. D2b also explicitly rejects the
alternative that would make the table work (*"a per-suite inline `vi.hoisted` fake would duplicate
~80 lines across 6 suites and, worse, define the FK behaviour 6 times so the R2 guard would be a
property of one file rather than of the suite"*). The table as written therefore cannot be
executed without violating D2b.

**Resolution.** The double becomes **its own work unit (Phase 4, "S")**, placed after B and before
C2, so every adapter suite consumes one shared FK implementation. Slice G then only *consumes* it.
This is the placement the sequencing rationale already requires (*"each domain's port + in-memory +
SQLite adapter travel together as one slice"* — a slice that consumes an unbuilt double does not).

### CORRECTION 2 — `src/domain/calidad.test.ts` is a real diff, not zero

**Conflict.** The design's File Changes table and the schema spec both state `src/domain/**` is
**Unchanged**, *"Zero diff — enforced as an acceptance criterion"*. That is true for domain
**source** and it remains the target. It is **false for one domain test file**:
`src/domain/calidad.test.ts:14` imports `InMemoryDanoRepository`, and `:267` and `:284` call
`repo.listarPorOrden(orden.id)` synchronously, passing the result straight into
`proyeccionSegundaDeOrden(orden, …)`. When `IDanoRepository.listarPorOrden` becomes
`Promise<Dano[]>` (slice D1), those two call sites become TypeScript errors.

**Resolution.** Phase 7 (D1) owns the two `await` additions. The correction is **two `await`
keywords in a test file** — no rule, invariant, message or signature of `src/domain/**` changes,
and `src/domain/*.ts` source keeps its exact zero diff. The acceptance criterion is therefore
restated precisely: **`src/domain/**` source files are byte-unchanged; `src/domain/calidad.test.ts`
gains exactly two `await` keywords, no other change.** Reporting this honestly matters more than
letting a `size:exception`-shaped surprise land mid-chain.

### CORRECTION 3 — slice A is split into A1 + A2

Slice A forecasts ≈ 530 changed lines, of which 240 are the byte-identical mirror. `chained-pr`'s
decision gate names migration diffs as a case that "cannot split cleanly", so the DDL and its
registration stay together in A1. The SQL-contract suite — which realises 12 approved schema
requirements and is itself a deliverable — becomes A2. **A1 carries no new test**; this is a
deliberate, stated deviation from "keep tests with code", taken because A1+A2 exceed 400, and A2
MUST chain immediately after A1 on the same logical review.

### CORRECTION 4 — B owns the parada-only App landing (3.1's Verify was false)

**Conflict.** Phase 3 task 3.1 originally asserted that converting the parada port to `Promise`
would leave `npx tsc --noEmit` green because the project has **no linter**
(`openspec/config.yaml`: `linter: none`), so *"no floating-promise rule applies"*. That reasoning
is false: the `tsc` failures are **type-assignability errors** (TS2345 / TS2740 / TS2339), not
floating-promise lint findings, and `linter: none` is irrelevant to them. `App.tsx` consumes the
parada port synchronously — `setParadas(paradaRepository.listarPorMaquina("M1"))` stores a
`Promise` in React state, so render throws (`input.paradas is not iterable`) and the app does not
boot. Task 3.1's Verify line as written therefore cannot be satisfied without either editing
`App.tsx` (then forbidden) or inventing a type that reshapes the return types (forbidden by
Requirement 1).

**Resolution.** The async port conversion NECESSARILY breaks its synchronous consumers, and those
consumers must compile before the unit can close. B therefore owns the **parada-only** await
landing: the awaits in `App.tsx` for parada consumption and the matching adjustments in
`App.test.tsx`. This is a correction of the plan, not a workaround — keeping `App.tsx` untouched
until G2 would produce a chain of temporarily-invalid slices. The domain itself stays synchronous:
`registrarDano`'s injected `obtenerParada` lookup is resolved in `App.tsx:411` from state already
held — `(id) => paradas.find(p => p.id === id)` — never a Promise inside a synchronous validation
function. Scope discipline: B lands **only** the parada awaits; actividades/danos/inspecciones/
mantenimiento consumptions each get their own landing in their own port-async unit (C1, D1, E1, F1),
and the full App/UI evolution remains G2.

### CORRECTION 5 — B's parada landing ripples into 2 UI prop declarations (found by applying CORRECTION 4)

**Conflict.** CORRECTION 4 assigned the parada landing to `App.tsx` + `App.test.tsx` and listed the
rollback boundary as *"5 files (3 store + App.tsx + App.test.tsx)"*. Awaiting the port makes
`handleRegistrarParada` / `handleCerrarParada` `async`, so their return type becomes
`Promise<string[]>` — and both are declared, re-declared and consumed as **synchronous**
`string[]` by two UI files. The compiler proved it after the `App.tsx` edits were already in place:

```
src/App.tsx(727,11): error TS2322: Type '(input: RegistrarParadaInput) => Promise<string[]>'
  is not assignable to type '(input: RegistrarParadaInput) => string[]'
src/ui/OrderInProduction.tsx(182,9): error TS2322: Type '(input: RegistrarParadaInput) => string[]'
  is not assignable to type '(input: RegistrarParadaInput) => Promise<string[]>'
```

The chain is `App.tsx:727-728` → `OrderInProductionProps` (`:53,:55`, pure pass-through to
`ParadasSection`) → `ParadasSectionProps` (`:21,:23`) → the two call sites
`ParadasSection.tsx:93` (`setErrores(res)`) and `:111` (`setErroresCierre(onCerrarParada())`).

**Resolution.** B also touches those **2 UI files**, and only the parada props: four type
declarations, `async` on the two local handlers, and two `await`s. This is not G2 work pulled
forward — it is the same forced-compile situation CORRECTION 4 already accepted, one level down,
and it is **not** the *"6 UI files await"* deliverable that G2 still owns. Crucially it is **not a
new pattern**: `ResumenTiempoSection.tsx:16,61` already ships exactly this shape
(`onCambiarFinJornada(fin: string): Promise<string[]>` + `setErrores(await …)`) for the jornada
handler, so the parada props now match the existing async-handler convention.

**Why the alternative was rejected.** Keeping the two handlers synchronous (fire-and-forget the
write + reload) would have held the file count at 5 and made `tsc` green, but it would leave a
floating promise and push the state reload past the handler's return — the UI assertions in
`App.test.tsx` would then race the reload. A green compiler bought with a race is a fake green.

**Scope discipline preserved.** No `await` was added for actividades / danos / inspecciones /
mantenimiento consumption, and `DanoSection` is untouched: `handleRegistrarDano` stays
**synchronous** because its injected lookup resolves from `paradas` state, so the daño UI keeps its
`string[]` contract. B's UI footprint is parada-only.

### CORRECTION 6 — C1 owns the actividades async landing (5.1's Verify was false, same contradiction as CORRECTION 4)

**Conflict.** Phase 5 tasks 5.1–5.3 converted the `actividad planificada` port to `Promise` and
listed a *"Revert 3 files"* rollback boundary (store files only). The compiler proved that the
premise — that the actividades App/UI landing could be deferred until G2 — was incorrect, exactly
as CORRECTION 4 proved for parada: awaiting the port makes its synchronous consumers fail
type-assignability, so a green port suite is not evidence the app boots. `npx tsc --noEmit` exited
2 with 9 errors, all outside the store: `App.tsx` (4, TS2345 — `Promise<ActividadPlanificada[]>`
into `setState`, `Promise<ActividadAbierta | null>` into `ActividadAbierta`) and `App.test.tsx`
(5, TS2339 — `operatorName`/`queSeLimpio`/`id` on `Promise<ActividadAbierta | null>`). The full
suite produced 110 failures with the single signature `input.actividades is not iterable` — the
mirror of CORRECTION 4's `input.paradas is not iterable`. The landed work is 7 files, not 3.

**Resolution.** C1 therefore owns the **actividades-only** await landing: the awaits in `App.tsx`
for actividades consumption, the matching `App.test.tsx` adjustments, and the async-handler
pass-through props (`ActividadesProps`, `OrderAvailableProps`, `OrderInProductionProps`,
`OrderFinishedProps` + `src/ui/ActividadesSection.tsx`). This follows the approved B precedent
(CORRECTION 4 + 5) and, like it, is a correction of the plan, not a workaround — the async port
port cannot be integrated while its direct consumers remain synchronous. The landing is
**C1-specific** (actividades pass-through only, no `await` for danos/inspecciones/mantenimiento)
and does **not** pull forward G2's full App/UI evolution. The domain stays synchronous. Rollback
boundary of C1 is updated to the real file list in the slice table.

### CORRECTION 7.5 — D1 owns the daño-only App/UI landing (7.1–7.4's Verify was false, same contradiction as CORRECTION 4 and 6)

**Conflict.** Phase 7 as first planned (tasks 7.1–7.4) converted the 6 `daño` port methods to `Promise`
and nothing else. The slice table gave the unit a **"Revert 3 files"** rollback boundary — store files
only — and a **≈ 75-line** forecast, with **no App/UI task at all**. That premise is false for the same
reason CORRECTION 4 proved for `parada` and CORRECTION 6 for `actividad planificada`: awaiting the port
makes its **synchronous** consumers fail type-assignability, so a green port suite is not evidence that
the app compiles or boots. `App.tsx` consumed the `daño` port synchronously at **six call sites across
three places** — the `setDanos(danoRepository.listarPorMaquina("M1"))` load effect,
`handleRegistrarDano` (the write plus its reload) and `handleCerrarDano` (the `getDanoAbierto` read, the
write, and its reload) — and `DanoSection.tsx` declared **and** consumed both handlers as synchronous
`string[]`. Task 7.1's own Verify (`npx tsc --noEmit`) was therefore not satisfiable inside the planned
3-file boundary, exactly as task 3.1's and task 5.1's were not. Keeping the port sync to hold the file
count at 3 was already rejected once, in CORRECTION 5: *"a green compiler bought with a race is a fake
green."*

**Resolution.** D1 therefore owns the **daño-only** await landing, recorded as task **7.5**. The real
boundary is **7 files, not 3**: the 3 store files (7.1–7.3), `src/domain/calidad.test.ts` (7.4 — the two
mandatory `await`s of CORRECTION 2), plus `src/App.tsx`, `src/ui/DanoSection.tsx` and `src/App.test.tsx`.
The landing is: the `danos` load effect becomes an async inner function carrying the `cancelled` guard
already used by `cargarJornada` and by C1's actividades effect, so a late `setDanos` cannot fire after
unmount; `handleRegistrarDano` / `handleCerrarDano` become `async … Promise<string[]>`;
`DanoSection`'s two prop types become `Promise<string[]>` with `await` at its two call sites; and every
`setDanos` receives a **resolved** `Dano[]`, never a `Promise`.

**Why two synchronous consumers could not keep reading the port, and why the domain stayed pure.** Both
were resolved from state the App already holds rather than by making the domain async.
`danoAbiertoDeMaquina` now calls the **existing pure domain function** `danoAbierto(danos, "M1")`
(`src/domain/danos.ts:253` — already exported, already covered by `src/domain/danos.test.ts:491-519`),
not the port. The reactive-maintenance link lookup resolves from `danos` state
(`danos.find((d) => d.id === id)`) instead of `danoRepository.obtenerPorId(id)`. Injecting the port
there would hand a `Promise` to `registrarMantenimiento`, a **synchronous** validation function — the
exact defect CORRECTION 4 forbids. The load-bearing assumption is recorded in the code itself: M1 is the
only machine (ADR 0003), so the loaded state covers the port. The 2da projection follows the same rule,
deriving from `danos.filter((d) => d.ordenId === orden.id)` instead of a port read.

**Scope discipline preserved.** `src/domain/**` production source is **byte-unchanged** — the only
domain diff in the whole unit is `calidad.test.ts`'s two `await` keywords plus the two `async` callback
signatures TypeScript requires. No `any` was introduced; no `Promise` reaches React state or a
synchronous prop; no `danoRepository.*` call site is left un-awaited; **zero assertions were deleted or
weakened** in any of the three touched suites. **No D2 work, no SQLite adapter, no `main.tsx`, no
`recovery.ts`, no migration, no other port, no `vitest.config.ts` and no other UI file was touched.** This
is the same forced-compile situation CORRECTION 4 and CORRECTION 6 already accepted, one domain along —
it is **not** G2's *"11 async handlers"* deliverable, and it does **not** pull forward G2's full App/UI
evolution. D1's real footprint is **7 files, +119 / −93 = 212 changed lines**, inside the 400 budget with
no `size:exception`.

### CORRECTION 8 — E1 owns the inspección-only App/UI landing (9.1's Verify was false, same contradiction as CORRECTION 4, 6 and 7.5)

**Conflict.** Phase 9 as enumerated (tasks 9.1–9.3) converts the 4 `inspección de tela` port methods to
`Promise` and enumerates **3 store files** at a **≈ 95-line** forecast, with **no App/UI task at all**. That
premise is false for the reason CORRECTION 4 proved for `parada`, CORRECTION 6 for `actividad planificada`
and CORRECTION 7.5 for `daño`: awaiting the port makes its **synchronous** consumers fail
type-assignability, so a green port suite is still not evidence that the app compiles or boots — and task
9.1's own Verify (`npx tsc --noEmit`) is unsatisfiable inside the planned 3-file boundary.

Note this is **not** a new discovery. Line 128 of this plan already declares that *"mantenimiento
consumptions each get their own landing in their own port-async unit (C1, D1, **E1**, F1)"*. Phase 9
simply failed to enumerate the landing its own dependency table promised, exactly as Phases 3, 5 and 7
did. This correction makes the plan say what it already decided.

`App.tsx` consumes the inspección port synchronously at **9 call sites across 4 places** — the
`setInspecciones(inspeccionRepository.listarPorOrden(orden.id))` load effect at `:233`, and then
`handleRegistrarInspeccion` (`:485` insert + `:486` reload), `handleDevolverInspeccion` (`:498`
`obtenerPorId` + `:510` update + `:511` reload) and `handleAutorizarInspeccion` (`:523` `obtenerPorId` +
`:534` update + `:535` reload). `InspeccionTelaSection.tsx` **declares and consumes all three** handlers
as synchronous `string[]` in **two** prop interfaces (`:68`/`:85` and `:72`/`:86`) with three un-awaited
call sites (`:117`, `:131`, `:329`).

**Resolution.** E1 therefore owns the **inspección-only** await landing, recorded as task **9.4**. The real
boundary is **6 files, not 3**: the 3 store files (9.1–9.3), `src/App.tsx`, and
`src/ui/InspeccionTelaSection.tsx`. The landing is: the `inspecciones` load effect becomes an async inner
function carrying the `cancelled` guard already used by `cargarParadas`, `cargarActividades` and `cargarDanos`,
so a late `setInspecciones` cannot fire after unmount; the three handlers become
`async … Promise<string[]>`; both `InspeccionProps` interfaces in `InspeccionTelaSection.tsx` declare
`Promise<string[]>`; and every `setInspecciones` receives a **resolved** `InspeccionTela[]`, never a
`Promise`.

A 6th file is therefore in scope: **`src/App.test.tsx`**, which calls `repoInspecciones.listarPorOrden(...)`
**directly at 5 sites** (`:1424`, `:1447`, `:1483`, `:1519`, `:1526`) to assert post-hoc results such as
`expect(lista[0].lote).toBe(...)`. Those calls must be `await`ed, or `tsc` fails with TS7053/TS7006
because a `Promise` gets indexed. The real boundary is **6 files, not 3**: the 3 store files
(9.1–9.3), `src/App.tsx`, `src/ui/InspeccionTelaSection.tsx` and `src/App.test.tsx`.

Those 5 edits are **type-level only** — the tests drive the UI, whose call sites now `await`, so no
behavioural `await`/`waitFor` was needed. That is verified, not assumed: 9.4's Verify runs `App.test.tsx`
and reports any test that genuinely needs an added `await` rather than presuming none does.

**Scope discipline preserved.** The `mantenimiento` handlers at `:540`/`:562` and the
`mantenimientoRepository` consumption at `:228`, `:556`, `:557`, `:563`, `:574`, `:575`, `:641` are
**sync and stay sync** — they land with F1, not here. `src/domain/**` production source stays
**byte-unchanged**. No `any`; no `Promise` reaches React state or a synchronous prop; no
`inspeccionRepository.*` call site is left un-awaited; **zero assertions deleted or weakened**. No E2
work, no SQLite adapter, no `main.tsx`, no `recovery.ts`, no migration, no other port, no
`vitest.config.ts`, no `DanoSection.tsx` and no other UI file is touched. This is the same forced-compile
situation CORRECTION 4, 6 and 7.5 already accepted, one domain along — it is **not** G2's *"11 async
handlers"* deliverable and does not pull forward G2's full App/UI evolution.

---

### CORRECTION 9 — F1 owns the mantenimiento-only App/UI landing (11.1's Verify was false, same contradiction as CORRECTION 4, 6, 7.5 and 8)

**Conflict.** Phase 11 as enumerated (tasks 11.1–11.3) converts the 5 `mantenimiento` port methods to
`Promise` and enumerates **3 store files** at a **≈ 70-line** forecast, with **no App/UI task at all**. That
premise is false for the reason CORRECTION 4 proved for `parada`, CORRECTION 6 for `actividad
planificada`, CORRECTION 7.5 for `daño` and CORRECTION 8 for `inspección de tela`: awaiting the port
makes its **synchronous** consumers fail type-assignability, so a green port suite is still not evidence
that the app compiles — and task 11.1's own Verify (`npx tsc --noEmit`) is unsatisfiable inside the
planned 3-file boundary. Line 128 of this plan already declares that the *"mantenimiento consumptions
each get their own landing in their own port-async unit (…**F1**)"*; Phase 11 simply failed to enumerate
the landing its own dependency table promised, the same omission every prior port unit made. This
correction makes the plan say what it already decided.

`App.tsx` consumes the mantenimiento port synchronously at: the `setMantenimientos(
mantenimientoRepository.listarPorMaquina("M1"))` load effect at `:228`; `handleRegistrarMantenimiento`
(`:565` insert + `:573` reload); `handleCerrarMantenimiento` (`:587` `getMantenimientoAbierto` + `:598`
update + `:601` reload); and the render-body `getMantenimientoAbierto("M1")` at `:663`, which must become
a derived read from resolved state (`mantenimientoAbierto(mantenimientos, "M1")`), the same shape
`danoAbierto(danos, "M1")` already uses. `MantenimientoSection.tsx` **declares both handlers as
synchronous `string[]`** (`:23`/`:24`) with two un-awaited call sites (`:119`, `:136`).

**Resolution.** F1 therefore owns the **mantenimiento-only** await landing. The real boundary is **6
files, not 3**: the 3 store files (11.1–11.3), `src/App.tsx`, `src/ui/MantenimientoSection.tsx` and
`src/App.test.tsx`. The landing is: the load effect becomes an async inner function carrying the
`cancelled` guard already used by the other loaders, so a late `setMantenimientos` cannot fire after
unmount; the two handlers become `async … Promise<string[]>`; `MantenimientoSectionProps` declares both
handlers as `Promise<string[]>` and the two call sites `await` them exactly as `DanoSection.tsx` does;
and every `setMantenimientos` receives a **resolved** `Mantenimiento[]`, never a `Promise`.

`App.test.tsx` calls the repo directly at 5 sites (all `await`ed) and drives the close flow with
`fireEvent.click` under fake timers. Two close tests (and the two register steps inside them) needed the
existing `await act(async () => { fireEvent.click(...) })` choreography (the same one the file already
uses around `handleIniciar`) so the DOM asserts after the async handler resolves; this is a **forced
choreography adaptation**, not a test weakening — zero assertions deleted or altered, test count
unchanged (103).

**Scope discipline preserved.** No other port, no `Order*` component (they receive the section props by
extension and needed no edit), no domain file, no SQLite adapter, no migration, no `vitest.config.ts`.
`src/domain/**` production source stays **byte-unchanged**. No `any`; no `Promise` reaches React state or
a synchronous prop; zero assertions weakened. Same forced-compile situation CORRECTION 4, 6, 7.5 and 8
already accepted, one domain along — and **not** G2's full App/UI evolution.

---

## Verification strategy — what each layer can and cannot prove

| Layer | Command | Proves | Does NOT prove |
|-------|---------|--------|----------------|
| Rust shell | `cargo check` in `src-tauri` | 004 is valid SQL as far as sqlx/migration registration is concerned | That the plugin applies it at runtime |
| Frontend types | `npx tsc --noEmit` | 26 async methods, 6 UI files, zero `Promise` reaching a React child | Anything about behaviour |
| Frontend tests | `npm run test` (Vitest 5) | Port contracts, mapper round trips, statement shapes, recovery, startup, restart survival, Approach A | Real SQLite engine semantics |
| Runtime probe | `getForeignKeys()` on the real Tauri binary (`database.ts:136-140`) | Whether `PRAGMA foreign_keys` is enforced on the connection actually used | — |

**R5 / R6 remain OPEN and are NOT converted into acceptance criteria.** Per D2d, no workaround is
added, `src/store/sqlite/database.ts` is **unchanged**, and the fake store's FK behaviour is a
*model* of the declared schema, never proof of enforcement. Every new suite header carries the
project's honesty note. Specifically:

- **Blocking acceptance criteria** are only those a fake store can honestly establish: the adapter
  emits the declared statements, binds the dangling link verbatim, performs no lookup, and
  propagates failures with `cause`.
- **Non-blocking, explicit runtime step (part of Phase 14):** on the real Tauri binary, run
  `getForeignKeys()` and confirm 004 was applied (checksum recorded, DDL executed). Record the
  result; a failure here opens R5/R6 rather than failing the change, exactly as for 001–003.

The A1/A1b/A2 triple (Phase 14) is a **contract** test proving the *domain pre-check* still fires.
It proves the domain guard, not the FK. That distinction is the whole point of D2b and must survive
into the code comments and the test names.

---

## Slicing rule: no duplicated responsibility

Exactly one owner per concern. Reference table for the whole plan:

| Concern | Owner phase | Never touched by |
|---------|-------------|------------------|
| 004 DDL + registration | 1 (A1) | any other |
| 004 SQL contract assertions | 2 (A2) | any other |
| Port async signature (one per file) | 3, 5, 7, 9, 11 | 13, 14 |
| In-memory async adaptation (one per file) | 3, 5, 7, 9, 11 | any other |
| Port contract suite awaits (one per file) | 3, 5, 7, 9, 11 | 14 |
| **Domain-only App/UI landing forced by the async port** (load effect, handlers, section props, Approach A read) | 3 (parada), 5 (actividades), **7 (daño)** — see CORRECTION 4, 6, 7.5 | 13, 14 |
| Shared FK fake store | 4 (S) | any other — consumers only |
| SQLite adapter (one per file) | 6, 8, 10, 12 | any other |
| SQLite adapter suite (one per file) | 6, 8, 10, 12 | 14 |
| Recovery composition + rename | 13 (G1) | 14 |
| Startup composition | 13 (G1) | 14 |
| App state / loaders / handlers / Approach A | 14 (G2) — **minus the daño loader, handlers and Approach A lookup, already owned by 7 (D1)** | 13 |
| UI callback evolution (one per file) | 14 (G2) — **minus `src/ui/DanoSection.tsx`, already owned by 7 (D1)** | any other |
| Restart survival + A1/A1b/A2 | 14 (G2) | 13 |

Phases **9 (E1)** and **11 (F1)** are still listed as port-only above. The same contradiction CORRECTION 4
proved for `parada`, CORRECTION 6 for `actividad planificada` and CORRECTION 7.5 for `daño` applies to any
port with a synchronous consumer, so each of those units is expected to need its own domain-only landing
row (and its own `CORRECTION` block) when it runs. That is a projection, not a pre-approval of scope.

---

## Phase 1 / Unit A1 — Migration 004 DDL and registration

**Objective.** Make the durable shape of the five operational domains exist: 5 tables, 59 columns,
5 foreign keys, 11 indexes, registered canonically in Rust and mirrored byte-identically for the
frontend.
**Depends on.** Nothing. First in the chain.
**Design decisions.** D1 (`machine_id` / `operario` columns, translation happens in the mappers),
D2d (`database.ts` untouched), D3 (no adapter filenames in this phase).
**Estimated changed lines.** ≈ 255 — **within budget**.
**Capability.** `operational-events-schema`.

- [x] 1.1 Create `src-tauri/migrations/004_operational_events.sql` (new, canonical). Exactly 5 `CREATE TABLE IF NOT EXISTS` statements — `parada` (9 cols), `actividad_planificada` (8), `dano` (14), `inspeccion_tela` (18), `mantenimiento` (10) = 59 columns. Exactly 5 FKs: `parada.orden_id → orden(id)`, `dano.orden_id → orden(id)`, `dano.parada_id → parada(id)`, `inspeccion_tela.orden_id → orden(id)` (NOT NULL), `mantenimiento.dano_id → dano(id)`. Exactly 11 `CREATE INDEX IF NOT EXISTS` statements — the four `(machine_id, inicio)`, the four open-record indexes carrying `WHERE fin IS NULL`, `idx_parada_orden`, `idx_dano_orden`, `idx_inspeccion_orden (orden_id, timestamp)`. No `CHECK`, no `DEFAULT`, no sixth table, no speculative index. Column names and nullability exactly as `operational-events-schema/spec.md:63-116`. **Acceptance:** the file contains no `CHECK` or `DEFAULT` token; `orden_id` is absent from `actividad_planificada` and `mantenimiento`; the two D1 columns are `machine_id` and `operario` (NOT `maquina_id`, NOT `operator_name`). **Tests:** none in this unit (see CORRECTION 3). **Out of scope:** 001/002/003, the mirror, the Rust registration, any `Down` migration, any derived column. **Verify:** `cargo check` in `src-tauri`; read `src-tauri/migrations/001_initial_schema.sql` (read-only) to confirm the referenced `orden` table name.

- [x] 1.2 Create `src/store/sqlite/migrations/004_operational_events.sql` as a **byte-identical** mirror of 1.1. **Acceptance:** `cmp src-tauri/migrations/004_operational_events.sql src/store/sqlite/migrations/004_operational_events.sql` exits 0. **Out of scope:** any formatting divergence, any comment that exists in only one copy. **Verify:** `cmp` as above; compare against `src/store/sqlite/migrations/003_d1_orden_persistence.sql` (read-only) for the mirror convention.

- [x] 1.3 Modify `src/store/sqlite/migrations/index.ts`: `CURRENT_MIGRATION_VERSION` 3 → 4; `TABLES` gains `PARADA: "parada"`, `ACTIVIDAD_PLANIFICADA: "actividad_planificada"`, `DANO: "dano"`, `INSPECCION_TELA: "inspeccion_tela"`, `MANTENIMIENTO: "mantenimiento"` (8 entries). **Acceptance:** `Object.values(TABLES)` has 8 entries; `verifySchema()` is unchanged and therefore reports existence for all 8 after migration. **Out of scope:** `tableExists`, `getTableNames`, `verifySchema` bodies, the module doc comment's Phase 1 framing beyond what the version bump forces. **Verify:** `npx tsc --noEmit`; `npm run test` still green.

- [x] 1.4 Modify `src-tauri/src/lib.rs`: append `Migration { version: 4, description: "operational_events", sql: include_str!("../migrations/004_operational_events.sql"), kind: MigrationKind::Up }` to the `migrations` vec. **Acceptance:** versions 1, 2 and 3 are byte-identical to their current form; all four entries are `MigrationKind::Up`; no `Down` is registered. **Out of scope:** the `greet` command, the builder chain, `Cargo.toml`. **Verify:** `cargo check` in `src-tauri`; read `docs/adr/0003-single-machine-scope.md` (read-only) for the single-machine premise the `machine_id` column serves.

- [x] 1.5 Confirm the immutability precondition: read `src-tauri/migrations/001_initial_schema.sql`, `002_lectura_orden_sequence_unique.sql`, `003_d1_orden_persistence.sql` and their three `src/store/sqlite/migrations/` counterparts (all read-only). **Acceptance:** `git status` shows no modification to any of the six files; 004 is the only migration added. **Out of scope:** any edit to an applied migration — sqlx fails startup with `VersionMismatch`. **Verify:** `git diff --stat -- src-tauri/migrations/001* src-tauri/migrations/002* src-tauri/migrations/003* src/store/sqlite/migrations/001* src/store/sqlite/migrations/002* src/store/sqlite/migrations/003*` returns empty.

---

## Phase 2 / Unit A2 — Migration 004 SQL contract suite

**Objective.** Machine-enforce the 12 approved `operational-events-schema` requirements so a
later column addition, index addition or vocabulary drift fails the build instead of a review.
**Depends on.** Phase 1.
**Design decisions.** D1 (column vocabulary is asserted by name), D2d (honesty note: this suite
does **not** execute the real migration).
**Estimated changed lines.** ≈ 300 — **within budget**.
**Capability.** `operational-events-schema`.

- [x] 2.1 Create `src/store/sqlite/__tests__/migration004.test.ts`, modelled structurally on `src/store/sqlite/__tests__/migration003.test.ts` (read-only, 569 lines). **Suite header must state** that the suite asserts the SQL *contract* and does not run the real Tauri migration. **Acceptance:** the suite parses the SQL text of the canonical and mirror files directly (as `migration003.test.ts` does), asserting: exactly 5 `CREATE TABLE`; exactly 59 columns with the exact enumerated names and nullability; exactly 5 FKs with the correct targets; exactly 11 indexes with the 4 partial predicates; no `CHECK`; no `DEFAULT`; canonical ≡ mirror byte for byte. **Tests required:** one assertion per enumerated requirement — (a) 5 tables / 59 columns; (b) the five exact column sets; (c) no `CHECK` / no `DEFAULT`; (d) nullability per `spec.md:95-116`; (e) `orden_id` absent on `actividad_planificada` and `mantenimiento`, NOT NULL on `inspeccion_tela`; (f) the 5 FKs; (g) exactly 11 indexes, 4 partial; (h) **no speculative index** on `dano.parada_id`, `dano.orden_id` alone, `mantenimiento.dano_id`, `actividad_planificada.tipo` alone; (i) `campos_especificos` is one `TEXT NOT NULL` column with no per-cause column; (j) the two flags are `INTEGER NOT NULL` with no CHECK tying them; (k) the five checklist columns are NOT NULL and `con_anomalia` / `estado_inspeccion` do not exist; (l) the resolution column set is complete including `registrada_por`, `resolucion_timestamp`, `autorizacion_observaciones`. **Out of scope:** executing DDL, any adapter, any repository. **Verify:** `npx vitest run src/store/sqlite/__tests__/migration004.test.ts`.

- [x] 2.2 Add the derived-column absence assertion, by name. **Acceptance:** the suite asserts that none of `tiempo_productivo`, `duracion`, `duracion_segundos`, `porcentaje_2da_proyectado`, `alerta_2da`, `buena_racha`, `con_anomalia`, `estado_inspeccion`, `estado_maquina`, `delta_golpes`, `progreso` exists as a column of the five tables, so a derived column added later **fails the suite**. **Out of scope:** the in-memory derived behaviour; reading `docs/adr/0004-productive-time-derived.md` and `docs/adr/0007-maintenance-documentary-no-time-deduction.md` (read-only) for the rules these names come from. **Verify:** as 2.1.

---

## Phase 3 / Unit B — `parada` port and in-memory adapter go async

**Objective.** Establish the async port pattern on the reference domain before any adapter layers on
top of it, proving the in-memory adapter keeps identical observable behaviour.
**Depends on.** Phase 1 (A1) — the port must describe what 004 stores.
**Design decisions.** Ports/contracts spec Requirement 1; D2j (message vocabulary preserved
verbatim: duplicate `ya existe una parada con el id <id>`, unknown `no existe una parada con el
id <id>`).
**Estimated changed lines.** ≈ 85 — **within budget**.
**Capability.** `operational-repository-contracts`.

- [x] 3.1 Modify `src/store/paradasRepository.ts`: all **6** methods return `Promise` — `insertParada` / `updateParada` `Promise<void>`, `obtenerPorId` `Promise<Parada | undefined>`, `listarPorMaquina` / `listarPorOrden` `Promise<Parada[]>`, `getParadaAbierta(maquinaId, ordenId: string | null)` `Promise<ParadaAbierta | null>`. Update the module doc comment, whose *"los métodos son síncronos"* note becomes false. **Acceptance:** method names, parameters and resolved value types are unchanged; `obtenerPorId` resolves `undefined` (never `null`); `getParadaAbierta` keeps `ordenId: string | null` as its second parameter. **Out of scope:** adding or removing a method, `listarPorMaquina` on the inspection port, any domain import. **Verify:** `npx tsc --noEmit` — see CORRECTION 4: the port change breaks assignability in its synchronous consumers, so this unit also owns the parada-only App landing (task 3.4). `tsc` is green only after 3.4 lands; the floating-promise claim of the original text was false.

- [x] 3.2 Modify `src/store/inMemoryParadasRepository.ts`: wrap all 6 bodies in `async` / `Promise.resolve()`, **identical** messages and semantics — explicit insert vs update, duplicate-id rejection, unknown-id rejection, defensive clone on read **and** write, chronological ordering by `inicio`, `listarPorOrden` excluding `ordenId: null`. **Acceptance:** not one error message changes character; the defensive clone still runs in both directions. **Out of scope:** any validation addition (this is a pure storage boundary), any business rule. **Verify:** `npx vitest run src/store/paradasRepository.test.ts`.

- [x] 3.3 Modify `src/store/paradasRepository.test.ts` (155 lines): `await` every port call. **Acceptance:** **no assertion is deleted or weakened** to make the async change pass — duplicate-id rejection, unknown-id rejection, defensive cloning in both directions, chronological ordering, per-order exclusion of `null`, and the open-record queries all remain asserted. **Out of scope:** adding new behaviour assertions (a port contract change is not a behaviour change), rewriting the file. **Verify:** `npx vitest run src/store/paradasRepository.test.ts` + `npm run test` (no regression elsewhere).

- [x] 3.4 Modify `src/App.tsx` and `src/App.test.tsx` — the **parada-only** await landing (see CORRECTION 4). `App.tsx`: `await` every parada port consumption — `:180` `setParadas(await paradaRepository.listarPorMaquina("M1"))`, `:336` after `await paradaRepository.insertParada(...)`, `:349`/`:357` around `cerrarParada` + `updateParada` + reload, and `:411` `registrarDano(danos, input, (id) => paradas.find(p => p.id === id))` — the injected lookup resolves from state already held, keeping the domain synchronous; never pass a Promise into a synchronous validation function. `App.test.tsx`: adjust the 3 parada call sites (`:340`, `:407`, `:408`) the same way. **Acceptance:** `npx tsc --noEmit` exit 0 — every TS2345/TS2740/TS2339 from the parada conversion gone; `src/domain/**` byte-unchanged; **no** `await` added for actividades/danos/inspecciones/mantenimiento consumption — those land with C1/D1/E1/F1 in their own units. **Out of scope:** all other port landings, App/UI evolution beyond parada, Approach A work, any handler refactor. **Verify:** `npx tsc --noEmit` + `npm run test` (green; known worker-start flakes reported separately, TS errors are NOT environmental).

---

## Phase 4 / Unit S — shared FK-capable fake store (D2b)

**Objective.** Build the one store double the five adapter suites and the restart-survival suite
consume, enforcing the five declared foreign keys for real, so the R2 regression guard cannot pass
vacuously.
**Depends on.** Phase 3.
**Design decisions.** **D2b in full** — the anti-vacuity contract. **D2d** — the double *models*
SQLite, it does not execute it; the honesty note is mandatory.
**Estimated changed lines.** ≈ 250 — **within budget**.
**Capability.** `operational-repository-contracts` (serves the R2 guard of `operational-recovery-wiring`).
**Placement.** See CORRECTION 1 — this unit exists before the adapter suites, not inside slice G.

- [x] 4.1 Create `src/store/sqlite/__tests__/fakeSqliteStore.ts` exporting `FakeSqliteStoreOptions { foreignKeys: boolean }` and `createFakeSqliteStore(options?)` returning `Database & { row accessors }`. Tables as row arrays keyed by `id`: `parada`, `actividad_planificada`, `dano`, `inspeccion_tela`, `mantenimiento`, **plus `orden`** so FK targets can be primed. **Acceptance:** `foreignKeys: true` is the default; there is no FK-off mode, no toggle and no second truth. **Out of scope:** becoming a SQL engine, modelling CHECK constraints, modelling DEFAULTs. **Verify:** `npx vitest run src/store/sqlite/__tests__/fakeSqliteStore.test.ts`.

- [x] 4.2 Implement **shape matching** with a loud failure on drift. `execute(query, binds)` / `select(query, binds)` dispatch on substrings of the exact statements the adapters emit, following `src/store/sqlite/__tests__/sqliteOrderRepository.test.ts` (read-only). Any unmodelled statement throws `execute: unsupported query in mock: <query>`. **Acceptance:** an adapter that drifts from its declared statement shape fails loudly instead of silently no-op'ing — that throw is part of the anti-vacuity contract. **Out of scope:** regex-guessing arbitrary SQL. **Verify:** 4.1's suite asserts the throw for an unknown statement.

- [x] 4.3 Implement the **five foreign keys** before applying any `INSERT` or `UPDATE` that writes a link column: `parada.orden_id → orden.id`, `dano.orden_id → orden.id`, `dano.parada_id → parada.id`, `inspeccion_tela.orden_id → orden.id`, `mantenimiento.dano_id → dano.id`. An unresolvable link rejects with a message containing `FOREIGN KEY constraint failed` whose `cause` is a synthetic `SqliteFkError` naming table, column and value. A `null` link is always accepted. **Acceptance:** this is the A1 control — see Phase 14 for why a fake that rejects nothing, or everything, is useless. **Out of scope:** any per-connection `PRAGMA` simulation (D2d declines it). **Verify:** 4.1's suite covers each of the 5 pairs plus the `null`-accepted case.

- [x] 4.4 Implement **ordering owned by the repository** and **`LIMIT 1` honoured literally**: `ORDER BY inicio ASC` / `ORDER BY timestamp ASC` sorted by the fake from the row's own value (never from insertion order), and `LIMIT 1` returns exactly one row. **Acceptance:** inserting rows out of order makes *"the repository owns the ordering"* a real assertion rather than an accident. **Out of scope:** sorting the results inside the adapters. **Verify:** 4.1's suite inserts out of order and asserts the returned order.

- [x] 4.5 Create `src/store/sqlite/__tests__/fakeSqliteStore.test.ts` (new): the double's own suite. **Acceptance:** covers the unsupported-statement throw, each of the 5 FK rejections with the `cause`, the `null`-link acceptance, ordering from the row value, `LIMIT 1`, and a pre-check `SELECT id FROM t WHERE id = $1` answered from the array. The suite header carries the honesty note. **Out of scope:** re-testing any adapter (each adapter suite does that in Phases 6, 8, 10, 12). **Verify:** `npx vitest run src/store/sqlite/__tests__/fakeSqliteStore.test.ts`.

---

## Phase 5 / Unit C1 — `actividad planificada` port and in-memory adapter go async

**Objective.** Make the 5 `actividad planificada` port methods async with identical in-memory
behaviour, one step ahead of its adapter, and land the **actividades-only** App/UI await
adjustments (see CORRECTION 6) so the direct synchronous consumers of the port compile and render
again.
**Depends on.** Phase 4.
**Design decisions.** Requirement 1 (5 methods); D2j (message vocabulary preserved); ADR 0005
(`docs/adr/0005-planned-activities-vs-paradas.md`, read-only) — a planned activity is **not** a
parada and has **no** `ordenId` by design. CORRECTION 6: the actividades landing belongs to C1,
following the approved B precedent (CORRECTION 4 + 5); it is actividades-only and does not pull
forward G2; the domain stays synchronous.
**Estimated changed lines.** ≈ 70 store-only; ≈ 283 with the CORRECTION 6 landing — **within
budget**.
**Capability.** `operational-repository-contracts`.

- [x] 5.1 Modify `src/store/actividadesRepository.ts`: all **5** methods return `Promise`; doc comment updated. **Acceptance:** `getActividadAbierta(maquinaId, tipo: TipoActividadPlanificada)` keeps its `tipo` parameter; `obtenerPorId` resolves `undefined`; no method added or removed. **Out of scope:** a `listarPorOrden` method — this domain has **no** `orden_id` column, so the port has no such query. **Verify:** `npx tsc --noEmit` — see CORRECTION 6: the port change breaks assignability in its synchronous consumers, so this unit also owns the actividades-only App landing (task 5.4). `tsc` is green only after 5.4 lands.

- [x] 5.2 Modify `src/store/inMemoryActividadesRepository.ts`: `async` bodies, identical messages and semantics, `queSeLimpio` optionality untouched, one-open-activity-per-machine-and-type remains a **domain** rule the adapter does not enforce. **Acceptance:** no validation added. **Verify:** `npx vitest run src/store/actividadesRepository.test.ts`.

- [x] 5.3 Modify `src/store/actividadesRepository.test.ts` (149 lines): `await` every call, **zero assertions deleted or weakened**. **Verify:** `npx vitest run src/store/actividadesRepository.test.ts` + `npm run test`.

- [x] 5.4 Modify `src/App.tsx`, `src/App.test.tsx` and the actividades UI pass-through — the **actividades-only** await landing (see CORRECTION 6). `App.tsx`: `await` every actividades port consumption before it reaches React state — `setActividades(await actividadRepository.listarPorMaquina("M1"))` on mount and reload, `await insertActividad` before re-reading, `await updateActividad` before re-reading, and `getActividadAbierta` results resolved before touching `ActividadAbierta` state; never store a `Promise` in React state, never pass one into a synchronous validation function. UI pass-through: the props whose handler return types become `Promise<string[]>` / `Promise<ActividadAbierta | null>` (e.g. `ActividadesProps`, and any `Order*Props` that receive the same async handlers) and the consumers that call them (`src/ui/ActividadesSection.tsx` and the affected order components without parada daño-landing side effects) get matching async types and `await`s. **Acceptance:** `npx tsc --noEmit` exit 0 — every TS2345/TS2740/TS2339 from the actividades conversion gone; `src/domain/**` byte-unchanged; **no** `await` added for danos/inspecciones/mantenimiento consumption — those land with D1/E1/F1 in their own units. **Out of scope:** all other port landings, App/UI evolution beyond actividades, Approach A work, any handler refactor beyond the type/await choreography. **Verify:** `npx tsc --noEmit` + `npm run test` (green; known worker-start flakes reported separately, TS errors are NOT environmental).

---

## Phase 6 / Unit C2 — `sqliteActividadPlanificadaRepository` and its suite

**Objective.** Deliver the first SQLite operational adapter, which sets the shape the other three
copy: exported `Row`, exported pure `mapXRow` / `mapXToSql`, a class holding `private db: Database`.
**Depends on.** Phases 4 and 5.
**Design decisions.** **D3** (`sqliteActividadPlanificadaRepository.ts` / `SqliteActividadPlanificadaRepository`,
matching the port interface name-for-name and the singular Phase 1 precedent). **D1** (`machine_id`
/ `operario` in `Row`, `maquinaId` / `operatorName` in the domain object — the translation is the
mapper's whole job). **D2j** (pre-check `SELECT id …` then one explicit `INSERT` / `UPDATE`; no
upsert, no `INSERT OR REPLACE`, no `rowsAffected` branch). **D2d** (honesty note in the header).
**Estimated changed lines.** ≈ 410 — **AT OR OVER BUDGET. Requires `size:exception` or a further
split decision before apply.**
**Capability.** `operational-repository-contracts`.

- [x] 6.1 Create `src/store/sqlite/sqliteActividadPlanificadaRepository.ts`. `ActividadPlanificadaRow` (8 columns), `ActividadPlanificadaSqlValues`, pure `mapActividadPlanificadaRow` / `mapActividadPlanificadaToSql`, `class SqliteActividadPlanificadaRepository implements IActividadPlanificadaRepository { constructor(private db: Database) {} }`. `$1`-style placeholders, no `BEGIN`/`COMMIT`, one statement per write, errors wrapped as `no se pudo persistir la <entidad> "<id>"` **preserving the original as `cause`**. The module header states the repository does **not** validate business rules. **Acceptance:** mappers are pure — no I/O, no clock, no randomness, no `Database`; a round trip is unit-testable with no connection in scope; there is **no** `orden_id` column and the mapper never produces an order link. **Out of scope:** any `listarPorOrden`, any business validation, any transaction attempt (tauri-plugin-sql exposes none). **Verify:** `npx tsc --noEmit`.

- [x] 6.2 Implement the prescribed statement shapes exactly: `obtenerPorId` `SELECT * FROM actividad_planificada WHERE id = $1` → `rows[0]` → `mapXRow`, else `undefined`; `listarPorMaquina` `… WHERE machine_id = $1 ORDER BY inicio ASC`; `getActividadAbierta` `… WHERE machine_id = $1 AND tipo = $2 AND fin IS NULL ORDER BY inicio ASC LIMIT 1`; `insertActividad` pre-check then `INSERT`; `updateActividad` pre-check then `UPDATE` setting **all non-PK columns** (004 has no `created_at`/`updated_at`, so `id` never appears in a `SET` list). **Acceptance:** duplicate insert rejects with the in-memory message verbatim; unknown-id update rejects with the in-memory message verbatim; the pre-check uses `select`, already proven by Phase 1. **Out of scope:** branch-on-`rowsAffected` (semantics across the plugin are unverified — R6). **Verify:** `npx vitest run src/store/sqlite/__tests__/sqliteActividadPlanificadaRepository.test.ts`.

- [x] 6.3 Create `src/store/sqlite/__tests__/sqliteActividadPlanificadaRepository.test.ts` over the shared double from Phase 4. **Acceptance:** covers the mapper round trip with no `Database` in scope; insert-then-read; duplicate insert rejected with the record unchanged; unknown-id update rejected creating nothing; chronological ordering owned by the adapter (rows inserted out of order); the open-record query returning the `ActividadAbierta` alias or `null`; descriptive error propagation with `cause`; the update-in-place case with no extra row. Suite header carries the honesty note. **Out of scope:** per-order filtering (this domain has no order link), JSON handling (that is `parada`, Phase 14's concern is `App`; the JSON assertions belong to the parada adapter in Phase 3's lineage). **Verify:** as 6.2.

---

## Phase 7 / Unit D1 — `daño` port and in-memory adapter go async

**Objective.** Make the 6 `daño` port methods async with identical in-memory behaviour.
**Depends on.** Phase 6.
**Design decisions.** Requirement 1 (6 methods). **CORRECTION 2 applies here**: this phase also
owns the two `await` keywords in `src/domain/calidad.test.ts`, because that file consumes
`InMemoryDanoRepository` synchronously.
**Estimated changed lines.** ≈ 75 (7.1–7.4) + ≈ 80–100 landing (7.5, CORRECTION 7.5) = **≈ 155–175 — within budget (≤ 400)**.
**Measured (post-apply).** 7 files, +119 / −93 = 212 changed lines — see CORRECTION 7.5 and apply-progress.md.
**Capability.** `operational-repository-contracts`.

- [x] 7.1 Modify `src/store/danosRepository.ts`: all **6** methods return `Promise`; doc comment updated; the existing note that **linked-entity existence is a domain rule supplied through an injected lookup** is preserved verbatim. **Acceptance:** `obtenerPorId` resolves `undefined`; `getDanoAbierto(maquinaId)` takes one parameter; no method added. **Out of scope:** making the injected lookup async — that is the rejected alternative (it would put I/O in the pure domain). **Verify:** `npx tsc --noEmit`.

- [x] 7.2 Modify `src/store/inMemoryDanosRepository.ts`: `async` bodies, identical messages and semantics, defensive clone both directions, chronological ordering, `listarPorOrden` excluding `null`. **Acceptance:** the `causoParada` ↔ `paradaId` coupling and the `posibleSegunda` ↔ `unidadesSospechadas` coupling remain **domain** rules the adapter does not re-check. **Verify:** `npx vitest run src/store/danosRepository.test.ts`.

- [x] 7.3 Modify `src/store/danosRepository.test.ts` (176 lines): `await` every call, **zero assertions deleted or weakened**. **Verify:** as 7.2.

- [x] 7.4 Add exactly two `await` keywords in `src/domain/calidad.test.ts` — at the `repo.listarPorOrden(orden.id)` call sites (`:267` and `:284`) — so `proyeccionSegundaDeOrden` still receives a `Dano[]`. **Acceptance (CORRECTION 2, restated precisely):** `src/domain/**` **source** files are byte-unchanged — this is the enforced zero-diff criterion; `src/domain/calidad.test.ts` gains exactly **two** new `await` keywords, and the **two** corresponding `it` callbacks necessarily become `async` so TypeScript compiles — **no other change**: no test case and no assertion is added, removed or altered, and the same test count and `expect` count stand before and after; no ticket 02–08 rule, invariant, message or signature is altered. **Out of scope:** touching `src/domain/danos.test.ts` (520 lines) and `src/domain/mantenimiento.test.ts` (636 lines) — both are read-only here and must keep passing **unchanged**, which is itself an acceptance criterion of the Approach A design. **Verify:** `npx vitest run src/domain/calidad.test.ts src/domain/danos.test.ts src/domain/mantenimiento.test.ts`; `git diff --stat -- src/domain/` shows only `calidad.test.ts`, and only the two `await` additions plus their two mandatory `async` callbacks.

- [x] 7.5 (CORRECTION 7.5) App/UI functional daño landing — modify src/App.tsx, src/ui/DanoSection.tsx, src/App.test.tsx so 7.1–7.4 leave the project compiling. **Acceptance:** `tsc --noEmit` exit 0; `src/App.test.tsx` passes adapted (zero assertions relaxed); `setDanos` only after `await`; no `any`; no Promise in React state; `git diff --stat -- src/domain/` unchanged from 7.4. **Verify:** `npx tsc --noEmit`; `npx vitest run src/App.test.tsx`; full suite (serial `--pool=threads --maxWorkers=1`; `--isolate=false` where needed).

---

## Phase 8 / Unit D2 — `sqliteDanoRepository` and its suite

**Objective.** Deliver the `daño` adapter: 14 columns, two independent 0/1 flags, two foreign keys,
and the `unidadesSospechadas` NULL → `undefined` round trip.
**Depends on.** Phases 4 and 7.
**Design decisions.** **D3** (`sqliteDanoRepository.ts` / `SqliteDanoRepository`). **D1** (`machine_id`,
`operario`). **D2j** (pre-check + explicit statement). **D2b** — this adapter is the one that
persists a dangling `parada_id` **verbatim** with no lookup of its own, which is what makes the
Phase 14 A1 control meaningful. **D2d** (honesty note).
**Estimated changed lines.** ≈ 520 — **OVER BUDGET. `size:exception` APPROVED in-session by the
maintainer, on the explicit condition that D2 is delivered whole and not re-sliced to fit a number.**
**Measured (post-apply).** 2 files, +1198 / −0 = 1198 changed lines (400 adapter + 798 suite) — see
apply-progress.md. This is **298 lines above the ≈900 the maintainer estimated**, and the reason is
structural, not padding: `dano` is the widest table of the unit (14 columns, 6 port methods, 2
nullable foreign keys, 2 independent flags), and the C2 documentation discipline scales with that
surface. A conforming `dano` adapter cannot be written in 900 lines without dropping a required
decision note, the D2b white-box assertion, or an acceptance case.
**Capability.** `operational-repository-contracts`.

- [x] 8.1 Create `src/store/sqlite/sqliteDanoRepository.ts`. 14-column `DanoRow`, `DanoSqlValues`, pure `mapDanoRow` / `mapDanoToSql`, `class SqliteDanoRepository implements IDanoRepository { constructor(private db: Database) {} }`. Flag encoding: write `causo_parada = causoParada ? 1 : 0`, read `=== 1` — the exact convention of `aplica_segunda` in `src/store/sqlite/sqliteOrderRepository.ts` (read-only). **Acceptance:** the two flags are encoded and decoded **independently**; no `CHECK`, no code path or comment ties `causo_parada`, `posible_segunda`, `parada_id` or `unidades_sospechadas` together — that coupling is a domain rule. The header states the adapter does not validate linked-entity existence. **Out of scope:** any attempt to make the FK behave like a domain rule. **Verify:** `npx tsc --noEmit`.

- [x] 8.2 Implement the prescribed statements: `obtenerPorId`; `listarPorMaquina` `WHERE machine_id = $1 ORDER BY inicio ASC`; `listarPorOrden` `WHERE orden_id = $1 ORDER BY inicio ASC` (plain `= $1` is correct **and** already excludes `null` links by three-valued logic — adding `IS NOT NULL` would be noise); `getDanoAbierto` `WHERE machine_id = $1 AND fin IS NULL ORDER BY inicio ASC LIMIT 1`; `insertDano` / `updateDano` with the pre-check. **Acceptance:** `orden_id` reads back as `null` (the domain type is `string | null`, not optional); `solucion_aplicada` and `observaciones` read back `?? undefined`, never `""` and never `0`; `unidades_sospechadas` reads back `?? undefined`, so the invariant *"without `posibleSegunda`, `unidadesSospechadas` is undefined"* survives the round trip. **Out of scope:** `orden_id IS $2` — that null-safe form is prescribed **only** for `getParadaAbierta`, which is not a method on this port. **Verify:** 8.3.

- [x] 8.3 Create `src/store/sqlite/__tests__/sqliteDanoRepository.test.ts` over the shared double. **Acceptance:** covers the round trip with no connection; all four `causoParada × posibleSegunda` combinations; `unidades_sospechadas` NULL → `undefined` (never `0`, never `null`); per-order filtering that never returns an unlinked record; chronological ordering; open-daño query; duplicate insert and unknown-id update rejections; error propagation with `cause`. **Plus the white-box statement assertion D2b requires:** passing a `Dano` with a dangling `paradaId` directly to `insertDano` (constructed without going through `registrarDano`) — the emitted `INSERT` binds `parada_id` verbatim and the adapter performs **no lookup**. The storage-level rejection is asserted separately in Phase 14 as the A1 control; **no FK-off mode is introduced here.** Suite header carries the honesty note. **Verify:** `npx vitest run src/store/sqlite/__tests__/sqliteDanoRepository.test.ts`.

---

## Phase 9 / Unit E1 — `inspección de tela` port and in-memory adapter go async

**Objective.** Make the 4 `inspección de tela` port methods async with identical in-memory
behaviour.
**Depends on.** Phase 8.
**Design decisions.** Requirement 1 (4 methods). The port gains **no** `listarPorMaquina` — an
inspection is always an order event.
**Estimated changed lines.** ≈ 95 — **false, see CORRECTION 8.** The real boundary is **6 files** and
the ≈ 95 counted only the 3 store files; the inspección-only App/UI landing (9.4) adds
`src/App.tsx`, `src/ui/InspeccionTelaSection.tsx` and 5 direct port calls in `src/App.test.tsx`; the 9 App
call sites, 5 UI prop declarations, 3 UI call sites and 5 test call sites cannot be left un-awaited.
**Capability.** `operational-repository-contracts`.

- [x] 9.1 Modify `src/store/inspeccionRepository.ts`: all **4** methods return `Promise`; doc comment updated. **Acceptance:** exactly `insertInspeccion`, `updateInspeccion`, `obtenerPorId`, `listarPorOrden`; **no** `listarPorMaquina` is added. **Out of scope:** any machine query. **Verify:** `npx tsc --noEmit`.

- [x] 9.2 Modify `src/store/inMemoryInspeccionRepository.ts`: `async` bodies, identical semantics, `validarId` **preserved**. **Acceptance:** defensive clone both directions; `listarPorOrden` returns every inspection of the order ordered by `timestamp` — the approved ticket 07 model has no one-inspection-per-order restriction, so the adapter must support multiple inspections per order. **Out of scope:** checklist completeness validation, resolution exclusivity — both are domain rules. **Verify:** `npx vitest run src/store/inMemoryInspeccionRepository.test.ts`.

- [x] 9.3 Modify `src/store/inMemoryInspeccionRepository.test.ts` (338 lines): `await` every call, **zero assertions deleted or weakened** — this is the largest port suite and the most tempting to trim. **Verify:** as 9.2.

- [x] 9.4 Modify `src/App.tsx`, `src/ui/InspeccionTelaSection.tsx` and the 5 direct port calls in `src/App.test.tsx` — the **inspección-only** await landing (see CORRECTION 8). `App.tsx`: the `inspecciones` load effect at `:231-234` becomes an async inner function with the `cancelled` guard already used by `cargarParadas` / `cargarActividades` / `cargarDanos` (`let cancelled = false; async function cargarInspecciones() { if (orden) { const cargadas = await inspeccionRepository.listarPorOrden(orden.id); if (!cancelled) setInspecciones(cargadas); } else if (!cancelled) { setInspecciones([]); } } cargarInspecciones(); return () => { cancelled = true; };`) so a late `setInspecciones` cannot fire after unmount; `handleRegistrarInspeccion` becomes `async … Promise<string[]>`, `await`ing `insertInspeccion` before the reload; `handleDevolverInspeccion` and `handleAutorizarInspeccion` become `async … Promise<string[]>`, `await`ing `obtenerPorId` before the domain call and `updateInspeccion` before the reload. `InspeccionTelaSection.tsx`: **both** prop interfaces declare the three handlers as `Promise<string[]>` (`:68`, `:72`, `:85`, `:86`) and the three un-awaited call sites (`:117`, `:131`, `:329`) `await` them exactly as `DanoSection.tsx` does for `onRegistrarDano` / `onCerrarDano`. Plus 5 `await`s on the direct `repoInspecciones.listarPorOrden(...)` calls in `src/App.test.tsx` (`:1424`, `:1447`, `:1483`, `:1519`, `:1526`) — type-level only, no assertion touched. **Acceptance:** `npx tsc --noEmit` exit 0 — every TS2345/TS2740/TS2339/TS7053/TS7006 from the inspección conversion gone; `src/domain/**` byte-unchanged; **zero `Promise` reaches React state or a synchronous prop**; every `setInspecciones` receives a resolved `InspeccionTela[]`; **no** `await` added for the `mantenimiento` consumption (`:228`, `:540`, `:562`, `:641`) — that lands with F1. **Out of scope:** all other port landings, App/UI evolution beyond inspecciones, Approach A work, any handler refactor beyond the type/await choreography. **Verify:** `npx tsc --noEmit` + `npx vitest run src/store/inMemoryInspeccionRepository.test.ts` + `npx vitest run src/App.test.tsx --testTimeout=30000` + `npm test`; any App test that genuinely needs an added `await` is reported in apply-progress.md rather than assumed unnecessary.

---

## Phase 10 / Unit E2 — `sqliteInspeccionTelaRepository` and its suite

**Objective.** Deliver the hardest adapter: the flat 5-column checklist plus the complete
`ResolucionInspeccion` union in **both** directions, with derived state recomputed rather than read.
**Depends on.** Phases 4 and 9.
**Design decisions.** **D3** (`sqliteInspeccionTelaRepository.ts` / `SqliteInspeccionTelaRepository`).
**D1**. **D2j**. R7 (resolution-column gap: the three columns that complete the flat-column decision
— `registrada_por`, `resolucion_timestamp`, `autorizacion_observaciones` — are what make US6
survivable). **D2d**.
**Estimated changed lines.** ≈ 640 — **THE LARGEST UNIT, OVER BUDGET by ~60%. Requires
`size:exception` or a further split decision before apply.**
**Capability.** `operational-repository-contracts`.

- [x] 10.1 Create `src/store/sqlite/sqliteInspeccionTelaRepository.ts`. 18-column `InspeccionTelaRow`, `InspeccionTelaSqlValues`, pure `mapInspeccionRow` / `mapInspeccionToSql`, `class SqliteInspeccionTelaRepository implements IInspeccionRepository { constructor(private db: Database) {} }`. **Acceptance:** mappers are pure and unit-testable with no connection. `lote`, `otra_anomalia` and `observaciones` read back `?? undefined`; `orden_id` reads back as `null`-impossible because the column is NOT NULL. **Out of scope:** any column read for `conAnomalia` or `estadoInspeccion` — neither exists. **Verify:** `npx tsc --noEmit`.

- [x] 10.2 Implement the **branch-exclusive resolution write**. `resolucion = null` → all five resolution columns NULL. `devolucion` → `resolucion='devolucion'`, `motivo_devolucion`, `registrada_por`, `resolucion_timestamp`; `autorizado_por` and `autorizacion_observaciones` NULL. `autorizacion_gerencia` → `resolucion='autorizacion_gerencia'`, `autorizado_por`, `resolucion_timestamp`, `autorizacion_observaciones`; `motivo_devolucion` and `registrada_por` NULL. **Acceptance:** no column of the *other* branch is ever populated; no information present in the domain resolution is dropped. **Out of scope:** storing a serialised `resolucion` blob — the spec requires separate columns. **Verify:** 10.4.

- [x] 10.3 Implement the **checklist rebuild from a literal ordered tuple**. `mapInspeccionRow` rebuilds `items` by iterating the literal tuple `["absorcion", "tundido", "manchas", "dimensiones", "estado_general"]` and rebuilds the matching `ResolucionInspeccion` branch. A non-null discriminator with a null data column, or an unrecognised discriminator string, is a **descriptive mapping error with `cause`** — never a fabricated `""`, never a silent `null`. `conAnomalia` and `estadoInspeccion` are **never read from a column and never cached**; the domain's own functions recompute them. **Acceptance:** *why a literal tuple and not `getItemsChecklist()`:* the column set is fixed by 004, so the mapping is a storage fact; a catalogue-driven zip would silently yield a 5-item array if the domain ever grew a sixth item, instead of failing loudly. A suite assertion pins the tuple to `getItemsChecklist().map(i => i.id)`, so catalogue-order drift fails the build. **Out of scope:** changing `getItemsChecklist()`. **Verify:** 10.4.

- [x] 10.4 Create `src/store/sqlite/__tests__/sqliteInspeccionTelaRepository.test.ts` over the shared double. **Acceptance:** covers — the round trip with no connection; the 5-item rebuild (exactly 5 entries, one per catalogue id, in catalogue order, `tundido: "anomalia"`); the checklist tuple pinned to `getItemsChecklist().map(i => i.id)`; **both** resolution branches rebuilt with their own columns; an unresolved inspection deriving `"no_usable"`; an entirely conforme one deriving `"conforme"`; absent optional text reading back `undefined`, never `""`; the corrupt-row cases (non-null discriminator with null data column, unrecognised discriminator) raising a mapping error with `cause`; resolution replacing the row in place with exactly one row for that id; three inspections of one order all returned ordered by `timestamp` with no cross-order mixing; chronological ordering; error propagation with `cause`. Suite header carries the honesty note. **Verify:** `npx vitest run src/store/sqlite/__tests__/sqliteInspeccionTelaRepository.test.ts`.

---

## Phase 11 / Unit F1 — `mantenimiento` port and in-memory adapter go async

**Objective.** Make the 5 `mantenimiento` port methods async with identical in-memory behaviour.
**Depends on.** Phase 10.
**Design decisions.** Requirement 1 (5 methods). ADR 0006 (`docs/adr/0006-maintenance-on-machine-not-chemistry.md`,
read-only) and ADR 0007 (`docs/adr/0007-maintenance-documentary-no-time-deduction.md`, read-only) —
maintenance is machine-level, never per chemistry, and documentary only.
**Estimated changed lines.** ≈ 70 — **within budget**.
**Capability.** `operational-repository-contracts`.

- [x] 11.1 Modify `src/store/mantenimientoRepository.ts`: all **5** methods return `Promise`; doc comment updated; the existing note that **linked-entity existence is a domain rule supplied through an injected lookup** is preserved. **Acceptance:** `obtenerPorId` resolves `undefined`; `getMantenimientoAbierto(maquinaId)` takes one parameter; no method added. **Out of scope:** a `listarPorOrden` — this domain has no `orden_id` column by design (ADR 0006). **Verify:** `npx tsc --noEmit`.

- [x] 11.2 Modify `src/store/inMemoryMantenimientoRepository.ts`: `async` bodies, identical semantics; duration stays **derived** from `inicio`/`fin` and is never stored. **Acceptance:** one open maintenance per machine remains a domain rule, not a store constraint. **Verify:** `npx vitest run src/store/mantenimientoRepository.test.ts`.

- [x] 11.3 Modify `src/store/mantenimientoRepository.test.ts` (184 lines): `await` every call, **zero assertions deleted or weakened**. **Verify:** as 11.2.

---

## Phase 12 / Unit F2 — `sqliteMantenimientoRepository` and its suite

**Objective.** Deliver the `mantenimiento` adapter: 10 columns, no `orden_id`, no `duracion`, and an
update that mutates the row in place.
**Depends on.** Phases 4 and 11.
**Design decisions.** **D3** (`sqliteMantenimientoRepository.ts` / `SqliteMantenimientoRepository`).
**D1**. **D2j** — the update sets all non-PK columns, which is an exact behavioural match for the
in-memory `map.set(record)` with no "preserve the creation timestamp" wrinkle. ADR 0007. **D2d**.
**Estimated changed lines.** ≈ 420 — **OVER BUDGET. Requires `size:exception` or a further split
decision before apply.** — F2 ran with the maintainer-approved `size:exception` of the cycle (user
directive "queda aprobada"; same class as E2). Result: 452 changed lines (adapter 428 + suite 743),
atomicity justified — the adapter and its suite are one unit, the suite cannot be split from the
adapter and the adapter hides nothing worth exposing as a separate PR.
**Capability.** `operational-repository-contracts`.

- [x] 12.1 Create `src/store/sqlite/sqliteMantenimientoRepository.ts`. 10-column `MantenimientoRow`, `MantenimientoSqlValues`, pure `mapMantenimientoRow` / `mapMantenimientoToSql`, `class SqliteMantenimientoRepository implements IMantenimientoRepository { constructor(private db: Database) {} }`. **Acceptance:** the mapper **never produces** an order link (no `orden_id` column exists) and **never produces** a duration (ADR 0007: documentary only, never deducts productive time). `que_se_reviso_reparo` and `observaciones` read back `?? undefined`. The header states the repository does not validate business rules and that linked-entity existence is a domain rule. **Out of scope:** any time or duration column, any per-chemistry field. **Verify:** `npx tsc --noEmit`.

- [x] 12.2 Implement the prescribed statements: `obtenerPorId`; `listarPorMaquina` `WHERE machine_id = $1 ORDER BY inicio ASC`; `getMantenimientoAbierto` `WHERE machine_id = $1 AND fin IS NULL ORDER BY inicio ASC LIMIT 1`; `insertMantenimiento` / `updateMantenimiento` with the pre-check. **Acceptance:** `updateMantenimiento` with the domain's closed copy (same id, `fin` set, `que_se_reviso_reparo` set) updates the row **in place**, creates **no** additional row, and never rewrites the identity with a different value; `dano_id` reads back `null` for a preventive maintenance, so the nullable FK imposes no requirement. **Out of scope:** enforcing immutability-after-close as a database constraint — that is a domain rule the adapter does not extend. **Verify:** 12.3.

- [x] 12.3 Create `src/store/sqlite/__tests__/sqliteMantenimientoRepository.test.ts` over the shared double. **Acceptance:** covers the round trip; update-in-place with no extra row and no `duracion`; duplicate insert and unknown-id update rejections; chronological ordering; the open-record query; per-order filtering asserted **absent** (the port has no such method); error propagation with `cause`. Suite header carries the honesty note. **Verify:** `npx vitest run src/store/sqlite/__tests__/sqliteMantenimientoRepository.test.ts`.

---

## Phase 13 / Unit G1 — recovery and startup composition

**Objective.** Rename recovery to what it promises, grow `RecoveryState` from 3 to 8 sources, read
in the one correct order, and construct all eight adapters once at startup.
**Depends on.** Phases 3, 5, 6, 7, 8, 9, 10, 11, 12 (all five domains must be async **simultaneously**).
**Design decisions.** **D2a** (rename `recoverPhase1State` → `recoverPersistedState`; `RecoveryState`
keeps its name). **D2e** (sequential fixed read order, one declared dependency). **D2f**
(`maquinaId` as an explicit parameter; 8 repositories first, then the two scalars). **D2d**
(`database.ts` unchanged). **D2h** is Phase 14's concern (it is an `App` behaviour), not this one.
**Estimated changed lines.** ≈ 300 — **within budget** (it is within budget only because the fake
store moved out; see CORRECTION 1).
**Capability.** `operational-recovery-wiring`.

- [ ] 13.1 Modify `src/store/sqlite/recovery.ts`: rename the function to **`recoverPersistedState`** and grow `RecoveryState` from 3 to 8 fields — `jornada`, `orden`, `lecturas`, `paradas`, `actividades`, `danos`, `mantenimientos`, `inspecciones`. The `RecoveryState` interface name is **kept unchanged** (D2a). **Acceptance:** the function receives repository **interfaces only**, never a `Database`; the module contains **no SQL**; it performs no arithmetic beyond assembling lists — no `tiempo productivo`, no duration, no projected 2da, no alert, no `buena_racha`, no machine state, no inspection `estado`. `componerOrdenConLecturas` is unchanged. **Out of scope:** splitting into two functions (rejected in D2a: it would push the read-order rule out of the composition and give `main.tsx` two failure points). **Verify:** `npx tsc --noEmit`.

- [ ] 13.2 Implement the **D2e read order**, sequentially, each `await`ed: `jornada → orden → lecturas → paradas → actividades → daños → mantenimientos → inspecciones`, with `inspecciones = orden ? await inspeccionRepository.listarPorOrden(orden.id) : []` — the same guard shape as the existing `lecturas` read. **Acceptance:** the four machine-event lists carry the machine's **full history with no date predicate**; a read failure **propagates** and is never downgraded to an empty list; a `Promise.all` fan-out is **not** used, so a partial failure is diagnosable at a named domain. **Out of scope:** adding a date predicate (a future "view a past day" feature adds it to the **ports**, not to recovery). **Verify:** 13.4.

- [ ] 13.3 Modify `src/main.tsx`: step 2 becomes **eight** repository constructions; the two hard-wired in-memory `parada` / `actividad` lines are **removed**; step 4 calls `recoverPersistedState`; step 5 passes the five operational repositories to `<App>`; `main.tsx` passes `maquinaId = "M1"`. The numbered header comment (step 4) is rewritten to name the **eight** recovered sources. The `try`/`catch` discipline, `mensajeDeError` and `InicializacionFallida` are untouched. **Acceptance:** adapters are constructed **once**, never per render; no `InMemoryParadaRepository` or `InMemoryActividadPlanificadaRepository` remains in `main.tsx`; a failure in any step still renders `InicializacionFallida` and `App` never mounts with partial state. **Out of scope:** the `useMemo` in-memory defaults inside `App` — they stay, so a test injecting nothing still gets an in-memory adapter (R9). **Verify:** 13.5.

- [ ] 13.4 Modify `src/store/sqlite/__tests__/recovery.test.ts` (352 lines): rename references, assert the 8 fields, the orden-before-inspections order, an absent `orden` yielding `inspecciones = []` while the other domains still recover, full machine history with no date filtering, the absence of any derived value, and a read failure propagating rather than being swallowed. **Acceptance:** **no existing assertion is deleted**; fakes substituted for the contracts are sufficient to test the composition (that is the point of keeping it contract-based). **Verify:** `npx vitest run src/store/sqlite/__tests__/recovery.test.ts`.

- [ ] 13.5 Modify `src/store/sqlite/__tests__/startup.test.ts` (406 lines): assert eight adapters constructed once, no in-memory operational wiring remaining, recovery failure → `InicializacionFallida` with `App` never mounted, and an operational-domain read failure reaching the same screen. **Acceptance:** only the plugin boundary is faked; the suite header keeps the honesty note that the real Tauri binary is not exercised. **Out of scope:** any test of `App`'s handlers (Phase 14 owns those). **Verify:** `npx vitest run src/store/sqlite/__tests__/startup.test.ts`.

- [ ] 13.6 Update the remaining `recoverPhase1State` references created by the D2a rename in `src/__tests__/persistence-integration.test.ts`. **Acceptance:** **no** occurrence of `recoverPhase1State` remains anywhere in `src/`; `RecoveryState` occurrences keep their name; the numbered startup comment in `src/main.tsx` names the eight sources. **Out of scope:** the restart-survival body of that file — Phase 14 owns it; this task is the rename only, so the file stays green. **Verify:** `grep -rn "recoverPhase1State" src/` returns nothing; `npm run test` green.

---

## Phase 14 / Unit G2 — App state, handlers, Approach A, and the 6 UI files

**Objective.** Make the application layer await persistence before touching React state, keep the
domain's synchronous lookups synchronous, lift the render-body reads into state, and adapt the six
UI files that declare the callbacks.
**Depends on.** Phase 13.
**Design decisions.** **Approach A** (D2 + the Data Flow diagram). **D2c** (6 files, 15 declaration
sites, 12 consumption sites — `OrderAvailable.tsx` and `OrderFinished.tsx` are **not** edited).
**D2g** (one uniform handler template, no error taxonomy, a failed write never returns an empty
error list). **D2h** (unconditional seed + `cancelled`-flag mount loaders, deps per domain).
**D2i** (one re-seed helper per domain, so "refreshed after every mutation" is true **by
construction**). **D2b** (the A1/A1b/A2 triple).
**Estimated changed lines.** ≈ 620 — **THE HIGHEST-RISK AND LARGEST UNIT, OVER BUDGET. Requires
`size:exception` or a further split decision before apply.**
**Capability.** `operational-recovery-wiring`.

- [ ] 14.1 Modify `src/App.tsx` — state and loaders. Seed `paradas`, `actividades`, `danos`,
  `mantenimientos`, `inspecciones` from `estadoInicial` **unconditionally** (D2h), and **add** three
  state values: `danoAbiertoDeMaquina`, `mantenimientoAbiertoDeMaquina`, `danosDeOrden`. Convert the
  mount loaders to the `cancelled`-flag async pattern already at `App.tsx:156-177` and `:187-197`,
  with deps: paradas `[paradaRepository]`; actividades `[actividadRepository]`; danos + open damage +
  per-order damages `[danoRepository, orden?.id]`; mantenimientos + open maintenance
  `[mantenimientoRepository]`; inspecciones `[inspeccionRepository, orden?.id]`. **Acceptance:** the
  first paint shows the recovered operational state with no empty flash; a loader resolving after
  unmount does not call a setter; a stable repository identity does not re-trigger the loader on
  every render; the `useMemo` in-memory defaults are **kept**; no `new Sqlite…(db)` per render is
  introduced. **Out of scope:** conditional seeding (rejected in D2h — it would invent a new
  precedence rule between two sources the specs already settled); dropping the loaders. **Verify:**
  14.6.

- [ ] 14.2 Modify `src/App.tsx` — lift the three render-body reads. Replace `danoRepository.getDanoAbierto("M1")` (`:583`), `mantenimientoRepository.getMantenimientoAbierto("M1")` (`:605`) and `danoRepository.listarPorOrden(orden.id)` (`:626`) with the three state values. **Acceptance:** **no repository call remains in the render body**; the 2da integration reads `danosDeOrden` from state while `proyeccionSegundaDeOrden` still computes the projection, the >3% alert, the 5% target and `buena_racha` from that list; all derivation (`resumenTiempoTurno`, `paradaAbierta`, `duracionAcumulada`, `mantenimientoAbierto`, machine state) still happens in the render body **from state**; the `MAQUINA` literal `"M1"` stays as-is — D1 is about **columns**, not this. **Out of scope:** memoising a repository read in a `useMemo` (that is the rejected decision-11 second read path). **Verify:** 14.6.

- [ ] 14.3 Modify `src/App.tsx` — add the **D2i re-seed helpers**: `recargarDanos()` (one
  `Promise.all` over `listarPorMaquina` + `getDanoAbierto` + `listarPorOrden`, setting all three
  state values), `recargarMantenimientos()`, and the single-domain `recargarParadas()`,
  `recargarActividades()`, `recargarInspecciones()`. **Acceptance:** every handler calls the relevant
  helper **after** its awaited write; a handler never splices the domain object it just wrote into
  state; no ad-hoc refresh site exists. **Rationale to preserve in a comment:** three separate
  ad-hoc refresh sites per domain is exactly how `danoAbiertoDeMaquina` goes stale while `danos` is
  fresh — a stale open damage is the bug US4 exists to fix. **Out of scope:** one bulk helper
  reloading all five domains after every write (rejected in D2i: it couples unrelated domains and
  re-renders state the operario did not change). **Verify:** 14.6.

- [ ] 14.4 Modify `src/App.tsx` — convert the **11 handlers** to `async … Promise<string[]>` using
  the D2g template verbatim: guard → pure synchronous domain call → `if (errores.length > 0) return
  errores` → `await repository.insertX / updateX` → `catch` returning
  `[error instanceof Error ? error.message : "<spanish domain-specific fallback>"]` → `await
  recargar<Domain>()` → `return []`. **Acceptance:** a **failed write never returns an empty error
  list** — the `catch` is the only other exit and it always returns one message; each fallback string
  is Spanish and specific to its domain; domain errors and persistence errors share the channel
  with **no** distinguishing class, code or prefix. **Out of scope:** a `PersistenciaError` type
  (rejected in D2g — the sections render a `string[]` and nothing more). **Verify:** 14.6.

- [ ] 14.5 Modify `src/App.tsx` — implement **Approach A** in `handleRegistrarDano` and
  `handleRegistrarMantenimiento`. For `daño`: one `await paradaRepository.obtenerPorId(input.paradaId)`,
  then inject the **synchronous** closure `(id) => (id === vinculada?.id ? vinculada : paradas.find(p => p.id === id))`.
  For `mantenimiento`: identically with `danoRepository.obtenerPorId` and `el daño vinculado no
  existe: <id>`. **Acceptance:** the domain receives `Parada | undefined` / `Dano | undefined`,
  **never a `Promise`**; a dangling id therefore fails at the domain with its own message and **no
  write is attempted**, so the FK error never appears; the domain calls each lookup exactly once, so
  there is one `await` per handler; `src/domain/danos.test.ts` (520 lines) and
  `src/domain/mantenimiento.test.ts` (636 lines) pass **unchanged**. **Out of scope:** making the
  domain lookup async (puts I/O in the pure domain) and any memoized synchronous cache (a second
  read path that can go stale — effectively a second persistence strategy). **Verify:** 14.6 and 14.7.

- [ ] 14.6 Modify the **6 UI files** that declare the callbacks, in place — no wrapper, no
  adaptation layer (D2c). Declarations: `src/ui/ParadasSection.tsx:21,23`; `src/ui/ActividadesSection.tsx:25,27`;
  `src/ui/DanoSection.tsx:22,24`; `src/ui/MantenimientoSection.tsx:23,24`;
  `src/ui/InspeccionTelaSection.tsx:68,70,72` **and** `:85,86`; `src/ui/OrderInProduction.tsx:53,55`
  (pure forwarding to `ParadasSection` at `:182,183`, no consumption site). Consumptions needing
  `await`: `ParadasSection.tsx:93,111`; `ActividadesSection.tsx:73,90`; `DanoSection.tsx:139,159`;
  `MantenimientoSection.tsx:119,136`; `InspeccionTelaSection.tsx:117,131,329`. Each affected handler
  becomes `async` and `e.preventDefault()` is the **first statement, before any `await`**. **Acceptance:**
  no `Promise` ever reaches a React child and no section reads `.length` on the `Promise` object;
  `InspeccionTelaSection.tsx` has **both** declaration interfaces changed — the container props at
  `:68,70,72` and the per-item child props at `:85,86`; **`src/ui/OrderAvailable.tsx` and
  `src/ui/OrderFinished.tsx` are NOT edited** — they inherit the new type through `import type` +
  `extends` and must still compile, which is part of this task's verification. **Follow the existing
  Phase 1 precedent** at `src/ui/OrderInProduction.tsx:45,47,86,100` (read-only at planning time),
  including the *"Async desde el ticket 10.4"* comment convention. **Out of scope:** a
  `useAsyncCallback` hook or a second `onRegistrarXAsync` prop (rejected in D2c — a second
  vocabulary for one concept, with exactly one consumer). **Verify:** `npx tsc --noEmit` plus
  `npm run test`; the failure mode if a declaration is missed is a **TypeScript error**, never
  silence.

- [ ] 14.7 Modify `src/App.test.tsx` (2062 lines). **Acceptance — the file is NOT rewritten**;
  affected tests gain `await act(...)` using the existing pattern at `App.test.tsx:48`; new coverage
  for (a) a persistence failure leaving the visible state untouched and returning a non-empty list,
  (b) Approach A yielding the domain's own `la parada vinculada no existe: <id>` /
  `el daño vinculado no existe: <id>` rather than a constraint error, (c) the mount loaders re-reading
  for an injected `hoy`, (d) no `Promise` reaching a React child. **Out of scope:** deleting or
  relaxing existing assertions to make the async change pass (R4). **Verify:**
  `npx vitest run src/App.test.tsx`.

- [ ] 14.8 Extend `src/__tests__/persistence-integration.test.ts` (341 lines) with **restart
  survival** plus the **A1/A1b/A2 triple**. Restart survival: record a `parada`, an `actividad`, a
  `daño`, an in-progress `mantenimiento` and an `inspección` through the real handlers over the
  SQLite adapters → construct **fresh** adapter instances over the same store → run recovery → assert
  the five lists are identical field for field, the `mantenimiento` is still in progress, and the
  inspection's checklist, `lote`, resolution, `registradaPor` and resolution timestamp all survive;
  then assert the derived values (machine state, `tiempo productivo` buckets, 2da projection with its
  >3% alert, `buena_racha`, per-inspection `estado de tela`) are **recomputed identically** before
  and after. The A1/A1b/A2 triple, mirrored for `daño`/`parada_id`:

  | # | Assertion | Degenerate world it rules out |
  |---|---|---|
  | A1 (control) | `await danoRepository.insertDano({...paradaId: "no-existe"})` **directly**, bypassing `App` → rejects with `FOREIGN KEY constraint failed` | A fake that rejects everything — A1b with a **valid** id would then fail |
  | A1b (control) | The same direct insert with a **primed, valid** `paradaId` → resolves | A store whose FK check never passes, masking every write |
  | A2 (subject) | Drive `App`'s damage registration with `causoParada: true, paradaId: "no-existe"` → the returned error list contains `la parada vinculada no existe: no-existe` and does **not** contain `FOREIGN KEY` | A `Promise` injected as the lookup: `if (!parada)` never fires, the domain accepts, `insertDano` is attempted, and the store now rejects with `FOREIGN KEY constraint failed` — so A2 sees the FK message and fails |

  **Acceptance:** A1/A1b prove the fake's FK is real; A2 proves the domain pre-check still fires; the
  test fails in **every** degenerate world — fake-rejects-everything, fake-never-rejects, and
  lookup-re-promised. A2 is a **domain-guard** test; it is explicitly **not** a claim that the real
  connection enforces the FK (R5). **Out of scope:** any FK-off configuration, any second storage
  truth. **Verify:** `npx vitest run src/__tests__/persistence-integration.test.ts`.

- [ ] 14.9 Run the full guardrails and record the **non-blocking runtime step**. Guardrails:
  `npm run test` and `npx tsc --noEmit` in `.`; `cargo check` in `src-tauri`; and
  `git diff --stat -- src/domain/` shows **no source file** changed (only
  `src/domain/calidad.test.ts` with exactly 2 added lines, per CORRECTION 2). Non-blocking runtime
  step, recorded but **not** an acceptance criterion: on the real Tauri binary, confirm 004 was
  applied (checksum recorded, DDL executed) and run **`getForeignKeys()`** (`src/store/sqlite/database.ts:136-140`,
  read-only — D2d changes nothing in that file) to observe whether `PRAGMA foreign_keys` is enforced
  on the connection actually serving `execute`/`select`. **Acceptance:** the outcome of that step is
  written down; a failure **opens R5/R6 and does not fail this change**, exactly as for 001–003,
  because the approved specs already hedge every FK scenario with *"when foreign key enforcement is
  active on the connection"*. **Out of scope:** re-asserting the pragma per statement, adding a
  startup verification step, or branching adapter behaviour on the enforcement result — all three
  rejected in D2d as unverifiable in this environment. **Verify:** the three guardrail commands
  plus the recorded runtime observation.

---

## Dependency graph

```
A1 ──► A2
 │
 └──► B ──► S ──┬──► C1 ──► C2 ──┐
                ├──► D1 ──► D2 ──┤
                ├──► E1 ──► E2 ──┼──► G1 ──► G2
                └──► F1 ──► F2 ──┘
```

- `A2` depends on `A1` (it asserts 004's DDL).
- `S` depends on `B` (the double lands once the reference async port exists) and precedes every
  adapter suite (CORRECTION 1).
- `G1` depends on all five ports being async **simultaneously** — this is why it is last, and why
  the design's sequencing rationale holds.
- `G2` depends on `G1` and carries the R2 guard (A1/A1b/A2).

**Base boundary.** Under `feature-branch-chain`: PR 1 targets the tracker branch; PR 2 targets PR
1's branch; and so on, with only PR 14 merging to main. If a child PR's diff shows an earlier
slice, the base is wrong — retarget before review.

---

## Cross-cutting acceptance criteria (every phase, verified at Phase 14)

1. `src/domain/**` **source** files are byte-unchanged. `src/domain/calidad.test.ts` carries exactly
   two added `await` keywords and nothing else (CORRECTION 2).
2. `src/domain/danos.test.ts` and `src/domain/mantenimiento.test.ts` pass **unchanged** — Approach A
   keeps the domain's lookups synchronous, and that is the proof.
3. `src/store/sqlite/database.ts` is **unchanged** (D2d — no unverifiable workaround).
4. `src/ui/OrderAvailable.tsx` and `src/ui/OrderFinished.tsx` are **unchanged** and still compile
   (D2c — verified inheritance, not assumed).
5. `src-tauri/migrations/001*.sql`, `002*.sql`, `003*.sql` and their three
   `src/store/sqlite/migrations/` counterparts are **unchanged** in all six files.
6. No derived value has a column; no ticket 02–08 rule is altered; no Acabado channel, no official
   2da, no persistent `lote` entity, no approval workflow, no delete path, no date scoping.
7. Every new suite header carries the project's honesty note: the double **models** SQLite
   semantics, it does not execute the real engine, and 004's real application plus per-connection
   `PRAGMA foreign_keys` enforcement remain PENDING runtime validation.

---

## Open items carried into `sdd-apply` (not blockers, decisions required first)

1. **Chain strategy** — `pending`. `stacked-to-main`, `feature-branch-chain` or `size:exception`.
2. **The 5 over-budget units** (C2 ≈ 410, D2 ≈ 520, E2 ≈ 640, F2 ≈ 420, G2 ≈ 620). One honest
   slicing pass has been made. `chained-pr` says to stop iterating and report the overage, so each
   needs a maintainer `size:exception` or an explicit further-split decision. **The budget constrains
   how work is sliced, never the code itself** — no task below may be shrunk by deleting comments,
   blank lines, docs or tests.
3. **R5 / R6 runtime verification** — stays open; 14.9 records it without converting it into a
   blocking acceptance criterion.
