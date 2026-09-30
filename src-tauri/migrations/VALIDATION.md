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

The script applies the **actual migration files** (`src-tauri/migrations/001..004`,
the same files registered as sqlx `Migration` structs in `src-tauri/src/lib.rs`)
against a **real SQLite engine** via Python's `sqlite3` (SQLite 3.46.1 in this
environment). It validates, with a non-zero exit and no invented pass:

1. Migrations 001–004 apply cleanly in order on a fresh database.
2. The real DDL created exactly the 8 expected tables
   (`jornada, orden, lectura_golpe, parada, actividad_planificada, dano,
   inspeccion_tela, mantenimiento`).
3. Migration 004 exposes 59 columns across its 5 tables (file header contract).
4. The declared foreign keys exist on the real schema (5 total: `parada` 1,
   `dano` 2, `inspeccion_tela` 1, `mantenimiento` 1).
5. `PRAGMA foreign_keys = ON` is effective and **enforced** on the real
   connection: a `dano` row referencing a nonexistent `parada_id` is rejected
   with error code **787 (SQLITE_CONSTRAINT_FOREIGNKEY)**, while a valid
   reference is accepted and a nullable FK (`parada.orden_id`) accepts NULL.
6. The sha384 checksum of each file — the exact value sqlx 0.8.6 records
   (`Sha384::digest(sql.as_bytes())`, confirmed at
   `sqlx-core-0.8.6/src/migrate/migration.rs:25` in the local cargo registry):

   | version | description           | sha384                                                           |
   | ------- | --------------------- | ---------------------------------------------------------------- |
   | 1       | create_initial_tables | `c9709ce3d33ed4278be951c9040ebb05fe2abcc8dc15492526ef76b55e8416f23fb524d6c6d6a29f9b0be3a62105b52d` |
   | 2       | unique_orden_sequence | `02fdeebf1b7de154925057e6227345dc60942ba2fa3ff1e0fa1e097dee6ac4049b9e84531afc5a3353ff98989727d742` |
   | 3       | d1_orden_persistence  | `9dd8527f7fa52bbced908bdb8fd5a65481e0770d417b604a62459b5aef00ff9f3d618350c3ed150c96be3328a9f6dcf0` |
   | 4       | operational_events    | `85de47c9639921f1f31de2e691e34cac54b84d4addaf21c523b1c609e0b65e10331655e8eb00856e846d9716b8a2bbc0` |

## Frontier of the validation

| Contract | Evidence produced here | Still requires |
| --- | --- | --- |
| R5 — migration 004 applied (checksum + DDL) | DDL executes cleanly on real SQLite; file checksums computed with the sqlx algorithm | The sqlx `_sqlx_migrations` **tracking** (version row, checksum record, `VersionMismatch` gate) and the real Tauri binary. |
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