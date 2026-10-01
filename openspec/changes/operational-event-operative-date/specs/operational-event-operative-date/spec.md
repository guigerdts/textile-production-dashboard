# Operational Event Operative Date Specification

Capability: `operational-event-operative-date` (NEW)
Change: `operational-event-operative-date`
In-scope projects: `.` (frontend, TypeScript) and `src-tauri` (Rust shell)

## Purpose

Define the **explicit operational-day attribution** carried by the four machine events —
`Parada`, `ActividadPlanificada`, `Dano` and `Mantenimiento` — so that any day-scoped query is a
deterministic equality filter, and so that no layer has to *infer* the day from a UTC timestamp.

This capability is **domain-first**. It specifies *what day an event belongs to* and *where that
attribution comes from*. It does not specify the durable column set (`operational-events-schema`),
repository behaviour (`operational-repository-contracts`) or recovery composition
(`operational-recovery-wiring`).

## User Stories covered

| # | As a… | I want… | So that… |
|---|---|---|---|
| US-A | the machine | every operational event to carry the operational day it was attributed to | a past day can be queried by equality, never by inference from a timestamp |
| US-B | the reviewer | events with no production order to carry an operative date | the **empty day** — the case that has no order to derive a date from — is still queryable |

## Referenced domain rules — NOT redefined here

The event rules of tickets 02–08 are closed. This capability references them and changes none of
them. `fechaOperativa` is an **additional attribution field**, not a replacement for any existing
semantics:

| Rule | Source | How this spec uses it |
|---|---|---|
| `Parada` is registrable on an **empty day** (`ordenId` may be `null`) | ticket 02, `CONTEXT.md` | a `null` `ordenId` is the reason `fechaOperativa` must exist on the event itself |
| Activities are **independent of any orden** by design | ticket 03, ADR 0005 | `ActividadPlanificada` has no `ordenId`, so it has no other day source |
| `Dano` accepts `ordenId: null` ("máquina ociosa / día vacío") | ticket 05, `src/domain/danos.ts:69` | same as `Parada` |
| Maintenance is machine-level, **never** tied to an orden; may be registered on an empty day | ticket 08, ADR 0006 | no `ordenId` exists to borrow a date from |
| Open record = `fin === null`; `DanoAbierto` is `Dano & { fin: null }`, never a stored discriminator | tickets 02/05/08 | `fin` and `fechaOperativa` are **independent**: closing changes `fin`, never the day |
| The domain is **pure** (no clock, no `Date.now()`) | `src/domain/*.ts` header rules | `fechaOperativa` is an **input**; the domain never computes it |
| `InspeccionTela` carries `timestamp: string` (`src/domain/types.ts:308`) and **always** belongs to an orden | ticket 07, `CONTEXT.md` | an inspection reaches its day through its mandatory `ordenId`, so it needs no field of its own — see "Non-goals" |

## Non-goals

- **No navigation.** Nothing in this capability selects, displays or filters a day; that is
  `historical-day-navigation` (CHANGE 2).
- **No port signature change.** List methods still return the machine's full history here.
- **No overlap semantics.** There is exactly one day per event, and only one rule for reaching it.
- **No derivation.** The domain must not compute `fechaOperativa` from `inicio`, and the UI or query
  layer must not derive it later.
- **No `fechaOperativa` on `InspeccionTela`.** It has `timestamp`, and its day is already reachable
  through the `orden` every inspection belongs to. Adding a second, redundant day field there would
  duplicate an attribution the mandatory `ordenId` already provides.
- **No `fechaOperativa` on `Jornada`.** A jornada is the day aggregate itself, not an event attributed
  to a day.

## ADDED Requirements

### Requirement: The four machine events carry an explicit `fechaOperativa`

`Parada`, `ActividadPlanificada`, `Dano` and `Mantenimiento` MUST each expose a required
`fechaOperativa: string`. Its value MUST be the operational day the event was attributed to, in
`YYYY-MM-DD` form — the same shape `Orden.fechaOperativa` uses and the shape the jornada repositories
already validate against (`FECHA_OPERATIVA_RX`, `src/store/inMemoryJornadaRepository.ts:22`).

`Dano` is a single `interface` with `DanoAbierto = Dano & { fin: null }` as its open alias
(`src/domain/types.ts:196`, `:225`); the field therefore appears once, on the interface, and every
variant built from it inherits it.

#### Scenario: All four event types expose the field

- GIVEN the domain entity types
- WHEN `Parada`, `ActividadPlanificada`, `Dano` (and thus `DanoAbierto`) and `Mantenimiento` are inspected
- THEN each exposes a required `fechaOperativa: string`

#### Scenario: The inspection and jornada entities are untouched

- GIVEN the `InspeccionTela` and `Jornada` types
- WHEN their fields are enumerated
- THEN neither exposes `fechaOperativa`, and `InspeccionTela.timestamp` is unchanged

### Requirement: `fechaOperativa` is an input, never derived

Each `Registrar*Input` MUST require `fechaOperativa: string`. The domain MUST NOT compute it from
`inicio`, from a clock, or from any ambient source: registration already receives `inicio` as an
explicit caller-supplied ISO timestamp, and `fechaOperativa` follows the same path.

Each of the four domain modules MUST validate the field with a **module-private**
`esFechaOperativaValida`, following the pattern the project already uses for
`esTimestampValido` (private in both `src/domain/danos.ts` and `src/domain/mantenimiento.ts`) and
`FECHA_OPERATIVA_RX` (private in both jornada repositories). This change MUST NOT introduce a shared
domain validation module.

The application/UI layer is the single source of the current operational day, and every registration
call site MUST pass it explicitly.

#### Scenario: Registration rejects a missing or malformed `fechaOperativa`

- GIVEN a registration input whose `fechaOperativa` is absent, empty or not `YYYY-MM-DD`
- WHEN the pure domain function runs
- THEN it returns an error and no event

#### Scenario: The domain never derives the day from the timestamp

- GIVEN a registration input with `fechaOperativa` and an `inicio` whose own calendar date differs
- WHEN the domain constructs the event
- THEN the event keeps the supplied `fechaOperativa`
- AND no code path in `src/domain/**` computes a date to replace it

#### Scenario: Each call site supplies the day

- GIVEN the four registration call sites (`src/ui/ParadasSection.tsx:100`,
  `src/ui/ActividadesSection.tsx:76`, `src/ui/DanoSection.tsx:127`,
  `src/ui/MantenimientoSection.tsx:112` — each of which already builds its own `inicio:
  new Date().toISOString()`)
- WHEN each builds its domain input
- THEN each passes `fechaOperativa` explicitly, from the app's single operational-day source

### Requirement: `fechaOperativa` alone determines the day, exclusively

An event's day is its `fechaOperativa` and nothing else. Temporal overlap NEVER confers membership
in another day. This is the rule that makes a day query an equality filter.

#### Scenario: A midnight-crossing event stays on its registered day

- GIVEN a closed event with `fechaOperativa = D`, `inicio = D-1 23:50` and `fin = D 00:30`
- WHEN day `D-1` is queried
- THEN the event is not a member of `D-1`
- AND when day `D` is queried, the event is returned exactly once

#### Scenario: An open event that continues past midnight keeps its day

- GIVEN an open event with `fechaOperativa = D-1`, `inicio = D-1 09:00` and `fin = null`
- WHEN day `D` is queried
- THEN the event is not returned, because `D` is not its `fechaOperativa`

#### Scenario: An event is never returned twice

- GIVEN any event
- WHEN any single day is queried
- THEN it appears at most once, and only under its own `fechaOperativa`

#### Scenario: `inicio`/`fin` remain the real instants

- GIVEN an event whose `fechaOperativa` and `inicio` disagree on calendar date
- WHEN both are read back
- THEN `inicio`/`fin` are unchanged instants
- AND `fechaOperativa` is the attributed day, with no reconciliation between the two

### Requirement: Closing a record never changes its day

`cerrarParada`, closing a `Dano` and closing a `Mantenimiento` MUST preserve the record's
`fechaOperativa` verbatim. An open record carries its day forward across any number of midnights.

#### Scenario: Closing preserves the operative date

- GIVEN an open `Parada` with `fechaOperativa = D-1`
- WHEN it is closed with a `fin` timestamp on day `D`
- THEN the closed `Parada` still reports `fechaOperativa = D-1`

#### Scenario: Closing an open `Dano` preserves the operative date

- GIVEN a `DanoAbierto` with `fechaOperativa = D-1`
- WHEN it is closed on day `D`
- THEN the resulting `Dano` still reports `fechaOperativa = D-1`

#### Scenario: The domain never recomputes the day on update

- GIVEN an open `Mantenimiento` whose `inicio` is on `D-1`
- WHEN it is closed, for any duration, on any later day
- THEN its `fechaOperativa` is exactly the value it was registered with

### Requirement: Two events with identical timestamps may belong to different days

Two events with equal `inicio` (and equal `fin`) MUST be distinguishable by `fechaOperativa`. The
timestamp is not the key; the attributed day is.

#### Scenario: Equal timestamps, different operative dates

- GIVEN two `Parada` records with the same `inicio` and the same `fin`
- WHEN they are given `fechaOperativa = D1` and `fechaOperativa = D2`
- THEN both survive a store/reload round-trip with their own `fechaOperativa` intact
- AND neither is rewritten, merged or deduplicated because their timestamps match

### Requirement: The current operational day is read from the local calendar

The application's "current operational day" MUST be the calendar date **in the plant's local
timezone**, never the UTC date. A UTC calendar date is a different day: for any timezone west of
UTC, the last hours of the local day already belong to the next UTC day.

This matters *because* the value is now persisted. While it was an ephemeral in-memory jornada key,
a UTC-skewed value was self-correcting on the next render. Once it is written into a row it is
permanent, so a skew silently misattributes every event registered in the affected window — which
would violate the exclusive-attribution rule at the moment of registration. The existing code already
reads instants as UTC (`new Date().toISOString()` in all four sections), and `CONTEXT.md` states the
day is "extended by overtime", so this window is reachable in normal operation.

The reading of the local calendar MUST be injectable so the day boundary can be tested without
depending on the machine's wall clock or timezone.

#### Scenario: The operative date is the local date

- GIVEN the plant timezone is behind UTC
- WHEN the current operational day is read at a moment whose local date differs from its UTC date
- THEN the returned `fechaOperativa` is the **local** date

#### Scenario: A late-registration does not misattribute the day

- GIVEN a local time whose UTC date is the following day
- WHEN an event is registered
- THEN its persisted `fechaOperativa` is the local date the operator is working on

#### Scenario: The day boundary is testable without the wall clock

- GIVEN an injected clock at the day boundary
- WHEN the current operational day is read
- THEN the result is deterministic and independent of the machine's real timezone

### Requirement: Order attribution does not substitute for `fechaOperativa`

When an event carries an `ordenId`, the event's `fechaOperativa` MUST be the value supplied at
registration, NOT a value copied from `orden.fechaOperativa`. An orden may still be in production
on a later day than the day it was programmed for, and an event registered today against that
orden belongs to today's day.

#### Scenario: An event on an orden from a previous day keeps its own date

- GIVEN an `Orden` with `fechaOperativa = D1` that is still in production
- WHEN a `Parada` is registered today (`D2`) with that `ordenId` and `fechaOperativa = D2`
- THEN the `Parada` reports `fechaOperativa = D2`, not `D1`

#### Scenario: An event with no order is attributable

- GIVEN `ordenId = null`
- WHEN an event is registered with an explicit `fechaOperativa`
- THEN it is fully attributable, with no order needed to supply or validate the day