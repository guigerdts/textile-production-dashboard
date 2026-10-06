# Operational Recovery and Wiring Specification

Capability: `operational-recovery-wiring`
Change: `sqlite-persistence-phase-2`
In-scope projects: `.` (frontend, TypeScript)

## Purpose

Specify the composition side of the change: how the five operational domains are reconstructed after
a restart, how the startup root constructs and injects the five SQLite adapters, and how the
application layer adapts to `Promise`-returning repositories without ever letting a `Promise` be
mistaken for a domain value or for a React child.

This capability owns four distinct obligations:

1. **Recovery** returns sources only, for all five domains, in a read order that satisfies the
   inspection query's dependency on the recovered `orden`.
2. **Startup** composes the adapters once, and never mounts partial state.
3. **Application handlers** `await` persistence before React state changes, re-seed afterwards, and
   pre-resolve the domain's synchronous entity lookups so the domain's own validation still fires.
4. **UI callbacks** become `Promise`-returning and are awaited by the 8 files that consume them
   synchronously today.

The schema is specified in `operational-events-schema`; the repository contracts are specified in
`operational-repository-contracts`.

## User Stories covered

| # | As a… | I want… | So that… |
|---|---|---|---|
| US1 | operario de estampado | a `parada` registered before lunch to still exist after a restart | the machine state reads PARADA and the stop blocks lecturas honestly, instead of silently pretending the machine never stopped |
| US2 | operario de estampado | a `cambio de diseño` / `limpieza` / `almuerzo` period to survive a restart | **tiempo no productivo planificado** is not lost and **tiempo productivo** is not inflated by work that was actually planned |
| US3 | operario de estampado | a `daño` with its `causoParada`, `posibleSegunda` and `unidadesSospechadas` to survive a restart | the 2da projection and the alert are computed from real suspicions, not from an empty list that always reads "0%" |
| US4 | operario de estampado | an open `mantenimiento` to survive a restart | the dashboard still shows what the machine is being repaired for, and I cannot register a second open one on a machine that already has one |
| US5 | operario de estampado | every `inspección de tela` — checklist, `lote`, resolution, who registered it and when — to survive a restart | the `estado de tela` is still derivable per inspection after the shift is resumed |
| US6 | operario de estampado | a `devolución de tela` to keep its `motivo`, `registradaPor` and its timestamp across a restart | the documentary trail of who returned the fabric and why is not lost |
| US8 | the reviewer | the five domains to be persisted **one domain per reviewable slice** | the change arrives as reviewable, independently verifiable units |
| US9 | the operario | a persistence failure to surface as an error **and leave the visible state untouched** | I never believe a record was saved when it was not — no silent fire-and-forget writes |

## Referenced domain rules — NOT redefined here

The wiring re-invokes existing domain functions unchanged. It MUST NOT add, relax or reimplement any
of their rules:

| Rule | Source | How the wiring uses it |
|---|---|---|
| `validarLecturaConParadas` / `validarFinalizacionConParadas` — an open `parada` of the order blocks lecturas and finalización | ticket 02, ticket 04 | the handler computes these from the `paradas` state, which after recovery is the real persisted list |
| `resumenTiempoTurno` — derived from jornada, actividades and paradas with no manual entry and no double counting | ticket 04, `src/domain/tiempo.ts` | the render body keeps deriving; recovery supplies only the sources |
| `registrarDano` requires an existing linked `parada` (via the injected lookup), with the same machine, the same order and a non-earlier start | ticket 05, `src/domain/danos.ts` | the injected lookup MUST be a synchronous closure over refreshed state, so this validation still fires |
| `proyeccionSegundaDeOrden` and the >3% alert / 5% target / `buena racha` are derived from suspicion data and produced units | ticket 06, `src/domain/calidad.ts` | the 2da integration keeps reading a `listarPorOrden` result — now from state instead of the render body |
| `registrarInspeccion` requires an orden; a `devolución` is allowed only when derived production is 0; resolutions are exclusive | ticket 07 | the handler passes the recovered `orden` and the persisted inspection unchanged |
| `registrarMantenimiento` validates a linked `dano` through the injected lookup; the link is optional and never a precondition | ticket 08 | same synchronous-closure obligation as for `parada` |
| Machine state (ANDANDO / PARADA / OCIOSA), open-`parada` cause and accumulated duration, open-`mantenimiento` props for the dashboard home | ticket 09 | derived from recovered state; never persisted, never stored in a column |

## Requirements

### Requirement: Recovery returns sources for all five operational domains

The recovery composition MUST return the five operational domains alongside the three Phase 1
sources, so the recovered state grows from 3 to 8 fields: `jornada`, `orden`, `lecturas`, `paradas`,
`actividades`, `danos`, `mantenimientos`, `inspecciones`. Each value MUST come from the corresponding
repository contract; the composition MUST receive repository interfaces, MUST NOT receive a raw
`Database`, and MUST NOT emit SQL. Recovery MUST return **sources only, never derivations**:
`tiempo productivo`, durations, the 2da projection, the alert, `buena racha`, machine state,
`conAnomalia` and `estadoInspeccion` are never part of the recovered state — they are recomputed
afterwards by the existing domain layer.

#### Scenario: The recovered state carries the five operational domains

- GIVEN a database with a parada, an actividad, a daño, a maintenance and an inspection persisted
- WHEN recovery runs for the operational date
- THEN the returned state exposes `paradas`, `actividades`, `danos`, `mantenimientos` and
  `inspecciones` alongside `jornada`, `orden` and `lecturas`
- AND each list contains the persisted records

#### Scenario: Recovery returns no derived value

- GIVEN a fully populated database
- WHEN recovery runs
- THEN the returned state contains no time summary, no duration, no projected 2da, no alert flag, no
  `buena_racha`, no machine state and no inspection `estado`
- AND the composition performs no arithmetic over the recovered records beyond assembling the lists

#### Scenario: The composition stays contract-based

- GIVEN the recovery function's parameters
- WHEN they are inspected
- THEN they are the eight repository interfaces, never a `Database` instance
- AND the module contains no SQL string
- AND substituting fakes for the contracts is sufficient to test it

### Requirement: Inspections are read after the order, and an absent order yields none

Recovery MUST read in this order: `jornada` → `orden` → `lecturas` → the four machine-event lists →
`inspecciones`. The inspection read depends on the recovered `orden`, because an inspection is an
event of an order and is queried by `orden.id`. A `null` or absent `orden` MUST yield an **empty**
inspection list — not an error, and not a machine-wide query — because a day without an order has no
inspections.

#### Scenario: Inspections are recovered for the recovered order

- GIVEN an `orden` is recovered and two inspections are persisted for it
- WHEN recovery runs
- THEN `inspecciones` holds both inspections of that order, in chronological order
- AND the inspection read happens after the order read, not before

#### Scenario: A day without an order recovers no inspections

- GIVEN no `orden` exists for the operational date
- WHEN recovery runs
- THEN `orden` is `undefined` and `inspecciones` is an empty array
- AND the remaining domains are still recovered normally

#### Scenario: Inspections of other orders are not recovered

- GIVEN the operational date's order is `o-1` and an inspection exists for an unrelated order
- WHEN recovery runs
- THEN `inspecciones` contains only the inspections belonging to `o-1`

### Requirement: Machine-event lists carry the machine's full history

`paradas`, `actividades`, `danos` and `mantenimientos` MUST be recovered with the machine's complete
history, exactly as the in-memory adapters return it today. Recovery MUST NOT add a date predicate,
and recovery MUST NOT silently drop older records: the dashboard has no past-day navigation (ticket
04), so filtering by date would be a new behaviour rather than a persistence concern. A future
"view a past day" feature is expected to add a date predicate to the ports, not to recovery alone.

#### Scenario: Records from earlier dates survive a restart

- GIVEN paradas and daños persisted on several earlier dates for the same machine
- WHEN recovery runs for today's date
- THEN the returned machine-event lists include all of them
- AND no record is filtered out by date

#### Scenario: The chronological order of recovered lists matches the repository's

- GIVEN machine events stored out of chronological order
- WHEN recovery returns them
- THEN each list is in the same chronological order the repository produced, and recovery does not
  re-sort or reorder it

### Requirement: Startup constructs the five SQLite adapters once and injects them

`main.tsx` MUST construct one instance of each of the five SQLite adapters over the initialized
database, pass them to the recovery composition, and pass them to `<App>`. The hard-wired in-memory
wiring for `parada` and `actividad` MUST be removed from `main.tsx`. Because these instances are
stable, the `useMemo` defaults inside `App` — which exist so a test that injects nothing gets an
in-memory adapter instead of a new instance on every render — MUST be preserved. A per-render
`new Sqlite…(db)` MUST NOT be introduced anywhere.

#### Scenario: The startup composition passes SQLite adapters for all five domains

- GIVEN the startup sequence in `main.tsx`
- WHEN it is inspected
- THEN five SQLite repository instances are created after `initDatabase()` and before recovery
- AND the recovery call receives them
- AND the rendered `<App>` receives them through its repository props
- AND no `InMemoryParadaRepository` or `InMemoryActividadPlanificadaRepository` is constructed in
  `main.tsx` any more

#### Scenario: Adapters are constructed once, not per render

- GIVEN `main.tsx` constructs the adapters once at module-scope of the startup function
- WHEN the app re-renders
- THEN the same adapter instances are still in use
- AND the mount loaders do not re-fire because a repository identity changed

#### Scenario: Tests can still inject in-memory adapters

- GIVEN `App` is mounted in a test without passing the operational repository props
- WHEN the component initialises
- THEN it falls back to in-memory adapters through `useMemo` defaults
- AND the test needs no database

### Requirement: A startup failure still renders the failure screen and never partial state

A failure in any startup step — database initialisation, adapter construction, materialization or
recovery — MUST render the explicit initialization-failure screen and MUST NOT mount `App`. Extending
recovery from 3 to 8 fields MUST NOT weaken this discipline: the app is either fully recovered or not
rendered at all.

#### Scenario: A recovery failure aborts startup

- GIVEN recovery rejects for any reason
- WHEN startup runs
- THEN the initialization-failure screen is rendered with the failure message
- AND `App` is never mounted
- AND no partially recovered state reaches the UI

#### Scenario: An operational-domain read failure is not swallowed

- GIVEN the `parada` read during recovery fails
- WHEN startup runs
- THEN the failure propagates to the same explicit failure screen
- AND it is not downgraded to an empty `parada` list

### Requirement: App seeds from the recovered state and keeps its mount loaders

`App` MUST seed its `paradas`, `actividades`, `danos`, `mantenimientos` and `inspecciones` state from
`estadoInicial` for the first paint, exactly as it already seeds `orden` and `jornada`. It MUST **also
keep** its mount loaders, converted to the `cancelled`-flag asynchronous pattern already used for the
order and jornada loaders, because `App` accepts an injectable `fechaOperativa` that the startup recovery does not
know about: a test injecting a different date must not display stale recovered data.

#### Scenario: The first paint shows the recovered operational state

- GIVEN a recovered state containing paradas and daños
- WHEN `App` mounts for the first time
- THEN its parada and daño lists are already populated from `estadoInicial`
- AND no intermediate empty flash of machine events is shown

#### Scenario: The mount loaders re-read the same repositories for the injected date

- GIVEN `App` is mounted with a `fechaOperativa` different from the one used to produce `estadoInicial`
- WHEN the mount loaders run
- THEN each operational domain is re-read through its repository contract for `fechaOperativa` / the machine
- AND the state is replaced with the re-read values
- AND a loader that resolves after unmount does not call a state setter

#### Scenario: A repository prop change re-runs the loader

- GIVEN the repository prop identity changes
- WHEN the effect re-runs
- THEN the domain is re-read and the state refreshed
- AND a stable repository identity does not re-trigger the loader on every render

### Requirement: Handlers await persistence before React state changes

Every handler that registers or closes an operational record MUST `await` its repository write
**before** mutating React state, and MUST re-read the domain from the repository afterwards to
re-seed the state. Fire-and-forget writes, background writers, retry queues and optimistic UI updates
are prohibited. The order is always: pure domain call → `await` persistence → re-seed state → return.

#### Scenario: Registering a parada persists before the UI reflects it

- GIVEN an order in production and a valid `RegistrarParadaInput`
- WHEN the handler is invoked
- THEN `registrarParada` runs and returns a `Parada`, and `insertParada` is awaited with that result
- AND only after it resolves is the parada list refreshed and the handler's empty error list returned
- AND the parada list is never updated from a fire-and-forget write

#### Scenario: Closing a maintenance persists before the UI reflects it

- GIVEN an open maintenance
- WHEN the close handler is invoked with a `fin` and a `queSeRevisoReparo`
- THEN `cerrarMantenimiento` runs, `updateMantenimiento` is awaited, and only then is the list
  refreshed and the handler's empty error list returned

#### Scenario: State is re-seeded from the repository, not from the local object

- GIVEN a successful write
- WHEN the handler re-seeds state
- THEN the refreshed list is the one returned by the repository read
- AND the domain object that was written is not spliced into local state by hand

#### Scenario: A domain rejection never reaches persistence

- GIVEN a `RegistrarDanoInput` that fails a domain rule
- WHEN the handler is invoked
- THEN the domain's error list is returned to the UI
- AND no repository write is attempted
- AND the visible state is unchanged

### Requirement: A persistence failure surfaces the error and leaves the visible state untouched

When a repository write rejects, the handler MUST return the error message in its error-list shape —
the same shape the existing order and lectura handlers already use — and MUST NOT have mutated any
React state. The failure MUST NOT be swallowed, retried in the background, or converted into an empty
error list that would read as success.

#### Scenario: A rejected insert reports the error and changes nothing

- GIVEN `insertParada` rejects for any reason
- WHEN the handler is invoked
- THEN the returned error list contains the failure message
- AND the parada list in the UI still shows exactly what it showed before the call
- AND the operario is not told the parada was recorded

#### Scenario: A rejected update reports the error and changes nothing

- GIVEN `updateMantenimiento` rejects
- WHEN the close handler is invoked
- THEN the error message is returned
- AND the open maintenance is still shown as open
- AND no partial state is applied

#### Scenario: A failure is never reported as success

- GIVEN any repository write that rejects
- WHEN the handler returns
- THEN the returned error list is non-empty
- AND the handler never returns an empty error list after a failed write

### Requirement: The domain's synchronous entity lookups are pre-resolved, not promised

`registrarDano` receives an `ObtenerParadaPorId` and `registrarMantenimiento` an `ObtenerDanoPorId` —
both `(id: string) => Entity | undefined`, **synchronous by contract**. Because the repositories are
now async, injecting a repository call directly would hand the domain a `Promise`, which is truthy, so
the `if (!entidad)` check would never fire and a non-existent linked entity would be accepted by the
domain and rejected later as a foreign-key constraint error.

The application layer MUST therefore **pre-resolve the lookup**: `await` the entity from the
repository, and inject a **synchronous closure over the state that was just refreshed** — for example
`(id) => paradas.find(p => p.id === id)` and `(id) => danos.find(d => d.id === id)`. The domain MUST
receive a function that returns the entity or `undefined`, never a `Promise`. Approaches that make the
domain lookup asynchronous, or that keep a separate memoized cache of the entities, are rejected: the
first would put I/O in the pure domain, the second would create a second read path that can go stale.

#### Scenario: A dangling `paradaId` is rejected by the domain, not by the database

- GIVEN a `RegistrarDanoInput` with `causoParada: true` and a `paradaId` that does not exist
- WHEN the handler is invoked with the SQLite adapters wired
- THEN the domain returns the error *"la parada vinculada no existe: <id>"*
- AND that error is what the operario sees
- AND no write is attempted, so no foreign-key constraint error is ever produced
- AND the visible state is unchanged

#### Scenario: A dangling `danoId` is rejected by the domain, not by the database

- GIVEN a `registro de mantenimiento reactivo` with a `danoId` that does not exist
- WHEN the handler is invoked with the SQLite adapters wired
- THEN the domain returns the error *"el daño vinculado no existe: <id>"*
- AND no write is attempted
- AND the visible state is unchanged

#### Scenario: A valid link is validated against the persisted entity

- GIVEN a `parada` persisted in the database with the same machine, the same order and a start not
  earlier than the damage
- WHEN a `daño` linking to it is registered
- THEN the domain accepts it and the record is persisted
- AND the entity the domain validated is the one just read from the database, not a stale copy

#### Scenario: The injected lookup is genuinely synchronous

- GIVEN the closure injected into `registrarDano` / `registrarMantenimiento`
- WHEN the domain calls it
- THEN the returned value is an entity or `undefined`
- AND it is never a `Promise`
- AND `src/domain/danos.test.ts` and `src/domain/mantenimiento.test.ts` pass unchanged

#### Scenario: A regression test fails if the lookup is ever promised again

- GIVEN a test that wires the SQLite adapters and registers a `daño` with a non-existent `paradaId`
- WHEN the handler runs
- THEN the test asserts the domain's own error message
- AND if a `Promise` were injected instead of a closure, the test would fail because the FK error would
  surface instead of the domain error

### Requirement: Repository reads in the render body are lifted into state

`getDanoAbierto("M1")`, `getMantenimientoAbierto("M1")` and `danoRepository.listarPorOrden(orden.id)`
are called during render today and cannot await. They MUST become React state — `danoAbiertoDeMaquina`,
`mantenimientoAbiertoDeMaquina` and `danosDeOrden` — seeded by the mount loaders and refreshed after
every mutation. This preserves the shape the UI sections already consume, because they take values,
not repositories. The reads MUST NOT be performed in the render body after the change.

#### Scenario: The open-daño and open-maintenance props come from state

- GIVEN a machine with an open `daño` and an open `mantenimiento`
- WHEN `App` renders
- THEN `danoAbiertoDeMaquina` and `mantenimientoAbiertoDeMaquina` are the state values passed to the
  damage and maintenance sections
- AND no repository call executes during the render body

#### Scenario: The 2da integration reads its inputs from state

- GIVEN an order in production and persisted `daños` for it
- WHEN the 2da integration is computed
- THEN it uses the `danosDeOrden` state value
- AND `proyeccionSegundaDeOrden` still computes the projection, the >3% alert, the 5% target and
  `buena racha` from that list — none of them stored

#### Scenario: State is refreshed after a mutation so the derived views stay correct

- GIVEN the open `daño` state is derived from a state variable
- WHEN a `daño` is closed
- THEN the state is refreshed before the next render
- AND the damage section no longer shows an open damage, and the dashboard home reflects it

### Requirement: The eight UI files consume Promise-returning callbacks

Five UI sections and three order views declare their operational callbacks as returning `string[]`
synchronously and consume the result synchronously. All eight files MUST evolve those declarations to
`Promise<string[]>` and MUST `await` the result before inspecting its `.length` or storing it in
state. A `Promise` MUST NOT reach a React child, and a section MUST NOT treat the `Promise` object
itself as the result. This is folded into this change rather than deferred, because port signatures do
not advertise this blast radius and shipping a partially adapted UI would break the operario's
workflow.

| File | Callbacks that become `Promise<string[]>` |
|---|---|
| `src/ui/ParadasSection.tsx` | `onRegistrarParada`, `onCerrarParada` |
| `src/ui/ActividadesSection.tsx` | `onRegistrarActividad`, `onCerrarActividad` |
| `src/ui/DanoSection.tsx` | `onRegistrarDano`, `onCerrarDano` |
| `src/ui/MantenimientoSection.tsx` | `onRegistrarMantenimiento`, `onCerrarMantenimiento` |
| `src/ui/InspeccionTelaSection.tsx` | `onRegistrarInspeccion`, `onDevolverInspeccion`, `onAutorizarInspeccion` |
| `src/ui/OrderInProduction.tsx` | re-exports the parada callbacks |
| `src/ui/OrderAvailable.tsx` | same re-export chain |
| `src/ui/OrderFinished.tsx` | same re-export chain |

#### Scenario: A section awaits the callback before reading the result

- GIVEN a damage section whose `onRegistrarDano` is invoked
- WHEN the handler's `Promise<string[]>` resolves
- THEN the section awaits it and only then checks whether the error list is empty
- AND the section never reads `.length` on the `Promise` object itself

#### Scenario: A close callback's result is awaited before it is stored

- GIVEN `setErroresCierre(onCerrarMantenimiento(fin, revisó))` in the shape it has today
- WHEN the callback becomes asynchronous
- THEN the section awaits the call and passes the resolved array to `setErroresCierre`
- AND no `Promise` is ever placed into a state value that is rendered

#### Scenario: No Promise reaches a React child

- GIVEN any of the eight files
- WHEN a callback result is rendered
- THEN only a resolved `string[]` is rendered
- AND no runtime "objects are not valid as a React child" failure occurs

#### Scenario: The re-export chain stays consistent

- GIVEN `OrderInProduction`, `OrderAvailable` and `OrderFinished` re-export the section callback types
- WHEN the section callback types become `Promise<string[]>`
- THEN all three order views re-export the same `Promise<string[]>`-returning types
- AND no view keeps a stale synchronous re-export

### Requirement: Restart survival is proven end to end

A test MUST record events in all five operational domains, simulate a restart by constructing fresh
adapters over the same store, run recovery, and assert the recovered state is identical to what was
recorded. This is the requirement that distinguishes this change from the Phase 1 state, and it is the
one that makes the success criteria of the change falsifiable.

#### Scenario: Every operational domain survives a restart

- GIVEN a parada, an actividad, a `daño`, an in-progress `mantenimiento` and an inspection are
  recorded through the real application handlers over the SQLite adapters
- WHEN the application is "restarted" — fresh adapter instances over the same store — and recovery runs
- THEN the recovered `paradas`, `actividades`, `danos`, `mantenimientos` and `inspecciones` are
  observably identical to what was recorded, field for field
- AND an in-progress `mantenimiento` is still in progress after recovery
- AND the inspection's checklist, `lote`, resolution, `registradaPor` and resolution timestamp all
  survive

#### Scenario: Derived values are recomputed identically after recovery

- GIVEN the state recorded before the "restart"
- WHEN the dashboard derives its values after recovery
- THEN the machine state, the `tiempo productivo` buckets, the 2da projection with its >3% alert, the
  `buena racha` state and the per-inspection `estado de tela` are the same before and after
- AND each is recomputed from the recovered sources rather than read from storage

#### Scenario: The domain rules of tickets 02–08 still hold over the persisted store

- GIVEN the SQLite adapters are wired and a domain rule is violated
- WHEN the operario's action is attempted
- THEN the domain's own validation rejects it with its own message
- AND `src/domain/**` has zero diff, enforced as an acceptance criterion of the change

#### Scenario: The guardrails pass

- GIVEN the change is complete
- WHEN `npm run test` and `npx tsc --noEmit` are run in `.`, and `cargo check` in `src-tauri`
- THEN all three pass
- AND the affected test suites that cannot exercise the real Tauri runtime keep the project's honesty
  note, so no suite claims runtime verification it does not have

### Requirement: Recovery is day-scoped, never full-history

`recoverPersistedState` MUST read the eight sources for the `fechaOperativa` it was given. The four
machine-event lists MUST be read via their **day-scoped** machine listings (not a day-free history
listing). The order of reads is the same fixed order: jornada → orden → lecturas → paradas → actividades
→ daños → mantenimientos → inspecciones. A failure at any read still propagates; no read is downgraded to
an empty list on failure.

Recovery MUST NOT apply any date predicate to `inspecciones` or to `lecturas` (they are reached through
the order); it MUST apply the day predicate only where specified.

#### Scenario: Recovery uses the day-scoped machine listings

- GIVEN a machine with events attributed to `D-1` and to `D`
- WHEN `recoverPersistedState` is called for day `D`
- THEN the paradas, actividades, daños and mantenimientos in the recovered state are those returned by
  their day-scoped listings for `D`
- AND they contain no record of `D-1`

#### Scenario: Recovery passes the day to the day-scoped listings

- GIVEN the call to `recoverPersistedState(fechaOperativa = D, maquinaId = "M1", ...)`
- WHEN it reads the four machine-event collections
- THEN each read supplies `D` (and `"M1"`) to the day-scoped listing
- AND no day-free machine listing is used

#### Scenario: Recovery's read order remains the fixed order

- GIVEN `recoverPersistedState`
- WHEN its read sequence is inspected
- THEN it is jornada → orden → lecturas → paradas → actividades → daños → mantenimientos → inspecciones
- AND the only declared dependency is the `orden` for `lecturas` and `inspecciones`

#### Scenario: Inspections remain order-reached

- GIVEN an `orden` exists for day `D`
- WHEN recovery runs for `D`
- THEN `inspecciones` is read by `inspeccionRepository.listarPorOrden(orden.id)`
- AND the day `D` is not passed to that call
- AND only the inspections of that order are returned

#### Scenario: Recovery returns sources only

- GIVEN recovery completes for a selected day
- WHEN it returns
- THEN its state contains only the eight persisted sources
- AND no derived value is present

### Requirement: Startup passes the selected day to recovery, and the app seeds from it

When the application is started with a selected day, `main.tsx` (or the startup composition path) MUST
pass that selected day to `recoverPersistedState`. The `App` component MUST receive that selected day as
its `fechaOperativa` and MUST seed its state from the recovered state that
belongs to that day. The first paint MUST show the recovered day, with no intermediate "today" shown.

#### Scenario: Startup passes the selected day to recovery

- GIVEN the application starts with selected day `D`
- WHEN recovery runs
- THEN `recoverPersistedState` receives `fechaOperativa = D`
- AND the recovered state contains only records of `D`

#### Scenario: The app uses the same selected day as its view

- GIVEN recovery was called for day `D`
- WHEN `App` mounts with `estadoInicial` from that recovery
- THEN `App`'s selected day is `D`
- AND the header shows `D` as the displayed day

#### Scenario: The first paint matches the recovered day

- GIVEN a recovered state for day `D` with an `orden` and some events
- WHEN `App` renders its first paint
- THEN the order and events shown are those of day `D`
- AND no state was seeded from a different day

### Requirement: Mount loaders use the selected day for day-scoped reads

The mount loaders inside `App` MUST reload the eight sources for the **selected** day, not for
`fechaOperativaHoy()`. The four machine-event loaders MUST call their day-scoped machine listings with
that selected day. The `cancelled`-flag pattern is preserved, and re-seeding happens only when the load
is not cancelled.

#### Scenario: The four machine-event loaders use the day-scoped listings with the selected day

- GIVEN `App` has selected day `D`
- WHEN its mount loaders run
- THEN `paradaRepository`, `actividadRepository`, `danoRepository` and `mantenimientoRepository` are each
  called via their day-scoped machine listings with `(machineId="M1", fechaOperativa=D)`
- AND no day-free listing is used

#### Scenario: The jornada and order loaders use the selected day

- GIVEN `App` has selected day `D`
- WHEN its mount loaders run
- THEN `jornadaRepository.obtenerParaFecha(D)` and `repository.getOrderByFechaOperativa(D)` are called
- AND `lecturaRepository.getLecturasByOrden` is called for the order of `D` when present

#### Scenario: Changing the selected day re-runs the mount loaders

- GIVEN the mount loaders ran for day `D`
- WHEN the selected day becomes `D+1`
- THEN the mount loaders re-run with `D+1`
- AND the state is replaced by the sources of `D+1`

#### Scenario: A loader cancelled after unmount does not set state

- GIVEN a mount loader is in flight
- WHEN the component unmounts
- THEN the `cancelled` flag is true and no `setState` is called

### Requirement: Registration handlers pass the selected day, never recompute it

Every handler that registers a record MUST pass `fechaOperativa` in its domain input, and that value
MUST be the **selected operational day** of the app (`fechaOperativa`, the selected-day prop), not `fechaOperativaHoy()`
recomputed inside the handler. The four sections (`ParadasSection`, `ActividadesSection`,
`DanoSection`, `MantenimientoSection`) and every call site that builds a registration input MUST receive
the selected day as a prop and use it verbatim.

`InspeccionTelaSection` also passes `fechaOperativa` where its registration inputs require it, using the
same selected day. No call site may derive the day from `new Date()` or call `fechaOperativaHoy()`.

#### Scenario: Each section receives and uses the selected day

- GIVEN the four sections are rendered while the selected day is `D`
- WHEN each builds a `Registrar*Input`
- THEN each passes `fechaOperativa = D`
- AND the prop that carries `D` is the selected day, not recomputed inside the section

#### Scenario: No section computes the day independently

- GIVEN the section components
- WHEN their registration handler bodies are inspected
- THEN none of them call `fechaOperativaHoy()` or compute a date
- AND each reads `fechaOperativa` from its props or from the closure that received the selected day

#### Scenario: The handler passes the selected day to the domain

- GIVEN a registration input is built for day `D`
- WHEN it is passed to the domain registration function
- THEN the domain receives `fechaOperativa = D`
- AND that value is written verbatim into the persisted entity

#### Scenario: The selected day is stable while the view is active

- GIVEN the operario registered a record while viewing day `D`
- WHEN the persisted entity is read back
- THEN its `fechaOperativa` is `D`
- AND it was not rewritten to `fechaOperativaHoy()` by the handler

### Requirement: Re-seeding after mutations uses the selected day

After a successful write, the handler MUST re-seed the machine-event collections by reading them again
for the **selected day** (using the day-scoped listings). It MUST NOT re-seed by reading the full
history or by manually splicing the just-written record into state in a way that could mix days. The
re-seed reads the same collections the mount loaders read.

#### Scenario: A successful write triggers a re-seed with the selected day

- GIVEN the selected day is `D` and a `Parada` was just inserted
- WHEN the handler re-seeds state
- THEN it calls `paradaRepository.listarPorMaquinaYFecha` with the day-scoped listing for `(machineId="M1", fechaOperativa=D)`
- AND sets state to that result

#### Scenario: The re-seed does not introduce another day's record

- GIVEN day `D` is selected and a record was inserted for `D`
- WHEN the re-seed completes
- THEN the parada list contains only records of `D`
- AND no record of any other day appears

#### Scenario: A failed write does not re-seed

- GIVEN a persistence write rejects
- WHEN the handler completes
- THEN no re-seed of the affected collections occurs
- AND the visible state is unchanged

### Requirement: Day scoping does not change the "sources only" discipline or the cancellation guard

Recovery and the mount loaders still return and consume **sources only**. No derived value is computed
during recovery or during a mount load. The `cancelled` flag prevents state updates after unmount for
every loader, including the new day-scoped reads. The error propagation discipline is unchanged: a read
failure propagates to the startup failure screen (if during recovery) or surfaces as before (if during a
mount load), and is never silently downgraded to an empty list.

#### Scenario: No derived value is computed in recovery

- GIVEN recovery runs for a selected day
- WHEN it returns
- THEN the recovered state contains no time summary, duration, projection, alert, `buena racha`, machine
  state or inspection `estado`

#### Scenario: No derived value is computed in mount loaders

- GIVEN the mount loaders run
- WHEN they set state
- THEN they set the raw source collections only
- AND they do not compute any of the derived values themselves

#### Scenario: A cancelled day-scoped load does not set state

- GIVEN a mount loader for a day-scoped collection is in flight for day `D`
- WHEN the component unmounts before it resolves
- THEN no `setState` is called
- AND the state remains as it was before the unmount

#### Scenario: A recovery failure propagates to the failure screen

- GIVEN recovery is called for day `D` and a day-scoped read rejects
- WHEN the startup path handles the rejection
- THEN the initialization-failure screen is rendered
- AND `App` is never mounted
- AND no partially recovered state reaches the UI

### Requirement: Recovery preserves `fechaOperativa` exactly

`recoverPersistedState` MUST return every recovered machine event with `fechaOperativa` byte-identical
to what was persisted. Recovery MUST NOT recompute, normalise or drop it, and MUST NOT filter by it:
the full-history behaviour that the seam deliberately left open for CHANGE 2 is unchanged.

#### Scenario: A restart returns the same operative dates

- GIVEN events persisted under three different operational days, including an event with no order
- WHEN recovery runs
- THEN each recovered event's `fechaOperativa` equals the value it was persisted with

#### Scenario: A midnight-crossing event recovers on its own day

- GIVEN a closed event with `fechaOperativa = "2026-09-29"`, `inicio` on `2026-09-29T23:50` and `fin`
  on `2026-09-30T00:30`
- WHEN recovery runs
- THEN the recovered event reports `fechaOperativa = "2026-09-29"`
- AND its `inicio`/`fin` are unchanged instants

#### Scenario: An open event that survived a midnight keeps its day

- GIVEN an open event persisted with `fechaOperativa = "2026-09-29"` and `fin = null`
- WHEN recovery runs after the wall clock has passed into the next day
- THEN the recovered event still reports `fechaOperativa = "2026-09-29"` and `fin = null`

#### Scenario: Recovery does not partition the history

- GIVEN events attributed to several operational days
- WHEN recovery runs
- THEN every one of them appears in the recovered lists, with no day predicate applied

### Requirement: Registration handlers supply the operative date explicitly

Every registration call site MUST pass `fechaOperativa` in its input, taken from the app's single
source of the current operational day. No call site may rely on the domain to infer it, and none may
omit it and expect a default.

The four call sites are `src/ui/ParadasSection.tsx:100`, `src/ui/ActividadesSection.tsx:76`,
`src/ui/DanoSection.tsx:127` and `src/ui/MantenimientoSection.tsx:112` — each already builds its own
`inicio: new Date().toISOString()`. Only `ActividadesSection` currently receives the selected day
(`src/ui/ActividadesSection.tsx`), so the other three sections MUST gain that prop from the same
source rather than computing a date independently.

#### Scenario: Each registration call site passes the current day

- GIVEN the four registration call sites in `src/ui/*Section.tsx`
- WHEN each builds its domain input
- THEN each passes `fechaOperativa` explicitly, from the same source the app uses for the active
  jornada

#### Scenario: No section derives its own date

- GIVEN the four section components
- WHEN their registration handlers are inspected
- THEN each reads the operative date from a prop or seam, not from a date it computes itself

#### Scenario: A call site cannot omit the field

- GIVEN the domain input types after this change
- WHEN a call site is type-checked without `fechaOperativa`
- THEN compilation fails, so an omission cannot reach runtime

### Requirement: Persistence round-trips the operative date before the UI reflects the event

The existing "persist before React state changes" contract extends to the new field: a registration
that the UI displays MUST already be durable, and the state the UI re-seeds from the repository MUST
carry the same `fechaOperativa` the domain assigned.

#### Scenario: The displayed event already carries the persisted date

- GIVEN a `Parada` the UI has just displayed
- WHEN the repository is re-read
- THEN the re-read `Parada` reports the same `fechaOperativa` as the displayed one

#### Scenario: A rejected insert leaves no event without a `fechaOperativa`

- GIVEN a registration whose persistence fails
- WHEN the handler completes
- THEN the error is surfaced and the visible state is unchanged
- AND no event exists in storage without a `fechaOperativa`

## Interaction with the pending `operational-event-operative-date` delta

The `operational-recovery-wiring` spec in the `operational-event-operative-date` change contains an
ADDED requirement that states registration handlers supply `fechaOperativa` explicitly. That requirement
is consistent with this delta; the value they must supply is the **selected day** (not necessarily
`fechaOperativaHoy()`) once navigation exists. The two deltas do not conflict; when both changes are
promoted, the wiring honours the selected day as specified here.
