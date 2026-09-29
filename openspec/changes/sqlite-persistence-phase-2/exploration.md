# Exploration: sqlite-persistence-phase-2

Persist the operational domains — paradas, actividades planificadas, daños, inspecciones de tela,
mantenimiento — in SQLite, with recovery and application wiring, without persisting derived values.

Adopted decisions (10/10, inviolable in this exploration) are treated as constraints, not options:
async Phase 1 repository pattern; `camposEspecificos` as JSON TEXT; flat checklist columns;
physical FKs; indexes only for real queries; one migration 004 registered in Rust with an identical
mirror; scope IN/EXCL as approved; no derived values persisted; tickets A–G valid but not yet written.

---

## Current State

### What already survives a restart (Phase 1, ticket 10)

| Table | Adapter | Port | Contract |
|---|---|---|---|
| `jornada` | `src/store/sqlite/sqliteJornadaRepository.ts` | `IJornadaRepository` | async (`repository.ts`-style precedent, `jornadaRepository.ts:40,48`) |
| `orden` (15 cols, incl. 003 D-1) | `src/store/sqlite/sqliteOrderRepository.ts` | `IOrderRepository` | async (`saveOrder`, `materializeOrder`) |
| `lectura_golpe` | `src/store/sqlite/sqliteLecturaGolpeRepository.ts` | `ILecturaGolpeRepository` | async (`reserveSequence` + `completeLecture`, two-phase) |

Wiring today — `src/main.tsx:53-102`: `initDatabase()` → 3 SQLite repos → `materializarPrograma()` →
`recoverPhase1State()` → `render(<App estadoInicial={...}>)`. Failures in steps 1-4 render
`InicializacionFallida`; the app never mounts with partial state.

### What does NOT survive a restart (the gap)

All five operational domains are **synchronous, in-memory only**. Evidence:

- Ports: `paradasRepository.ts:25-61`, `actividadesRepository.ts:26-57`, `danosRepository.ts:35-70`,
  `inspeccionRepository.ts:40-65`, `mantenimientoRepository.ts:35-63` — every method returns a value
  or `void`, never a `Promise`.
- Adapters: `inMemoryParadasRepository.ts`, `inMemoryActividadesRepository.ts`,
  `inMemoryDanosRepository.ts`, `inMemoryInspeccionRepository.ts`, `inMemoryMantenimientoRepository.ts`.
- `main.tsx:85-86` hard-wires the in-memory adapters (`new InMemoryParadaRepository([])`,
  `new InMemoryActividadPlanificadaRepository([])`); the other three fall back to in-memory defaults
  inside `App` (`App.tsx:143-154`).
- `recoverPhase1State` (`src/store/sqlite/recovery.ts:50-72`) reconstructs **only** jornada, orden,
  lecturas. `RecoveryState` has three fields; the five domains are absent.
- `App` seeds all five arrays with `useState([])` and refills them with **synchronous** `useEffect`
  loaders: `App.tsx:120-124` (state), `179-181` (paradas), `183-185` (actividades), `199-201` (danos),
  `203-205` (mantenimientos), `207-210` (inspecciones, keyed by `orden?.id`).

Consequence: a parada, a limpieza, a damage, an inspection or an open maintenance recorded before a
restart is silently lost. Everything those events feed (tiempo productive, 2da projection, the >3%
alert, buena racha, machine state) is recomputed from arrays that no longer exist.

### Persisted now vs. still missing, per domain

Domain truth lives in `src/domain/types.ts` and is unchanged by this change. No column below
duplicates a derived value.

**Parada** (`types.ts:82-98`) — 9 fields, all source-of-truth: `id`, `maquinaId`, `ordenId?`,
`operatorName`, `causaId`, `camposEspecificos`, `observaciones?`, `inicio`, `fin?`.
Not persisted today. `ParadaAbierta` is a **type alias** (`fin: null`), never stored.

**ActividadPlanificada** (`types.ts:125-139`) — 8 fields. No `ordenId` by design (independent of the
order, registrable on an empty day). Not persisted today.

**Dano** (`types.ts:196-222`) — 14 fields including the two independent flags `causoParada` /
`posibleSegunda` and the declarative `paradaId` link (optional, never a precondition — `danos.ts:53`,
`CONTEXT.md`). Not persisted today.

**InspeccionTela** (`types.ts:296-314`) — `id`, `ordenId` (mandatory), `operatorName`, `lote?`,
`items` (exactly 5, explicit state), `otraAnomalia?`, `timestamp`, `observaciones?`, `resolucion`.
Not persisted today. `conAnomalia` and `estadoInspeccion` are **derived** (`inspeccionTela.ts:111-136`)
and must stay unpersisted.

**Mantenimiento** (`types.ts:335-353`) — 10 fields, machine-level, **no `ordenId` by design**
(`CONTEXT.md`: "Not tied to an order"). Not persisted today. Duration is always derived.

---

## Affected Areas

### Persistence layer (new)

- `src/store/sqlite/migrations/004_*.sql` (canonical: `src-tauri/migrations/004_*.sql`) — **new**,
  5 tables + indexes. `001/002/003` are immutable (sqlx checksum: editing an applied migration fails
  startup with `VersionMismatch`, documented in `002_lectura_orden_sequence_unique.sql:2-4`).
- `src/store/sqlite/migrations/index.ts` — `CURRENT_MIGRATION_VERSION` 3 → 4, `TABLES` gains 5 names.
- `src-tauri/src/lib.rs:11-30` — register `Migration { version: 4, description, sql: include_str!(...), kind: MigrationKind::Up }`.
- `src/store/sqlite/sqliteParadaRepository.ts`, `sqliteActividadPlanificadaRepository.ts`,
  `sqliteDanoRepository.ts`, `sqliteInspeccionTelaRepository.ts`, `sqliteMantenimientoRepository.ts`
  — **new**, mirroring `sqliteOrderRepository.ts` (Row interface + exported pure mappers
  `mapXRow`/`mapXToSql` + class implementing the port with `private db: Database`).

### Contracts to evolve (sync → async)

- `src/store/paradasRepository.ts`, `actividadesRepository.ts`, `danosRepository.ts`,
  `inspeccionRepository.ts`, `mantenimientoRepository.ts` — add `Promise<>` to all 26 methods
  (5+5+6+4+5 = insert/update/obtenerPorId/listarPorMaquina[/listarPorOrden]/get*Abierto).
  Method names and semantics stay identical (adopted decision 1).
- The 5 in-memory adapters — wrap bodies in `async`/`Promise.resolve()`, same semantics: explicit
  insert vs update, duplicate-id rejection, defensive cloning, chronological ordering
  (e.g. `inMemoryParadasRepository.ts:27-67`).

### Composition

- `src/store/sqlite/recovery.ts` — `RecoveryState` extends from 3 to 8 fields; `recoverPhase1State`
  (or a successor) gains the 5 repository parameters. Inspection recovery depends on the recovered
  `orden` (a single `orden` for `fechaOperativa`), so read order matters: orden first, then
  `inspeccionRepository.listarPorOrden(orden.id)`, empty array when there is no orden.
- `src/main.tsx:59-87` — instantiate the 5 SQLite repos, pass them to recovery, pass them to `<App>`.
- `src/App.tsx` — see the dedicated section below; this is the highest-risk file.

### UI (blast radius found during investigation — not obvious from the port signatures)

Every UI section types its App callback as **synchronous** and consumes the return value
synchronously:

| File | Line | Signature |
|---|---|---|
| `src/ui/ParadasSection.tsx` | 21, 23 | `onRegistrarParada(input): string[]`, `onCerrarParada(): string[]` |
| `src/ui/ActividadesSection.tsx` | 25, 27 | `onRegistrarActividad(input): string[]`, `onCerrarActividad(tipo): string[]` |
| `src/ui/DanoSection.tsx` | 22, 24 | `onRegistrarDano(input): string[]`, `onCerrarDano(fin, solucion): string[]` |
| `src/ui/MantenimientoSection.tsx` | 23, 24 | `onRegistrarMantenimiento(input): string[]`, `onCerrarMantenimiento(fin, revisó): string[]` |
| `src/ui/InspeccionTelaSection.tsx` | 68, 70, 72 | `onRegistrarInspeccion`, `onDevolverInspeccion`, `onAutorizarInspeccion` |
| `src/ui/OrderInProduction.tsx` | 53, 55 | re-exports the parada callbacks |
| `src/ui/OrderAvailable.tsx`, `src/ui/OrderFinished.tsx` | — | same re-export chain |

Consumers do `const res = onRegistrarX(input); if (res.length === 0) {...}` and
`setErroresCierre(onCerrarX(...))` — e.g. `DanoSection.tsx:139,159`,
`MantenimientoSection.tsx:119,136`, `ActividadesSection.tsx:73,90`, `ParadasSection.tsx:93,111`,
`InspeccionTelaSection.tsx:131,146,159`. A `Promise` returned into these paths renders as a React
child and throws — loud, not silent, but it must be fixed in the same change.

`App.tsx` also calls repositories **in the render body**: `danoRepository.getDanoAbierto("M1")`
(`App.tsx:583`), `mantenimientoRepository.getMantenimientoAbierto("M1")` (`:605`),
`danoRepository.listarPorOrden(orden.id)` (`:626`). These must become state.

### Tests

- Contract tests to update to async: `src/store/paradasRepository.test.ts` (155),
  `actividadesRepository.test.ts` (149), `danosRepository.test.ts` (176),
  `inMemoryInspeccionRepository.test.ts` (338), `mantenimientoRepository.test.ts` (184).
- `src/App.test.tsx` — 2062 lines, mounts App with all 5 in-memory adapters. Widest test surface.
- New: per-repository SQLite suites + migration-004 suite + recovery extension + startup wiring +
  a restart-survival integration case in the style of
  `src/__tests__/persistence-integration.test.ts` (341 lines) and
  `src/store/sqlite/__tests__/startup.test.ts` (406 lines).
- Mirrored by `migration003.test.ts` (569 lines) as the template for the 004 SQL-contract suite.

---

## Proposed Schema — Migration 004

One `CREATE TABLE` per domain plus indexes. Single-column-per-ASCII-snake_case, singular table
names, matching the `jornada` / `orden` / `lectura_golpe` convention. Validation stays in the
domain (adopted decision 4); no CHECK constraints, following 001/002/003.

### Column naming — one open detail for `sdd-design`

Migration 001 names the machine and operator columns `machine_id` / `operario`. The domain names are
`maquinaId` / `operatorName`. Recommendation: **match 001** (`machine_id`, `operario`) so the schema
speaks one vocabulary. The alternative (`maquina_id`, `operator_name`) is more legible but creates
two conventions inside one database. 004 is new and never applied, so either is free — this is a
design-time call, not a re-opened decision.

### `parada`

| Column | Type | Source | Notes |
|---|---|---|---|
| `id` | TEXT PK | `Parada.id` | domain-generated `crypto.randomUUID()` |
| `machine_id` | TEXT NOT NULL | `maquinaId` | |
| `orden_id` | TEXT NULL | `ordenId` | FK → `orden(id)` |
| `operario` | TEXT NOT NULL | `operatorName` | |
| `causa_id` | TEXT NOT NULL | `causaId` | one of the 10 `CausaParadaId`; domain validates |
| `campos_especificos` | TEXT NOT NULL | `camposEspecificos` | **JSON TEXT** (adopted decision 2) |
| `observaciones` | TEXT NULL | `observaciones?` | |
| `inicio` | TEXT NOT NULL | `inicio` | |
| `fin` | TEXT NULL | `fin` | NULL = abierta; `ParadaAbierta` never stored |

`campos_especificos` handling: `JSON.stringify(record)` on write; `JSON.parse` + a shape check on
read. **Invalid JSON is a persistence/mapping error, never silently swallowed** — a descriptive
`Error` with the original `cause`, exactly as `sqliteOrderRepository.ts:260-265` does. An empty
record is valid and round-trips as `{}`.

### `actividad_planificada`

`id` PK · `machine_id` NOT NULL · `tipo` NOT NULL · `inicio` NOT NULL · `fin` NULL ·
`que_se_limpio` NULL · `observaciones` NULL · `operario` NOT NULL.
**No `orden_id`** — the model has no `ordenId` by design.

### `dano`

`id` PK · `machine_id` NOT NULL · `orden_id` NULL (FK → `orden`) · `operario` NOT NULL ·
`tipo` NOT NULL · `componente` NOT NULL · `inicio` NOT NULL · `fin` NULL ·
`solucion_aplicada` NULL · `causo_parada` INTEGER NOT NULL (0/1) · `parada_id` NULL (FK → `parada`) ·
`posible_segunda` INTEGER NOT NULL (0/1) · `unidades_sospechadas` INTEGER NULL · `observaciones` NULL.

The 0/1 INTEGER encoding mirrors `orden.aplica_segunda` from 003 (`sqliteOrderRepository.ts:138`:
`row.aplica_segunda === 1`). The two flags stay **independent** — no CHECK ties them together.

### `inspeccion_tela`

Flat checklist columns (adopted decision 3). Each is NOT NULL because
`validarChecklist` guarantees exactly 5 items with explicit state.

`id` PK · `orden_id` **NOT NULL** (FK → `orden`) · `operario` NOT NULL · `lote` NULL ·
`absorcion` NOT NULL · `tundido` NOT NULL · `manchas` NOT NULL · `dimensiones` NOT NULL ·
`estado_general` NOT NULL · `otra_anomalia` NULL · `timestamp` NOT NULL · `observaciones` NULL ·
`resolucion` NULL · `motivo_devolucion` NULL · `autorizado_por` NULL.

> **Finding — decision 3's column list is incomplete against the real type.** The approved list
> names `resolucion`, `motivoDevolucion` and `autorizadoPor`, but `ResolucionInspeccion`
> (`types.ts:260-280`) is a discriminated union that also carries `registradaPor`, its own
> `timestamp`, and — for the authorization branch — its own `observaciones`. A `devolucion` with no
> `registradaPor` column would lose the registered-by data on restart. Three additional columns are
> needed: `registrada_por` NULL, `resolucion_timestamp` NULL, `autorizacion_observaciones` NULL.
> This **completes** the adopted flat-column decision; it does not reopen it. `sdd-propose` must
> state it explicitly.

`conAnomalia` is **not** a column. `estadoInspeccion` is recomputed by the domain from the five
checklist columns + `otra_anomalia` + `resolucion` on every read.

### `mantenimiento`

`id` PK · `machine_id` NOT NULL · `tipo` NOT NULL · `operario` NOT NULL · `motivo` NOT NULL ·
`inicio` NOT NULL · `fin` NULL · `que_se_reviso_reparo` NULL · `dano_id` NULL (FK → `dano`) ·
`observaciones` NULL. **No `orden_id`** and **no `duracion`** (always derived).

### Indexes — only for queries the ports actually issue

| Index | Serves | Port method |
|---|---|---|
| `idx_parada_maquina_inicio (machine_id, inicio)` | machine events, chronological | `listarPorMaquina` |
| `idx_parada_abierta (machine_id, orden_id) WHERE fin IS NULL` | open-stop lookup | `getParadaAbierta` |
| `idx_parada_orden (orden_id)` | per-order events | `listarPorOrden` |
| `idx_actividad_maquina_inicio (machine_id, inicio)` | machine events | `listarPorMaquina` |
| `idx_actividad_abierta (machine_id, tipo) WHERE fin IS NULL` | open-activity lookup | `getActividadAbierta` |
| `idx_dano_maquina_inicio (machine_id, inicio)` | machine events | `listarPorMaquina` |
| `idx_dano_abierta (machine_id) WHERE fin IS NULL` | open-daño lookup | `getDanoAbierto` |
| `idx_dano_orden (orden_id)` | 2da projection input | `listarPorOrden` |
| `idx_mantenimiento_maquina_inicio (machine_id, inicio)` | machine events | `listarPorMaquina` |
| `idx_mantenimiento_abierta (machine_id) WHERE fin IS NULL` | open-maintenance lookup | `getMantenimientoAbierto` |
| `idx_inspeccion_orden (orden_id, timestamp)` | per-order, chronological | `listarPorOrden` |

`obtenerPorId` needs no extra index (primary key). **No index on `dano.parada_id`,
`dano.orden_id`-only, `mantenimiento.dano_id`, or `actividad.tipo` alone** — none is a query the
ports issue, and nothing is ever deleted, so SQLite never needs to chase a foreign key (adopted
decision 5: no speculative indexes).

### Migration mechanics

- Canonical file `src-tauri/migrations/004_operational_events.sql`, registered as version 4,
  `MigrationKind::Up`, `description` in the existing snake_case style (e.g. `operational_events`).
- **Byte-identical mirror** at `src/store/sqlite/migrations/004_operational_events.sql`. The current
  three mirrors were verified identical to their canonical twins; the convention is real, not
  aspirational.
- `CURRENT_MIGRATION_VERSION = 4`; `TABLES` in `migrations/index.ts` gains the five names.
- `001/002/003` untouched — no edits, no renames.
- No Down migration (the project registers Up-only); the table-rebuild rollback pattern from 10.9
  is the documented precedent if a rollback is ever required.

---

## The async seam: three concrete sub-problems

Adopted decision 1 fixes the pattern (async repos, sync domain, awaited persistence, re-seed state).
Implementing it surfaces three places where the current code reads repositories in shapes the async
contract cannot express. These are the real work of the change.

### 1. The domain lookups are synchronous by contract — **highest correctness risk**

`src/domain/danos.ts:53` declares `ObtenerParadaPorId = (id: string) => Parada | undefined`, and
`src/domain/types.ts:362` declares `ObtenerDanoPorId = (id: string) => Dano | undefined`. App injects
`(id) => paradaRepository.obtenerPorId(id)` (`App.tsx:411`) and
`(id) => danoRepository.obtenerPorId(id)` (`App.tsx:512`).

If the repository becomes async and the injection is not adapted, the domain receives a **Promise**,
which is truthy — so `if (!parada)` never fires and a **non-existent linked entity is accepted**.
`registrarMantenimiento` (`mantenimiento.ts:157-162`) has the identical shape. The physical FK
(adopted decision 4) would then reject the write at the SQLite layer, so the bug surfaces — but as a
confusing constraint error instead of the domain's own "el daño vinculado no existe".

**Resolution: pre-resolve in App, keep the domain untouched.** Before calling the domain, `await`
the lookup, then inject a synchronous closure over App state that was just refreshed from the
repository (`(id) => danos.find(d => d.id === id)`). Zero domain change, zero behaviour change,
and the domain stays pure per decision 1.

### 2. Repository reads inside the render body

`App.tsx:583, 605, 626` call `getDanoAbierto`, `getMantenimientoAbierto` and `listarPorOrden` during
render, and `:345, 377, 425, 527` call the open-entity lookups inside handlers. All must become
either `await`ed handler calls or state.

**Resolution:** lift `danoAbiertoDeMaquina`, `mantenimientoAbiertoDeMaquina` and `danosDeOrden` into
React state, seeded by the mount loader and refreshed after each mutation — the same shape the UI
sections already receive today (they take values, not repositories).

### 3. The mount loaders vs. `estadoInicial` — keep both

`App` already has mount loaders that re-read the same repositories (idempotent, same data,
`App.tsx:156-177`), and it accepts an injectable `hoy` prop (`App.tsx:98`) that `main.tsx`'s recovery
does not know about. Dropping the loaders would leave a test injecting a different `hoy` showing
stale recovered data.

**Resolution:** seed from `estadoInicial` for the initial paint (as today), **keep** the loaders,
convert them to the `cancelled`-flag async pattern already used at `App.tsx:156-177, 187-197`.
This is exactly the 10.8 precedent, applied uniformly.

---

## Approaches

The three approaches below are variants of the **already-adopted** async pattern, differing only in
how the sync domain lookups (sub-problem 1) are satisfied. None of them re-opens any decision.

**A. Pre-resolve the lookup in App, inject a closure over refreshed state** — *recommended*

- Pros: domain stays pure and sync (decision 1 honoured literally); zero domain diff; the validated
  entity comes from the database at the moment of use, so a dangling `paradaId` / `danoId` is caught
  by the domain's own error message; no second read path, no staleness window.
- Cons: one extra `await` per `registrarDano` / `registrarMantenimiento` call; App must keep its
  arrays fresh for the closure to be truthful (it already refreshes after every mutation).
- Effort: Low.

**B. Make the domain lookup async** (`(id) => Promise<Parada | undefined>`, awaited inside the
domain function)

- Pros: conceptually direct; the repository call is expressed where the validation happens.
- Cons: **violates adopted decision 1** — it makes `registrarDano` / `registrarMantenimiento` async
  and puts I/O in the pure domain, which breaks the hexagonal rule in `openspec/config.yaml` and
  every domain test in `src/domain/danos.test.ts` (520 lines) and
  `src/domain/mantenimiento.test.ts` (636 lines). Rejected.
- Effort: High, and rejected on principle.

**C. Memoized synchronous cache over the async repository** (a `Map` populated on mount, read
synchronously by the injected lookup)

- Pros: no `await` in the handler; sync closure over a map instead of an array.
- Cons: a second read path that can go stale (an entity written by another layer would be invisible
  to the validation), and effectively a second persistence strategy — the shape decision 1
  explicitly forbids. Rejected.
- Effort: Medium, and rejected on principle.

**Recommendation: A**, and it is not close. B and C are rejected because they break the layering the
whole codebase is built on; A is a handful of `await`s in App and nothing else.

---

## Preliminary Acceptance Criteria

Not a spec — a checklist for `sdd-propose` / `sdd-spec` to formalize.

**Schema (004)**
1. `004` creates exactly 5 tables and the 11 listed indexes; nothing else.
2. `001`, `002`, `003` are byte-unchanged.
3. The canonical file and the mirror are byte-identical; `CURRENT_MIGRATION_VERSION = 4`;
   `lib.rs` registers version 4 with `MigrationKind::Up`.
4. Every domain field that is source of truth has a column; no derived value
   (`tiempo productivo`, duración, estado de máquina, proyección de 2da, alerta >3%, buena racha,
   `conAnomalia`, estado de tela, `deltaGolpes`, progreso) has one.
5. `mantenimiento` and `actividad_planificada` have no `orden_id`; `inspeccion_tela.orden_id` is
   NOT NULL; all 5 FKs are declared; the resolution columns cover the full
   `ResolucionInspeccion` union including `registradaPor` and the resolution timestamp.

**Contracts and adapters**
6. All 5 ports are async; method names and semantics unchanged.
7. All 5 in-memory adapters satisfy the async contracts with identical observable behaviour
   (duplicate rejection, unknown-id rejection, defensive clone, chronological order).
8. `src/domain/**` has zero diff.

**Repositories**
9. Each SQLite adapter exposes pure exported mappers and writes the exact column set of its table.
10. Duplicate insert and unknown-id update are rejected, matching the in-memory contract.
11. `campos_especificos` round-trips as JSON; invalid JSON raises a descriptive error with the
    original cause — never a silent `{}` or a swallowed failure.
12. `conAnomalia` / `estadoInspeccion` are recomputed after a read, never read from a column.

**Recovery and wiring**
13. `RecoveryState` carries the 5 domains; a null/absent order yields an empty inspection list.
14. `main.tsx` constructs the 5 SQLite adapters, recovers, and passes them to `<App>`.
15. A mutation awaits persistence **before** state is updated; a persistence failure surfaces the
    error to the operator and leaves state untouched. No fire-and-forget, no background writer.
16. Restart survival is covered by a test: record in the 5 domains → "restart" (fresh adapters over
    the same store) → recover → identical state.

**Guardrails**
17. `npm run test` and `npx tsc --noEmit` pass; `cargo check` in `src-tauri` passes.
18. No changes to tickets 02–08 domain rules, and no Acabado / 2da-oficial / lote / approval-workflow
    work.

---

## Risks

1. **Sync UI callback contracts (High).** 5 UI sections + 3 order views declare `(): string[]` and
   consume the result synchronously. Underestimating this produces React "objects are not valid as a
   React child" errors at runtime. It is loud, but it is 8 files of churn that the port signatures
   do not advertise.
2. **Silent domain-validation bypass (High).** Sub-problem 1. A Promise injected into
   `ObtenerParadaPorId` / `ObtenerDanoPorId` is truthy, so a dangling link would be accepted by the
   domain and only rejected by the FK. Mitigation is approach A plus a test that asserts the
   domain's own "el daño vinculado no existe" error still fires with the SQLite adapter.
3. **Review budget: this change will exceed 400 changed lines (High, certain).** 5 tables +
   5 SQLite adapters + 5 port evolutions + 5 in-memory adaptations + migration + Rust + recovery +
   `main` + `App` + 5 UI sections + 3 order views + ~15 test files. The A–G ticket structure maps
   naturally onto chained PR slices; with delivery strategy `ask-on-risk`, `sdd-tasks` must
   forecast this explicitly and `sdd-apply` must not start it as one oversized unit.
4. **`App.test.tsx` is 2062 lines (Medium).** It mounts App with all 5 in-memory adapters. The
   async evolution touches it broadly; each affected test needs an `await act()` wrapper
   (pattern already at `App.test.tsx:48`).
5. **`PRAGMA foreign_keys = ON` is applied once per `initDatabase()` (Medium, needs runtime
   verification).** `database.ts:39` runs the pragma on the handle returned by `Database.load()`.
   SQLite treats `foreign_keys` as a **per-connection** setting; if tauri-plugin-sql serves
   `execute`/`select` from a pool, enforcement could be inconsistent across connections, silently
   weakening the FKs of adopted decision 4. This cannot be proven in this environment (see risk 6) —
   it needs a runtime check on the real Tauri binary before FK guarantees are claimed.
6. **No real-runtime validation available (Medium, established).** Following 10.9, the tests are
   mock/contract tests: the fake simulates SQLite semantics; the Rust-side application of 004
   (checksum recording, actual DDL execution) stays unverified until it runs on the real binary.
   Keep the project's honesty note convention in every affected test file header.
7. **Column-naming inconsistency (Low).** `machine_id`/`operario` (001) vs `maquina_id`/
   `operator_name` (domain). Cheap now, a permanent dual vocabulary if left undecided. Settle in
   `sdd-design`.
8. **Resolution-column gap (Low, already identified).** Covered in the schema section; if
   `sdd-propose` forgets it, `registradaPor` and the resolution timestamp are lost on restart.
9. **No date scoping on machine events (Low, by design).** Paradas, actividades, daños and
   mantenimientos have no `fechaOperativa`; recovery loads the machine's full history, exactly as
   the in-memory adapters do today. The dashboard has no historical navigation (ticket 04), so this
   is consistent — but a future "view a past day" feature will need a date predicate on the ports.

---

## Ready for Proposal

**Yes.** The domain decisions are closed (tickets 02–08), the persistence pattern is proven
(Phase 1, tickets 10.1–10.9), the schema is derivable from the domain types, and the schema
naming detail plus the resolution-column completion are settled enough to write down.

What the orchestrator should tell the user:

- The change is **large** and will exceed the 400-line review budget. The A–G structure should be
  turned into chained PR slices by `sdd-tasks` (e.g. A migration + Rust, B–F one repository each,
  G recovery + wiring), not delivered as one unit.
- Two points need explicit confirmation in the proposal, both completions of approved decisions
  rather than new ones: the `inspeccion_tela` resolution columns (`registradaPor`, resolution
  timestamp, authorization observations) and the column-naming convention
  (`machine_id`/`operario` vs `maquina_id`/`operator_name`).
- Runtime validation against the real Tauri binary remains an open item, as it already is for
  migrations 001–003.

Next phases: `sdd-propose` → `sdd-spec` → `sdd-design` → `sdd-tasks`.
