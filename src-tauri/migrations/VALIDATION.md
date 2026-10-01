# R5/R6 — Real-runtime migration validation (post-archive follow-up)

**Status: PARTIALLY VALIDATED — R5 and R6 stay OPEN as documented in the archived
change (`openspec/changes/archive/2026-09-30-sqlite-persistence-phase-2/archive-report.md` §5).**

This document records the exact evidence produced by the only technically valid
runtime validation this environment can run. It does **not** claim a full PASS
for the original R5/R6 contracts (real Tauri binary + `getForeignKeys()` TS
through the webview) because that runtime cannot execute here.

## What was run

```bash
python3 src-tauri/migrations/validate_r56.py
```

The script applies the **actual migration files** (`src-tauri/migrations/001..005`,
the same files registered as sqlx `Migration` structs in `src-tauri/src/lib.rs`)
against a **real SQLite engine** via Python's `sqlite3` (SQLite 3.46.1 in this
environment). It validates, with a non-zero exit and no invented pass:

1. Migrations 001–005 apply cleanly in order on a fresh database.
2. The real DDL created exactly the 8 expected tables
   (`jornada, orden, lectura_golpe, parada, actividad_planificada, dano,
   inspeccion_tela, mantenimiento`).
3. After migration 005 the operational tables expose **63** columns across
   their 5 tables (59 in 004 plus four `fecha_operativa`).
4. **CHANGE 1** — `fecha_operativa` exists as `TEXT NOT NULL` with **no
   DEFAULT** on `parada`, `actividad_planificada`, `dano` and `mantenimiento`;
   `inspeccion_tela` is untouched because an inspection inherits its day from
   its `orden`. The four day-scoped indexes
   (`idx_parada_maquina_fecha`, `idx_actividad_maquina_fecha`,
   `idx_dano_maquina_fecha`, `idx_mantenimiento_maquina_fecha`) exist on the
   real schema.
5. **CHANGE 1, loud-failure contract** — against a **populated** machine-event
   table (a real `parada` row written with the 004 schema) migration 005 is
   **rejected** by the real engine with `Cannot add a NOT NULL column with
   default value NULL`, and leaves no partial column behind. This is intended:
   the app has never written an operative day, so there is no correct value to
   backfill and a guessed date would be irreversible once persisted.
   *Limitation:* this harness uses `executescript()` in autocommit, while sqlx
   applies each migration inside a transaction — so this proves the real
   engine's constraint, not sqlx's transactional behaviour on partial failure.
6. The declared foreign keys exist on the real schema (5 total: `parada` 1,
   `dano` 2, `inspeccion_tela` 1, `mantenimiento` 1).
7. `PRAGMA foreign_keys = ON` is effective and **enforced** on the real
   connection: a `dano` row referencing a nonexistent `parada_id` is rejected
   with error code **787 (SQLITE_CONSTRAINT_FOREIGNKEY)**, while a valid
   reference is accepted and a nullable FK (`parada.orden_id`) accepts NULL.
8. The **other `applyPragmas()` PRAGMAs** take effect on a fresh connection
   (the real startup shape — `PRAGMA journal_mode` cannot change inside a
   transaction, and the FK probe above leaves one pending): `journal_mode` =
   `wal` and `synchronous` = `1` (NORMAL), the exact values
   `getJournalMode()` / `getSynchronous()` would return. Recorded as engine
   evidence; they are not part of the R5/R6 contracts themselves.
9. The sha384 checksum of each file — the exact value sqlx 0.8.6 records
   (`Sha384::digest(sql.as_bytes())`, confirmed at
   `sqlx-core-0.8.6/src/migrate/migration.rs:25` in the local cargo registry):

   | version | description           | sha384                                                           |
   | ------- | --------------------- | ---------------------------------------------------------------- |
   | 1       | create_initial_tables | `c9709ce3d33ed4278be951c9040ebb05fe2abcc8dc15492526ef76b55e8416f23fb524d6c6d6a29f9b0be3a62105b52d` |
   | 2       | unique_orden_sequence | `02fdeebf1b7de154925057e6227345dc60942ba2fa3ff1e0fa1e097dee6ac4049b9e84531afc5a3353ff98989727d742` |
   | 3       | d1_orden_persistence  | `9dd8527f7fa52bbced908bdb8fd5a65481e0770d417b604a62459b5aef00ff9f3d618350c3ed150c96be3328a9f6dcf0` |
   | 4       | operational_events    | `85de47c9639921f1f31de2e691e34cac54b84d4addaf21c523b1c609e0b65e10331655e8eb00856e846d9716b8a2bbc0` |
   | 5       | event_fecha_operativa | `bb952d73037bf031771a4bae508fcb565971f50b4daf3778f174bb749e92799b28d06d7cc94826f8c956a5cb7eda9cdc` |

## Frontier of the validation

| Contract | Evidence produced here | Still requires |
| --- | --- | --- |
| R5 — migrations 004/005 applied (checksum + DDL) | DDL executes cleanly on real SQLite; file checksums computed with the sqlx algorithm | The sqlx `_sqlx_migrations` **tracking** (version row, checksum record, `VersionMismatch` gate) and the real Tauri binary. |
| R6 — `getForeignKeys()` returns 1 / FK enforced | Real engine: `PRAGMA foreign_keys` = 1 after `applyPragmas`; a real FK violation is rejected (errcode 787) | The concrete `getForeignKeys()` TS call through `@tauri-apps/plugin-sql` (webview layer). |

## Why the full R5/R6 runtime was not exercised (exact limitation)

- The host Rust toolchain is `aarch64-linux-android` and **cannot link binaries**
  (`ld: cannot find -llog`, `-lunwind`); `pkg` is unavailable as root, so those
  libraries cannot be installed here. sqlx-based probes and the Tauri desktop
  binary therefore cannot be built or run in this environment.
- No webview/GTK runtime exists here, so the plugin's TypeScript surface cannot
  execute `getForeignKeys()`.
- Per the archived change rules, this limitation is **not** converted into a
  pass: R5/R6 remain open in the change record. The partial evidence above is
  reproducible and verifiable, and improves confidence that the schema contract
  holds on a real engine.

## Reproduce

```bash
# from the repository root
python3 src-tauri/migrations/validate_r56.py
# optional database path override:
R56_DB=/tmp/estampado_validated.db python3 src-tauri/migrations/validate_r56.py
```

Exit 0 = all checked assertions passed; any failure exits non-zero.