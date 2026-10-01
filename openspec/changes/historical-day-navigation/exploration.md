# Exploration: Historical operational-day view (`historical-day-navigation`)

> **STATUS: BLOCKED — decisions Q1 and Q2 were answered; this change is now waiting on
> `operational-event-operative-date` (CHANGE 1).**
>
> **Q1 = (a)** — the four machine-event domains get an explicit persisted
> `fechaOperativa`. No derivation from timestamps, in the UI or in the query layer.
> **Q2 = exclusive attribution** — `fechaOperativa` alone determines the day; a
> midnight-crossing or still-open event keeps the date it was registered with and
> never surfaces on another day through temporal overlap.
>
> Both decisions were taken on 2026-09-30 and are binding. They make this change
> **impossible to implement before CHANGE 1 lands**, because the field the ports must
> filter on does not exist yet. CHANGE 1 is specified separately in
> `openspec/changes/operational-event-operative-date/`. No spec, design or tasks are
> written here until CHANGE 1 is implemented.

Read-only exploration. No implementation. This file records the mapped facts, the
minimum viable scope, and the two blocking findings (now resolved as above) that
required a decision before any spec/design could be written.

## 1. What exists today (evidence)

### 1.1 The eight repository ports

Phase 1 (`jornada`, `orden`, `lectura_golpe`) and the five operational ports from
migration 004 (`parada`, `actividad_planificada`, `dano`, `inspeccion_tela`,
`mantenimiento`) are all async, name-stable contracts in `src/store/`:

| Port | File | Day-scoped read? |
| --- | --- | --- |
| `IJornadaRepository.obtenerParaFecha(fechaOperativa)` | `src/store/jornadaRepository.ts:40` | **yes** — keyed by `fechaOperativa` |
| `IOrderRepository.getOrderByFechaOperativa(fechaOperativa)` | `src/store/repository.ts:21` | **yes** — keyed by `fechaOperativa` |
| `ILecturaGolpeRepository.getLecturasByOrden(ordenId)` | `src/store/repository.ts:69` | indirect — via the order |
| `IParadaRepository.listarPorMaquina(maquinaId)` | `src/store/paradasRepository.ts:48` | **no** — full machine history |
| `IActividadPlanificadaRepository.listarPorMaquina(maquinaId)` | — | **no** — full machine history |
| `IDanoRepository.listarPorMaquina(maquinaId)` | `src/store/danosRepository.ts:49` | **no** — full machine history |
| `IMantenimientoRepository.listarPorMaquina(maquinaId)` | `src/store/mantenimientoRepository.ts:63` | **no** — full machine history |
| `IInspeccionRepository.listarPorOrden(ordenId)` | `src/store/inspeccionRepository.ts:66` | indirect — via the order |

`recoverPersistedState` already receives `fechaOperativa` and resolves jornada and
order by that date, but deliberately issues **no date predicate** for the four
machine-event lists — documented as intentional at `src/store/sqlite/recovery.ts:30-32`:
*"The four machine-event lists carry the machine's FULL history: recovery applies
NO date predicate (a future 'read a past day' feature adds it to the ports, never
to recovery)."* This confirms the archived proposal's prediction (`proposal.md:329`,
R10) that **the ports are the place to add the predicate**.

### 1.2 The clock is fixed to today

`src/App.tsx:113` binds `hoy = fechaOperativaHoy()` (`src/store/fixtures.ts:20-22`,
`new Date().toISOString().slice(0, 10)`). Recovery is invoked once in
`src/main.tsx:85-94` with that value. There is **no date selector and no day
navigation** anywhere in the UI.

### 1.3 Derived values stay pure and synchronous

Recovery returns **sources only**; every derived value (progreso, tiempo
productivo, machine state, projected 2da, alert, buena racha, inspection estado)
is computed afterwards by the existing `src/domain/**` functions. The boundary is
enforced by `RecoveryState` (`src/store/sqlite/recovery.ts:82-91`) and restated in
the promoted spec `operational-recovery-wiring`. Selecting a different day feeds the
**same** pure functions with a different source set — no domain change is implied
by the feature itself.

### 1.4 Adapters and tests

- In-memory adapters keep one `Map` per domain and filter in the read method
  (representative: `src/store/inMemoryDanosRepository.ts:48-53` — filters by
  `maquinaId`, sorts by `inicio`). SQLite adapters issue `SELECT ... WHERE machine_id`
  (representative: `src/store/sqlite/sqliteDanoRepository.ts:221`).
- There is **no shared contract harness** that runs one suite against both adapters.
  Each adapter has its own test file, plus `src/__tests__/persistence-integration.test.ts`
  and `src/store/sqlite/__tests__/fakeSqliteStore.ts` (a modelled SQLite double).
  A contract suite for the new day filter must be built — or the existing per-adapter
  parity pattern extended.

## 2. Minimum viable scope

1. **Operational-day selector** — the app reads an explicit `fechaOperativa` instead
   of `fechaOperativaHoy()`.
2. **Day-scoped query** — the four machine-event ports gain an explicit
   `fechaOperativa` predicate, filtered **in origin** (SQL `WHERE` / in-memory
   filter), never "load everything and discard in the UI".
3. **Empty day** — a day with no order and no events renders the existing
   no-order state; no error, no fabricated record.
4. **Read-only historical mode** — historical days expose no write controls.
5. **Day navigation** — move between days without leaving the dashboard.

## 3. Blocking finding #1 — the machine events have no `fechaOperativa`

The provisional decision *"the queried date filters by the jornada's
`fechaOperativa`, not by each event's UTC timestamp"* **contradicts the current
model** for the four machine-event domains.

`Parada`, `ActividadPlanificada`, `Dano` and `Mantenimiento` carry only
`inicio: string` (ISO 8601) and `fin: string | null`. They have **no
`fechaOperativa` field**:

- `src/domain/types.ts:125-139` (ActividadPlanificada), `:196-222` (Dano),
  `:335-353` (Mantenimiento); `Parada` likewise has `inicio`/`fin` only.
- Columns mirror it: `DanoSqlValues` (`sqliteDanoRepository.ts:133-148`),
  `MantenimientoSqlValues` (`sqliteMantenimientoRepository.ts:139-150`) — `inicio`,
  `fin`, no date column.

The only indirect attribution route is the order link, and it is unavailable for the
most important historical case: **machine events may exist with no order**.
ActividadPlanificada explicitly carries no `ordenId` (`types.ts:122-123`, *"puede
registrarse en día vacío"*); `Mantenimiento` is a machine record with no order at all
(ADR 0006); parada and daño accept `ordenId: string | null` (*"daño sin orden
(máquina ociosa)"*, `types.ts:199`).

So for an event recorded on an empty day — the exact case this feature exists to
show — **there is no `fechaOperativa` to filter on**. The choice that resolves this
is a domain decision, and the three routes have materially different consequences:

| Route | What it changes | Cost |
| --- | --- | --- |
| **(a) Persist `fechaOperativa` on the four events** | `src/domain/types.ts` + a new migration 005 writing the column | New domain field, new schema, 004 stays immutable. Widest blast radius; needs its own change. |
| **(b) Derive the day from `inicio`** | Nothing in the model; the port filters on the timestamp prefix | Exactly the UTC-timestamp filtering the provisional decision rejected. Also raises which timezone owns the day boundary. |
| **(c) Attribute by the jornada window** | Nothing persisted; the port filters `inicio` against the day's jornada range | Reuses `fechaOperativa` as the *selector* while still reading the event timestamp. Requires the "open event" rule (finding #2). |

## 4. Blocking finding #2 — midnight-crossing needs a new rule

The model represents time as `inicio` / `fin` ISO strings with `fin: null` meaning
**open** (parada, daño, mantenimiento, actividad all share this). It defines **no**
rule for which day an event belongs to when it starts on one day and ends on
another, or when it is still open.

Concretely, for a viewing day whose jornada is `D 07:00–17:00`:

- a damage with `inicio` `D-1 23:50`, `fin` `D 00:30` — does it appear on D-1, on D, or both?
- an open damage `inicio` `D-1 09:00`, `fin` null, still unresolved on D — does D show it?

Route (c) above still needs this answered: "belongs to the day it started" and
"overlaps the day's jornada" produce different dashboards here, and neither is
encoded anywhere in `CONTEXT.md`, the specs or the ADRs. Inventing it would be a new
domain rule, which the brief explicitly forbids without a decision.

## 5. Out of scope for this change

- Writing historical events (the historical view is read-only).
- The Acabado official-quality feed and the real weekly-programming feed — both
  separately blocked and untouched here.
- Persisting any derived value (the promoted specs forbid it).
- Any change to business rules in `src/domain/**`, or to migration 001–004.

## 6. Provenance

`R5/R6` (runtime validation) remain open per `src-tauri/migrations/VALIDATION.md` and
are unaffected by this exploration.