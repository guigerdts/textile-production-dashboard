# Operational Events Schema Specification

Capability: `operational-events-schema`
Change: `operational-event-operative-date`
In-scope projects: `.` (frontend, TypeScript) and `src-tauri` (Rust shell)

## Purpose

Define **migration `005_event_fecha_operativa.sql`**, which adds the `fecha_operativa` column to
the four machine-event tables created by migration 004, its four supporting indexes, and its
registration in the canonical (Rust), mirror (frontend SQL file) and metadata locations.

This delta is **persistence-only**. The day rule it stores is defined in
`operational-event-operative-date`; this capability specifies only *how the column is added and what
it is allowed to contain*.

## Referenced capability — NOT redefined here

| Capability | How this delta uses it |
|---|---|
| `operational-event-operative-date` | defines what `fechaOperativa` means, that it is caller-supplied, and that it alone determines the day. This capability stores that value and defines nothing about it |

## ADDED Requirements

### Requirement: Migration 005 adds exactly one column to exactly four tables

Migration `005_event_fecha_operativa.sql` MUST add a single column, `fecha_operativa`, to exactly
four existing tables: `parada`, `actividad_planificada`, `dano` and `mantenimiento`. It MUST NOT
create, drop or alter any other table, and MUST NOT touch `inspeccion_tela`, `jornada`, `orden`,
`lectura_golpe` or `golpe_unidad`.

The column type MUST be `TEXT`, matching the existing `fecha_operativa` column on `orden` and the
`TEXT NOT NULL` treatment of `inicio` in migration 004.

#### Scenario: The migration alters four tables and creates nothing

- GIVEN migration `005_event_fecha_operativa.sql`
- WHEN it is executed against a database already at version 4
- THEN exactly four `ALTER TABLE … ADD COLUMN` statements run, one per listed table
- AND the script contains no `CREATE TABLE`, `DROP TABLE` or `RENAME` statement

#### Scenario: `inspeccion_tela` is untouched

- GIVEN a database already migrated to version 5
- WHEN `PRAGMA table_info(inspeccion_tela)` is read
- THEN its column set is exactly the 18 columns created by migration 004
- AND it exposes no `fecha_operativa`

### Requirement: The column is `NOT NULL` and every write supplies it

`fecha_operativa` MUST be `TEXT NOT NULL` in all four tables, consistent with the promoted
`operational-events-schema` › "Required domain fields are NOT NULL and optional domain fields are
nullable".

The column MUST NOT carry a `DEFAULT` clause. Migration 004 established that the schema declares no
implicit column values, and a `DEFAULT` would let an adapter omit the field silently — exactly the
derivation this change forbids.

#### Scenario: The column is NOT NULL with no default

- GIVEN migration 005 applied
- WHEN `PRAGMA table_info` is read for the four tables
- THEN each exposes `fecha_operativa` with `notnull = 1` and `dflt_value IS NULL`

#### Scenario: The migration declares no DEFAULT anywhere

- GIVEN the migration 005 script
- WHEN it is inspected as a SQL contract
- THEN no statement contains a `DEFAULT` clause
- AND no `CHECK` constraint appears, following migration 004

### Requirement: An insert that omits the column fails at the storage layer

Because the column is `NOT NULL` with no default, an insert that does not supply
`fecha_operativa` MUST be rejected by SQLite. This is the storage-level backstop for "the day is
always explicit", and it is what makes the four existing fixture INSERTs in
`src-tauri/migrations/validate_r56.py` fail loudly until they are updated to supply the column.

#### Scenario: An insert without the column is rejected

- GIVEN a migrated database
- WHEN a row is inserted into `parada` supplying every column except `fecha_operativa`
- THEN the insert fails with a NOT NULL constraint violation

### Requirement: Migration 005 invents no backfill

The change MUST NOT insert, infer or synthesise any `fecha_operativa` value for pre-existing rows.
The current deployment holds no productive operational history to preserve, so the correct backfill is
none: no `UPDATE`, no `DEFAULT`, no derived value.

If a database were ever found holding pre-005 machine-event rows, the migration MUST fail loudly
rather than guess a day from a UTC timestamp, because `operational-event-operative-date` forbids
inference in every layer.

#### Scenario: The migration contains no data statement

- GIVEN the migration 005 script
- WHEN it is inspected as a SQL contract
- THEN it contains only `ALTER TABLE … ADD COLUMN` and `CREATE INDEX` statements — no `UPDATE`, no
  `INSERT`, no `SELECT`

#### Scenario: No existing row is assigned a synthesised day

- GIVEN a database holding machine-event rows created before version 5
- WHEN migration 005 is applied
- THEN the `ALTER TABLE` is rejected — SQLite refuses to add a `NOT NULL` column with no default to
  a populated table
- AND no row gains a `fecha_operativa` value, and no day was inferred from `inicio`

#### Scenario: The empty-history precondition is not asserted by a separate check

- GIVEN the existing schema verification (`verifySchema`, which only checks that tables exist)
- WHEN migration 005 is applied to a database that still holds machine-event rows
- THEN the failure comes from SQLite itself, not from a pre-check
- AND no new precondition-checking code is introduced for this migration

### Requirement: Migrations 001–004 stay byte-identical

Applied migrations MUST NOT be edited. Migration 005 MUST be a new file; sqlx checksum validation
(`VersionMismatch`) fails startup if any applied migration's bytes change.

#### Scenario: No applied migration is modified

- GIVEN migrations 001 through 004 as applied
- WHEN migration 005 is added
- THEN the files for 001–004 are byte-identical to their applied versions
- AND no `Down` migration is introduced

### Requirement: Four indexes are added, following migration 004's naming convention

Migration 005 MUST add one index per machine-event table over `(machine_id, fecha_operativa)`,
preparing for the equality lookup that `historical-day-navigation` (CHANGE 2) will issue from the
ports. CHANGE 1 performs no such query itself; the index exists so CHANGE 2 needs no migration.

Index names MUST follow the convention established by migration 004 — Spanish, singular table name,
`_maquina_` for the machine column and `IF NOT EXISTS` — namely `idx_parada_maquina_fecha`,
`idx_actividad_maquina_fecha`, `idx_dano_maquina_fecha` and `idx_mantenimiento_maquina_fecha`.

#### Scenario: Exactly four indexes are added, with convention-conforming names

- GIVEN migration 005 applied
- WHEN the new indexes are enumerated
- THEN each of the four tables gained one index over `(machine_id, fecha_operativa)`
- AND each name matches `idx_<tabla>_maquina_fecha` and was created `IF NOT EXISTS`

#### Scenario: No index is created for a column CHANGE 1 never queries

- GIVEN the migration 005 script
- WHEN its index statements are inspected
- THEN every created index is over `(machine_id, fecha_operativa)`
- AND no index is created on `inicio`, `fin` or any timestamp column

### Requirement: The migration is registered in Rust, mirrored in the frontend, and its version is reflected

Migration 005 MUST be registered as `version: 5` in the canonical Rust `migrations` vector in
`src-tauri/src/lib.rs`. A **byte-identical mirror** MUST exist at
`src/store/sqlite/migrations/005_event_fecha_operativa.sql`, following the pattern already used for
001–004, because the frontend test suites import both the canonical and the mirror SQL via `?raw` and
compare them. `CURRENT_MIGRATION_VERSION` in `src/store/sqlite/migrations/index.ts` MUST be advanced
from `4` to `5`.

#### Scenario: The Rust side registers version 5

- GIVEN the migrations vector in `src-tauri/src/lib.rs`
- WHEN it is read
- THEN it contains five `Migration` entries, versions 1 through 5 in ascending order
- AND version 5 has `kind: MigrationKind::Up` and includes the 005 SQL

#### Scenario: The mirror file is byte-identical to the canonical file

- GIVEN the canonical `src-tauri/migrations/005_event_fecha_operativa.sql` and its mirror
- WHEN the two files are compared byte for byte
- THEN they are identical, exactly as 001–004 and their mirrors are

#### Scenario: The frontend migration metadata reflects version 5

- GIVEN `CURRENT_MIGRATION_VERSION` in `src/store/sqlite/migrations/index.ts`
- WHEN it is read
- THEN it is `5`

## MODIFIED Requirements

The following promoted requirements of `operational-events-schema` change under migration 005. Only
the enumerated counts and the version registration move; every other clause of those requirements is
unchanged and remains in force.

### Requirement: Migration 004 creates exactly the five operational tables

Migration `004_operational_events.sql` MUST create exactly five tables — `parada` (9 columns),
`actividad_planificada` (8), `dano` (14), `inspeccion_tela` (18) and `mantenimiento` (10) — totalling
59 columns. Table names MUST be singular ASCII `snake_case`, matching the `jornada` / `orden` /
`lectura_golpe` convention of migration 001. Each domain field MUST be stored in its own column; no
column may hold a serialized aggregate of several fields, with the single exception of
`campos_especificos`.

**Change under migration 005:** the counts above describe what migration 004 itself creates, and that
is unchanged. What changes is the resulting schema once 005 is applied: each of `parada`,
`actividad_planificada`, `dano` and `mantenimiento` carries one additional `fecha_operativa` column, so
a database at version 5 exposes **63** columns across the five operational tables.

#### Scenario: The migration script creates the five tables and nothing else

- GIVEN the migration `004_operational_events.sql` script
- WHEN it is inspected as a SQL contract
- THEN it contains exactly 5 `CREATE TABLE` statements
- AND the total column count the script itself declares is 59

#### Scenario: The enumerated column sets describe migration 004

- GIVEN the five tables as created by migration 004
- WHEN `PRAGMA table_info` is read for each
- THEN `parada` exposes exactly its nine migration-004 columns, and so on for the other four

#### Scenario: A version-5 database carries 63 operational columns

- GIVEN a database migrated through version 5
- WHEN the column counts of the five operational tables are summed
- THEN the total is 63
- AND the four machine-event tables each additionally expose `fecha_operativa`

### Requirement: Exactly eleven indexes exist, one per query the ports issue

Migration 004 MUST create exactly its eleven indexes and MUST NOT create any other index.

**Change under migration 005:** migration 005 adds four more — `idx_parada_maquina_fecha`,
`idx_actividad_maquina_fecha`, `idx_dano_maquina_fecha`, `idx_mantenimiento_maquina_fecha` — so a
database at version 5 carries **15** indexes over the operational tables. The eleven from migration 004
remain, unchanged and still required.

#### Scenario: Migration 004's eleven indexes are still present

- GIVEN a database migrated through version 5
- WHEN its indexes are enumerated
- THEN all eleven migration-004 indexes still exist with their original names

#### Scenario: A version-5 database carries 15 operational indexes

- GIVEN a database migrated through version 5
- WHEN the indexes on the five operational tables are counted
- THEN there are exactly 15
- AND exactly four of them are over `(machine_id, fecha_operativa)`

### Requirement: The migration is registered in both projects and the frontend metadata matches

The migration MUST be registered in the canonical Rust `migrations` vector in
`src-tauri/src/lib.rs`, with a mirror SQL file under `src/store/sqlite/migrations/`, and
`CURRENT_MIGRATION_VERSION` in `src/store/sqlite/migrations/index.ts` MUST equal the highest
registered version.

**Change under migration 005:** the highest registered version becomes `5`.

#### Scenario: The Rust side registers the full version range

- GIVEN the migrations vector in `src-tauri/src/lib.rs`
- WHEN it is read
- THEN it registers every migration file 001 through 005 in ascending order

#### Scenario: The frontend migration metadata reflects the highest version

- GIVEN `CURRENT_MIGRATION_VERSION` and `TABLES` in `src/store/sqlite/migrations/index.ts`
- WHEN they are read
- THEN `CURRENT_MIGRATION_VERSION` is `5`
- AND `TABLES` is unchanged, since migration 005 creates no table