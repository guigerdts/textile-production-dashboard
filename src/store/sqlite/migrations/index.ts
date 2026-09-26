/**
 * Ticket 10.1 — Migration runner
 *
 * tauri-plugin-sql manages schema migrations via Rust-side Migration structs
 * registered in src-tauri/src/lib.rs. This module provides:
 *
 * 1. A way to check that tables exist after migration
 * 2. A reference for the migration version tracking
 * 3. A programmatic interface for verifying schema state
 *
 * The actual migration execution is handled by the plugin automatically
 * when Database.load() is called.
 */

import { getDatabase } from "../database";

// ── Migration metadata ───────────────────────────────────────────────────────

/** Current expected migration version */
export const CURRENT_MIGRATION_VERSION = 2;

/** Table names created by migrations */
export const TABLES = {
  JORNADA: "jornada",
  ORDEN: "orden",
  LECTURA_GOLPE: "lectura_golpe",
} as const;

// ── Schema verification ──────────────────────────────────────────────────────

/**
 * Check if a table exists in the database.
 * Uses sqlite_master system table.
 */
export async function tableExists(tableName: string): Promise<boolean> {
  const db = getDatabase();
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }

  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [tableName]
  );

  return rows.length > 0;
}

/**
 * Get all table names in the database.
 */
export async function getTableNames(): Promise<string[]> {
  const db = getDatabase();
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }

  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );

  return rows.map((r) => r.name);
}

/**
 * Verify that all expected Phase 1 tables exist.
 * Returns an object with each table's existence status.
 */
export async function verifySchema(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  for (const table of Object.values(TABLES)) {
    results[table] = await tableExists(table);
  }
  return results;
}
