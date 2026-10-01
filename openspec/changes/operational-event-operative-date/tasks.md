# Tasks: Operational event operative date (CHANGE 1)

Change: `operational-event-operative-date`
Artifact store: `openspec`
In-scope projects: `.` (frontend, TypeScript) and `src-tauri` (Rust shell)
Derived from: `proposal.md`, `design.md`, and the four specs `operational-event-operative-date` /
`operational-events-schema` (delta) / `operational-repository-contracts` (delta) /
`operational-recovery-wiring` (delta)

This document schedules work only. It implements nothing, opens no PR, and makes no commit.

**Scope guard:** no task touches day selection, navigation, read-only historical mode, or a port
list signature. Those belong to `historical-day-navigation` (CHANGE 2), which is blocked until this
change lands.

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | **≈ 700–900 authored changed lines** across 6 work units |
| 400-line budget risk | **Low** in aggregate for most units; **U3** (SQLite adapters) is the one near the budget |
| Chained PRs recommended | **Yes** — the units form a strict dependency chain, so chained PRs are the natural shape |
| Suggested split | 6 chained PRs (U1 → U2 → U3 → U4 → U5 → U6), see Work Units |
| Delivery strategy | `ask-on-risk` (session preflight) |
| Chain strategy | `pending` — team decision, required before apply |

Decision needed before apply: Chain strategy only.
400-line budget risk: Low
Chained PRs recommended: Yes

> Every unit below is independently revertible at a named boundary. U1 is a pure type addition with
> no runtime effect, so reverting the chain from any later unit returns the app to its current
> behaviour.

### Work Units

| # | Unit | Goal | Test command | Runtime harness | Rollback boundary |
|---|------|------|--------------|-----------------|-------------------|
| 1 | U1 — domain types + inputs | `fechaOperativa` exists on 4 entities and 4 inputs; domain validates it | `npx vitest run src/domain` | N/A — pure | Revert `types.ts` + 4 domain files; no runtime effect existed yet |
| 2 | U2 — local-calendar clock | `fechaOperativa` is read from the local calendar via an injectable `Reloj` | `npx vitest run src/store/clock.test.ts` | N/A — pure | Revert clock module; `fechaOperativaHoy()` reverts with it |
| 3 | U3 — migration 005 | Column + indexes exist, registered in Rust + mirror + metadata, no data statement | `npx vitest run src/store/sqlite/__tests__/migration005.test.ts` + `python3 src-tauri/migrations/validate_r56.py` | `validate_r56.py` on real SQLite (DDL + NOT NULL + index assertions) | Revert 3 files; DB stays at version 4 |
| 4 | U4 — SQLite adapters | `fecha_operativa` round-trips on insert/update/read; mapper fails loudly when absent | `npx vitest run src/store/sqlite/__tests__` | Same suite against real SQLite where the harness supports it | Revert 4 adapter files; in-memory still serves the app |
| 5 | U5 — InMemory adapters + fixtures | Identical observable behaviour; explicit fixture dates | `npx vitest run src/store` (repository suites) | N/A | Revert adapter + fixture changes |
| 6 | U6 — recovery, call sites, contract suite | Recovery preserves the field; 4 call sites pass it; parity suite green across both families | `npm run test` | `validate_r56.py` for the schema assertions | Revert call-site + recovery changes; current-day behaviour intact |

---

## U1 — Domain types and registration inputs

- [ ] 1.1 Add required `fechaOperativa: string` to `Parada`/`ParadaAbierta`, `ActividadPlanificada`, all `Dano` branches and `Mantenimiento` in `src/domain/types.ts`. Do not touch `InspeccionTela` or `Jornada`.
- [ ] 1.2 Add a module-private `esFechaOperativaValida` to each of the four domain modules, matching the existing per-module validator pattern (`esTimestampValido` in `danos.ts` and `mantenimiento.ts`; `FECHA_OPERATIVA_RX` in the two jornada repositories). There is no shared domain validator today and this change does not create one.
- [ ] 1.3 Add required `fechaOperativa` to `RegistrarParadaInput` (`src/domain/paradas.ts`), the activity registration input (`src/domain/actividades.ts`), `RegistrarDanoInput` (`src/domain/danos.ts`) and `RegistrarMantenimientoInput` (`src/domain/mantenimiento.ts`).
- [ ] 1.4 Validate presence and `YYYY-MM-DD` shape in all four, with messages consistent with the existing validation style. **No cross-check against `inicio`** — Q2 forbids reconciling them.
- [ ] 1.5 Carry `fechaOperativa` verbatim into every constructed entity branch, including the `Dano` branches that link a parada.
- [ ] 1.6 Confirm `cerrarParada`, closing a `Dano` and closing a `Mantenimiento` preserve the field through their spread; add the regression test rather than assuming it.
- [ ] 1.7 Tests, covering every required shape **in the domain suite**: missing field rejected; malformed date rejected; midnight-crossing event keeps its day; an **open event that crosses midnight** keeps its day; closing a `Parada`, a `DanoAbierto` and a `Mantenimiento` each preserves the day; two events with identical `inicio`/`fin` stay distinct; an event on an orden from a previous day keeps its own date; an event with `ordenId: null` is attributable.

**Boundary:** pure domain only. No adapter, no migration, no caller yet — those units will not compile until the callers are updated in U6, which is expected.

## U2 — Local-calendar operative day

- [ ] 2.1 Create `src/store/clock.ts` exporting a `Reloj` type (`() => Date`), a `relojDelSistema` implementation, and `fechaOperativaDe(reloj?)` returning the **local** calendar date as `YYYY-MM-DD`.
- [ ] 2.2 Rewrite `fechaOperativaHoy()` (`src/store/fixtures.ts:20-22`) as a wrapper over `fechaOperativaDe()`, replacing the `toISOString().slice(0, 10)` UTC read.
- [ ] 2.3 Confirm no caller of `fechaOperativaHoy()` needs a signature change.
- [ ] 2.4 Tests with an injected fixed `Reloj`: local date returned when local and UTC dates differ; day-boundary determinism independent of the machine timezone; `fechaOperativaHoy()` agrees with `fechaOperativaDe(relojDelSistema)`.

**Boundary:** behaviour-correcting change on UTC-offset machines, called out in `design.md` §4. Reverting restores the UTC read.

## U3 — Migration 005

- [ ] 3.1 Create `src-tauri/migrations/005_event_fecha_operativa.sql` exactly as in `design.md` §3: four `ALTER TABLE … ADD COLUMN fecha_operativa TEXT NOT NULL` statements and four `CREATE INDEX IF NOT EXISTS idx_<tabla>_maquina_fecha …` statements, following migration 004's Spanish naming convention. No `DEFAULT`, no `UPDATE`, no `INSERT`, no `SELECT`.
- [ ] 3.2 Register `version: 5` with `kind: MigrationKind::Up` in `src-tauri/src/lib.rs`.
- [ ] 3.2b Create the **byte-identical mirror** at `src/store/sqlite/migrations/005_event_fecha_operativa.sql`, as 001–004 do, and advance `CURRENT_MIGRATION_VERSION` 4 → 5 in `src/store/sqlite/migrations/index.ts`.
- [ ] 3.3 Do not edit 001–004 in any byte.
- [ ] 3.4 Extend `validate_r56.py`: add version 5 to its migration list; update `EXPECTED_COLUMNS_004 = 59` to a version-5 total of **63**; and update the four machine-event INSERTs, which currently omit the new column and will start failing on the NOT NULL constraint. Assert the column exists on exactly those four tables with `notnull = 1` and `dflt_value IS NULL`; `inspeccion_tela` still has exactly 18 columns; the four indexes exist.
- [ ] 3.5 Add the negative evidence: applying 005 against a database **holding** machine-event rows must fail loudly, proving no day is invented for existing rows. Record it in `VALIDATION.md`; do not change R5/R6 from OPEN.
- [ ] 3.6 Tests: migration 005 is additive (creates/drops nothing); column sets per table; no `DEFAULT`; the Rust vector registers five versions; the mirror is byte-identical to the canonical file (`cmp`, as the 001–004 tests do via `?raw`); `CURRENT_MIGRATION_VERSION` is 5; 001–004 byte-identical.
- [ ] 3.7 Do **not** present harness evidence as runtime-equivalent: sqlx applies each migration in one transaction including `_sqlx_migrations`, while `validate_r56.py` uses `executescript` in autocommit and leaves partial DDL on failure. Record that distinction in `VALIDATION.md`.

**Boundary:** DB moves 4 → 5. Reverting the code leaves a version-5 DB, which the code tolerates (extra column), so rollback is safe.

## U4 — SQLite adapters

- [ ] 4.1 Add `fecha_operativa` to the INSERT and UPDATE of `sqliteParadaRepository.ts`, `sqliteActividadPlanificadaRepository.ts`, `sqliteDanoRepository.ts`, `sqliteMantenimientoRepository.ts`. Never a `COALESCE` or conditional default.
- [ ] 4.2 Read the column in each exported pure mapper.
- [ ] 4.3 Because the column is `NOT NULL`, a row missing `fecha_operativa` (or carrying `null`) MUST throw a mapping error naming the column — never yield an unset field. Follow the loud-failure posture of the `campos_especificos` JSON mapper.
- [ ] 4.4 Tests per adapter, run on a **real SQLite connection with migrations 001–005 applied**, not only on `fakeSqliteStore.ts` (a fake cannot enforce `NOT NULL`): insert then read returns the exact date; closing a record updates `fin` and leaves `fecha_operativa` untouched; a mapper throws on an absent/null column; mappers remain pure and connection-free; duplicate-id insert and unknown-id update still reject.

**Boundary:** in-memory adapters still serve the app, so the UI is unaffected if this unit reverts.

## U5 — InMemory adapters and fixtures

- [ ] 5.1 Mirror U4's observable behaviour in the in-memory repositories (they store whole objects, so the field follows automatically — assert it, do not assume it).
- [ ] 5.2 Give every seeded event in `src/store/fixtures.ts` an explicit `fechaOperativa`; omit nothing, since a missing date would make the families diverge on the one property this change introduces.
- [ ] 5.3 Update any test fixture or literal event that no longer type-checks.
- [ ] 5.4 Tests: full-machine listing still returns every day's events (DD7 — no filter was added); per-order listings still exclude the null order; open-record queries still answer as queries.

**Boundary:** fixtures-only plus in-memory assertions.

## U6 — Recovery, call sites, parity contract suite

- [ ] 6.1 Verify `src/store/sqlite/recovery.ts` preserves `fechaOperativa` byte-identically through the SQLite→domain mapping; add the assertions rather than trusting pass-through.
- [ ] 6.2 Confirm recovery still applies **no** day predicate — the full-history seam stays open for CHANGE 2.
- [ ] 6.3 Pass `fechaOperativa` explicitly at the four real call sites — `src/ui/ParadasSection.tsx:100`, `ActividadesSection.tsx:76`, `DanoSection.tsx:127`, `MantenimientoSection.tsx:112` — from the app's single operational-day source. Thread the day prop into the three sections that lack it (only `ActividadesSection` has `hoy` today). Let the required field make any omission a compile error.
- [ ] 6.4 Build the **shared contract suite** running against both adapter families: for each of the four entities — event with an operative date; event with no order and a date; midnight-crossing event; open event crossing midnight; two events with identical timestamps and different dates; duplicate-id rejection; unknown-id rejection.
- [ ] 6.5 Recovery tests: restart returns the same dates; a midnight-crossing event recovers under its own day; an open event crossing midnight keeps its day; recovery does not partition history.
- [ ] 6.6 Persistence test: registering through the UI path persists before the UI reflects it, and the re-seeded state carries the same `fechaOperativa`.
- [ ] 6.7 Full verification: `npx tsc --noEmit` clean, `npm run build` OK, full `npm run test` green, `python3 src-tauri/migrations/validate_r56.py` exits 0. Update `VALIDATION.md` with the version-5 evidence.

**Boundary:** the last unit. Reverting it returns the app to today's behaviour with a version-5 DB that nothing reads.

---

## Definition of done

- [ ] All four entities and inputs carry `fechaOperativa`; the domain rejects a missing or malformed one.
- [ ] Migration 005 applies on top of 004, adds four NOT NULL columns with no default and four convention-named indexes, creates/drops nothing, contains no data statement, and fails loudly instead of backfilling when rows exist.
- [ ] The 005 mirror file is byte-identical to the canonical file; 59 → 63 columns and 11 → 15 indexes are reflected in the promoted spec's MODIFIED requirements and in `validate_r56.py`.
- [ ] 001–004 are byte-identical; both manifests are at version 5.
- [ ] The operative day is read from the local calendar through an injectable clock.
- [ ] Both adapter families pass one shared contract suite covering the Q2 shapes, with the SQLite side exercised on a real engine rather than only on the fake.
- [ ] Recovery preserves the field exactly and filters by nothing.
- [ ] `npx tsc --noEmit`, `npm run build`, the full test suite and `validate_r56.py` are all green.
- [ ] R5/R6 remain **OPEN**; no Tauri-runtime claim is made.

## Out of scope (asserted, not implied)

Day selector · navigation between days · read-only historical mode · `listarPorMaquina(maquinaId, fechaOperativa)`
or any port signature change · day-filtered recovery · derived-value persistence · any change to an
existing business rule · inventing historical data.