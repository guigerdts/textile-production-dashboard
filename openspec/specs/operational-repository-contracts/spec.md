# Operational Repository Contracts Specification

Capability: `operational-repository-contracts`
Change: `sqlite-persistence-phase-2`
In-scope projects: `.` (frontend, TypeScript)

## Purpose

Specify the async evolution of the five operational repository ports (26 methods), the adaptation of
the five in-memory adapters to those async contracts with **identical observable behaviour**, and the
contract every new SQLite adapter MUST satisfy — pure exported mappers, explicit insert vs update,
duplicate and unknown-id rejection, repository-owned chronological ordering, descriptive failure
propagation, and recomputation of derived inspection state on read rather than reading it from a
column.

The schema these adapters write to is specified in `operational-events-schema`. Their use at startup
and inside the application is specified in `operational-recovery-wiring`.

## User Stories covered

| # | As a… | I want… | So that… |
|---|---|---|---|
| US1 | operario de estampado | a `parada` I registered before lunch to still exist after a restart | the machine state reads PARADA and the stop blocks lecturas honestly, instead of silently pretending the machine never stopped |
| US2 | operario de estampado | a `cambio de diseño` / `limpieza` / `almuerzo` period to survive a restart | **tiempo no productivo planificado** is not lost and **tiempo productivo** is not inflated by work that was actually planned |
| US3 | operario de estampado | a `daño` (with its `carro`, its `causoParada` flag, its `posibleSegunda` suspicion and the `unidadesSospechadas`) to survive a restart | the 2da projection and the alert are computed from real suspicions, not from an empty list that always reads "0%" |
| US4 | operario de estampado | an open `mantenimiento` (en progreso) to survive a restart | the dashboard still shows what the machine is being repaired for, and I cannot register a second open one on a machine that already has one |
| US5 | operario de estampado | every `inspección de tela` — checklist, `lote`, `otra anomalía`, resolution, **who registered it and when** — to survive a restart | the `estado de tela` (conforme / no usable / devuelta / uso autorizado) is still derivable per inspection after the shift is resumed |
| US6 | operario de estampado | a `devolución de tela` to keep its `motivo`, its `registradaPor` and its timestamp across a restart | the documentary trail of who returned the fabric and why is not lost — this is the finding that completes the flat-column decision |
| US9 | the operario | a persistence failure to surface as an error **and leave the visible state untouched** | I never believe a record was saved when it was not — no silent fire-and-forget writes |

## Referenced domain rules — NOT redefined here

These contracts are storage contracts. They MUST NOT validate business rules; they persist and
return records the domain has already validated. The rules themselves stay exactly as closed in:

| Rule | Source | Consequence for this capability |
|---|---|---|
| `registrarParada` / `cerrarParada`, the 10 `CausaParadaId` values and their required `camposEspecificos` | ticket 02, `src/domain/paradas.ts` | the adapter stores `causa_id` and the cause-specific record verbatim; it never checks that a causa exists or that its fields are present |
| `comenzarActividad` / `finalizarActividad`; one open activity per machine + type; `queSeLimpio` required only for `limpieza` | ticket 03, `src/domain/actividades.ts` | `getActividadAbierta` is a **query**, not the enforcement of that rule |
| `registrarDano` / `cerrarDano`; the `causoParada` ↔ `paradaId` coupling; same machine, same order, non-earlier start; `posibleSegunda` ↔ `unidadesSospechadas`; one open `daño` per machine | ticket 05, `src/domain/danos.ts` | none of these is re-checked in the adapter; the repository's own documentation already states it does not validate linked-entity existence |
| `registrarInspeccion` / `registrarDevolucion` / `registrarAutorizacionGerencia`; complete checklist; mutually exclusive resolutions; pre-impresión `devolución`; multiple inspections per order | ticket 07, `src/domain/inspeccionTela.ts` | resolution never mutates the persisted row in place; the domain returns a new copy and the adapter replaces the row |
| `registrarMantenimiento` / `cerrarMantenimiento`; one open maintenance per machine; `queSeRevisoReparo` required at close; records immutable once closed | ticket 08, `src/domain/mantenimiento.ts` | `getMantenimientoAbierto` is a query; immutability-after-close is a domain rule the adapter does not extend to a database constraint |

## Requirements

### Requirement: All five ports are async, with unchanged names and semantics

The five operational ports MUST return `Promise` from all 26 methods. Method names, parameters,
return shapes and semantics MUST be unchanged from the synchronous contracts; only the asynchronous
delivery is added. The domain stays synchronous and pure — no `Promise` may enter `src/domain/**`.

| Port | File | Methods (26 total) |
|---|---|---|
| `IParadaRepository` | `src/store/paradasRepository.ts` | `insertParada`, `updateParada`, `obtenerPorId`, `listarPorMaquina`, `listarPorOrden`, `getParadaAbierta` (6) |
| `IActividadPlanificadaRepository` | `src/store/actividadesRepository.ts` | `insertActividad`, `updateActividad`, `obtenerPorId`, `listarPorMaquina`, `getActividadAbierta` (5) |
| `IDanoRepository` | `src/store/danosRepository.ts` | `insertDano`, `updateDano`, `obtenerPorId`, `listarPorMaquina`, `listarPorOrden`, `getDanoAbierto` (6) |
| `IInspeccionRepository` | `src/store/inspeccionRepository.ts` | `insertInspeccion`, `updateInspeccion`, `obtenerPorId`, `listarPorOrden` (4) |
| `IMantenimientoRepository` | `src/store/mantenimientoRepository.ts` | `insertMantenimiento`, `updateMantenimiento`, `obtenerPorId`, `listarPorMaquina`, `getMantenimientoAbierto` (5) |

#### Scenario: Every port method is Promise-returning

- GIVEN the five port interfaces
- WHEN their method signatures are read
- THEN all 26 methods declare a `Promise`-returning type
- AND the count per port is 6, 5, 6, 4 and 5 respectively
- AND no method name, parameter list or resolved value type was renamed or reshaped

#### Scenario: An `undefined` / `null` answer survives the async boundary unchanged

- GIVEN `obtenerPorId` for an id that does not exist
- WHEN it is called on an async adapter
- THEN the resolved value is `undefined`, not `null`
- AND `getParadaAbierta` / `getActividadAbierta` / `getDanoAbierto` / `getMantenimientoAbierto` for a
  machine with no open record resolve to `null`

#### Scenario: No domain module becomes asynchronous

- GIVEN `src/domain/**` after the change
- WHEN it is inspected for `Promise`, `async`/`await` and repository imports
- THEN none is present
- AND `registrarParada`, `cerrarParada`, `comenzarActividad`, `finalizarActividad`, `registrarDano`,
  `cerrarDano`, `registrarInspeccion`, `registrarDevolucion`, `registrarAutorizacionGerencia`,
  `registrarMantenimiento` and `cerrarMantenimiento` keep their synchronous signatures

### Requirement: The in-memory adapters keep identical observable behaviour

The five in-memory adapters MUST satisfy the async contracts with **exactly** the observable
behaviour they have today, differing only in returning a `Promise`: explicit insert vs update,
duplicate-id rejection, unknown-id rejection, defensive cloning, chronological ordering, per-order
filtering that excludes `ordenId: null`, and the open-record queries. The in-memory adapters remain
the reference semantics the SQLite adapters are measured against.

#### Scenario: Insert rejects a duplicate id

- GIVEN an in-memory repository already holding a `Parada` with id `p-1`
- WHEN `insertParada` is called again with `p-1`
- THEN the returned promise rejects with a message naming the duplicate id
- AND the stored record is unchanged

#### Scenario: Update rejects an unknown id

- GIVEN an in-memory repository that does not hold a `Parada` with id `p-9`
- WHEN `updateParada` is called with `p-9`
- THEN the returned promise rejects with a message naming the missing id
- AND no record is created

#### Scenario: Reads and writes are defensively cloned

- GIVEN a record inserted into an in-memory repository
- WHEN the caller mutates the object it passed in, or mutates the object a read returned
- THEN neither change is observable through a later read
- AND the stored record is unaffected in both directions

#### Scenario: Listings are chronological and per-order listings exclude the null order

- GIVEN paradas and daños inserted out of chronological order, some with `ordenId: null`
- WHEN `listarPorMaquina("M1")` and `listarPorOrden("o-1")` are called
- THEN `listarPorMaquina` returns the machine's records ordered by `inicio` ascending, including
  those with `ordenId: null`
- AND `listarPorOrden("o-1")` returns only records whose `ordenId` equals `"o-1"`, never the `null`
  ones

#### Scenario: The open-record queries are answered as queries

- GIVEN a machine with more than one closed record and at most one open record per query shape
- WHEN `getParadaAbierta(maquinaId, ordenId)`, `getActividadAbierta(maquinaId, tipo)`,
  `getDanoAbierto(maquinaId)` and `getMantenimientoAbierto(maquinaId)` are called
- THEN each resolves the single open record typed as the corresponding `*Abierta` alias, or `null`
  when there is none
- AND the resolved value is usable by the closing domain function without a cast

### Requirement: Each SQLite adapter follows the established Phase 1 adapter shape

Each of the five new SQLite adapters MUST follow the shape established by
`sqliteOrderRepository.ts`: an exported `Row` interface describing the table's columns, exported
**pure** mappers `mapXRow` (row → domain) and `mapXToSql` (domain → SQL values), and a class holding
`private db: Database`. The mappers MUST be pure: no I/O, no clock, no randomness, no database
access, so a round-trip is unit-testable without a connection. SQL placeholders MUST be SQLite's
`$1`, `$2`, … form, as in the Phase 1 adapters.

#### Scenario: The mappers are exported and pure

- GIVEN each of the five SQLite adapter modules
- WHEN it is inspected
- THEN it exports a `Row` interface and both `mapXRow` and `mapXToSql` functions
- AND `mapXRow` returns a new domain object from a row without touching a database
- AND `mapXToSql` returns SQL values from a domain object without touching a database

#### Scenario: A mapper round-trips a record without a connection

- GIVEN a domain record and a `Row` produced by the corresponding `mapXToSql`
- WHEN `mapXRow` is applied to that row
- THEN the result is observably equal to the original record for every source-of-truth field
- AND the round trip runs with no `Database` instance in scope

### Requirement: SQLite writes are explicit insert vs update, with the same rejections as in memory

`insertX` MUST issue an explicit `INSERT` and `updateX` an explicit `UPDATE` — no upsert, no
`INSERT OR REPLACE`, and no path that can create a record from an update. `insertX` MUST reject a
duplicate id; `updateX` MUST reject an unknown id. Both rejections MUST carry a descriptive message
naming the offending id, and a rejection or plugin failure MUST surface as a rejected promise with a
descriptive error that **preserves the original `cause`** — the pattern already used by
`sqliteOrderRepository.saveOrder`.

#### Scenario: Inserting a new record succeeds and is immediately readable

- GIVEN a `Parada` with an id not present in the table
- WHEN `insertParada` is awaited
- THEN the promise resolves
- AND a subsequent `obtenerPorId` for that id returns the record

#### Scenario: Inserting a duplicate id is rejected, not silently overwritten

- GIVEN a `Parada` with id `p-1` already stored
- WHEN `insertParada` is awaited with `p-1` and different field values
- THEN the promise rejects with a message identifying the duplicate id
- AND the stored record still holds the original values

#### Scenario: Updating an unknown id is rejected and creates nothing

- GIVEN no `Parada` with id `p-9` in the table
- WHEN `updateParada` is awaited with `p-9`
- THEN the promise rejects with a message identifying the missing id
- AND no row for `p-9` exists afterwards

#### Scenario: A storage failure propagates with its cause

- GIVEN the database rejects the statement for any reason
- WHEN an insert or update is awaited
- THEN the promise rejects with a descriptive error naming the record
- AND the original error is preserved as the error's `cause`
- AND the failure is never swallowed and never converted into a success

#### Scenario: An update never changes the record's identity or creates one

- GIVEN a stored `Mantenimiento` with id `m-1`
- WHEN `updateMantenimiento` is awaited with the domain's closed copy — same id, `fin` set,
  `queSeRevisoReparo` set
- THEN the row for `m-1` is updated in place
- AND no additional row is created
- AND the immutable identity fields are not rewritten with a different value

### Requirement: SQLite reads match the in-memory read contract

`obtenerPorId` MUST resolve `undefined` for a missing id. The four open-record queries MUST resolve
the single open record typed as the corresponding `*Abierta` alias, or `null`. `listarPorMaquina` and
`listarPorOrden` MUST return chronological order by the domain's own temporal field — `inicio` for the
four machine-event tables, `timestamp` for inspections — and that ordering is **owned by the
repository**, not by the caller. `listarPorOrden` MUST exclude records whose order link is `null`.
`IInspeccionRepository` MUST NOT gain a `listarPorMaquina`: an inspection is always an order event, so
no such query exists.

#### Scenario: Chronological ordering is guaranteed by the adapter

- GIVEN three `dano` rows for the same machine inserted in non-chronological order
- WHEN `listarPorMaquina("M1")` is awaited
- THEN the resolved array is ordered by `inicio` ascending, without the caller sorting it
- AND the same holds for `parada`, `actividad_planificada` and `mantenimiento` by `inicio`, and for
  `inspeccion_tela` by `timestamp`

#### Scenario: Per-order listings never include unlinked records

- GIVEN a `parada` with `ordenId: null` and another with `ordenId: "o-1"`
- WHEN `listarPorOrden("o-1")` is awaited
- THEN only the `parada` whose order link is `"o-1"` is returned
- AND the unlinked one is not returned by any `listarPorOrden` call

#### Scenario: The inspection port exposes no machine query

- GIVEN `IInspeccionRepository` and its SQLite adapter
- WHEN its method list is read
- THEN it exposes exactly `insertInspeccion`, `updateInspeccion`, `obtenerPorId` and `listarPorOrden`
- AND no `listarPorMaquina` exists, matching the approved ticket 07 model

### Requirement: `campos_especificos` round-trips as JSON and fails loudly on invalid JSON

The SQLite `parada` adapter MUST serialize `camposEspecificos` with `JSON.stringify` on write and
parse it on read. An **empty record MUST round-trip as `{}`** and MUST be preserved as valid, not
treated as missing. If the stored text is not valid JSON, the adapter MUST raise a descriptive
mapping error **carrying the original parse error as its `cause`** — it MUST NOT return `{}`, MUST NOT
return a partially populated record, and MUST NOT swallow the failure. The check on read MUST also
reject JSON that parses to a non-object value.

#### Scenario: A populated record round-trips through JSON

- GIVEN a `Parada` whose `camposEspecificos` is `{ carro: 3, colorFaltante: "rojo" }`
- WHEN it is written and read back
- THEN the resolved `camposEspecificos` deep-equals the original record
- AND the stored text is a valid JSON object

#### Scenario: An empty record round-trips as an empty object

- GIVEN a `Parada` whose `camposEspecificos` is `{}` — valid, for a cause that requires no extra data
- WHEN it is written and read back
- THEN the resolved `camposEspecificos` is `{}`
- AND the write is not rejected as incomplete

#### Scenario: Invalid JSON in the stored column is a hard mapping error

- GIVEN a `parada` row whose `campos_especificos` column contains text that is not valid JSON
- WHEN the row is read
- THEN the promise rejects with a descriptive mapping error
- AND the error's `cause` is the original parse failure
- AND no `{}` is returned and the row is not skipped

#### Scenario: JSON that parses to a non-object is rejected

- GIVEN a `parada` row whose `campos_especificos` column contains a valid JSON scalar or array
- WHEN the row is read
- THEN the read fails with a descriptive error
- AND the failure is not silently coerced into an empty record

### Requirement: The two `daño` flags are encoded and decoded as 0/1 INTEGER

The SQLite `dano` adapter MUST write `causoParada: true` as `causo_parada = 1` and `false` as `0`, and
MUST read back `1` as `true` and `0` as `false`, using the same comparison convention as
`orden.aplica_segunda` (`row.aplica_segunda === 1`). `unidadesSospechadas` MUST be written as an
INTEGER or NULL, and MUST read back as `undefined` when NULL so that the domain's invariant
"without `posibleSegunda`, `unidadesSospechadas` is undefined" is preserved.

#### Scenario: `true` and `false` both round-trip

- GIVEN a `Dano` with `causoParada: true` and another with `causoParada: false`, each persisted
- WHEN both are read back
- THEN the first resolves `causoParada: true` and the second `causoParada: false`
- AND the stored column values are `1` and `0` respectively

#### Scenario: An absent suspicion count reads back as undefined

- GIVEN a `Dano` with `posibleSegunda: false`, which the domain guarantees carries no
  `unidadesSospechadas`
- WHEN it is written and read back
- THEN `unidades_sospechadas` is stored as NULL
- AND the read record has `unidadesSospechadas: undefined`, never `0` and never `null`

### Requirement: Inspection mapping rebuilds the checklist and recomputes derived state

The SQLite inspection adapter MUST map the five flat checklist columns back into the domain's
`items` array — exactly 5 entries, one per catalog id, in catalog order, each with an explicit
`conforme` / `anomalia` state — and MUST map the `resolucion` discriminator plus the resolution
columns back into the correct `ResolucionInspeccion` branch. `conAnomalia` and `estadoInspeccion`
MUST be recomputed by the domain's own derived functions after a read; they MUST NOT be read from a
column, and the adapter MUST NOT cache or persist them. `lote`, `otraAnomalia` and `observaciones`
MUST read back as `undefined` when their columns are NULL, so an absent value is never invented.

#### Scenario: The checklist is rebuilt as exactly five items

- GIVEN an inspection row with `absorcion = "conforme"`, `tundido = "anomalia"`, `manchas = "conforme"`,
  `dimensiones = "conforme"`, `estado_general = "conforme"`
- WHEN it is read
- THEN `items` has exactly 5 entries
- AND each entry's `id` matches its column, with `tundido`'s `estado` equal to `"anomalia"`
- AND `conAnomalia(inspeccion)` evaluates to `true` as a derived result, not as a stored value

#### Scenario: A `devolucion` branch is rebuilt from its own columns

- GIVEN a row with `resolucion = "devolucion"`, `motivo_devolucion`, `registrada_por` and
  `resolucion_timestamp` set
- WHEN it is read
- THEN `resolucion` is `{ tipo: "devolucion", motivo, registradaPor, timestamp }`
- AND `estadoInspeccion(inspeccion)` derives `"devuelta"`

#### Scenario: An `autorizacion_gerencia` branch is rebuilt from its own columns

- GIVEN a row with `resolucion = "autorizacion_gerencia"`, `autorizado_por`, `resolucion_timestamp`
  and `autorizacion_observaciones` set
- WHEN it is read
- THEN `resolucion` is `{ tipo: "autorizacion_gerencia", autorizadoPor, timestamp, observaciones }`
- AND `estadoInspeccion(inspeccion)` derives `"uso_autorizado"`

#### Scenario: An unresolved inspection derives no usable state

- GIVEN a row with `resolucion` NULL and one checklist item in `anomalia`
- WHEN it is read
- THEN `resolucion` is `null`
- AND `estadoInspeccion(inspeccion)` derives `"no_usable"`

#### Scenario: An entirely conforme inspection derives `conforme`

- GIVEN a row with all five checklist columns `"conforme"` and `otra_anomalia` NULL
- WHEN it is read
- THEN `conAnomalia(inspeccion)` is `false`
- AND `estadoInspeccion(inspeccion)` is `"conforme"`

#### Scenario: Absent optional text reads back as undefined

- GIVEN an inspection row with `lote`, `otra_anomalia` and `observaciones` all NULL
- WHEN it is read
- THEN each of those fields is `undefined`
- AND none is reconstructed as an empty string

#### Scenario: Resolving an inspection replaces the row without mutating history

- GIVEN a stored inspection with `resolucion: null`
- WHEN the domain's resolved copy is passed to `updateInspeccion`
- THEN the row is replaced with the resolved values
- AND exactly one row for that id exists afterwards
- AND the previous unresolved state is not retained as a second record

### Requirement: The SQLite adapter for inspections supports multiple inspections per order

Because the approved ticket 07 model has no "one inspection per order" restriction, `listarPorOrden`
MUST return every inspection registered for the order — an empty checklist inspection and its
subsequent resolutions are separate rows, each with its own `lote`, its own `timestamp` and its own
resolution. This requirement is a **persistence of the existing model**, not a new rule.

#### Scenario: Every inspection of an order is returned

- GIVEN three inspections registered for the same order, with different `lote` values and timestamps
- WHEN `listarPorOrden(ordenId)` is awaited
- THEN all three are returned, ordered by `timestamp`
- AND inspections of other orders are never mixed in

### Requirement: The ports remain a pure storage boundary

None of the five adapters — in memory or SQLite — may validate business rules. The repository layer
MUST NOT check that a `causaId` exists, that a `camposEspecificos` entry is required, that a linked
`paradaId` / `danoId` resolves, that a `tipo` is a valid catalog value, that there is at most one
open record per machine, that a `devolución` is pre-impresión, that `queSeRevisoReparo` is present at
close, or that maintenance records are immutable once closed. Those checks belong to
`src/domain/**`, which runs before the adapter is called, and each adapter's documentation MUST say
so, as the existing port documentation already does.

#### Scenario: An adapter persists a record the domain would have rejected

- GIVEN a `Dano` carrying a `paradaId` that resolves to nothing, constructed directly without going
  through `registrarDano`
- WHEN it is passed to `insertDano`
- THEN the adapter persists it without raising a domain-rule error
- AND the rejection of the dangling link remains the domain's job, surfaced to the operario with
  *"la parada vinculada no existe: …"* / *"el daño vinculado no existe: …"*

#### Scenario: The repository's own documentation states the boundary

- GIVEN the five port interface files and the five SQLite adapter modules
- WHEN their header documentation is read
- THEN each states that the repository does not validate business rules
- AND `IDanoRepository` and `IMantenimientoRepository` each state that linked-entity existence is a
  domain rule supplied through an injected lookup
- AND the in-memory and SQLite adapters do not reintroduce those checks

### Requirement: Tests cover both adapters per domain, plus the migration contract

The port contract suites for the five domains MUST be updated to the async contracts without weakening
their assertions, and each SQLite adapter MUST have its own suite. New tests MUST carry the project's
honesty note, because the test double simulates SQLite semantics and does not exercise the real
engine.

#### Scenario: The existing port suites become async and keep their coverage

- GIVEN `paradasRepository.test.ts`, `actividadesRepository.test.ts`, `danosRepository.test.ts`,
  `inMemoryInspeccionRepository.test.ts` and `mantenimientoRepository.test.ts`
- WHEN they are run
- THEN they await every port call
- AND they still assert duplicate-id rejection, unknown-id rejection, defensive cloning, chronological
  ordering, per-order exclusion of `null`, and the open-record queries
- AND no assertion is deleted to make an async change pass

#### Scenario: Each SQLite adapter is covered by its own suite

- GIVEN the five new adapter suites under `src/store/sqlite/__tests__/`
- WHEN they are run
- THEN they cover the mapper round trip, duplicate insert rejection, unknown-id update rejection,
  chronological ordering, open-record queries, per-order filtering, descriptive error propagation
  with `cause`, and — for `parada` — the JSON round trip plus the invalid-JSON hard failure
- AND each suite header states that it does not execute the real Rust migration

#### Scenario: The full guardrails pass

- GIVEN the change is complete
- WHEN `npm run test` and `npx tsc --noEmit` are run in `.`
- THEN both pass
- AND `cargo check` passes in `src-tauri`

### Requirement: Exactly four machine-event ports gain a day-scoped listing

Exactly four ports MUST offer a machine listing that takes the operational day and returns only the
records attributed to it: `IParadaRepository`, `IActividadPlanificadaRepository`, `IDanoRepository` and
`IMantenimientoRepository`. No fifth operational port may gain one.

The day MUST be a **required** input of that listing. A listing that omits it MUST NOT be the day-scoped
read, and the day-scoped read MUST NOT be implemented by calling a day-free listing and discarding rows.

How the day reaches the port — a new method, an added parameter on the existing machine listing, or a
distinct query shape — is a design decision and is deliberately left open here.

#### Scenario: Each of the four machine-event ports exposes a day-scoped machine listing

- GIVEN `IParadaRepository`, `IActividadPlanificadaRepository`, `IDanoRepository` and
  `IMantenimientoRepository`
- WHEN their read contracts are enumerated
- THEN each exposes a machine listing that requires an operational day
- AND the count of ports gaining a day predicate is exactly four

#### Scenario: The day is a required input, not an optional refinement

- GIVEN a caller of the day-scoped machine listing
- WHEN it is type-checked without supplying the operational day
- THEN compilation fails, so a day-free call cannot reach the day-scoped read

#### Scenario: `IInspeccionRepository` gains no date predicate

- GIVEN `IInspeccionRepository` and its in-memory and SQLite adapters
- WHEN their method lists are read
- THEN none of them accepts a `fechaOperativa` or any other day value
- AND the port still exposes only the order-reached inspection read, with no machine listing

#### Scenario: `ILecturaGolpeRepository` gains no date predicate

- GIVEN `ILecturaGolpeRepository` and its in-memory and SQLite adapters
- WHEN their method lists are read
- THEN none of them accepts a `fechaOperativa` or any other day value
- AND the port still resolves readings only through the order

#### Scenario: The order-reached ports are day-scoped transitively, without their own predicate

- GIVEN an `Orden` whose `fechaOperativa` is `D`
- WHEN its `lecturas` and its `inspecciones` are read
- THEN only that order's readings and inspections are returned
- AND the day they belong to is the order's `fechaOperativa`
- AND neither port was asked for a day to produce that result

### Requirement: The day predicate is applied in origin, never in the caller

The day predicate MUST be applied where the records are read — in the query the SQLite adapter issues
and in the filter the in-memory adapter applies — and MUST NOT be applied by the caller after the read.
The caller MUST receive only the selected day's records; another day's records MUST never cross the
port boundary, not even transiently.

Reading a machine's complete history and discarding the other days in the application layer or in the
UI is prohibited: the cost of such a read grows with the archive, and it would deliver another day's
records to a layer that must not have them.

#### Scenario: The SQLite adapter matches on the operative-date column in its own query

- GIVEN a `parada` table holding records attributed to several days
- WHEN the day-scoped machine listing is executed
- THEN the statement it issues restricts its result by the persisted `fecha_operativa` value
- AND the restriction is part of the read, not a filter applied to an already-read full result

#### Scenario: The in-memory adapter filters within its own read path

- GIVEN an in-memory adapter holding records attributed to several days
- WHEN the day-scoped machine listing is read
- THEN the records it returns are restricted to the requested day inside the adapter
- AND the adapter hands back nothing that belongs to another day

#### Scenario: Another day's record never reaches the caller

- GIVEN records attributed to `D-1`, `D` and `D+1`
- WHEN the listing is read for day `D`
- THEN the resolved collection contains no record of `D-1` and none of `D+1`
- AND the collection length equals the number of records attributed to `D`

#### Scenario: Filtering by another day happens in origin as well

- GIVEN the same records
- WHEN the listing is read for day `D+1`
- THEN the filtering is performed by the adapter in both adapter families
- AND the application layer applies no second filter of its own to obtain that result

### Requirement: The day-scoped listing returns that day's records, in the established contract

A day-scoped machine listing MUST resolve exactly the records whose `fechaOperativa` equals the requested
day, in chronological order by `inicio`, and MUST resolve an empty collection — never `undefined`, never
an error — when the day has none. It MUST include records whose `ordenId` is `null`, because such records
are attributed to their day on their own and are the reason the day filter exists.

All the other contracts of these listings are unchanged: no business-rule validation, defensive cloning
in the in-memory family, an open-record query that is a query and not an enforcement, and ordering owned
by the repository.

#### Scenario: Only the requested day's records are resolved

- GIVEN `Parada` records attributed to `D-1`, `D` and `D+1` for one machine
- WHEN the listing is read for day `D`
- THEN the resolved array holds exactly the records attributed to `D`

#### Scenario: A day with no records resolves an empty array

- GIVEN no record attributed to day `D`
- WHEN the listing is read for day `D`
- THEN the resolved value is an empty array
- AND it is not `undefined`, not `null`, and not a rejected promise

#### Scenario: Unlinked records are included on their own day

- GIVEN a `Parada` with `ordenId: null` and `fechaOperativa = D`
- WHEN the day-scoped listing is read for day `D`
- THEN that record is returned
- AND the exclusion of unlinked records that applies to the order-reached listing does not apply here

#### Scenario: Chronological order is owned by the adapter, as before

- GIVEN three records of day `D` stored out of chronological order
- WHEN the listing is read for day `D`
- THEN the resolved array is ordered by `inicio` ascending
- AND the caller performs no sorting

#### Scenario: The adapters still validate no business rule

- GIVEN a record attributed to a day that the domain would reject
- WHEN it is written and then read through the day-scoped listing
- THEN the adapter persists and returns it without a domain-rule error
- AND the day predicate adds no validation of any kind

### Requirement: The day predicate matches only the exact attributed day

The day predicate MUST be an **exact match** on `fechaOperativa`. It MUST NOT match on `inicio`, on `fin`,
on a timestamp prefix, on the jornada window, on temporal overlap, or on "the record is still open".
Temporal overlap MUST NOT confer membership in any day.

#### Scenario: A record whose timestamps fall in another day does not match

- GIVEN a record with `fechaOperativa = D`, `inicio` on `D-1` and `fin` on `D-1`
- WHEN the listing is read for day `D-1`
- THEN that record is not returned
- AND it is returned for day `D`

#### Scenario: A still-open record matches only its own day

- GIVEN an open record with `fechaOperativa = D-1` and `fin = null`
- WHEN the listing is read for day `D`
- THEN it is not returned

#### Scenario: No window or overlap predicate exists in the read

- GIVEN a persisted `jornada` record defining the day's productive window
- WHEN the day-scoped listing is executed
- THEN the result is decided by `fechaOperativa` alone
- AND the jornada window takes no part in the decision

### Requirement: A day-free machine listing may remain, and must stay complete

A machine listing that omits the operational day MAY continue to exist. Where it does, it MUST return the
machine's **complete** history, unchanged from today's behaviour — it MUST NOT be narrowed, and it MUST
NOT become a partial read that the day-scoped path then filters. Every day-scoped read the application
performs MUST go through the day-scoped listing instead.

Removing the day-free listing is permitted only if no consumer outside the day-scoped path needs it;
which of the two survive is a design decision, deliberately left open here.

#### Scenario: A surviving day-free listing is unchanged

- GIVEN a day-free machine listing still exists after the change
- WHEN it is called with only the machine id
- THEN it returns the machine's records across every day, exactly as before this change

#### Scenario: The day-scoped path does not build on the day-free listing

- GIVEN both a day-free and a day-scoped machine listing
- WHEN the application resolves the sources of a selected day
- THEN it uses the day-scoped listing
- AND it does not read the day-free listing and discard rows afterwards

#### Scenario: Every machine-event read the application performs carries the day

- GIVEN every **listing** of `paradas`, `actividades`, `danos` and `mantenimientos` performed for a selected day
- WHEN each one is inspected
- THEN each one supplied the selected operational day
- AND no **listing** of those four collections is day-free

#### Scenario: The rule binds listings, not open-state queries

The requirement above governs **listings**: the reads that answer *"what happened on this
day"*. It does not govern an **open-state query**, which answers *"what is open right now"*
about the machine rather than about a day. The distinction is what lets both hold at once:

- a listing is attributed to exactly one day, because a record is never shown on two days;
- an open-state query is a machine-level invariant that legitimately spans days, so it takes
  no day and never re-attributes anything.

`IParadaRepository.getParadaAbiertaDeMaquina(maquinaId)` is the single declared exception. It
resolves the machine's one open `parada` with no order and no day predicate, and it is
**never** a substitute for a listing: it returns at most one open record and cannot produce
history.

- GIVEN a `parada` opened on day `D-1` under an order that is no longer current, still open on `D`
- WHEN the application resolves the machine's operational state for `D`
- THEN it obtains that `parada` through the machine-level open-state query
- AND the day-scoped listing for `D` still omits it, because it belongs to `D-1`
- AND the `parada` keeps `fechaOperativa = D-1` — it is neither re-attributed nor duplicated

#### Scenario: An open-state query is never used to answer a historical day

- GIVEN a day that is not today is selected
- WHEN the application resolves what happened on it
- THEN every read it performs is day-scoped
- AND no day-free open-state query contributes to that day's result

### Requirement: `fechaOperativa` round-trips verbatim through every adapter

Both adapter families MUST write `fechaOperativa` on insert and update, and MUST return it
byte-identical on read, for all four entities. No adapter may normalise, truncate, reformat or
default the value.

#### Scenario: An insert returns the exact operative date

- GIVEN an event with `fechaOperativa = "2026-09-30"`
- WHEN it is inserted and immediately read back
- THEN the returned entity reports `fechaOperativa = "2026-09-30"`, unchanged

#### Scenario: An update never rewrites the operative date

- GIVEN a stored event with `fechaOperativa = "2026-09-29"` that is being closed
- WHEN the update supplying the new `fin` is applied
- THEN the stored `fechaOperativa` is still `"2026-09-29"`

#### Scenario: No adapter invents a value

- GIVEN any entity written through either adapter family
- WHEN its stored columns are enumerated
- THEN `fecha_operativa` was supplied by the write, never filled in by a `DEFAULT` or a
  `COALESCE`/conditional expression in the adapter

### Requirement: SQLite row mappers rebuild the field from its own column

Each SQLite adapter's exported, pure row→domain mapper MUST read `fecha_operativa` from its own
column. Because the column is `NOT NULL`, a row missing it is a storage defect and MUST raise a
mapping error rather than yielding `undefined` or an empty string — the same loud-failure posture the
`campos_especificos` JSON mapping already establishes.

#### Scenario: A row carries its own operative date into the entity

- GIVEN a database row whose `fecha_operativa` is `"2026-09-30"`
- WHEN the mapper is called with that row
- THEN the mapped entity's `fechaOperativa` is `"2026-09-30"`

#### Scenario: A row without the column fails loudly

- GIVEN a row object lacking `fecha_operativa`, or carrying `null`
- WHEN the mapper is called
- THEN it throws a mapping error identifying the missing column
- AND it never returns an entity with `fechaOperativa` unset

#### Scenario: Mappers stay pure

- GIVEN a mapper and a row
- WHEN the mapper runs with no connection present
- THEN it returns the entity, mutating neither the row nor any module state

### Requirement: Both adapter families are observably identical

A shared contract suite MUST run the same cases against the in-memory adapters and the SQLite
adapters, for all four entities. Neither family may pass a case the other fails. This is what makes
the day filter CHANGE 2 relies on trustworthy.

The SQLite side of the suite MUST run against a **real SQLite connection** applying the real
migrations, not only against `fakeSqliteStore.ts`. The existing SQLite adapter suites run partly
against that fake, and a fake cannot enforce `NOT NULL`, so parity proved only against the fake would
not prove the day survives real storage. The fake-based cases remain, added to the real-engine run
rather than replacing it.

#### Scenario: The same contract suite runs against both families

- GIVEN the operational contract suite
- WHEN it executes
- THEN it runs every case for both the in-memory and the SQLite adapter family
- AND both families pass every case

#### Scenario: The SQLite family is exercised on a real engine

- GIVEN the contract suite's SQLite cases
- WHEN they run
- THEN they run against a connection with migrations 001–005 applied
- AND they are not satisfied solely by `fakeSqliteStore.ts`

#### Scenario: Parity covers the Q2 shapes, not just the happy path

- GIVEN the parity cases
- WHEN they are enumerated
- THEN they include, for each entity: an event with an operative date, an event with no order and
  an operative date, a midnight-crossing event, an open event that crosses midnight, and two events
  with identical timestamps and different operative dates

### Requirement: In-memory fixtures carry an explicit operative date

The in-memory fixtures MUST give each seeded event an explicit `fechaOperativa`. A fixture MUST NOT
omit the field, because omission would make the adapters diverge on the one property this change
introduces.

#### Scenario: No seeded event lacks an operative date

- GIVEN the in-memory operational fixtures
- WHEN every seeded event is enumerated
- THEN each exposes a `fechaOperativa` in `YYYY-MM-DD` form

#### Scenario: Fixtures keep exercising the shape the domain produces

- GIVEN a fixture event
- WHEN it is passed through a `Registrar*Input`
- THEN the fixture's `fechaOperativa` is the one the domain carries into the entity

## Interaction with the pending `operational-event-operative-date` delta

`openspec/changes/operational-event-operative-date/specs/operational-repository-contracts/spec.md`
contains an ADDED requirement *"No port signature changes in this change"*, whose scenario asserts that
`listarPorMaquina` accepts only `maquinaId`. That requirement was correct for its own change and is
**superseded** by the requirement *"Exactly four machine-event ports gain a day-scoped listing"* above.
The superseded scenario MUST NOT be promoted as-is when `operational-event-operative-date` is archived;
it must be replaced by the day-scoped contract specified here. This delta records that; it does not
edit the other change's file.
