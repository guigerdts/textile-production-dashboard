# Operational Events Schema Specification

Capability: `operational-events-schema`
Change: `sqlite-persistence-phase-2`
In-scope projects: `.` (frontend, TypeScript) and `src-tauri` (Rust shell)

## Purpose

Define the durable shape of the five operational domains — **parada**, **actividad planificada**,
**daño**, **inspección de tela** and **mantenimiento** — as migration `004_operational_events.sql`,
together with the exact boundary between what is stored and what is always recomputed, and the
mechanics that register the migration in both the canonical (Rust) and mirror (frontend) locations.

This capability is **persistence-only**. It specifies *what is written to disk*. It does not specify
any domain rule, and it does not specify repository behaviour — those live in
`operational-repository-contracts` and `operational-recovery-wiring`.

## User Stories covered

| # | As a… | I want… | So that… |
|---|---|---|---|
| US7 | the machine | a broken `parada` → `daño` → `mantenimiento` chain to be re-established from the database | linked-entity queries are answered by the database (indexed, referentially enforced) instead of by in-memory arrays |
| US8 | the reviewer | the five domains to be persisted **one domain per reviewable slice** | the change does not arrive as a single oversized diff that no reviewer can actually hold in their head |

Plus the structural guarantee underlying every persistence story in the change: a schema in which
**nothing derived is stored**, so no derived value can survive a restart stale.

## Referenced domain rules — NOT redefined here

The domain rules of tickets 02–08 are closed and inviolable. This capability references them and
changes none of them. The following are the *sources of the columns*, not new rules:

| Rule | Source | How this spec uses it |
|---|---|---|
| 10 predefined `CausaParadaId` values; `camposEspecificos` validated per causa; `observaciones` required only for `otro`; open `parada` = `fin === null` | ticket 02 (`parada.registrarParada` / `cerrarParada`, `src/domain/paradas.ts`) | `causa_id` is stored as TEXT; the domain owns validation. `fin IS NULL` is the on-disk form of "open" |
| `Parada` is registrable on an **empty day** (`ordenId` may be `null`); activities are **independent of any orden** by design | ticket 03 (`src/domain/actividades.ts`), `CONTEXT.md` | `actividad_planificada` has **no** `orden_id` column; `parada.orden_id` is nullable |
| `tiempo no productivo planificado` and `tiempo improductivo por incidencias` are **derived**; productive time is never entered and the two buckets never double-count | ticket 04 (`src/domain/tiempo.ts`) | **no** time column exists anywhere in 004 |
| `causoParada` and `posibleSegunda` are **independent** flags; `dano` is not a parada; one open `daño` per machine is a domain rule, not a schema rule | ticket 05 (`src/domain/danos.ts`) | the two flags are two independent INTEGER columns with no CHECK tying them to `parada_id` |
| Inspection is **always** an event of an orden (`ordenId` mandatory); exactly 5 checklist items with explicit state; `conAnomalia` and `estadoInspeccion` are **derived**; resolutions are mutually exclusive; `devolución` is pre-impresión only; Gerencia's authorization is documentary, not a workflow | ticket 07 (`src/domain/inspeccionTela.ts`) | `orden_id NOT NULL`; 5 flat NOT NULL checklist columns; no `con_anomalia` column; the full `ResolucionInspeccion` union gets its own columns |
| Maintenance is machine-level, **never** tied to an orden and **never** per paint chemistry; duration is always derived; documentary only (never deducts productive time) | ticket 08 (`src/domain/mantenimiento.ts`), ADR 0007 | no `orden_id`, **no** `duracion` column |
| Official 1ra/2da classification belongs to **Acabado**; Estampado records suspicion only | ticket 06 (`src/domain/calidad.ts`) | the 2da **projection**, the >3% alert, the 5% monthly target and `buena racha` have **no** columns |

## Requirements

### Requirement: Migration 004 creates exactly the five operational tables

Migration `004_operational_events.sql` MUST create exactly five tables — `parada` (9 columns),
`actividad_planificada` (8), `dano` (14), `inspeccion_tela` (18) and `mantenimiento` (10) — totalling
59 columns. Table names MUST be singular ASCII `snake_case`, matching the `jornada` / `orden` /
`lectura_golpe` convention of migration 001. Each domain field MUST be stored in its own column; no
column may hold a serialized aggregate of several fields, with the single exception of
`campos_especificos` (Requirement: `campos_especificos` is stored as JSON TEXT).

**Change under migration 005:** the counts above describe what migration 004 itself creates, and that
is unchanged. What changes is the resulting schema once 005 is applied: each of `parada`,
`actividad_planificada`, `dano` and `mantenimiento` carries one additional `fecha_operativa` column, so
a database at version 5 exposes **63** columns across the five operational tables.

#### Scenario: The migration script creates the five tables and nothing else

- GIVEN the migration `004_operational_events.sql` script
- WHEN it is inspected as a SQL contract
- THEN it contains exactly 5 `CREATE TABLE` statements — `parada`, `actividad_planificada`, `dano`,
  `inspeccion_tela`, `mantenimiento`
- AND it creates no table other than those five
- AND the total column count across the five tables is 59

#### Scenario: The five tables carry exactly the enumerated column sets

- GIVEN the five tables created by migration 004
- WHEN `PRAGMA table_info` is read for each
- THEN `parada` exposes exactly `id`, `machine_id`, `orden_id`, `operario`, `causa_id`,
  `campos_especificos`, `observaciones`, `inicio`, `fin`
- AND `actividad_planificada` exposes exactly `id`, `machine_id`, `tipo`, `inicio`, `fin`,
  `que_se_limpio`, `observaciones`, `operario`
- AND `dano` exposes exactly `id`, `machine_id`, `orden_id`, `operario`, `tipo`, `componente`,
  `inicio`, `fin`, `solucion_aplicada`, `causo_parada`, `parada_id`, `posible_segunda`,
  `unidades_sospechadas`, `observaciones`
- AND `inspeccion_tela` exposes exactly `id`, `orden_id`, `operario`, `lote`, `absorcion`, `tundido`,
  `manchas`, `dimensiones`, `estado_general`, `otra_anomalia`, `timestamp`, `observaciones`,
  `resolucion`, `motivo_devolucion`, `autorizado_por`, `registrada_por`, `resolucion_timestamp`,
  `autorizacion_observaciones`
- AND `mantenimiento` exposes exactly `id`, `machine_id`, `tipo`, `operario`, `motivo`, `inicio`,
  `fin`, `que_se_reviso_reparo`, `dano_id`, `observaciones`

#### Scenario: The schema declares no CHECK constraints and no DEFAULTs

- GIVEN the migration 004 script
- WHEN it is inspected
- THEN no `CHECK` constraint appears on any of the five tables
- AND no column of the five tables declares a `DEFAULT` value
- AND all business-rule enforcement is left to `src/domain/**`, following 001/002/003

#### Scenario: No Down migration is registered

- GIVEN the registered migrations
- WHEN their `kind` values are inspected
- THEN all five are `MigrationKind::Up`, one per registered version
- AND schema rollback, if ever required, follows the documented table-rebuild precedent rather than a
  `Down` script

#### Scenario: A version-5 database carries 63 operational columns

- GIVEN a database migrated through version 5
- WHEN the column counts of the five operational tables are summed
- THEN the total is 63
- AND the four machine-event tables each additionally expose `fecha_operativa`

### Requirement: Nullability encodes the domain's own optionality

Column nullability MUST mirror the domain type's optionality exactly, so that a record that the
domain considers well-formed always has a representable row and a record the domain considers
incomplete can never be silently accepted by the store.

#### Scenario: Required domain fields are NOT NULL and optional domain fields are nullable

- GIVEN the five tables of migration 004
- WHEN nullability is read per column
- THEN `parada.machine_id`, `parada.operario`, `parada.causa_id`, `parada.campos_especificos` and
  `parada.inicio` are NOT NULL, and `parada.orden_id`, `parada.observaciones`, `parada.fin` are nullable
- AND `actividad_planificada.machine_id`, `actividad_planificada.tipo`, `actividad_planificada.inicio`
  and `actividad_planificada.operario` are NOT NULL, and `actividad_planificada.fin`,
  `actividad_planificada.que_se_limpio` and `actividad_planificada.observaciones` are nullable
- AND `dano.machine_id`, `dano.operario`, `dano.tipo`, `dano.componente`, `dano.inicio`,
  `dano.causo_parada` and `dano.posible_segunda` are NOT NULL, and `dano.orden_id`, `dano.fin`,
  `dano.solucion_aplicada`, `dano.parada_id`, `dano.unidades_sospechadas` and `dano.observaciones`
  are nullable
- AND `inspeccion_tela.orden_id`, `inspeccion_tela.operario`, `inspeccion_tela.timestamp` and the five
  checklist columns are NOT NULL, and `inspeccion_tela.lote`, `inspeccion_tela.otra_anomalia`,
  `inspeccion_tela.observaciones`, `inspeccion_tela.resolucion`, `inspeccion_tela.motivo_devolucion`,
  `inspeccion_tela.autorizado_por`, `inspeccion_tela.registrada_por`,
  `inspeccion_tela.resolucion_timestamp` and `inspeccion_tela.autorizacion_observaciones` are nullable
- AND `mantenimiento.machine_id`, `mantenimiento.tipo`, `mantenimiento.operario`,
  `mantenimiento.motivo` and `mantenimiento.inicio` are NOT NULL, and `mantenimiento.fin`,
  `mantenimiento.que_se_reviso_reparo`, `mantenimiento.dano_id` and `mantenimiento.observaciones`
  are nullable

#### Scenario: `fin IS NULL` is the on-disk representation of an open record

- GIVEN an open `parada`, an open `actividad planificada`, an open `daño` or an in-progress
  `mantenimiento` — each defined by its domain type as `fin === null`
- WHEN the record is persisted
- THEN the `fin` column is NULL
- AND a closed record persists its ISO-8601 `fin` timestamp
- AND the derived type aliases `ParadaAbierta`, `ActividadAbierta`, `DanoAbierto` and
  `MantenimientoAbierto` are never stored as a distinct column value or discriminator

### Requirement: Machine events are registrable on an empty day, inspections are not

`parada` and `dano` MUST carry a nullable `orden_id`. `actividad_planificada` and `mantenimiento`
MUST NOT have an `orden_id` column at all, because the domain model has no `ordenId` for them and a
planned activity or a maintenance is registrable on a day with no order.
`inspeccion_tela.orden_id` MUST be NOT NULL, because an inspection is an event of an order and never
a general machine event.

#### Scenario: A parada on an empty day is representable

- GIVEN a `Parada` with `ordenId: null`, created on a day with no production order
- WHEN it is mapped to SQL
- THEN `orden_id` is written as NULL
- AND the record round-trips back with `ordenId: null`, not `undefined`

#### Scenario: `actividad_planificada` and `mantenimiento` have no order column

- GIVEN the tables `actividad_planificada` and `mantenimiento`
- WHEN their columns are listed
- THEN neither table has a column named `orden_id` or any equivalent order reference
- AND an `ActividadPlanificada` or `Mantenimiento` can therefore be persisted with no order present

#### Scenario: An inspection cannot be persisted without an order

- GIVEN `inspeccion_tela.orden_id` is declared NOT NULL
- WHEN an insert statement is built for an inspection
- THEN an `ordenId` of `undefined` or `null` cannot produce a valid row
- AND the domain remains the layer that reports the user-facing message *"la inspección de tela debe
  estar asociada a una orden de producción"*

### Requirement: Five physical foreign keys are declared

Migration 004 MUST declare exactly five physical foreign keys, and `PRAGMA foreign_keys` MUST remain
`ON` as the existing `initDatabase()` already sets it: `parada.orden_id → orden(id)` (nullable),
`dano.orden_id → orden(id)` (nullable), `inspeccion_tela.orden_id → orden(id)` (NOT NULL),
`dano.parada_id → parada(id)` (nullable), `mantenimiento.dano_id → dano(id)` (nullable).

A foreign key is a **storage integrity guarantee layered under** the domain rule; it MUST NOT replace,
relax or become a precondition of any ticket 02–08 rule. In particular the reactive-maintenance link
to a `dano` remains optional and is never required for a write to succeed.

#### Scenario: All five foreign keys are present with the correct target and nullability

- GIVEN the five tables of migration 004
- WHEN `PRAGMA foreign_key_list` is read for each
- THEN `parada` declares one FK on `orden_id` referencing `orden(id)`
- AND `dano` declares two FKs: `orden_id → orden(id)` and `parada_id → parada(id)`
- AND `inspeccion_tela` declares one FK on `orden_id` referencing `orden(id)`
- AND `mantenimiento` declares one FK on `dano_id` referencing `dano(id)`
- AND `actividad_planificada` declares no foreign key
- AND exactly 5 foreign keys exist across the five tables

#### Scenario: A dangling order link is rejected at the storage layer

- GIVEN a `parada` row whose `orden_id` references an `orden.id` that does not exist
- WHEN foreign key enforcement is active on the connection
- THEN the insert fails
- AND the domain's own rule remains the one the operario sees for a *domain* violation, because the
  domain validates before the store is ever called

#### Scenario: A preventive maintenance with no linked damage is accepted

- GIVEN a `Mantenimiento` of type `preventivo` with `danoId: null`, which the domain accepts because
  the link is optional and never a precondition (ADR 0006 / ticket 08)
- WHEN it is persisted
- THEN `dano_id` is written as NULL
- AND the insert succeeds; the nullable FK imposes no requirement

### Requirement: Exactly eleven indexes exist, one per query the ports issue

Migration 004 MUST create exactly these eleven indexes, and MUST NOT create any other:

| Index | Serves |
|---|---|
| `idx_parada_maquina_inicio (machine_id, inicio)` | `paradaRepository.listarPorMaquina` |
| `idx_actividad_maquina_inicio (machine_id, inicio)` | `actividadRepository.listarPorMaquina` |
| `idx_dano_maquina_inicio (machine_id, inicio)` | `danoRepository.listarPorMaquina` |
| `idx_mantenimiento_maquina_inicio (machine_id, inicio)` | `mantenimientoRepository.listarPorMaquina` |
| `idx_parada_abierta (machine_id, orden_id) WHERE fin IS NULL` | `getParadaAbierta(maquinaId, ordenId)` |
| `idx_actividad_abierta (machine_id, tipo) WHERE fin IS NULL` | `getActividadAbierta(maquinaId, tipo)` |
| `idx_dano_abierta (machine_id) WHERE fin IS NULL` | `getDanoAbierto(maquinaId)` |
| `idx_mantenimiento_abierta (machine_id) WHERE fin IS NULL` | `getMantenimientoAbierto(maquinaId)` |
| `idx_parada_orden (orden_id)` | `paradaRepository.listarPorOrden` |
| `idx_dano_orden (orden_id)` | `danoRepository.listarPorOrden`, also the 2da projection input |
| `idx_inspeccion_orden (orden_id, timestamp)` | `inspeccionRepository.listarPorOrden` |

**Change under migration 005:** migration 005 adds four more — `idx_parada_maquina_fecha`,
`idx_actividad_maquina_fecha`, `idx_dano_maquina_fecha`, `idx_mantenimiento_maquina_fecha` — so a
database at version 5 carries **15** indexes over the operational tables. The eleven from migration 004
remain, unchanged and still required.

#### Scenario: The migration creates exactly the eleven listed indexes

- GIVEN the migration 004 script
- WHEN its `CREATE INDEX` statements are counted
- THEN there are exactly 11
- AND their names and column lists match the table above
- AND the four open-record indexes carry the partial predicate `WHERE fin IS NULL`

#### Scenario: No speculative index is created

- GIVEN the eleven indexes of migration 004
- WHEN the index list is searched for indexes on `dano.parada_id`, `dano.orden_id` alone,
  `mantenimiento.dano_id`, or `actividad_planificada.tipo` alone
- THEN none is found
- AND `obtenerPorId` has no dedicated index because the primary key already serves it

#### Scenario: Migration 004's eleven indexes are still present

- GIVEN a database migrated through version 5
- WHEN its indexes are enumerated
- THEN all eleven migration-004 indexes still exist with their original names

#### Scenario: A version-5 database carries 15 operational indexes

- GIVEN a database migrated through version 5
- WHEN the indexes on the five operational tables are counted
- THEN there are exactly 15
- AND exactly four of them are over `(machine_id, fecha_operativa)`

### Requirement: `campos_especificos` is stored as JSON TEXT

`parada.campos_especificos` MUST be a single `TEXT NOT NULL` column holding the JSON serialization of
the domain's `Record<string, unknown>`. The domain value is the source of truth; JSON is only the
storage form. The read path MUST validate the parsed shape and MUST fail loudly when the stored text
is not valid JSON — this is a **mapping error carrying the original `cause`**, never a silent `{}` and
never a swallowed failure. Storage-level JSON handling is specified here; the adapter's round-trip
behaviour is specified in `operational-repository-contracts`.

#### Scenario: The column is a single TEXT column, not a set of per-cause columns

- GIVEN the `parada` table
- WHEN its columns are listed
- THEN `campos_especificos` is one `TEXT NOT NULL` column
- AND no per-cause column (`carro`, `color`, `tiempo_reparacion`, …) exists

#### Scenario: Invalid JSON is a hard failure, not a default object

- GIVEN a `parada` row whose `campos_especificos` text is not parseable JSON
- WHEN the row is mapped to the domain
- THEN a descriptive mapping error is raised
- AND the error carries the original parse failure as its `cause`
- AND no empty object and no partially populated record is returned

### Requirement: The two `daño` flags are independent 0/1 INTEGERs

`dano.causo_parada` and `dano.posible_segunda` MUST be `INTEGER NOT NULL` encoded as `1` for `true`
and `0` for `false`, mirroring `orden.aplica_segunda` from migration 003. No `CHECK` constraint,
index or default may tie either flag to `dano.parada_id`, to the other flag, or to
`unidades_sospechadas`. The coupling rules are domain rules and the domain is the only thing that
owns them.

#### Scenario: Both flags round-trip independently

- GIVEN a `Dano` with `causoParada: true`, `paradaId: "p-1"`, `posibleSegunda: true` and
  `unidadesSospechadas: 12`
- WHEN it is written and read back
- THEN `causo_parada` is stored as `1` and read back as `true`
- AND `posible_segunda` is stored as `1` and read back as `true`
- AND `parada_id` is stored as `"p-1"` and `unidades_sospechadas` as `12`

#### Scenario: All four flag combinations are storable

- GIVEN the combinations `causoParada` × `posibleSegunda` = true/false × true/false
- WHEN each is written
- THEN all four are accepted by the schema without a constraint violation
- AND the domain — not the schema — is what rejects the invalid combinations, for example
  `causoParada: false` together with a non-null `paradaId`

### Requirement: The inspection checklist is stored as flat columns

`inspeccion_tela` MUST store the checklist as five flat columns — `absorcion`, `tundido`, `manchas`,
`dimensiones`, `estado_general` — plus `otra_anomalia`. Each of the five MUST be `NOT NULL`, because
`validarChecklist` guarantees exactly the 5 catalog items each with an explicit `conforme`/`anomalia`
state: there is no legitimate "unknown" to store. `conAnomalia` MUST NOT have a column, and
`estadoInspeccion` (conforme / no usable / devuelta / uso autorizado) MUST NOT have a column; both
are derived by the domain on every read.

#### Scenario: The five checklist states persist as explicit values

- GIVEN an `InspeccionTela` whose items are `absorcion: conforme`, `tundido: anomalia`,
  `manchas: conforme`, `dimensiones: conforme`, `estado_general: conforme`
- WHEN it is written and read back
- THEN `absorcion` is `"conforme"`, `tundido` is `"anomalia"`, and the other three are `"conforme"`
- AND the reconstructed `items` array carries exactly 5 entries, one per catalog id, in catalog order

#### Scenario: A checklist column can never be NULL

- GIVEN `inspeccion_tela.absorcion` and the other four checklist columns are NOT NULL
- WHEN an insert is attempted with any of them omitted or NULL
- THEN the insert fails
- AND no row can represent a partially-known checklist, because the domain rejects such an input
  before persistence with *"debe indicar el estado de los 5 ítems del checklist"*

#### Scenario: Derived inspection state has no column

- GIVEN the `inspeccion_tela` table
- WHEN its columns are searched
- THEN no column named `con_anomalia`, `estado_inspeccion`, `estado_tela` or any equivalent exists
- AND `conAnomalia` and `estadoInspeccion` are recomputed by the domain from the checklist columns,
  `otra_anomalia` and the resolution on every read

### Requirement: The resolution column set covers the full `ResolucionInspeccion` union

`inspeccion_tela` MUST carry a `resolucion` discriminator column plus the full data of **both**
branches of the `ResolucionInspeccion` union, as separate nullable columns:
`resolucion`, `motivo_devolucion`, `autorizado_por`, `registrada_por`, `resolucion_timestamp` and
`autorizacion_observaciones`. The three columns that complete the flat-column decision
(`registrada_por`, `resolucion_timestamp`, `autorizacion_observaciones`) are REQUIRED: a `devolución`
without `registrada_por` would lose who returned the fabric, and an authorization without
`autorizacion_observaciones` would lose its documentary notes, both across a restart.

#### Scenario: A devolución survives a restart with who registered it and when

- GIVEN an inspection resolved with a `devolucion` carrying `motivo`, `registradaPor` and its own
  `timestamp`
- WHEN it is written to the schema
- THEN `resolucion` is `"devolucion"`, `motivo_devolucion` holds the reason, `registrada_por` holds
  the person, and `resolucion_timestamp` holds the moment
- AND no information present in the domain resolution is dropped

#### Scenario: A gerencia authorization survives a restart with its observations

- GIVEN an inspection resolved with an `autorizacion_gerencia` carrying `autorizadoPor`, its own
  `timestamp` and an `observaciones`
- WHEN it is written to the schema
- THEN `resolucion` is `"autorizacion_gerencia"`, `autorizado_por` holds the authorizer,
  `resolucion_timestamp` holds the moment, and `autorizacion_observaciones` holds the notes

#### Scenario: An unresolved inspection stores no resolution data

- GIVEN an inspection with `resolucion: null` — the `sin_resolucion` state
- WHEN it is written
- THEN `resolucion` is NULL
- AND `motivo_devolucion`, `autorizado_por`, `registrada_por`, `resolucion_timestamp` and
  `autorizacion_observaciones` are all NULL
- AND no column of the *other* resolution branch is populated

### Requirement: No derived value is persisted

A column MUST exist only where the domain holds the value as an independent input. Anything the
domain computes from other values MUST be recomputed on read and MUST NOT have a column. The
following MUST NOT appear anywhere in migration 004: `tiempo productivo`, any duration, the projected
`2da` percentage, the >3% alert, the 5% monthly target, `buena racha`, `conAnomalia`, the per-inspection
`estado de tela`, `deltaGolpes`, production progress, and the machine state (ANDANDO / PARADA /
OCIOSA). This mirrors what Phase 1 already does for `orden`, where `iniciadaEn` and `contadorBase` are
derived from `lecturas[0]` rather than stored.

#### Scenario: No time or duration column exists

- GIVEN the five tables of migration 004
- WHEN their columns are searched
- THEN no column holds a duration, an accumulated time, a productive-time value, or a contribution to
  `tiempo no productivo planificado` or `tiempo improductivo por incidencias`
- AND `mantenimiento` in particular has no `duracion` column, because maintenance is documentary and
  never deducts productive time (ADR 0007)

#### Scenario: No quality-projection column exists

- GIVEN the `dano` table
- WHEN its columns are searched
- THEN it stores `unidades_sospechadas` (an independent input, the suspicion) but no projected
  percentage, no alert flag, no monthly target value and no `buena_racha` flag
- AND the 2da projection, the alert and `buena racha` are computed from the persisted sources on read

#### Scenario: A test asserts the absence of derived columns

- GIVEN the migration 004 script
- WHEN the schema contract suite runs
- THEN it asserts that none of the derived names — `tiempo_productivo`, `duracion`, `duracion_segundos`,
  `porcentaje_2da_proyectado`, `alerta_2da`, `buena_racha`, `con_anomalia`, `estado_inspeccion`,
  `estado_maquina`, `delta_golpes`, `progreso` — exists as a column of the five tables
- AND a new derived column added later fails the suite

### Requirement: Migrations 001, 002 and 003 are immutable

`001_initial_schema.sql`, `002_lectura_orden_sequence_unique.sql` and `003_d1_orden_persistence.sql`
MUST NOT be edited, renamed or removed — neither the canonical copy nor the mirror. sqlx-core
validates the checksum of every already-applied migration and fails startup with
`MigrateError::VersionMismatch` when one changes. All new schema work MUST arrive as the new
migration 004.

#### Scenario: The three earlier migrations are byte-unchanged

- GIVEN migrations 001, 002 and 003 in both locations
- WHEN their content is compared against the state before this change
- THEN no byte of any of the six files differs
- AND 004 is the only migration added or altered

#### Scenario: Editing an applied migration is a documented startup failure

- GIVEN an existing database where 001 was already applied
- WHEN 001's content is edited
- THEN startup fails with a version-mismatch error rather than silently diverging
- AND this is the documented reason the change never edits 001/002/003 as an implementation shortcut

### Requirement: The migration is registered canonically, mirrored, and versioned

Every migration MUST live in `src-tauri/migrations/<version>_<name>.sql` and MUST be registered in
`src-tauri/src/lib.rs` as `Migration { version: <n>, kind: MigrationKind::Up }` with a `description`
in the existing `snake_case` style, embedded via `include_str!`. A **byte-identical** mirror MUST
exist at `src/store/sqlite/migrations/<version>_<name>.sql`. `CURRENT_MIGRATION_VERSION` in
`src/store/sqlite/migrations/index.ts` MUST equal the highest registered version, and `TABLES` in that
module MUST list all eight tables. No `Down` migration may be registered, matching the project's
Up-only mechanism.

This requirement states the rule that holds for every migration. The concrete assertions migration
005 introduces are stated separately in *The migration is registered in Rust, mirrored in the
frontend, and its version is reflected*.

**Change under migration 005:** the highest registered version becomes `5`.

#### Scenario: The Rust side registers the full version range

- GIVEN `src-tauri/src/lib.rs`
- WHEN the `migrations` vector is read
- THEN it contains five entries, versions 1 through 5 in ascending order, each with
  `kind: MigrationKind::Up` and a `description` in the snake_case style of the previous ones
- AND version 5 embeds `sql: include_str!("../migrations/005_event_fecha_operativa.sql")`
- AND the entries for versions 1 through 4 are unchanged

#### Scenario: The mirror is byte-identical to the canonical file

- GIVEN `src-tauri/migrations/005_event_fecha_operativa.sql` and
  `src/store/sqlite/migrations/005_event_fecha_operativa.sql`
- WHEN the two files are compared byte for byte
- THEN they are identical
- AND the same check continues to hold for 001, 002, 003 and 004

#### Scenario: The frontend migration metadata reflects the highest version

- GIVEN `src/store/sqlite/migrations/index.ts`
- WHEN `CURRENT_MIGRATION_VERSION` and `TABLES` are read
- THEN `CURRENT_MIGRATION_VERSION` is `5`, equal to the highest registered version
- AND `TABLES` contains the eight names `jornada`, `orden`, `lectura_golpe`, `parada`,
  `actividad_planificada`, `dano`, `inspeccion_tela` and `mantenimiento`, unchanged, since migration 005
  creates no table
- AND `verifySchema()` reports existence for all eight after migration

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

## Out of scope for this capability

- Any change to the domain rules of tickets 02–08 (the target is a zero diff in `src/domain/**`).
- Any column for a derived value, a persistent `lote` entity, an Acabado channel, or an approval
  workflow state.
- Repository and adapter behaviour (`operational-repository-contracts`) and application wiring
  (`operational-recovery-wiring`).
- Runtime validation against the real Tauri binary, which stays an open honesty note exactly as it is
  for migrations 001–003: the Rust-side application of 004 (checksum recording, actual DDL execution)
  cannot be exercised in this environment.
