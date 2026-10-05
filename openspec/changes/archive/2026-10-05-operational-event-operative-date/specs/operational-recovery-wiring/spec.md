# Operational Recovery and Wiring Specification

Capability: `operational-recovery-wiring`
Change: `operational-event-operative-date`
In-scope projects: `.` (frontend, TypeScript)

## Purpose

Define that recovery and the application-layer registration handlers carry `fechaOperativa` without
loss and without invention: the field the domain produced is the field that comes back after a
restart, and the handler supplies it explicitly rather than letting any layer derive it.

## Referenced capability — NOT redefined here

| Capability | How this delta uses it |
|---|---|
| `operational-event-operative-date` | defines the field and its exclusive attribution. This capability only guarantees it survives a restart and is supplied on the way in |

## ADDED Requirements

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
`inicio: new Date().toISOString()`. Only `ActividadesSection` currently receives `hoy`
(`src/ui/ActividadesSection.tsx:17`), so the other three sections MUST gain that prop from the same
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

#### Scenario: A rejected insert reports the error and changes nothing

- GIVEN a registration whose persistence fails
- WHEN the handler completes
- THEN the error is surfaced and the visible state is unchanged
- AND no event exists in storage without a `fechaOperativa`