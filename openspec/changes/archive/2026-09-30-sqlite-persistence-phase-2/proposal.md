# Proposal: SQLite Persistence — Phase 2 (Operational Domains)

## Intent

Ticket 10 (SQLite Persistence) was scoped in two phases. Phase 1 closed with ticket 10 and
persisted only `jornada`, `orden` and `lectura_golpe`. The five operational domains — **parada**,
**actividad planificada**, **daño**, **inspección de tela** and **mantenimiento** — remain
**synchronous, in-memory only**.

The consequence is a silent data-loss bug that the operario de estampado cannot see: a `parada`, a
`limpieza`, a `carro 3` damage, a `devolución de tela` or an open `mantenimiento` registered before a
restart disappears. Everything those events feed is then recomputed from arrays that no longer
exist — **tiempo productivo**, the >3% **2da** alert, **buena racha**, machine state
(ANDANDO/PARADA/OCIOSA), and the **estado de tela** of each inspection.

This change closes the gap. It is a **persistence-only** change: the domain rules of tickets 02–08
are inviolable, `src/domain/**` gets zero diff, and no derived value is ever written to disk.

## Scope

In-scope projects: **`.` (frontend, TypeScript)** and **`src-tauri` (Rust shell)** — the Rust change
is the single `Migration { version: 4 }` registration plus the canonical SQL file location.

### In Scope

- **Migration 004** (`004_operational_events.sql`): 5 new tables (`parada`, `actividad_planificada`,
  `dano`, `inspeccion_tela`, `mantenimiento`), 59 columns, 5 physical foreign keys, 11 indexes —
  one for each query the ports actually issue, none speculative.
- **Migration registration**: byte-identical mirror under `src/store/sqlite/migrations/`,
  `CURRENT_MIGRATION_VERSION = 4`, five new names in `TABLES`, and `Migration { version: 4 }` in
  `src-tauri/src/lib.rs`. Migrations `001`/`002`/`003` are immutable (sqlx checksum: editing an
  applied migration fails startup with `VersionMismatch`).
- **Async contract evolution** of the 5 ports (26 methods: paradas 6, actividades 5, daños 6,
  inspecciones 4, mantenimiento 5) — `Promise<>` added, method names and semantics unchanged.
- **5 in-memory adapters** adapted to the async contracts with identical observable behaviour
  (explicit insert vs update, duplicate-id rejection, unknown-id rejection, defensive clone,
  chronological ordering).
- **5 new SQLite repositories** mirroring `sqliteOrderRepository.ts` (Row interface + exported pure
  mappers `mapXRow` / `mapXToSql` + class with `private db: Database`).
- **`campos_especificos` as validated JSON TEXT** for `parada`; `campos_especificos` is
  `Record<string, unknown>`, so JSON is the storage form. Invalid JSON is a **mapping error with the
  original `cause`**, never a silent `{}` and never a swallowed failure.
- **Inspection checklist as flat columns** (5 items + `otraAnomalia` + the full
  `ResolucionInspeccion` set). `conAnomalia` and `estadoInspeccion` stay **derived** and are
  recomputed on every read.
- **Recovery extension**: `RecoveryState` grows from 3 to 8 fields; the 5 repositories are added to
  the recovery composition; a null/absent `orden` yields an empty inspection list.
- **Application wiring**: `main.tsx` constructs and injects the 5 SQLite adapters; `App` seeds from
  the recovered state, `await`s persistence before touching React state, and re-seeds afterwards.
- **UI contract evolution** in the 8 files that declare `(): string[]` callbacks — the UI blast radius
  is real and is fixed inside this change.
- **Tests**: 5 port contract suites updated to async, 5 new SQLite adapter suites, a migration-004
  SQL-contract suite (modelled on `migration003.test.ts`), a recovery extension suite, a startup
  wiring suite, and a **restart-survival** integration case.

### Out of Scope

- **Domain rules of tickets 02–08.** No change to any validation, invariant, or error message. The
  target is a **zero diff in `src/domain/**`**.
- **Persisting derived values**: `tiempo productivo`, any duration, projected `2da`, the >3% alert,
  `buena racha`, `conAnomalia`, `estado de tela`, `deltaGolpes`, production progress, machine state.
- **Acabado / official quality classification** and any synchronization channel with it. The
  dashboard keeps the operational suspicion model; official data flow is still undefined.
- **A persistent `lote` entity.** `lote` stays free text on the inspection; the 10.9-style honesty
  note is preserved.
- **Any approval workflow or permission system.** Gerencia's authorization stays a documentary
  record (`autorizadoPor` + timestamp), not a state machine.
- **Date scoping / historical navigation** for machine events. Recovery loads the machine's full
  history exactly as the in-memory adapters do today; the dashboard has no past-day navigation
  (ticket 04), so this is consistent — but a future "view a past day" feature will need a date
  predicate on the ports.
- **Deleting or editing closed records.** Nothing in the ports deletes; this change adds no delete
  path.
- **Editing `001`/`002`/`003`, or their Rust registrations.** One new migration, applied once.
- **Runtime validation against the real Tauri binary.** Unavailable in this environment, exactly as
  for migrations 001–003 (see Risks).

## User Stories

| # | As a… | I want… | So that… |
|---|---|---|---|
| US1 | operario de estampado | a `parada` I registered before lunch to still exist after a restart | the machine state reads PARADA and the stop blocks lecturas honestly, instead of silently pretending the machine never stopped |
| US2 | operario de estampado | a `cambio de diseño` / `limpieza` / `almuerzo` period to survive a restart | **tiempo no productivo planificado** is not lost and **tiempo productivo** is not inflated by work that was actually planned |
| US3 | operario de estampado | a `daño` (with its `carro`, its `causoParada` flag, its `posibleSegunda` suspicion and the `unidadesSospechadas`) to survive a restart | the 2da projection and the alert are computed from real suspicions, not from an empty list that always reads "0%" |
| US4 | operario de estampado | an open `mantenimiento` (en progreso) to survive a restart | the dashboard still shows what the machine is being repaired for, and I cannot register a second open one on a machine that already has one |
| US5 | operario de estampado | every `inspección de tela` — checklist, `lote`, `otra anomalía`, resolution, **who registered it and when** — to survive a restart | the `estado de tela` (conforme / no usable / devuelta / uso autorizado) is still derivable per inspection after the shift is resumed |
| US6 | operario de estampado | a `devolución de tela` to keep its `motivo`, its `registradaPor` and its timestamp across a restart | the documentary trail of who returned the fabric and why is not lost — this is the finding that completes the flat-column decision |
| US7 | the machine | a broken `parada` → `daño` → `mantenimiento` chain to be re-established from the database | linked-entity queries are answered by the database (indexed, referentially enforced) instead of by in-memory arrays |
| US8 | the reviewer | the five domains to be persisted **one domain per reviewable slice** | the change does not arrive as a single oversized diff that no reviewer can actually hold in their head |
| US9 | the operario | a persistence failure to surface as an error **and leave the visible state untouched** | I never believe a record was saved when it was not — no silent fire-and-forget writes |

## Capabilities

> Contract for `sdd-spec`. `openspec/specs/` is currently empty (`.gitkeep` only) — no capability
> exists yet, so **nothing is modified at the requirement level**. All three below are new.

### New Capabilities

- **`operational-events-schema`**: the durable shape of the five operational domains — migration
  004 DDL (tables, columns, nullability, 5 FKs, 11 indexes), the persisting/none-persisting
  boundary, `campos_especificos` JSON TEXT with hard failure on invalid JSON, the `boolean → 0/1
  INTEGER` encoding for the two independent `daño` flags, flat inspection checklist columns, the
  completeness of the `ResolucionInspeccion` column set, migration immutability (001/002/003),
  canonical file + byte-identical mirror + `CURRENT_MIGRATION_VERSION` + Rust registration.
- **`operational-repository-contracts`**: the 26 port methods become `Promise`-returning with
  unchanged names and semantics; the 5 in-memory adapters keep identical observable behaviour; the 5
  SQLite adapters expose pure exported mappers, reject duplicate inserts and unknown-id updates,
  propagate failures descriptively, and recompute derived inspection state on read instead of reading
  it from a column.
- **`operational-recovery-wiring`**: recovery returns sources only (never derivations) for the 5
  domains with the correct read order (orden before inspections); `main.tsx` composes and injects the
  adapters; `App` awaits persistence before mutating React state, re-seeds afterwards, lifts
  render-body reads into state, pre-resolves the domain's synchronous entity lookups so a `Promise`
  can never be mistaken for a linked entity, and the 8 UI files consume `Promise`-returning
  callbacks.

### Modified Capabilities

**None.** `openspec/specs/` contains no existing capability specs, and the change introduces no new
requirement on the Phase 1 domains (`jornada`, `orden`, `lectura_golpe`) — `RecoveryState` gains
fields, which is additive behaviour inside the new capability above, not a change to a specified
capability.

## Approach

### Architecture affected

Hexagonal layering is preserved end to end — `src/domain` (pure) → `src/store` (ports + adapters)
→ `src/ui` (React). The only structural change is at the composition root.

```
main.tsx  ── initDatabase() → 8 SQLite repos → materializarPrograma() → recover…State() → <App estadoInicial>
                                                                                              │
App (async handlers)  ── domain (pure, sync) ──▶ awaited repo write ──▶ re-seed state ──▶ UI (await callbacks)
```

### Migration 004 — entities and tables

One `CREATE TABLE` per domain, single-column-per-ASCII-snake_case, singular table names, matching
the `jornada` / `orden` / `lectura_golpe` convention. **No CHECK constraints and no DEFAULTs** —
validation stays in the domain, following 001/002/003.

**`parada`** (9 columns)

| Column | Type | Source |
|---|---|---|
| `id` | TEXT PK | `Parada.id` (domain-generated `crypto.randomUUID()`) |
| `machine_id` | TEXT NOT NULL | `maquinaId` |
| `orden_id` | TEXT NULL, **FK → `orden(id)`** | `ordenId` (null = stop without an order) |
| `operario` | TEXT NOT NULL | `operatorName` |
| `causa_id` | TEXT NOT NULL | `causaId` (one of the 10 `CausaParadaId`; domain validates) |
| `campos_especificos` | TEXT NOT NULL | `camposEspecificos` — **JSON TEXT** |
| `observaciones` | TEXT NULL | `observaciones?` |
| `inicio` | TEXT NOT NULL | `inicio` |
| `fin` | TEXT NULL | `fin` — NULL = open; `ParadaAbierta` is a **type alias**, never stored |

**`actividad_planificada`** (8 columns): `id` PK · `machine_id` NOT NULL · `tipo` NOT NULL ·
`inicio` NOT NULL · `fin` NULL · `que_se_limpio` NULL · `observaciones` NULL · `operario` NOT NULL.
**No `orden_id`** — the model has no `ordenId` by design (registrable on an empty day).

**`dano`** (14 columns): `id` PK · `machine_id` NOT NULL · `orden_id` NULL **FK → `orden`** ·
`operario` NOT NULL · `tipo` NOT NULL · `componente` NOT NULL · `inicio` NOT NULL · `fin` NULL ·
`solucion_aplicada` NULL · `causo_parada` INTEGER NOT NULL · `parada_id` NULL **FK → `parada`** ·
`posible_segunda` INTEGER NOT NULL · `unidades_sospechadas` INTEGER NULL · `observaciones` NULL.

The 0/1 encoding mirrors `orden.aplica_segunda` from 003 (`row.aplica_segunda === 1`). The two flags
are **independent**: no CHECK ties `causo_parada`, `parada_id` and `posible_segunda` together —
that coupling is a domain rule, and the domain is the only thing that owns it.

**`inspeccion_tela`** (18 columns): `id` PK · `orden_id` **NOT NULL, FK → `orden`** · `operario` NOT
NULL · `lote` NULL · `absorcion` NOT NULL · `tundido` NOT NULL · `manchas` NOT NULL · `dimensiones`
NOT NULL · `estado_general` NOT NULL · `otra_anomalia` NULL · `timestamp` NOT NULL · `observaciones`
NULL · `resolucion` NULL · `motivo_devolucion` NULL · `autorizado_por` NULL · **`registrada_por` NULL ·
`resolucion_timestamp` NULL · `autorizacion_observaciones` NULL**.

The five checklist columns are `NOT NULL` because `validarChecklist` guarantees **exactly 5 items
with explicit state** — there is no legitimate "unknown" to store.

**`mantenimiento`** (10 columns): `id` PK · `machine_id` NOT NULL · `tipo` NOT NULL · `operario` NOT
NULL · `motivo` NOT NULL · `inicio` NOT NULL · `fin` NULL · `que_se_reviso_reparo` NULL · `dano_id`
NULL **FK → `dano`** · `observaciones` NULL. **No `orden_id`** and **no `duracion`** — maintenance is
machine-level, not tied to an order, and duration is always derived (ADR 0007).

**Indexes — 11, one per real query**

| Index | Serves |
|---|---|
| `idx_parada_maquina_inicio (machine_id, inicio)` · `idx_actividad_maquina_inicio` · `idx_dano_maquina_inicio` · `idx_mantenimiento_maquina_inicio` | `listarPorMaquina` — machine events, chronological |
| `idx_parada_abierta (machine_id, orden_id) WHERE fin IS NULL` | `getParadaAbierta(maquinaId, ordenId)` |
| `idx_actividad_abierta (machine_id, tipo) WHERE fin IS NULL` | `getActividadAbierta(maquinaId, tipo)` |
| `idx_dano_abierta (machine_id) WHERE fin IS NULL` | `getDanoAbierto(maquinaId)` |
| `idx_mantenimiento_abierta (machine_id) WHERE fin IS NULL` | `getMantenimientoAbierto(maquinaId)` |
| `idx_parada_orden (orden_id)` · `idx_dano_orden (orden_id)` | per-order events; `listarPorOrden` (also the 2da projection input) |
| `idx_inspeccion_orden (orden_id, timestamp)` | `listarPorOrden` — per order, chronological |

`obtenerPorId` needs no extra index (primary key). **Deliberately absent**: any index on
`dano.parada_id`, `mantenimiento.dano_id`, `actividad.tipo` alone, or a `dano.orden_id`-only index —
none is a query the ports issue, and nothing is ever deleted, so SQLite never has to chase a foreign
key.

### Persistence rules — what is stored vs. derived

| Persisted (source of truth) | Derived — NEVER persisted |
|---|---|
| `parada`: id, machine, order link, operario, causa, `campos_especificos` (JSON), observaciones, inicio, fin | open/closed **duration**, accumulated duration |
| `actividad_planificada`: all 8 fields | its contribution to **tiempo no productivo planificado** |
| `dano`: all 14 fields including the two independent flags | the 2da **projection**, the >3% **alert**, the 5% monthly target, **buena racha** |
| `inspeccion_tela`: id, order, operario, lote, the 5 checklist states, otra anomalía, timestamp, observaciones, the full resolution set | **`conAnomalia`**, **`estadoInspeccion`** (conforme / no usable / devuelta / uso autorizado) |
| `mantenimiento`: all 10 fields | its duration, and any **tiempo** deduction (ADR 0007 — documentary only) |
| — | **tiempo productivo**, all durations, machine state (ANDANDO/PARADA/OCIOSA), `deltaGolpes`, production progress |

The rule is a single sentence: **a column exists only where the domain holds the value as
independent input. Anything the domain computes from other values is recomputed on read.** This
mirrors what Phase 1 already does for `orden` — `iniciadaEn` and `contadorBase` are derived from
`lecturas[0]`, not stored.

### Recovery strategy

`recoverPhase1State` (or its successor) keeps its existing promise: **return sources only, never
derivations.** The composition stays contract-based — it receives repository interfaces, never a raw
`Database`, and never emits SQL.

- `RecoveryState` grows from 3 to 8 fields. Read order matters and is explicit: `jornada` → `orden` →
  `lecturas` → the four machine-event lists → `inspecciones`, because `inspeccionRepository
  .listarPorOrden(orden.id)` needs the recovered `orden`. **A null or absent `orden` yields an empty
  inspection list** — an inspection is an event of an order, never a general machine event, and a
  day without an order has none.
- Machine-event lists carry the machine's full history, exactly as the in-memory adapters do today
  (no date scoping — see Out of Scope).
- `main.tsx` keeps the existing startup discipline: a failure in any of the steps renders
  `InicializacionFallida` and **the app never mounts with partial state**. Extending recovery to 8
  fields does not weaken that.
- `App` seeds its arrays from `estadoInicial` for the first paint **and keeps its mount loaders**
  (converted to the `cancelled`-flag async pattern already used at `App.tsx:156-177`), because a test
  injecting a different `hoy` must not show stale recovered data. This is the 10.8 precedent applied
  uniformly.

### Async strategy — including the sync-lookup bypass

Adopted pattern: **async repositories / promise-based ports, pure sync domain, `await`ed persistence,
then re-seed state. Never fire-and-forget.** The three seams that pattern exposes, and how each is
resolved:

**1. The domain's entity lookups are synchronous by contract — highest correctness risk.**
`ObtenerParadaPorId` (`src/domain/danos.ts:53`) and `ObtenerDanoPorId` (`src/domain/types.ts:362`)
are `(id: string) => Parada | undefined` / `=> Dano | undefined`. If the repository becomes async and
the injection is not adapted, the domain receives a **Promise — which is truthy** — so
`if (!parada)` never fires and a **non-existent linked entity is accepted**. The physical FK would
eventually reject the write, but the operator would see a confusing constraint error instead of the
domain's own *"el daño vinculado no existe"*.

**Decision: Approach A — pre-resolve in `App`, keep the domain untouched.** Before invoking the
domain, `App` `await`s the lookup from the repository and injects a synchronous closure over the
state it just refreshed: `(id) => paradas.find(p => p.id === id)` and
`(id) => danos.find(d => d.id === id)`. Zero domain diff, zero behaviour change, domain stays pure,
the validated entity comes from the database at the moment of use, and there is no second read path
to go stale. The cost is one extra `await` per `registrarDano` / `registrarMantenimiento` call.

*Rejected, and why:* making the domain lookup async would make `registrarDano` /
`registrarMantenimiento` async, put I/O in the pure domain, break the hexagonal rule in
`openspec/config.yaml`, and invalidate `src/domain/danos.test.ts` (520 lines) and
`src/domain/mantenimiento.test.ts` (636 lines). A memoized synchronous cache over the async
repository would introduce a second read path that can go stale — effectively a second persistence
strategy. Both are rejected on principle, not on effort.

**2. Repository reads in the render body.** `App.tsx:583` (`getDanoAbierto`), `:605`
(`getMantenimientoAbierto`) and `:626` (`listarPorOrden`) run during render and cannot await. They are
lifted into React state — `danoAbiertoDeMaquina`, `mantenimientoAbiertoDeMaquina`, `danosDeOrden` —
seeded by the mount loader and refreshed after every mutation, which is the shape the UI sections
already consume today (they take values, not repositories).

**3. The UI callback contracts.** Five UI sections and three order views declare
`onRegistrarX(input): string[]` / `onCerrarX(...): string[]` and consume the result **synchronously**
(`DanoSection.tsx:139,159`, `MantenimientoSection.tsx:119,136`, `ActividadesSection.tsx:73,90`,
`ParadasSection.tsx:93,111`, `InspeccionTelaSection.tsx:131,146,159`). They evolve to
`Promise<string[]>`; the sections `await` the result before inspecting `.length` or storing it in
state. A Promise returned into a sync path renders as a React child and throws — loud, not silent,
but all 8 files must change **inside this change**, because leaving them would ship a broken UI.

**Failure semantics.** A mutation `await`s its write **before** React state changes. A persistence
failure surfaces the error to the operario (same shape as the existing order/lectura handlers) and
leaves the visible state untouched. No background writer, no retry queue, no optimistic UI.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src-tauri/migrations/004_operational_events.sql` | New | Canonical DDL: 5 tables, 59 columns, 5 FKs, 11 indexes |
| `src/store/sqlite/migrations/004_operational_events.sql` | New | Byte-identical mirror |
| `src/store/sqlite/migrations/index.ts` | Modified | `CURRENT_MIGRATION_VERSION` 3 → 4; `TABLES` gains 5 names |
| `src-tauri/src/lib.rs` | Modified | Register `Migration { version: 4, description, kind: Up }` |
| `src/store/paradasRepository.ts` | Modified | 6 methods → `Promise` |
| `src/store/actividadesRepository.ts` | Modified | 5 methods → `Promise` |
| `src/store/danosRepository.ts` | Modified | 6 methods → `Promise` |
| `src/store/inspeccionRepository.ts` | Modified | 4 methods → `Promise` |
| `src/store/mantenimientoRepository.ts` | Modified | 5 methods → `Promise` |
| `src/store/inMemory{Paradas,Actividades,Danos,Inspeccion,Mantenimiento}Repository.ts` | Modified | Wrap bodies in `async` / `Promise.resolve()`, same semantics |
| `src/store/sqlite/sqliteParadaRepository.ts` | New | Row + `mapParadaRow` / `mapParadaToSql` + JSON TEXT handling |
| `src/store/sqlite/sqliteActividadPlanificadaRepository.ts` | New | Same pattern |
| `src/store/sqlite/sqliteDanoRepository.ts` | New | Same pattern, 0/1 flag encoding |
| `src/store/sqlite/sqliteInspeccionTelaRepository.ts` | New | Flat checklist mapping; recomputes `conAnomalia` / `estadoInspeccion` |
| `src/store/sqlite/sqliteMantenimientoRepository.ts` | New | Same pattern |
| `src/store/sqlite/recovery.ts` | Modified | `RecoveryState` 3 → 8 fields; 5 repository parameters; orden-before-inspections read order |
| `src/main.tsx` | Modified | Construct 5 SQLite repos, pass to recovery and to `<App>`; drop the in-memory wiring for paradas/actividades |
| `src/App.tsx` | Modified | **Highest-risk file.** Async handlers; pre-resolved sync lookups; render-body reads → state; mount loaders → `cancelled`-flag async; seed from `estadoInicial` |
| `src/ui/ParadasSection.tsx`, `ActividadesSection.tsx`, `DanoSection.tsx`, `MantenimientoSection.tsx`, `InspeccionTelaSection.tsx` | Modified | Callbacks → `Promise<string[]>`; `await` before consuming |
| `src/ui/OrderInProduction.tsx`, `OrderAvailable.tsx`, `OrderFinished.tsx` | Modified | Re-export the async callback types |
| `src/store/{paradas,actividades,danos,mantenimiento}Repository.test.ts`, `inMemoryInspeccionRepository.test.ts` | Modified | Port contract suites → async |
| `src/App.test.tsx` (2062 lines) | Modified | Widest test surface; affected tests need `await act(...)` |
| `src/store/sqlite/__tests__/migration004.test.ts` | New | SQL contract, modelled on `migration003.test.ts` (569 lines) |
| `src/store/sqlite/__tests__/sqlite*Repository.test.ts` (5) | New | Per-adapter suites |
| `src/store/sqlite/__tests__/recovery.test.ts`, `startup.test.ts` | Modified | Recovery extension + startup composition |
| `src/__tests__/persistence-integration.test.ts` | Modified | Restart-survival case |
| `src/domain/**` | **Unchanged** | Zero diff — enforced as an acceptance criterion |

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | **Review budget: certain to exceed 400 changed lines.** ~30 files across 4 layers plus ~15 test files. Delivered as one unit, it is unreviewable. | High (certain) | Delivery strategy is `ask-on-risk`. `sdd-tasks` MUST forecast this explicitly, MUST emit the guard lines, and `sdd-apply` MUST NOT start it as one oversized unit. Slice forecast below. |
| R2 | **Silent domain-validation bypass.** A `Promise` injected into `ObtenerParadaPorId` / `ObtenerDanoPorId` is truthy, so a dangling link is accepted by the domain and only caught by the FK — as a confusing constraint error. | High | Approach A (pre-resolve + closure over refreshed state) + a test asserting the domain's own *"el daño vinculado no existe"* still fires with the SQLite adapter. |
| R3 | **UI blast radius underestimation.** 8 UI files declare `(): string[]` and consume synchronously. Port signatures do not advertise this. | High | Enumerated in Affected Areas; folded into the same change, not deferred. Failure mode is loud (React child error), not silent. |
| R4 | **`App.test.tsx` is 2062 lines** and mounts `App` with all 5 in-memory adapters. The async evolution touches it broadly. | Medium | Split by slice; the `await act(...)` pattern already exists at `App.test.tsx:48`. Do not rewrite the file. |
| R5 | **`PRAGMA foreign_keys = ON` is set once per `initDatabase()`** (`database.ts:39`) and SQLite treats `foreign_keys` as a **per-connection** setting. If tauri-plugin-sql serves `execute`/`select` from a pool, FK enforcement could be inconsistent across connections, silently weakening the FK guarantees. | Medium (unverified) | Cannot be proven in this environment — needs a runtime check on the real Tauri binary before any FK guarantee is claimed. Carry the honesty note. |
| R6 | **No real-runtime validation available** (same as 10.9). Tests are mock/contract tests; Rust-side application of 004 (checksum recording, actual DDL execution) stays unverified. | Medium (established) | Keep the project's honesty-note convention in every affected test file header. Do not claim runtime verification. |
| R7 | **Resolution-column gap.** `ResolucionInspeccion` also carries `registradaPor`, its own `timestamp` and — for the authorization branch — its own `observaciones`. Without the three extra columns, a `devolución` loses its registered-by data on restart. | Low (already identified) | Addressed explicitly in the schema section: `registrada_por`, `resolucion_timestamp`, `autorizacion_observaciones`. |
| R8 | **Column-naming duality.** `machine_id`/`operario` (001) vs `maquina_id`/`operator_name` (domain vocabulary). Cheap now, a permanent dual vocabulary if left undecided. | Low | 004 is new and never applied, so either is free today. Settled in `sdd-design`. |
| R9 | **Adapter lifecycle.** `App` uses `useMemo` for repository defaults to avoid a re-render loop. With `main.tsx` constructing stable instances this is fine, but a per-render `new Sqlite…(db)` would re-trigger every loader. | Low | Construct the adapters once in `main.tsx`; keep the `useMemo` defaults for tests. |
| R10 | **No date scoping on machine events** (by design). A future "view a past day" feature will need a date predicate on the ports. | Low | Documented as out of scope; the ports are the place to add it later. |

### Slice forecast (for `sdd-tasks`; the strategy itself is decided there, not here)

The change is expected to be delivered as reviewable slices under the 400-line budget. Natural
boundaries, each autonomous with its own verification and rollback:

| Slice | Content | Capability |
|---|---|---|
| A | Migration 004 (canonical + mirror) + `index.ts` + `lib.rs` + SQL-contract suite | `operational-events-schema` |
| B | Port async evolution + in-memory adaptation, one domain at a time | `operational-repository-contracts` |
| C–F | One SQLite repository each, in the same order | `operational-repository-contracts` |
| G | Recovery + `main.tsx` + `App` + the 8 UI files + restart-survival test | `operational-recovery-wiring` |

`sqlite-persistence-phase-2` will not be applied as a single oversized unit. Chained vs stacked vs
`size:exception` is decided in `sdd-tasks` under `ask-on-risk`.

## Rollback Plan

- **Before 004 is applied to a real database**: drop the slice. The migrations are additive — no
  existing table is altered — so reverting the code leaves `001`–`003` untouched and valid.
- **If 004 has been applied and must be undone**: the project registers **Up-only** migrations with
  no Down path (same as 001/002/003), so a schema rollback uses the table-rebuild precedent
  documented in ticket 10.9: stop the app, remove the five tables, and reset the `_sqlx_migrations`
  bookkeeping for version 4. **Every `parada`, `actividad`, `daño`, `inspección` and `mantenimiento`
  row is lost** — the rollback is destructive and only acceptable before real data exists.
- **If 004 is reverted in code but 004 is already applied**: the extra tables are inert and ignored;
  the app falls back to Phase 1 behaviour (jornada/orden/lecturas only), which is the pre-change
  state and remains fully functional.
- **Per-slice rollback**: each slice above has a clear finish and can be reverted independently; no
  slice depends on a later one except the ordering A → B..F → G.
- **Never** edit or rename `001`, `002`, `003` as a rollback mechanism — sqlx checksum validation
  fails startup with `VersionMismatch`.

## Dependencies

- Ticket 10 (Phase 1) — closed. Provides the async repository pattern, the recovery composition, the
  migration registration mechanism and the `mapXRow` / `mapXToSql` mapper convention this change
  mirrors.
- Tickets 02–08 — closed. The inviolable domain rules and the canonical type shapes that define the
  columns.
- Ticket 09 (DashboardHome) — closed. Consumes machine state, open `parada` and open
  `mantenimiento` derived from state, so those must be correct after recovery.
- No new external dependency, no new library, no new tooling.

## Preliminary Acceptance Criteria

To be formalized as Given/When/Then scenarios in `sdd-spec`.

**Schema (004)**

1. `004` creates exactly 5 tables and the 11 listed indexes — nothing else.
2. `001`, `002`, `003` are byte-unchanged, canonical and mirror alike.
3. The canonical file and the mirror are byte-identical; `CURRENT_MIGRATION_VERSION = 4`; `lib.rs`
   registers version 4 with `MigrationKind::Up`; `TABLES` lists all 8 tables.
4. Every source-of-truth domain field has a column; **no** derived value has one
   (`tiempo productivo`, durations, projected `2da`, >3% alert, `buena racha`, `conAnomalia`,
   `estado de tela`, `deltaGolpes`, progress, machine state).
5. `mantenimiento` and `actividad_planificada` have **no** `orden_id`; `inspeccion_tela.orden_id` is
   NOT NULL; all 5 FKs are declared; the resolution columns cover the full `ResolucionInspeccion`
   union **including `registradaPor`, the resolution timestamp and the authorization observations**.
6. `causo_parada` and `posible_segunda` are independent 0/1 INTEGERs with no CHECK tying them to
   other fields.

**Contracts and adapters**

7. All 5 ports are async; method names and semantics unchanged (26 methods).
8. All 5 in-memory adapters satisfy the async contracts with **identical observable behaviour**
   (duplicate-id rejection, unknown-id rejection, defensive clone, chronological order).
9. `src/domain/**` has **zero diff**.

**Repositories**

10. Each SQLite adapter exposes pure exported mappers and writes the exact column set of its table.
11. Duplicate insert and unknown-id update are rejected, matching the in-memory contract.
12. `campos_especificos` round-trips as JSON; **invalid JSON raises a descriptive error carrying the
    original `cause`** — never a silent `{}`, never a swallowed failure. An empty record round-trips
    as `{}`.
13. `conAnomalia` / `estadoInspeccion` are recomputed after a read, never read from a column.

**Recovery and wiring**

14. `RecoveryState` carries the 5 domains; a null/absent order yields an empty inspection list; the
    orden-before-inspections read order holds.
15. `main.tsx` constructs the 5 SQLite adapters, recovers, and passes them to `<App>`; a startup
    failure still renders `InicializacionFallida` and never mounts partial state.
16. A mutation awaits persistence **before** state is updated; a persistence failure surfaces the
    error and leaves state untouched. **No fire-and-forget, no background writer.**
17. `App` injects a **synchronous** closure into `ObtenerParadaPorId` / `ObtenerDanoPorId`; the
    domain's own *"el daño vinculado no existe"* error still fires with the SQLite adapter.
18. All 8 UI files await their callbacks; no `Promise` reaches a React child.
19. **Restart survival** is covered by a test: record in the 5 domains → "restart" (fresh adapters
    over the same store) → recover → identical state.

**Guardrails**

20. `npm run test` and `npx tsc --noEmit` pass in `.`; `cargo check` passes in `src-tauri`.
21. No change to ticket 02–08 domain rules; no Acabado, official-2da, `lote` entity or approval
    workflow work.

## Open Decisions

**Not re-opened — completions of approved decisions, recorded here explicitly.**

- **Inspection resolution columns.** Adopted decision 3 lists a flat checklist; the real
  `ResolucionInspeccion` union additionally carries `registradaPor`, its own `timestamp` and the
  authorization branch's `observaciones`. This proposal **adds** `registrada_por`,
  `resolucion_timestamp` and `autorizacion_observaciones` to complete that decision. Same for
  `campos_especificos` JSON TEXT (decision 2) and the 5 FKs (decision 4). No adopted decision is
  changed by this document.
- **Approach A for the sync-lookup bypass** is decided here, as instructed, on top of exploration's
  recommendation. B and C are rejected on layering grounds.

**Genuinely open — for `sdd-design`.**

| # | Decision | Recommendation |
|---|---|---|
| D1 | Column naming: `machine_id` / `operario` (matches 001) vs `maquina_id` / `operator_name` (matches domain vocabulary) | **DECIDED in `design.md` (D1):** keep `machine_id` / `operario`. The three specs already name these columns, so **no spec rename is executed** and the 004 DDL is free to match 001. |
| D2 | `recoverPhase1State` — extend in place, or introduce a successor? | **DECIDED in `design.md` (D2a):** renamed to `recoverPersistedState`; `RecoveryState` keeps its name. The name must describe what the function promises, not which project phase introduced it. |
| D3 | Naming of the 5 new SQLite adapters | **DECIDED in `design.md` (D3):** the five names in `§Affected Areas` are **ratified** — `sqliteParadaRepository.ts`, `sqliteActividadPlanificadaRepository.ts`, `sqliteDanoRepository.ts`, `sqliteInspeccionTelaRepository.ts`, `sqliteMantenimientoRepository.ts`. They match the unanimous singular Phase 1 precedent and the port interface names. This row is retired; the file table above is the commitment. |

**Deferred to `sdd-tasks` / `sdd-apply`.**

- Delivery strategy under `ask-on-risk`: chained vs stacked vs `size:exception`. **This proposal
  forecasts that the budget is exceeded and does not decide the chain shape.**
- Runtime verification of `PRAGMA foreign_keys` and of 004's actual application on the real Tauri
  binary (R5, R6) — the same open item migrations 001–003 carry.

## Success Criteria

- [ ] A `parada`, `actividad planificada`, `daño`, `inspección de tela` and `mantenimiento` recorded
      before a restart are all present after the restart, with every source-of-truth field intact.
- [ ] After recovery, the dashboard derives the same machine state, `tiempo productivo` buckets, 2da
      projection, `buena racha` and per-inspection `estado de tela` it showed before the restart.
- [ ] `src/domain/**` has zero diff, and no ticket 02–08 rule was altered.
- [ ] No derived value exists in the schema; a test asserts it.
- [ ] The domain's own validation errors still fire with the SQLite adapters — a dangling
      `paradaId` / `danoId` is rejected by the domain, not by a foreign-key constraint.
- [ ] A persistence failure surfaces to the operario and leaves the visible state untouched.
- [ ] `npm run test` and `npx tsc --noEmit` pass; `cargo check` passes.
- [ ] The change is delivered as reviewable slices within the 400-line budget, each independently
      verifiable and revertible.
