# Operational Repository Contracts Specification

Capability: `operational-repository-contracts` (delta)
Change: `historical-day-navigation`
In-scope projects: `.` (frontend, TypeScript)

## Purpose

Specify the **day-scoped** listing the four machine-event ports gain so that a day query is an equality
filter executed **in origin**, and specify that the two order-reached ports — `inspeccion_tela` and
`lectura_golpe` — deliberately gain **no** day predicate at all.

This delta extends the storage contracts. It adds no business rule, no column and no migration, and it
changes nothing about insert, update, open-record queries, ordering or the pure-storage boundary the
promoted capability already establishes.

## Referenced capability — NOT redefined here

| Capability | How this delta uses it |
|---|---|
| `operational-event-operative-date` | defines `fechaOperativa` as required, persisted and exclusively determining the day. This capability only matches on it |

## ADDED Requirements

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

- GIVEN every read of `paradas`, `actividades`, `danos` and `mantenimientos` performed for a selected day
- WHEN each read is inspected
- THEN each one supplied the selected operational day
- AND no read of those four collections is day-free

## Interaction with the pending `operational-event-operative-date` delta

`openspec/changes/operational-event-operative-date/specs/operational-repository-contracts/spec.md`
contains an ADDED requirement *"No port signature changes in this change"*, whose scenario asserts that
`listarPorMaquina` accepts only `maquinaId`. That requirement was correct for its own change and is
**superseded** by the requirement *"Exactly four machine-event ports gain a day-scoped listing"* above.
The superseded scenario MUST NOT be promoted as-is when `operational-event-operative-date` is archived;
it must be replaced by the day-scoped contract specified here. This delta records that; it does not
edit the other change's file.
