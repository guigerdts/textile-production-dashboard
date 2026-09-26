/**
 * Ticket 10.1 — SQLite Infrastructure
 *
 * Connection lifecycle management with PRAGMA configuration.
 * Schema migrations are handled by tauri-plugin-sql Rust-side Migration structs.
 *
 * TECHNICAL LIMITATION (discovered during implementation):
 * tauri-plugin-sql does NOT expose transaction methods (BEGIN/COMMIT/ROLLBACK)
 * from the JavaScript API. Each db.execute() call acquires and releases a mutex
 * lock independently. This means Q34's BEGIN IMMEDIATE transactional model
 * cannot be implemented via db.execute("BEGIN IMMEDIATE"). Transactions must be
 * handled at the Rust/SQLx layer or through a different approach.
 * Documented: 2026-09-22, ticket 10.1.
 */

import Database from "@tauri-apps/plugin-sql";

// ── Constants ────────────────────────────────────────────────────────────────

const DB_PATH = "sqlite:estampado.db";

// ── State ────────────────────────────────────────────────────────────────────

let db: Database | null = null;

// ── PRAGMA application ───────────────────────────────────────────────────────

/**
 * Apply PRAGMA settings on a connection.
 * Called on every initDatabase() to ensure settings are active.
 *
 * Validation results (ticket 10.1):
 * - foreign_keys = ON: functional decision, always ON
 * - journal_mode: validated — see getJournalMode()
 * - synchronous: validated — see getSynchronous()
 */
async function applyPragmas(database: Database): Promise<void> {
  // Functional decision: foreign keys must be ON
  await database.execute("PRAGMA foreign_keys = ON");

  // Technical validation required: journal_mode
  // WAL is expected but must be validated with real plugin
  await database.execute("PRAGMA journal_mode = WAL");

  // Technical validation required: synchronous
  // NORMAL is expected but must be validated with real plugin
  await database.execute("PRAGMA synchronous = NORMAL");
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the database connection.
 * Creates the connection, applies PRAGMAs, and stores the singleton.
 * Migrations are applied automatically by tauri-plugin-sql (Rust-side).
 *
 * @returns The database instance
 * @throws If connection or PRAGMA application fails
 */
export async function initDatabase(): Promise<Database> {
  if (db) {
    return db;
  }

  try {
    db = await Database.load(DB_PATH);
    await applyPragmas(db);
    return db;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to initialize database: ${message}`);
  }
}

/**
 * Get the current database instance (singleton).
 * Returns null if initDatabase() has not been called yet.
 */
export function getDatabase(): Database | null {
  return db;
}

/**
 * Close the database connection.
 * Resets the singleton so initDatabase() can be called again.
 *
 * @param dbName - Optional database name to close (defaults to all)
 */
export async function closeDatabase(dbName?: string): Promise<boolean> {
  if (!db) {
    return false;
  }

  try {
    const success = await db.close(dbName);
    db = null;
    return success;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to close database: ${message}`);
  }
}

// ── PRAGMA validation helpers ────────────────────────────────────────────────

/**
 * Query the current journal_mode.
 * Used for technical validation during implementation.
 */
export async function getJournalMode(): Promise<string> {
  const database = db ?? (await initDatabase());
  const rows = await database.select<{ journal_mode: string }[]>(
    "PRAGMA journal_mode"
  );
  return rows[0]?.journal_mode ?? "unknown";
}

/**
 * Query the current synchronous setting.
 * Used for technical validation during implementation.
 */
export async function getSynchronous(): Promise<number> {
  const database = db ?? (await initDatabase());
  const rows = await database.select<{ synchronous: number }[]>(
    "PRAGMA synchronous"
  );
  return rows[0]?.synchronous ?? -1;
}

/**
 * Query the current foreign_keys setting.
 * Used for technical validation during implementation.
 */
export async function getForeignKeys(): Promise<number> {
  const database = db ?? (await initDatabase());
  const rows = await database.select<{ foreign_keys: number }[]>(
    "PRAGMA foreign_keys"
  );
  return rows[0]?.foreign_keys ?? -1;
}
