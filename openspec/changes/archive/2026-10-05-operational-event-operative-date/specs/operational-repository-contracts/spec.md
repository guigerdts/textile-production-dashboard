# Operational Repository Contracts Specification

Capability: `operational-repository-contracts`
Change: `operational-event-operative-date`
In-scope projects: `.` (frontend, TypeScript)

## Purpose

Define how `fechaOperativa` survives the round-trip through **both** adapter families, and how the
in-memory and SQLite adapters are held to observably identical behaviour for the new field.

This delta is **adapter-only**. It does not add day-scoped queries: `listarPorMaquina` keeps
returning the machine's full history, exactly as before.

## Referenced capability — NOT redefined here

| Capability | How this delta uses it |
|---|---|
| `operational-event-operative-date` | defines the field's meaning, its caller-supplied origin and the exclusive-attribution rule. This capability only stores and returns it verbatim |

## ADDED Requirements

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

### Requirement: No port signature changes in this change

The `I*Repository` method names and signatures MUST remain exactly as they are; `listarPorMaquina`
still returns the machine's full history and still accepts only `maquinaId`. Day-scoped listing is
CHANGE 2's scope, and adding an unused filter parameter here would be an untested speculative API.

#### Scenario: The ports are unchanged

- GIVEN the four operational port interfaces
- WHEN their method signatures are inspected
- THEN each matches its pre-change signature, with no date parameter added

#### Scenario: A full-machine listing still returns every day

- GIVEN stored events attributed to three different operational days
- WHEN `listarPorMaquina` is called with the machine id
- THEN all of them are returned, ordered chronologically as before

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