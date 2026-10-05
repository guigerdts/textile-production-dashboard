# Proposal: Operational event operative date (CHANGE 1)

**Change name:** `operational-event-operative-date`
**Status:** Specified. Ready for design/tasks review.
**Depends on:** nothing. **Blocks:** `historical-day-navigation` (CHANGE 2).

## Problem

`Parada`, `ActividadPlanificada`, `Dano` and `Mantenimiento` carry `inicio`/`fin`
ISO timestamps but **no `fechaOperativa`**. The machine's full history is already
persisted and reloaded, but there is no deterministic day key to filter on:

- For events **with** an order, `orden.fechaOperativa` exists — but it is the *order's*
  day, which is not necessarily the day the event was registered (an order left in
  production across days).
- For events **without** an order (a stop, damage or maintenance recorded on an empty
  day), there is no order at all and no date to attribute to.

This blocks any day-scoped query without inference from UTC timestamps, which is
explicitly rejected (the operator must not have the day inferred by the UI or the query
layer).

## Intent

Persist an explicit `fechaOperativa` on the four machine-event entities so that every
day-scoped query is a deterministic equality filter, and so that CHANGE 2
(`historical-day-navigation`) can filter at the ports without inference.

## Decisions

- **D1** — Add required `fechaOperativa: string` (YYYY-MM-DD, the operational day) to
  `Parada`, `ActividadPlanificada`, `Dano`, and `Mantenimiento` domain types and SQLite
  schema.
- **D2** — Add required `fechaOperativa: string` to each `Registrar*Input`. The caller
  (application layer, which owns the current operational day) supplies it explicitly;
  the pure domain does **not** derive it from `inicio` and has no clock.
- **D3** — Q2 (exclusive attribution): `fechaOperativa` alone determines the day. A
  midnight-crossing or still-open event keeps the date it was registered with and never
  appears on another day through temporal overlap. `inicio/fin` remain the real instant.
- **D4** — No new "overlap" semantics. The field is set once at registration and
  carried through `actualizar` (close) unchanged.
- **D5** — Migration 005 adds the column to the four tables. The current base is empty
  (no productive data to preserve), so **no invented backfill**; column is added and
  every write path supplies an explicit value. Existing migrations 001–004 stay
  immutable (no Down migrations, checksums must not change).
- **D6** — Port signatures and recovery composition are **unchanged in this change**
  (they still return full machine history). Day-scoped filtering belongs to CHANGE 2.
  What changes is that the field now survives the round-trip through both adapter
  families and recovery.
- **D7** — No duplication: no affected entity already carries an equivalent operative-date
  field. `InspeccionTela` has `timestamp` (not a day key) and always belongs to an orden, so it
  reaches its day through the mandatory `ordenId`; `Jornada` is the day aggregate itself. Both stay
  untouched. Documented in exploration.
- **D8** — The operative date is read from the **local** calendar through an injectable clock. The
  current `fechaOperativaHoy()` returns the UTC date, which once persisted would permanently
  misattribute late registrations — a precondition for Q2, not a new rule.

## Scope

**In scope**

1. Domain types: add `fechaOperativa` to `Parada`/`ParadaAbierta`, `ActividadPlanificada`,
   `Dano` (all branches), `Mantenimiento`.
2. Domain inputs: add required `fechaOperativa` to `RegistrarParadaInput`, the activity
   registration input, `RegistrarDanoInput`, `RegistrarMantenimientoInput`; validate
   presence/format in the pure domain with a **module-private** validator, following the
   project's existing per-module pattern (`esTimestampValido`, `FECHA_OPERATIVA_RX`).
3. SQLite migration 005: add `fecha_operativa` (`NOT NULL`, no `DEFAULT`) to the four tables
   plus four `(machine_id, fecha_operativa)` indexes following 004's Spanish naming;
   register as version 5 in `src-tauri/src/lib.rs`; create the byte-identical frontend mirror;
   advance `CURRENT_MIGRATION_VERSION`. Additive only, no data statement.
4. SQLite adapters: read/write the new column (INSERT, UPDATE, row→domain mapping).
5. InMemory adapters: store/return the field (pass-through with a fixture default if the
   fixture omits it, so pre-existing tests stay meaningful).
6. Recovery: preserve `fechaOperativa` through the SQLite→domain mapping.
7. Call sites: pass the current operational day at registration from the four real UI call sites (`src/ui/*Section.tsx`), threading the day prop into the three sections that lack it. Read that day from the **local** calendar, not UTC.
8. Update `validate_r56.py` (version list, 59 → 63 columns, and its four INSERTs that omit the new column).
8. Tests: parity + Q2 contract cases (see `tasks.md` matrix).

**Out of scope**

- Any change to `I*Repository` list signatures or day filtering (CHANGE 2).
- Any navigation, selector, or read-only historical mode (CHANGE 2).
- Behavioural change to any existing business rule (progressive field addition only).
- Inventing data or a default "today" value inside the SQLite default clause.
- Re-opening `inspeccion_tela` (already has its own date).

## Dependency order

Domain types → domain inputs/validation → migration 005 (+ Rust registration) →
SQLite adapters → InMemory adapters → recovery → application callers → tests.

## Notes / non-goals for reviewers

- The domain stays pure: `fechaOperativa` is an **input**, never computed from a clock.
- The application layer is the single source of the "current operational day"; it
  already owns it (`fechaOperativaHoy()`). Registration callers pass it explicitly.
- CHANGE 2 will filter ports by `fecha == fechaOperativa` (equality), which is only
  well-defined *because* of D3.