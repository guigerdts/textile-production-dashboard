# Design: Operational event operative date (CHANGE 1)

**Change:** `operational-event-operative-date`
**Status:** Specified. No implementation in this change.

## 1. Design decisions

| # | Decision | Rationale |
|---|---|---|
| DD1 | Required `fechaOperativa: string` on four entities and four `Registrar*Input`s | Q1=(a). An explicit persisted key is the only way to query deterministically without inference |
| DD2 | The domain receives the value; it never computes it | The domain is pure by project rule (`src/domain/*.ts` headers). Existing `inicio` already arrives from the caller — the new field follows the same path |
| DD3 | Application layer is the single source of the current day | `App.tsx` already owns `hoy`; registration call sites already pass `inicio` from the same context |
| DD4 | `TEXT NOT NULL`, no `DEFAULT`, no data statement in migration 005 | Migration 004's established posture: the schema declares no implicit values. A `DEFAULT` would silently let an adapter omit the day |
| DD5 | No backfill at all | No productive history exists to preserve, and inferring a day from `inicio` is exactly what Q1 rejects |
| DD6 | One index per table over `(machine_id, fecha_operativa)` | CHANGE 2's port query needs it; adding it here means CHANGE 2 needs no migration |
| DD7 | Port signatures unchanged | An unused filter parameter now would be speculative API with no test |
| DD8 | Shared contract suite across both adapter families | The invariant that makes CHANGE 2's filter trustworthy |
| DD9 | Operative date read from the **local** calendar via an injectable clock | See §4 — with a persisted key, a UTC-skewed day becomes a permanent misattribution |
| DD10 | Closing a record preserves `fechaOperativa` verbatim | Q2: the day is fixed at registration; `fin` and the day are independent |

## 2. Domain contract

```
Parada / ParadaAbierta    + fechaOperativa: string
ActividadPlanificada      + fechaOperativa: string
Dano (one interface)      + fechaOperativa: string   // DanoAbierto = Dano & { fin: null }
Mantenimiento             + fechaOperativa: string
```

Inputs gain the same required field, and the domain validates it following the project's
established pattern: a **private per-module** validator. `esTimestampValido` already exists privately
in `src/domain/danos.ts` and again in `src/domain/mantenimiento.ts`, and
`FECHA_OPERATIVA_RX` already exists privately in `inMemoryJornadaRepository.ts:22` and
`sqliteJornadaRepository.ts:53`. There is **no shared operative-date validator in the domain today**,
so the four new checks each get a module-private `esFechaOperativaValida` matching the `YYYY-MM-DD`
shape those existing regexes already encode. Introducing a single shared domain validation module, or
refactoring the duplicated timestamp validators, would widen this change beyond the operative-date
field — noted as out of scope in §8.

Validation contract, uniform across the four:

- absent or empty → error `"debe indicar la fecha operativa"`
- not `YYYY-MM-DD` → error naming the expected format
- **no** cross-check against `inicio` — Q2 explicitly forbids reconciling the two

`cerrarParada`, closing a `Dano` and closing a `Mantenimiento` spread the existing record and change
only `fin`, so `fechaOperativa` carries through structurally. No code change is needed there, and the
tests exist to prove it.

### Order interaction

An event with an `ordenId` keeps the **event's** `fechaOperativa`, never `orden.fechaOperativa`. An
order left in production across days makes these genuinely different values, and the event's day is
the day the operator registered it. This is why the field cannot be computed by copying the order.

## 3. Migration 005

```sql
-- CHANGE 1 (Q1=(a)): explicit operational-day attribution for machine events.
-- Additive only. No data statement: there is no productive history to preserve,
-- and inferring a day from `inicio` is forbidden by operational-event-operative-date.
-- 001-004 are applied and MUST NOT be edited (checksum validation).
-- Index names follow 004's convention: Spanish, singular table, _maquina_.

ALTER TABLE parada ADD COLUMN fecha_operativa TEXT NOT NULL;
ALTER TABLE actividad_planificada ADD COLUMN fecha_operativa TEXT NOT NULL;
ALTER TABLE dano ADD COLUMN fecha_operativa TEXT NOT NULL;
ALTER TABLE mantenimiento ADD COLUMN fecha_operativa TEXT NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parada_maquina_fecha ON parada (machine_id, fecha_operativa);
CREATE INDEX IF NOT EXISTS idx_actividad_maquina_fecha ON actividad_planificada (machine_id, fecha_operativa);
CREATE INDEX IF NOT EXISTS idx_dano_maquina_fecha ON dano (machine_id, fecha_operativa);
CREATE INDEX IF NOT EXISTS idx_mantenimiento_maquina_fecha ON mantenimiento (machine_id, fecha_operativa);
```

**Compatibility with the existing base.** A SQLite `ALTER TABLE … ADD COLUMN … NOT NULL` without a
default is accepted only when the table is empty; on a populated table SQLite rejects it with
`Cannot add a NOT NULL column with default value NULL`. Verified empirically against real SQLite
before writing this design:

| Case | Result |
|---|---|
| `ADD COLUMN … NOT NULL` on an empty table | accepted; column present |
| `ADD COLUMN … NOT NULL` on a table with one row | rejected — `OperationalError: Cannot add a NOT NULL column with default value NULL` |
| `CREATE INDEX` over the just-added column | accepted |
| `INSERT` omitting the new column | rejected — `NOT NULL constraint failed` |

Consequences:

- **The current base is empty**, the stated and verified situation, so the statements are accepted.
- **If rows were present, the migration fails loudly** instead of inventing a day — the required
  behaviour per the spec. There is deliberately no fallback `UPDATE` that backfills from `inicio`.
- **No pre-check is added.** The existing `verifySchema()` only tests that tables exist
  (`src/store/sqlite/migrations/index.ts:74`); nothing verifies a version or an empty history, and
  adding such a check would be new code for a condition SQLite already rejects on its own.

**Failure atomicity.** sqlx-sqlite applies each migration inside a single transaction that includes
its `_sqlx_migrations` bookkeeping, so a rejected 005 leaves the version at 4 with no partial DDL at
runtime. The Python harness uses `executescript` in autocommit mode and *does* leave partial DDL when
one statement fails — so harness evidence must never be presented as runtime-equivalent. The negative
case (rows present) is therefore demonstrated on the harness as evidence that SQLite rejects it, not
as evidence about runtime state.

**Counts that move.** The five operational tables go from 59 to **63** columns, and from 11 to **15**
indexes. The promoted `operational-events-schema` asserts 59, 11 and `CURRENT_MIGRATION_VERSION = 4`;
this change carries the `MODIFIED` requirements that keep those assertions true for migration 004
while describing the version-5 state. `validate_r56.py` hardcodes `EXPECTED_COLUMNS_004 = 59` and
four INSERTs that omit the new column, so it MUST be updated or it will fail — while that failure is
itself the correct proof of the NOT NULL backstop.

Registration: `src-tauri/src/lib.rs` gains `version: 5`; a **byte-identical mirror** is created at
`src/store/sqlite/migrations/005_event_fecha_operativa.sql` (the frontend suites import canonical and
mirror via `?raw` and compare them, as 001–004 do); `CURRENT_MIGRATION_VERSION` advances 4 → 5.

`inspeccion_tela` is untouched — it carries `timestamp` and always belongs to an orden, so it reaches
its day through the order.

## 4. Clock: local calendar, injectable

`fechaOperativaHoy()` currently returns `new Date().toISOString().slice(0, 10)` — the **UTC** date.
For a plant west of UTC, the last hours of the local workday already carry tomorrow's UTC date, and
`CONTEXT.md` states the day is "extended by overtime". Registering an event in that window would
persist tomorrow's date as today's attribution — irreversible, and a direct violation of Q2.

Design: extract a single clock seam used by every registration call site.

```
// src/store/clock.ts
export type Reloj = () => Date;
export const relojDelSistema: Reloj = () => new Date();
export function fechaOperativaDe(reloj: Reloj = relojDelSistema): string
```

`fechaOperativaDe` formats the local calendar date (`YYYY-MM-DD`). The existing
`fechaOperativaHoy()` (`src/store/fixtures.ts:20-22`) becomes a thin wrapper over it.

The four registration call sites already read their own instants as UTC
(`new Date().toISOString()` in `ParadasSection.tsx:100`, `ActividadesSection.tsx:76`,
`DanoSection.tsx:127`, `MantenimientoSection.tsx:112`). `inicio` legitimately is a UTC instant and
stays as it is; the new day field comes from the seam instead. Three of those four sections receive no
day prop today — only `ActividadesSection` declares `hoy: string` (`:17`) — so each needs the operative
day threaded in from the app's single source, rather than any section calling the clock itself.

Scope note: this is not a new business rule — it is the precondition for the already-closed Q2 rule to
hold. It is listed explicitly because it changes one function's output on a machine in a UTC-offset
timezone, and because `fechaOperativaHoy()` currently lives in `fixtures.ts`, which is a fixture module
rather than the right long-term home for a production date source. Moving it is part of this seam.

## 5. Files touched

| Layer | Files | Change |
|---|---|---|
| Types | `src/domain/types.ts` | + `fechaOperativa` on 4 entities |
| Domain | `src/domain/paradas.ts`, `actividades.ts`, `danos.ts`, `mantenimiento.ts` | input field + private validator; carry into construction |
| Clock | new `src/store/clock.ts`; `src/store/fixtures.ts` | local-calendar date + injectable seam |
| Migration | new `src-tauri/migrations/005_event_fecha_operativa.sql`; `src-tauri/src/lib.rs` | column + indexes + `version: 5` |
| Migration mirror | new `src/store/sqlite/migrations/005_event_fecha_operativa.sql`; `src/store/sqlite/migrations/index.ts` | byte-identical mirror; `CURRENT_MIGRATION_VERSION = 5` |
| SQLite adapters | `sqliteParadaRepository.ts`, `sqliteActividadPlanificadaRepository.ts`, `sqliteDanoRepository.ts`, `sqliteMantenimientoRepository.ts` | INSERT/UPDATE column, mapper read, loud failure on missing |
| InMemory adapters | matching in-memory repositories + `src/store/fixtures.ts` | store/return the field; explicit fixture dates |
| Recovery | `src/store/sqlite/recovery.ts` | verified pass-through (no logic change expected) |
| Call sites | `src/ui/ParadasSection.tsx:100`, `ActividadesSection.tsx:76`, `DanoSection.tsx:127`, `MantenimientoSection.tsx:112` | pass `fechaOperativa`; the three sections that lack a `hoy` prop gain it (only `ActividadesSection` has one today, `:17`) |
| Harness | `src-tauri/migrations/validate_r56.py` | version 5, 59 → 63 columns, four INSERTs must now supply the column |
| Tests | domain + adapter + contract + persistence + harness | see §6 |

## 6. Test strategy

**Domain (pure, no DB).** `fechaOperativa` required; format validated; midnight-crossing keeps its
day; closing preserves the day; two events with identical timestamps stay distinct; event on an
orden from a previous day keeps its own date; event with `ordenId: null` is fully attributable.

**Clock.** Injected `Reloj` at the day boundary yields the local date; `fechaOperativaHoy()` agrees
with it.

**Parity contract (new shared suite, both families).** For each of the four entities: event with an
operative date; event with no order and a date; midnight-crossing event; open event crossing
midnight; two events with equal timestamps and different dates; duplicate-id insert rejected;
unknown-id update rejected; full-machine listing still returns every day (DD7).

**Persistence (SQLite, real engine).** Migration 005 applies on top of 004 on a migrated database;
`fecha_operativa` is `NOT NULL` with `dflt_value IS NULL`; insert omitting the column is rejected;
`inspeccion_tela` still has exactly 18 columns; the four indexes exist; re-running the harness on a
database holding machine-event rows fails loudly instead of backfilling.

**Recovery.** After reload, each event's `fechaOperativa` equals what was persisted; a
midnight-crossing event recovers under its own day; an open event crossing midnight keeps its day;
recovery applies no day predicate.

**Harness.** `validate_r56.py` advances to version 5 and asserts the new column/index/NOT-NULL shape,
keeping R5/R6 evidence current. R5/R6 stay **OPEN** for Tauri-runtime verification — this change
does not close them.

## 7. Risks and rollback

| Risk | Mitigation |
|---|---|
| A call site that forgets the field | Required input field → compile error, not a runtime default |
| Adapters diverging | Shared contract suite across both families |
| Migration rejected on a non-empty base | Assert the precondition and let it fail loudly; never backfill a day |
| Clock correction changes a value on UTC-offset machines | Correct-by-necessity: it is the precondition for Q2; called out in §4 for review |
| Scope bleeding into navigation | No port signature change, no selector, no read-only mode — asserted by the tasks list |

**Rollback.** No `Down` migration exists (project convention). Rolling back means reverting the code
and the migration file before 005 is applied anywhere with data. Once an event is persisted, its
`fechaOperativa` is authoritative history and is never recomputed.

## 8. Explicit non-goals

No day selector, no navigation, no read-only historical mode, no port date filtering, no changes to
any existing business rule, no data invention. CHANGE 2 (`historical-day-navigation`) owns all of
that and is blocked until this change is implemented.