/**
 * Ticket 10.1 — SQLite Infrastructure Tests
 *
 * Tests run with mocked tauri-plugin-sql (no Tauri runtime in Vitest).
 * The mock simulates the plugin's execute/select/close behavior.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Mock setup ───────────────────────────────────────────────────────────────
// vi.hoisted is required: the vi.mock factory is hoisted above all imports,
// so mocks must be declared before the factory runs.

const mocks = vi.hoisted(() => ({
  execute: vi.fn().mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 }),
  select: vi.fn().mockResolvedValue([]),
  close: vi.fn().mockResolvedValue(true),
  load: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-sql", () => {
  const Database = {
    load: mocks.load.mockResolvedValue({
      execute: mocks.execute,
      select: mocks.select,
      close: mocks.close,
    }),
  };
  return { default: Database };
});

// ── Import after mock setup ──────────────────────────────────────────────────

import {
  initDatabase,
  getDatabase,
  closeDatabase,
  getJournalMode,
  getSynchronous,
  getForeignKeys,
} from "../database";
import { tableExists, getTableNames, verifySchema } from "../migrations";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Reset singleton between tests */
async function resetSingleton(): Promise<void> {
  const db = getDatabase();
  if (db) {
    await closeDatabase();
  }
  vi.clearAllMocks();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SQLite Infrastructure — Ticket 10.1", () => {
  beforeEach(async () => {
    await resetSingleton();
  });

  afterEach(async () => {
    await resetSingleton();
  });

  // ── Connection lifecycle ─────────────────────────────────────────────────

  describe("initDatabase", () => {
    it("creates a database connection", async () => {
      const db = await initDatabase();
      expect(db).toBeDefined();
      expect(mocks.load).toHaveBeenCalledWith("sqlite:estampado.db");
    });

    it("returns same instance on subsequent calls (singleton)", async () => {
      const db1 = await initDatabase();
      const db2 = await initDatabase();
      expect(db1).toBe(db2);
      expect(mocks.load).toHaveBeenCalledTimes(1);
    });
  });

  describe("getDatabase", () => {
    it("returns null before initDatabase is called", () => {
      expect(getDatabase()).toBeNull();
    });

    it("returns the instance after initDatabase", async () => {
      await initDatabase();
      expect(getDatabase()).not.toBeNull();
    });
  });

  describe("closeDatabase", () => {
    it("closes the connection", async () => {
      await initDatabase();
      const result = await closeDatabase();
      expect(result).toBe(true);
      expect(getDatabase()).toBeNull();
    });

    it("returns false if no connection is open", async () => {
      const result = await closeDatabase();
      expect(result).toBe(false);
    });

    it("resets singleton so initDatabase can be called again", async () => {
      await initDatabase();
      await closeDatabase();
      const db = await initDatabase();
      expect(db).toBeDefined();
    });
  });

  // ── PRAGMA configuration ────────────────────────────────────────────────

  describe("PRAGMA configuration", () => {
    it("applies PRAGMA foreign_keys = ON", async () => {
      await initDatabase();
      expect(mocks.execute).toHaveBeenCalledWith("PRAGMA foreign_keys = ON");
    });

    it("applies PRAGMA journal_mode = WAL", async () => {
      await initDatabase();
      expect(mocks.execute).toHaveBeenCalledWith("PRAGMA journal_mode = WAL");
    });

    it("applies PRAGMA synchronous = NORMAL", async () => {
      await initDatabase();
      expect(mocks.execute).toHaveBeenCalledWith("PRAGMA synchronous = NORMAL");
    });

    it("applies PRAGMAs on every initDatabase call", async () => {
      await initDatabase();
      await closeDatabase();
      vi.clearAllMocks();

      await initDatabase();
      const pragmaCalls = mocks.execute.mock.calls.filter((call) =>
        (call[0] as string).startsWith("PRAGMA")
      );
      expect(pragmaCalls).toHaveLength(3);
    });
  });

  // ── PRAGMA validation helpers ───────────────────────────────────────────

  describe("PRAGMA validation helpers", () => {
    it("getJournalMode queries and returns journal_mode", async () => {
      mocks.select.mockResolvedValueOnce([{ journal_mode: "wal" }]);
      await initDatabase();
      const mode = await getJournalMode();
      expect(mode).toBe("wal");
      expect(mocks.select).toHaveBeenCalledWith("PRAGMA journal_mode");
    });

    it("getSynchronous queries and returns synchronous value", async () => {
      mocks.select.mockResolvedValueOnce([{ synchronous: 1 }]);
      await initDatabase();
      const value = await getSynchronous();
      expect(value).toBe(1);
      expect(mocks.select).toHaveBeenCalledWith("PRAGMA synchronous");
    });

    it("getForeignKeys queries and returns foreign_keys value", async () => {
      mocks.select.mockResolvedValueOnce([{ foreign_keys: 1 }]);
      await initDatabase();
      const value = await getForeignKeys();
      expect(value).toBe(1);
      expect(mocks.select).toHaveBeenCalledWith("PRAGMA foreign_keys");
    });
  });

  // ── Migration verification ──────────────────────────────────────────────

  describe("Schema verification", () => {
    it("tableExists checks via sqlite_master", async () => {
      mocks.select.mockResolvedValueOnce([{ name: "jornada" }]);
      await initDatabase();
      const exists = await tableExists("jornada");
      expect(exists).toBe(true);
      expect(mocks.select).toHaveBeenCalledWith(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        ["jornada"]
      );
    });

    it("tableExists returns false for missing table", async () => {
      mocks.select.mockResolvedValueOnce([]);
      await initDatabase();
      const exists = await tableExists("nonexistent");
      expect(exists).toBe(false);
    });

    it("getTableNames returns all non-system tables", async () => {
      mocks.select.mockResolvedValueOnce([
        { name: "jornada" },
        { name: "orden" },
        { name: "lectura_golpe" },
      ]);
      await initDatabase();
      const tables = await getTableNames();
      expect(tables).toEqual(["jornada", "orden", "lectura_golpe"]);
    });

    it("verifySchema checks all Phase 1 tables", async () => {
      // Mock three sequential calls to tableExists
      mocks.select
        .mockResolvedValueOnce([{ name: "jornada" }])
        .mockResolvedValueOnce([{ name: "orden" }])
        .mockResolvedValueOnce([{ name: "lectura_golpe" }]);

      await initDatabase();
      const schema = await verifySchema();
      expect(schema).toEqual({
        jornada: true,
        orden: true,
        lectura_golpe: true,
      });
    });

    it("tableExists throws if database not initialized", async () => {
      await expect(tableExists("jornada")).rejects.toThrow(
        "Database not initialized"
      );
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe("Error handling", () => {
    it("initDatabase throws descriptive message on connection failure", async () => {
      mocks.load.mockRejectedValueOnce(
        new Error("SQLite not available")
      );

      await expect(initDatabase()).rejects.toThrow(
        "Failed to initialize database: SQLite not available"
      );
    });

    it("closeDatabase throws descriptive message on close failure", async () => {
      await initDatabase();
      mocks.close.mockRejectedValueOnce(new Error("Close failed"));

      await expect(closeDatabase()).rejects.toThrow(
        "Failed to close database: Close failed"
      );
    });
  });
});
