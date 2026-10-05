# Operational Recovery and Wiring Specification

Capability: `operational-recovery-wiring` (delta)
Change: `historical-day-navigation`
In-scope projects: `.` (frontend, TypeScript)

## Purpose

Specify how recovery composes the eight persisted sources when the application is loading a **specific
selected operational day**; how the startup composition and the mount loaders pass the selected day to
the day-scoped reads; and that the `fechaOperativa` passed to registration handlers is the **selected**
day, not `fechaOperativaHoy()` independently. This delta adds no column, no migration, and does not
change the "sources only" discipline.

## Referenced capabilities — NOT redefined here

| Capability | How this delta uses it |
|---|---|
| `historical-day-navigation` | defines the single selected day and the day-scoped reads |
| `operational-repository-contracts` (delta) | defines the day-scoped machine listings on the four machine-event ports |
| `operational-event-operative-date` | defines the required `fechaOperativa` on events and registration inputs |

## ADDED Requirements

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
its `hoy` (or equivalent selected-day prop) and MUST seed its state from the recovered state that
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
MUST be the **selected operational day** of the app (`hoy`/selected day prop), not `fechaOperativaHoy()`
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

## Interaction with the pending `operational-event-operative-date` delta

The `operational-recovery-wiring` spec in the `operational-event-operative-date` change contains an
ADDED requirement that states registration handlers supply `fechaOperativa` explicitly. That requirement
is consistent with this delta; the value they must supply is the **selected day** (not necessarily
`fechaOperativaHoy()`) once navigation exists. The two deltas do not conflict; when both changes are
promoted, the wiring honours the selected day as specified here.
