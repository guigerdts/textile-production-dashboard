/**
 * Ticket 10.5 + 10.6 — SqliteLecturaGolpeRepository Tests
 *
 * The repository receives an already-initialized Database (from ticket 10.1).
 * These tests run against a faithful in-memory fake of the plugin's
 * execute/select behavior for the EXACT query patterns the repository emits:
 *   - the C3 INSERT..SELECT reservation statement (single atomic write)
 *   - SELECT ... FROM lectura_golpe WHERE id = $1 (full-row projection)
 *   - the single completion UPDATE with the status guard
 *   - SELECT ... WHERE orden_id = $1 AND status = $2 (persisted projection)
 *   - SELECT COALESCE(MAX(sequence), 0) ... WHERE orden_id = $1
 *   - PRIMARY KEY conflict rejection (id already exists -> rejected promise)
 *
 * Test classification (10.6):
 *   - Contract tests: drive the repository through its public interface and
 *     assert observable state (status transitions, sequence preservation,
 *     retry idempotency, conflict errors).
 *   - White-box statement tests: assert the exact SQL/bindings the repository
 *     emits against the installed plugin API ($N placeholders, single UPDATE
 *     with the guard, no sequence writes, no BEGIN/COMMIT/ROLLBACK).
 *   - Real-runtime tests: PENDING — the real sqlite engine, real plugin
 *     bindings and error shapes, genuine concurrency, and multi-statement
 *     atomicity cannot run in this Termux-only environment.
 *
 * HONESTY NOTE (10.5/10.6): these are unit tests against a controlled fake.
 * They prove the repository logic (ordering, idempotency, error branches).
 * They do NOT prove real SQLite/runtime behavior: actual multi-statement
 * atomicity, real PK/UNIQUE error shape from the plugin, real bindings, WAL,
 * busy_timeout, or genuine concurrency between two simultaneous reservations
 * or completions. Those remain PENDING for real-runtime validation.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import realMigrationSql from "../../../../src-tauri/migrations/002_lectura_orden_sequence_unique.sql?raw";
import mirrorMigrationSql from "../migrations/002_lectura_orden_sequence_unique.sql?raw";

// ── In-memory fake (vi.hoisted is required for vi.mock factories) ────────────

interface MockRow {
  id: string;
  orden_id: string;
  valor: number;
  timestamp: string;
  sequence: number;
  status: string;
}

const mocks = vi.hoisted(() => {
  const rows: MockRow[] = [];

  async function execute(
    query: string,
    bindValues: unknown[] = []
  ): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    if (query.includes("INSERT INTO lectura_golpe")) {
      const [id, ordenId, timestamp] = bindValues as [
        string,
        string,
        string,
      ];
      // PRIMARY KEY conflict: id already exists -> rejection (like plugin)
      if (rows.some((r) => r.id === id)) {
        throw new Error("UNIQUE constraint failed: lectura_golpe.id");
      }
      const max = rows
        .filter((r) => r.orden_id === ordenId)
        .reduce((acc, r) => Math.max(acc, r.sequence), 0);
      const sequence = max + 1;
      rows.push({
        id,
        orden_id: ordenId,
        valor: 0,
        timestamp,
        sequence,
        status: "reserved",
      });
      return { rowsAffected: 1, lastInsertId: rows.length };
    }
    if (query.includes("UPDATE lectura_golpe")) {
      // Single completion UPDATE with the status guard: only a row that is
      // BOTH the given id AND still 'reserved' is updated (rowsAffected 1).
      // Any other situation yields rowsAffected 0, exactly like SQLite.
      const [id, valor, timestamp] = bindValues as [
        string,
        number,
        string,
      ];
      const row = rows.find((r) => r.id === id && r.status === "reserved");
      if (!row) {
        return { rowsAffected: 0 };
      }
      row.valor = valor;
      row.timestamp = timestamp;
      row.status = "persisted";
      return { rowsAffected: 1 };
    }
    if (query.startsWith("PRAGMA")) {
      return { rowsAffected: 0 };
    }
    throw new Error(`execute: unsupported query in mock: ${query}`);
  }

  async function select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    if (query.includes("WHERE id = $1")) {
      const [id] = bindValues as [string];
      const row = rows.find((r) => r.id === id);
      if (!row) {
        return [] as T;
      }
      // Full row: satisfies BOTH the 10.5 projections (sequence/orden_id/status)
      // and the 10.6 projection (valor/timestamp for the idempotency check).
      return [row] as T;
    }
    if (query.includes("COALESCE(MAX(sequence), 0)")) {
      const [ordenId] = bindValues as [string];
      const max = rows
        .filter((r) => r.orden_id === ordenId)
        .reduce((acc, r) => Math.max(acc, r.sequence), 0);
      return [{ max_sequence: max }] as T;
    }
    if (query.includes("WHERE orden_id = $1 AND status")) {
      // getLecturasByOrden projection: persisted rows for the order, ordered
      // by sequence ASC (gaps preserved — ordering from sequence, not index).
      const [ordenId, status] = bindValues as [string, string];
      return rows
        .filter((r) => r.orden_id === ordenId && r.status === status)
        .slice()
        .sort((a, b) => a.sequence - b.sequence) as T;
    }
    return [] as T;
  }

  return {
    rows,
    execute: vi.fn(execute),
    select: vi.fn(select),
    clear: () => rows.splice(0, rows.length),
  };
});

vi.mock("@tauri-apps/plugin-sql", () => {
  return {
    default: {
      load: vi.fn(),
    },
  };
});

// ── Import after mock setup ──────────────────────────────────────────────────

import type Database from "@tauri-apps/plugin-sql";
import {
  SqliteLecturaGolpeRepository,
  RESERVATION_PLACEHOLDER_TIMESTAMP,
  RESERVED_STATUS,
} from "../sqliteLecturaGolpeRepository";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createRepo() {
  const db = {
    execute: mocks.execute,
    select: mocks.select,
  } as unknown as Database;
  return new SqliteLecturaGolpeRepository(db);
}

function seedReservedRow(
  id: string,
  ordenId: string,
  sequence: number,
  status = "reserved"
): void {
  mocks.rows.push({
    id,
    orden_id: ordenId,
    valor: 0,
    timestamp: RESERVATION_PLACEHOLDER_TIMESTAMP,
    sequence,
    status,
  });
}

/** Seed an already-persisted row (used by completion/getLecturas tests). */
function seedPersistedRow(
  id: string,
  ordenId: string,
  sequence: number,
  valor: number,
  timestamp: string
): void {
  mocks.rows.push({
    id,
    orden_id: ordenId,
    valor,
    timestamp,
    sequence,
    status: "persisted",
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SqliteLecturaGolpeRepository — Ticket 10.5", () => {
  beforeEach(() => {
    mocks.clear();
    vi.clearAllMocks();
  });

  // ── Reservation ordering (C3) ──────────────────────────────────────────

  describe("reserveSequence — ordering", () => {
    it("reserves sequence 1 for the first reservation of an order", async () => {
      const repo = createRepo();
      const sequence = await repo.reserveSequence("orden-1", "lecture-1");
      expect(sequence).toBe(1);
      expect(mocks.rows).toHaveLength(1);
      expect(mocks.rows[0]).toMatchObject({
        id: "lecture-1",
        orden_id: "orden-1",
        sequence: 1,
      });
    });

    it("reserves sequence 2 for the next reservation of the same order", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      const sequence = await repo.reserveSequence("orden-1", "lecture-2");
      expect(sequence).toBe(2);
      expect(mocks.rows).toHaveLength(2);
    });

    it("two different orders each start their sequence at 1", async () => {
      const repo = createRepo();
      const a1 = await repo.reserveSequence("orden-A", "a-1");
      const b1 = await repo.reserveSequence("orden-B", "b-1");
      expect(a1).toBe(1);
      expect(b1).toBe(1);
      expect(mocks.rows).toHaveLength(2);
    });

    it("does not skip sequences when reservations exist for another order", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-A", "a-1");
      await repo.reserveSequence("orden-A", "a-2");
      const first = await repo.reserveSequence("orden-B", "b-1");
      expect(first).toBe(1);
    });

    it("does NOT reuse an existing high sequence for the same order", async () => {
      // Simulate a completed/high sequence already persisted for the order.
      seedReservedRow("existing-5", "orden-1", 5, "persisted");
      const repo = createRepo();
      const sequence = await repo.reserveSequence("orden-1", "lecture-new");
      expect(sequence).toBe(6);
    });
  });

  // ── Idempotency / retry with the same lectureId ────────────────────────

  describe("reserveSequence — idempotency (lectureId retry key)", () => {
    it("returns the same sequence on retry with the same lectureId (no second row)", async () => {
      const repo = createRepo();
      const first = await repo.reserveSequence("orden-1", "lecture-1");
      const second = await repo.reserveSequence("orden-1", "lecture-1");
      expect(second).toBe(first);
      expect(mocks.rows).toHaveLength(1); // no second row
    });

    it("fast-path: an already-reserved lectureId returns its existing sequence without recalculating", async () => {
      seedReservedRow("existing", "orden-1", 7);
      const repo = createRepo();
      const sequence = await repo.reserveSequence("orden-1", "existing");
      expect(sequence).toBe(7);
      expect(mocks.rows).toHaveLength(1);
      // no INSERT should have been attempted (no execute mutations)
      expect(
        mocks.execute.mock.calls.filter((c) =>
          (c[0] as string).includes("INSERT INTO lectura_golpe")
        )
      ).toHaveLength(0);
    });

    it("PK-conflict branch: concurrent race recovers the existing reserved row", async () => {
      // The row exists by the time the insert runs (another reservation
      // completed between our fast-path check and our insert). The fake
      // hides it for the FIRST select (fast-path) and reveals it on the
      // re-check after the rejected insert — mirroring the race.
      seedReservedRow("raced", "orden-1", 3);
      mocks.select.mockImplementationOnce(async () => []);
      const repo = createRepo();
      const sequence = await repo.reserveSequence("orden-1", "raced");
      expect(sequence).toBe(3);
      expect(mocks.rows).toHaveLength(1); // still exactly one row
    });

    it("does NOT swallow insert errors: non-reserved existing row propagates", async () => {
      seedReservedRow("weird", "orden-1", 9, "persisted");
      mocks.select.mockImplementationOnce(async () => []);
      const repo = createRepo();
      await expect(
        repo.reserveSequence("orden-1", "weird")
      ).rejects.toThrow();
      expect(mocks.rows).toHaveLength(1);
    });

    it("propagates arbitrary insert failures when no row exists", async () => {
      mocks.execute.mockImplementationOnce(async () => {
        throw new Error("database is locked");
      });
      const repo = createRepo();
      await expect(
        repo.reserveSequence("orden-1", "lecture-x")
      ).rejects.toThrow("database is locked");
      expect(mocks.rows).toHaveLength(0);
    });
  });

  // ── Statement shape / verified API contract ────────────────────────────

  describe("reserveSequence — statement shape against installed API", () => {
    it("issues ONE atomic INSERT..SELECT statement with $1..$4 bindings", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");

      const insertCalls = mocks.execute.mock.calls.filter((c) =>
        (c[0] as string).includes("INSERT INTO lectura_golpe")
      );
      expect(insertCalls).toHaveLength(1);
      const [query, bindValues] = insertCalls[0] as [string, unknown[]];
      expect(query).toContain(
        "COALESCE(MAX(sequence), 0) + 1"
      );
      expect(query).toContain("'reserved'");
      expect(bindValues).toEqual([
        "lecture-1",
        "orden-1",
        RESERVATION_PLACEHOLDER_TIMESTAMP,
        "orden-1",
      ]);
      // NO BEGIN/COMMIT anywhere (no transaction API used)
      const allQueries = mocks.execute.mock.calls.map(
        (c) => c[0] as string
      );
      expect(
        allQueries.some((q) => /BEGIN|COMMIT|ROLLBACK/i.test(q))
      ).toBe(false);
    });

    it("reads the reserved sequence back via SELECT by id after success", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      const selectCalls = mocks.select.mock.calls.filter((c) =>
        (c[0] as string).includes("WHERE id = $1")
      );
      expect(selectCalls.length).toBeGreaterThanOrEqual(1);
      expect(selectCalls[selectCalls.length - 1][1]).toEqual(["lecture-1"]);
    });

    it("only uses $N placeholder syntax (no '?' binds) per plugin SQLite API", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      await repo.getMaxSequence("orden-1");
      const allQueries = [
        ...mocks.execute.mock.calls.map((c) => c[0] as string),
        ...mocks.select.mock.calls.map((c) => c[0] as string),
      ];
      for (const q of allQueries) {
        expect(q).not.toMatch(/\?/);
      }
      expect(allQueries.length).toBeGreaterThan(0);
    });

    it("throws a descriptive error if the insert reports rowsAffected < 1", async () => {
      mocks.execute.mockImplementationOnce(async () => ({ rowsAffected: 0 }));
      const repo = createRepo();
      await expect(
        repo.reserveSequence("orden-1", "lecture-1")
      ).rejects.toThrow("no se insertó ninguna fila");
    });
  });

  // ── Reservation state shape ────────────────────────────────────────────

  describe("reserved row shape", () => {
    it("stores valor 0 and the documented placeholder timestamp on reservation", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      expect(mocks.rows[0]).toMatchObject({
        valor: 0,
        timestamp: RESERVATION_PLACEHOLDER_TIMESTAMP,
        status: RESERVED_STATUS,
      });
    });

    it("records status 'reserved' (not 'persisted') until completion", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      expect(mocks.rows[0].status).toBe("reserved");
    });
  });

  // ── findReservation ────────────────────────────────────────────────────

  describe("findReservation", () => {
    it("returns the reservation when it exists", async () => {
      seedReservedRow("existing", "orden-1", 4);
      const repo = createRepo();
      const reservation = await repo.findReservation("existing");
      expect(reservation).toEqual({ sequence: 4, ordenId: "orden-1" });
    });

    it("returns undefined when no reservation exists", async () => {
      const repo = createRepo();
      const reservation = await repo.findReservation("missing");
      expect(reservation).toBeUndefined();
    });
  });

  // ── getMaxSequence ─────────────────────────────────────────────────────

  describe("getMaxSequence", () => {
    it("returns 0 when the order has no lectures", async () => {
      const repo = createRepo();
      const max = await repo.getMaxSequence("orden-empty");
      expect(max).toBe(0);
    });

    it("returns the maximum sequence for the order", async () => {
      seedReservedRow("l1", "orden-1", 1);
      seedReservedRow("l2", "orden-1", 2);
      seedReservedRow("other", "orden-2", 42);
      const repo = createRepo();
      expect(await repo.getMaxSequence("orden-1")).toBe(2);
      expect(await repo.getMaxSequence("orden-2")).toBe(42);
    });
  });

  // ── Ticket 10.6 ──────────────────────────────────────────────────────────
});

describe("SqliteLecturaGolpeRepository — Ticket 10.6", () => {
  beforeEach(() => {
    mocks.clear();
    vi.clearAllMocks();
  });

  const TS = "2026-09-22T10:00:00.000Z";

  // ── completeLecture — reserved -> persisted ─────────────────────────────

  describe("completeLecture — reserved -> persisted", () => {
    it("transitions a reserved lecture to persisted", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      await repo.completeLecture("lecture-1", 3, TS);
      expect(mocks.rows[0].status).toBe("persisted");
    });

    it("preserves the exact sequence assigned at reservation", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      const before = mocks.rows[0].sequence;
      await repo.completeLecture("lecture-1", 3, TS);
      expect(mocks.rows[0].sequence).toBe(before);
      expect(mocks.rows[0].sequence).toBe(1); // not recalculated
    });

    it("persists valor and timestamp", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      await repo.completeLecture("lecture-1", 3, TS);
      expect(mocks.rows[0].valor).toBe(3);
      expect(mocks.rows[0].timestamp).toBe(TS);
    });

    it("updates the existing row in place (no new row, no deletion)", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      await repo.completeLecture("lecture-1", 3, TS);
      expect(mocks.rows).toHaveLength(1);
      expect(mocks.rows[0].id).toBe("lecture-1");
    });

    it("issues ONE atomic UPDATE with the status guard and spec bindings", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      await repo.completeLecture("lecture-1", 3, TS);

      const updateCalls = mocks.execute.mock.calls.filter((c) =>
        (c[0] as string).includes("UPDATE lectura_golpe")
      );
      expect(updateCalls).toHaveLength(1);
      const [query, bindValues] = updateCalls[0] as [string, unknown[]];
      expect(query).toContain(
        "SET valor = $2, timestamp = $3, status = 'persisted'"
      );
      expect(query).toContain("WHERE id = $1 AND status = 'reserved'");
      // bindings per spec: [lectureId, valor, timestamp]
      expect(bindValues).toEqual(["lecture-1", 3, TS]);

      // snapshot SELECT by id carries the full projection used by retry check
      const snapshotCalls = mocks.select.mock.calls.filter((c) =>
        (c[0] as string).includes("WHERE id = $1")
      );
      expect(snapshotCalls.length).toBeGreaterThanOrEqual(1);
      expect(snapshotCalls[snapshotCalls.length - 1][0]).toContain(
        "valor, timestamp"
      );
    });

    it("completion UPDATE never references the sequence column", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      await repo.completeLecture("lecture-1", 3, TS);
      const updateCalls = mocks.execute.mock.calls.filter((c) =>
        (c[0] as string).includes("UPDATE lectura_golpe")
      );
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][0]).not.toContain("sequence");
    });

    it("does not BEGIN/COMMIT/ROLLBACK and uses only $N placeholders", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      await repo.completeLecture("lecture-1", 3, TS);
      await repo.getLecturasByOrden("orden-1");
      const allQueries = [
        ...mocks.execute.mock.calls.map((c) => c[0] as string),
        ...mocks.select.mock.calls.map((c) => c[0] as string),
      ];
      for (const q of allQueries) {
        expect(q).not.toMatch(/BEGIN|COMMIT|ROLLBACK/i);
        expect(q).not.toMatch(/\?/);
      }
    });

    it("throws a descriptive error when the lecture does not exist", async () => {
      const repo = createRepo();
      await expect(
        repo.completeLecture("missing", 3, TS)
      ).rejects.toThrow("lectura no encontrada: missing");
    });
  });

  // ── completeLecture — retry / idempotency (already persisted) ───────────

  describe("completeLecture — retry / idempotency (already persisted)", () => {
    it("retry with identical (valor, timestamp) succeeds without a second write", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      await repo.completeLecture("lecture-1", 3, TS);
      await expect(repo.completeLecture("lecture-1", 3, TS)).resolves.toBeUndefined();
      expect(mocks.rows).toHaveLength(1);
      const updateCalls = mocks.execute.mock.calls.filter((c) =>
        (c[0] as string).includes("UPDATE lectura_golpe")
      );
      expect(updateCalls).toHaveLength(1); // retry resolved from the snapshot
    });

    it("retry with different data throws a conflict and never overwrites", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      await repo.completeLecture("lecture-1", 3, TS);
      await expect(
        repo.completeLecture("lecture-1", 9, "2026-09-22T11:00:00.000Z")
      ).rejects.toThrow("conflicto");
      // original persistence intact, still one row, no second UPDATE
      expect(mocks.rows[0].valor).toBe(3);
      expect(mocks.rows[0].timestamp).toBe(TS);
      expect(mocks.rows[0].status).toBe("persisted");
      expect(mocks.rows).toHaveLength(1);
      const updateCalls = mocks.execute.mock.calls.filter((c) =>
        (c[0] as string).includes("UPDATE lectura_golpe")
      );
      expect(updateCalls).toHaveLength(1);
    });

    it("a reserved lecture ends in exactly one persistence (crash retry cannot fork it)", async () => {
      // Reservation survives a crash (seed), completion happens, then a late
      // retry replays the SAME original data -> idempotent success.
      seedReservedRow("survived", "orden-1", 2);
      const repo = createRepo();
      await repo.completeLecture("survived", 5, TS);
      expect(mocks.rows[0].status).toBe("persisted");
      await expect(repo.completeLecture("survived", 5, TS)).resolves.toBeUndefined();
      expect(mocks.rows).toHaveLength(1);
      expect(mocks.rows[0].sequence).toBe(2);
    });
  });

  // ── completeLecture — rowsAffected=0 resolution ─────────────────────────

  describe("completeLecture — rowsAffected=0 resolution (concurrent completion)", () => {
    const fakeReservedSnapshot = {
      id: "raced",
      orden_id: "orden-1",
      sequence: 4,
      status: "reserved" as const,
      valor: 0,
      timestamp: RESERVATION_PLACEHOLDER_TIMESTAMP,
    };

    it("resolves to idempotent success when a concurrent completion persisted identical data", async () => {
      seedReservedRow("raced", "orden-1", 4, "persisted");
      mocks.select.mockImplementationOnce(async () => [fakeReservedSnapshot]);
      mocks.execute.mockImplementationOnce(async () => ({ rowsAffected: 0 }));
      const repo = createRepo();
      await expect(
        repo.completeLecture("raced", 0, RESERVATION_PLACEHOLDER_TIMESTAMP)
      ).resolves.toBeUndefined();
      expect(mocks.rows[0].status).toBe("persisted");
    });

    it("rejects a conflict when the concurrent completion persisted different data", async () => {
      seedReservedRow("raced", "orden-1", 4, "persisted");
      mocks.select.mockImplementationOnce(async () => [fakeReservedSnapshot]);
      mocks.execute.mockImplementationOnce(async () => ({ rowsAffected: 0 }));
      const repo = createRepo();
      await expect(
        repo.completeLecture("raced", 3, TS)
      ).rejects.toThrow("conflicto");
      expect(mocks.rows[0].valor).toBe(0);
    });

    it("throws an unexpected-state error when the row is still reserved after a 0-row UPDATE", async () => {
      seedReservedRow("stuck", "orden-1", 5);
      mocks.execute.mockImplementationOnce(async () => ({ rowsAffected: 0 }));
      const repo = createRepo();
      await expect(
        repo.completeLecture("stuck", 3, TS)
      ).rejects.toThrow("estado inesperado");
      expect(mocks.rows[0].status).toBe("reserved");
    });

    it("propagates SQL errors from the UPDATE (never a silent success)", async () => {
      const repo = createRepo();
      await repo.reserveSequence("orden-1", "lecture-1");
      mocks.execute.mockImplementationOnce(async () => {
        throw new Error("database is locked");
      });
      await expect(
        repo.completeLecture("lecture-1", 3, TS)
      ).rejects.toThrow("database is locked");
      expect(mocks.rows[0].status).toBe("reserved");
    });
  });

  // ── getLecturasByOrden — persisted projection (ticket 10.6) ─────────────

  describe("getLecturasByOrden — persisted projection", () => {
    it("returns only persisted lectures, ordered by sequence ASC, gaps preserved", async () => {
      // persisted with a gap: sequence 1 and 3 present, 2 absent
      seedPersistedRow("p1", "orden-1", 1, 3, "2026-09-22T10:00:00.000Z");
      seedPersistedRow("p3", "orden-1", 3, 9, "2026-09-22T10:01:00.000Z");
      seedReservedRow("r4", "orden-1", 4); // reserved -> excluded
      seedPersistedRow("other", "orden-2", 1, 7, "2026-09-22T09:00:00.000Z");
      const repo = createRepo();
      const lecturas = await repo.getLecturasByOrden("orden-1");
      expect(lecturas).toEqual([
        { valor: 3, timestamp: "2026-09-22T10:00:00.000Z", deltaGolpes: 0 },
        { valor: 9, timestamp: "2026-09-22T10:01:00.000Z", deltaGolpes: 0 },
      ]);
    });

    it("returns [] when no persisted lectures exist (reserved-only or empty)", async () => {
      seedReservedRow("r1", "orden-1", 1);
      const repo = createRepo();
      expect(await repo.getLecturasByOrden("orden-1")).toEqual([]);
      expect(await repo.getLecturasByOrden("orden-empty")).toEqual([]);
    });

    it("includes valor and timestamp of each persisted lecture (delta derived by domain)", async () => {
      seedPersistedRow("p1", "orden-1", 1, 3, TS);
      const repo = createRepo();
      const [lectura] = await repo.getLecturasByOrden("orden-1");
      expect(lectura.valor).toBe(3);
      expect(lectura.timestamp).toBe(TS);
      expect(lectura.deltaGolpes).toBe(0); // documented placeholder (10.8 consumes)
    });

    it("queries only persisted rows for the order, ordered by sequence", async () => {
      seedPersistedRow("p1", "orden-1", 1, 3, TS);
      const repo = createRepo();
      await repo.getLecturasByOrden("orden-1");
      const selectCalls = mocks.select.mock.calls.filter((c) =>
        (c[0] as string).includes("WHERE orden_id = $1 AND status")
      );
      expect(selectCalls).toHaveLength(1);
      const [query, bindValues] = selectCalls[0] as [string, unknown[]];
      expect(query).toContain("WHERE orden_id = $1 AND status = $2");
      expect(query).toContain("ORDER BY sequence ASC");
      expect(bindValues).toEqual(["orden-1", "persisted"]);
    });
  });
});

// ── Structural checks: migration 002 (UNIQUE barrier) ───────────────────────

describe("Migration 002 — UNIQUE(orden_id, sequence) final barrier", () => {
  it("exists in src-tauri/migrations and creates the unique index", () => {
    expect(realMigrationSql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS");
    expect(realMigrationSql).toContain("idx_lectura_orden_sequence");
    expect(realMigrationSql).toContain("ON lectura_golpe(orden_id, sequence)");
  });

  it("doc mirror (src/store/sqlite/migrations) matches the real migration", () => {
    expect(mirrorMigrationSql).toBe(realMigrationSql);
  });
});