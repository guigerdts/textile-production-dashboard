# Historical Operational-Day View Specification

Capability: `historical-day-navigation` (NEW)
Change: `historical-day-navigation`
In-scope projects: `.` (frontend, TypeScript)

## Purpose

Specify the behaviour that lets the **operario de estampado** display one **specific operational
day** of the machine — not only today — with the same dashboard, the same pure domain computations and
the same sources-only discipline the dashboard already has, while the historical view stays strictly
read-only.

This capability owns the selection, the day scoping, the read-only posture, the day-to-day navigation
and the empty-day behaviour. The port-level day predicate it depends on is specified in
`operational-repository-contracts`; the day-scoped recovery it depends on is specified in
`operational-recovery-wiring`.

## User Stories covered

| # | As a… | I want… | So that… |
|---|---|---|---|
| US-1 | operario de estampado | to select a previous operational day | I can review what the machine actually did on the previous shift, since every record is already persisted |
| US-2 | operario de estampado | to see **only** the selected day's events | a historical dashboard never mixes yesterday's `parada` with today's |
| US-3 | operario de estampado | to see the events of a day that had **no orden** | the machine-level and order-less records of an empty day are finally reachable — they are the reason this feature exists |
| US-4 | operario de estampado | a historical day to be read-only | I can never register, close or edit a record of a past day by mistake |
| US-5 | operario de estampado | today to behave exactly as it does now | the feature changes what I can *look at*, never how the live shift works |

## Referenced capabilities — NOT redefined here

| Capability | How this delta uses it |
|---|---|
| `operational-event-operative-date` | defines `fechaOperativa` as a required, persisted, caller-supplied field and its **exclusive** day attribution. This capability only selects a day and filters by equality on that field |
| `operational-repository-contracts` | defines the day-scoped listing on the four machine-event ports and the day-free `inspeccion_tela` / `lectura_golpe` ports |
| `operational-recovery-wiring` | defines that recovery returns **sources only** for the requested day, in the fixed read order, with no derived value |
| `operational-events-schema` | defines the persisted column set, including migration 005's `fecha_operativa`. This change adds **no** migration |

## Preconditions

Both decisions that once blocked this change are resolved and implemented
(`operational-event-operative-date`, commit `851172c`):

- `Parada`, `ActividadPlanificada`, `Dano` and `Mantenimiento` each carry a required,
  persisted `fechaOperativa: string` in `YYYY-MM-DD` form. It is **never** derived from `inicio`.
- `fechaOperativa` alone determines the day for attribution and filtering.

## Non-goals

- Any write, edit, closure or deletion of a record belonging to a non-selected day.
- Persisting any derived value (`progreso`, `tiempo productivo`, machine state, projected 2da, alert,
  `buena racha`, inspection `estado`). They stay recomputed.
- The Acabado official-quality feed and the real weekly-programming source.
- Any change to `src/domain/**` business rules.
- Any new migration, and any change to migrations 001–005. Migration 005 is already applied and
  immutable.
- Any `fechaOperativa` predicate on `IInspeccionRepository` or `ILecturaGolpeRepository`.
- R5/R6 runtime validation, which remains open on a Tauri-capable host.

## ADDED Requirements

### Requirement: The selected operational day is the app's single source of day scope

The application MUST read an explicit, selected `fechaOperativa` (`YYYY-MM-DD`) and MUST use that value
— not a clock read at render time — as the day scope of every day-scoped read it performs. When no day
has been selected, the selected day MUST be `fechaOperativaHoy()`, so the unconfigured behaviour is
today's.

The selected day MUST be **explicitly visible** to the operario. The application MUST NOT substitute
the wall-clock day for the selection while a selection stands.

#### Scenario: The default selection is today

- GIVEN the application starts with no day selected
- WHEN it resolves the day it reads for
- THEN the resolved day equals `fechaOperativaHoy()`
- AND every day-scoped read uses that value

#### Scenario: Selecting a day replaces the scope of every day-scoped read

- GIVEN the application currently displays the day `D0`
- WHEN the operario selects `D1`
- THEN every day-scoped read for `jornada`, `orden`, `lecturas`, `paradas`, `actividades`, `danos` and
  `mantenimientos` is issued for `D1`
- AND no day-scoped read for the day `D0` is issued afterwards

#### Scenario: The selected day is displayed

- GIVEN a day `D1` is selected
- WHEN the dashboard renders
- THEN the operario can read `D1` on the screen as the day being displayed

#### Scenario: A selection survives a re-render and is not replaced by the clock

- GIVEN the operario selected `D1`, which is not today
- WHEN the component re-renders, without any further selection
- THEN the displayed day is still `D1`
- AND no re-render reintroduces `fechaOperativaHoy()`

### Requirement: The selected day is the only thing that changes which sources are loaded

Changing the selected day MUST change **only** which sources are loaded. The machine, the repository
instances, the read order and every other input MUST remain identical, so the same composition runs
over a different day.

#### Scenario: Navigating from one day to another re-reads the same sources for the new day

- GIVEN the sources loaded for day `D0`
- WHEN the selected day becomes `D1`
- THEN the same eight sources are re-read, each scoped to `D1`
- AND the same machine and the same repository instances are used

#### Scenario: Re-reading the same day is idempotent

- GIVEN the sources already loaded for day `D0`
- WHEN the same day `D0` is read again
- THEN the returned sources are observably identical to the ones already loaded
- AND no record is duplicated and none disappears

#### Scenario: Navigating does not change unrelated state

- GIVEN day `D0` is displayed
- WHEN the selected day becomes `D1`
- THEN the persisted records are unchanged
- AND nothing was written to storage as a consequence of the navigation

### Requirement: Every day-scoped read returns only the selected day's records

A day-scoped read of a machine-event collection MUST return **exactly** the records whose
`fechaOperativa` equals the requested day, and no record of any other day. The filtering MUST happen
**in origin** — in the query or in the adapter's own read path — and MUST NOT happen in the caller.
The state the UI holds MUST contain no record of another day.

#### Scenario: A day's read returns that day's records and nothing else

- GIVEN events attributed to `D-1`, `D` and `D+1` exist for the same machine
- WHEN the collection is read for day `D`
- THEN every returned record reports `fechaOperativa = D`
- AND no record of `D-1` or `D+1` is present in the result

#### Scenario: The filtering happens before the caller sees anything

- GIVEN events attributed to `D-1` and to `D` exist for the same machine
- WHEN the collection is read for day `D`
- THEN the number of records the caller receives equals the number of records attributed to `D`
- AND a record of `D-1` is never observable by the caller, not even transiently

#### Scenario: The UI state never holds another day's rows

- GIVEN day `D` is displayed
- WHEN the dashboard's machine-event state is inspected
- THEN every record in it reports `fechaOperativa = D`
- AND no record of another day is present, whether seeded or loaded afterwards

#### Scenario: A day with no events yields an empty collection, not an error

- GIVEN no event is attributed to day `D`
- WHEN the collection is read for day `D`
- THEN the result is an empty collection
- AND the read does not fail and does not return `undefined`

#### Scenario: Chronological order is preserved under day scoping

- GIVEN three records attributed to `D`, inserted out of chronological order
- WHEN the collection is read for day `D`
- THEN the result is ordered by `inicio` ascending, as before the change
- AND the caller still does not sort the result itself

### Requirement: Records with no order are day-scoped and visible

Events that carry no `ordenId` MUST be day-scoped by their own `fechaOperativa` and MUST be visible on
the day they were attributed to. This is the case that makes the feature necessary: a day with no
`orden` has no order link to borrow an attribution from, and it is still a day whose records exist.

`ActividadPlanificada` (never carries an `ordenId`), `Mantenimiento` (machine-level, never tied to an
`orden`) and any `Parada` or `Dano` with `ordenId: null` MUST all be returned for their own day.

#### Scenario: A planned activity on an empty day is visible on that day

- GIVEN an `ActividadPlanificada` with `fechaOperativa = D`, no `ordenId`, and day `D` has no `orden`
- WHEN day `D` is displayed
- THEN the activity is present in the displayed `actividades`
- AND it is not filtered out for lack of an order

#### Scenario: A machine-level maintenance is visible on its own day

- GIVEN a `Mantenimiento` with `fechaOperativa = D` and no order link of any kind
- WHEN day `D` is displayed
- THEN the maintenance is present in the displayed `mantenimientos`

#### Scenario: A `parada` and a `Dano` recorded with no order are visible on their day

- GIVEN a `Parada` and a `Dano`, both with `ordenId = null` and `fechaOperativa = D`
- WHEN day `D` is displayed
- THEN both are present in the displayed `paradas` and `danos` respectively

#### Scenario: An order-less record does not leak into a day that has an order

- GIVEN an `ActividadPlanificada` with `fechaOperativa = D-1` and none with `fechaOperativa = D`
- WHEN day `D` is displayed
- THEN the displayed `actividades` is empty
- AND the day-`D-1` activity is not shown merely because it has no order to be attributed through

### Requirement: Day attribution is exclusive — `fechaOperativa` alone decides

A record's day MUST be its `fechaOperativa` and nothing else. A record MUST NOT be attributed to a day
because its `inicio`, its `fin`, or the interval between them falls in that day. There MUST be no
temporal-overlap, "open record carries forward", or window-containment predicate anywhere in the
day-scoped read path.

#### Scenario: A midnight-crossing record stays on its registered day

- GIVEN a closed record with `fechaOperativa = D`, `inicio` on `D-1` at 23:50 and `fin` on `D` at 00:30
- WHEN day `D-1` is displayed
- THEN that record is absent
- AND when day `D` is displayed, the record is present exactly once

#### Scenario: An open record that spans midnight does not surface on the next day

- GIVEN an open record with `fechaOperativa = D-1`, `inicio` on `D-1` at 09:00 and `fin = null`
- WHEN day `D` is displayed
- THEN that record is absent

#### Scenario: A record closed two days later keeps its original day

- GIVEN an open record with `fechaOperativa = D-1`
- WHEN it is closed with a `fin` on day `D+1`
- THEN it remains a member of `D-1`
- AND it is not a member of `D` or of `D+1`

#### Scenario: A record is never shown on two days

- GIVEN any record
- WHEN each of the days around it is displayed in turn
- THEN the record appears under exactly one day — its own

#### Scenario: `inicio` and `fin` are untouched by day scoping

- GIVEN a record whose `fechaOperativa` and `inicio` disagree on calendar date
- WHEN it is read for its own day
- THEN `inicio` and `fin` are returned as the unchanged instants they were stored as
- AND no reconciliation between them and `fechaOperativa` is performed

### Requirement: A day with no order and no events renders the existing no-order state

A selected day that has no `orden` MUST render the **existing** no-order state, unchanged. It MUST NOT
raise an error, MUST NOT fabricate a record, a jornada, an order or a reading, and MUST NOT invent a
placeholder to fill the empty view.

#### Scenario: A fully empty day renders the no-order state

- GIVEN a selected day `D` with no `orden`, no `lecturas` and no events of any kind
- WHEN the dashboard renders
- THEN it renders the same no-order state the application renders today for a day without an order
- AND no error is surfaced and no failure screen replaces the dashboard

#### Scenario: An empty day fabricates nothing

- GIVEN a selected day `D` with no persisted record of any kind
- WHEN the dashboard renders
- THEN no `orden`, `lectura`, `parada`, `actividad`, `Dano` or `mantenimiento` is displayed
- AND the storage is unchanged by the render

#### Scenario: A day with events but no order shows those events with the no-order state

- GIVEN a selected day `D` with no `orden` but with two activities and one `parada` attributed to `D`
- WHEN the dashboard renders
- THEN the no-order state is rendered
- AND the two activities and the `parada` of day `D` are also visible
- AND no record of another day appears alongside them

#### Scenario: The jornada of the selected day is used, not a default invented for it

- GIVEN a selected day `D` with no persisted jornada
- WHEN the dashboard renders
- THEN the jornada reads according to the existing default for a day without a persisted record
- AND no jornada record is created as a side effect

### Requirement: A day other than today is read-only

For any selected day that is not `fechaOperativaHoy()`, **no** control that creates, edits or closes a
record MUST be reachable. Every registration, start-of-production, closure and finalization control
MUST be **absent** from the rendered view.

Hidden is the required behaviour: a control that is present and fails silently, or present and reports a
validation error, is prohibited. A record of a past day MUST be unchangeable through the application.

#### Scenario: No registration control is reachable on a past day

- GIVEN a past day is selected that has an `orden` in production
- WHEN the dashboard renders
- THEN no control to register a `parada`, an `ActividadPlanificada`, a `Dano`, a `Mantenimiento` or an
  `InspeccionTela` is reachable
- AND no such control is present in a state that reports a failure when used

#### Scenario: No closure control is reachable on a past day

- GIVEN a past day is selected whose records include an open `parada`, an open `Dano` and a
  `Mantenimiento` in progress
- WHEN the dashboard renders
- THEN no control to close any of them is reachable
- AND the operario sees those records in the state they were persisted in

#### Scenario: No production-advancing control is reachable on a past day

- GIVEN a past day is selected whose `orden` is `available`
- WHEN the dashboard renders
- THEN the control to start production is absent
- AND the control to register a reading and the control to finalize production are absent for an `orden`
  in production

#### Scenario: The read-only view still shows everything the day recorded

- GIVEN a past day with an `orden`, its `lecturas`, and `paradas`, `actividades`, `danos`,
  `mantenimientos` and `inspecciones`
- WHEN the dashboard renders
- THEN all of that day's records and all derived values are displayed
- AND only the write controls are absent

#### Scenario: A read-only day can never produce a write

- GIVEN a past day is selected
- WHEN any operation that would persist a record is attempted
- THEN nothing is written to storage
- AND the persisted history is observably unchanged

### Requirement: Exactly one operational day is displayed at a time

The day selection MUST yield exactly **one** `fechaOperativa`. The application MUST NOT present a
range, a multi-day selection, or any aggregate spanning more than one operational day, and MUST NOT
merge two days into one view.

#### Scenario: The selection resolves to a single date

- GIVEN the operario navigates to a previous day
- WHEN the view resolves its sources
- THEN the resolved day scope is one `YYYY-MM-DD` value
- AND no second day is included in the same view

#### Scenario: No range or multi-day control exists

- GIVEN the dashboard is rendered on any day
- WHEN the day selection controls are inspected
- THEN none of them accepts a start date and an end date
- AND none of them aggregates several days

#### Scenario: A record of each day appears under its own day

- GIVEN day `D-1` and day `D` each have one `parada`
- WHEN the operario moves from `D` to `D-1` and back to `D`
- THEN `D-1` shows only its own `parada`
- AND `D` shows only its own `parada`

### Requirement: A selected day equal to today behaves exactly as today

When the selected day equals `fechaOperativaHoy()`, the application MUST behave exactly as it does
today: the same records, the same derived values, the same reachable controls and the same write
paths, with no read-only restriction of any kind.

#### Scenario: Today's write paths stay reachable

- GIVEN the selected day equals `fechaOperativaHoy()`
- WHEN the dashboard renders
- THEN every registration, closure, start-of-production, reading and finalization control is reachable,
  exactly as before this change

#### Scenario: Today's derived values are unchanged

- GIVEN the selected day equals `fechaOperativaHoy()`
- WHEN the dashboard derives `progreso`, `tiempo productivo`, machine state, projected 2da, the alert,
  `buena racha` and each inspection `estado`
- THEN each value is the value the application produced for today before this change

#### Scenario: Returning to today restores the live behaviour

- GIVEN the operario is viewing a past day
- WHEN the selection returns to `fechaOperativaHoy()`
- THEN the write controls are reachable again
- AND registering and closing records behave exactly as they do on an unconfigured application

#### Scenario: The operario never has to navigate to work

- GIVEN the application has never had a day selected
- WHEN the operario registers a `parada` or closes a `Dano`
- THEN the write succeeds exactly as before this change
- AND the record is attributed to `fechaOperativaHoy()`

### Requirement: No business rule in `src/domain/**` changes

`src/domain/**` MUST have zero diff caused by this change. Every derived value — `progreso`,
`tiempo productivo`, machine state, projected 2da, the >3% alert, the 5% target, `buena racha` and each
inspection `estado` — MUST be recomputed by the **existing** pure functions over the selected day's
sources. The day selection MUST NOT become an input to any derivation that did not already take those
sources.

#### Scenario: Every derived value comes from the existing pure functions

- GIVEN a past day with an `orden`, `lecturas` and machine events
- WHEN the dashboard renders
- THEN `progreso`, `tiempo productivo`, machine state, projected 2da, the alert, `buena racha` and each
  inspection `estado` are produced by the existing pure domain functions
- AND none of them is stored, cached or persisted

#### Scenario: Recovery returns sources only for the selected day

- GIVEN a selected day with a fully populated history
- WHEN the day's sources are composed
- THEN the composition returns the sources only
- AND it contains no time summary, no duration, no projection, no alert flag, no `buena racha`, no
  machine state and no inspection `estado`

#### Scenario: The same functions run for today and for a past day

- GIVEN two days, one of them today
- WHEN each is displayed
- THEN the same pure functions are invoked for both
- AND the only difference between the two invocations is the source set they receive

#### Scenario: A change to `src/domain/**` fails the change

- GIVEN a regression guard over `src/domain/**` for this change
- WHEN a day-scoped parameter, a clock read or a day derivation is introduced in that directory
- THEN the guard fails
- AND the change is not accepted with a modified domain

### Requirement: The day-scoped read is observably identical in both adapter families

The in-memory adapters and the SQLite adapters MUST satisfy **one** contract suite for the day-scoped
listing, so the day filter cannot drift between them. Neither family may pass a case the other fails.

The SQLite side of that suite MUST run against a **real SQLite connection** with migrations 001–005
applied, and not only against the modelled SQLite double. Parity proved solely against a double would
not prove that the day filter is enforced by the real engine. The double-based cases remain, added to
the real-engine run rather than replacing it.

#### Scenario: One contract suite runs against both adapter families

- GIVEN the day-scoped listing contract suite
- WHEN it executes
- THEN it runs every case against the in-memory family and against the SQLite family
- AND both families pass every case

#### Scenario: The SQLite family is exercised on a real engine

- GIVEN the contract suite's SQLite cases for the day-scoped listing
- WHEN they run
- THEN they run against a connection with migrations 001–005 applied
- AND they are not satisfied solely by the modelled SQLite double

#### Scenario: Parity covers the attribution shapes, not only the happy path

- GIVEN the parity cases for the day-scoped listing
- WHEN they are enumerated
- THEN for each of the four machine-event types they include a record with an order, a record with no
  order, a midnight-crossing record, an open record that spans midnight, two records with identical
  timestamps and different `fechaOperativa`, and a day with no records

#### Scenario: The existing adapter suites keep their coverage

- GIVEN the existing per-adapter port suites
- WHEN they are run after the day predicate is added
- THEN they still assert their previous behaviour
- AND no assertion is deleted to make the day predicate pass

#### Scenario: The guardrails pass

- GIVEN the change is complete
- WHEN `npm run test` and `npx tsc --noEmit` are run in `.`, and `cargo check` is run in `src-tauri`
- THEN all three pass
- AND the suites that cannot exercise the real Tauri runtime keep the project's honesty note, so no suite
  claims runtime verification it does not have

### Requirement: The persisted schema is unchanged by this change

This change MUST add no migration and MUST NOT alter migrations 001–005. Migration 005 already added
the `fecha_operativa` column to the four machine-event tables and is applied; this change only reads
it. No new column, no index change that alters persisted data, and no schema rewrite may be introduced.

#### Scenario: No migration is added

- GIVEN the migrations directory after the change
- WHEN its contents are enumerated
- THEN it contains no migration added by this change
- AND migrations 001–005 are byte-identical to their pre-change state

#### Scenario: The day predicate reads the existing column

- GIVEN a persisted record with `fecha_operativa`
- WHEN the day-scoped listing is executed against SQLite
- THEN it matches on the existing `fecha_operativa` column
- AND no column other than that one is needed to answer the day-scoped read
