/**
 * Ticket 10.3 — SqliteJornadaRepository Tests
 *
 * The repository receives an already-initialized Database (ticket 10.1).
 * These tests run against a faithful in-memory fake of the plugin's
 * execute/select behavior for the EXACT query patterns the repository emits:
 *   - SELECT inicio, fin FROM jornada WHERE fecha_operativa = $1
 *   - INSERT INTO jornada ... ON CONFLICT(fecha_operativa) DO UPDATE SET ...
 *     (single atomic UPSERT; NO INSERT OR REPLACE)
 *
 * Test classification (10.3):
 *   - Contract tests: drive the repository through its public interface and
 *     assert observable state (default fallback, persistence, isolation,
 *     validation rejections).
 *   - White-box statement tests: assert the exact SQL/bindings the repository
 *     emits against the installed plugin API ($N placeholders, ON CONFLICT
 *     UPSERT, no automatic default INSERT, no BEGIN/COMMIT/ROLLBACK).
 *   - Real-runtime tests: PENDING — the real sqlite engine, real plugin
 *     bindings and error shapes, and genuine concurrency cannot run in this
 *     Termux-only environment.
 *
 * HONESTY NOTE (10.3): these are unit tests against a controlled fake. They
 * prove the repository logic (validation, mapping, isolation, error branches)
 * and the exact SQL the repo emits. They do NOT prove real SQLite/runtime
 * behavior: actual ON CONFLICT upsert on the real engine, real plugin error
 * shape, WAL, busy_timeout, or genuine concurrency. Those remain PENDING for
 * real-runtime validation.
 *
 * Isolation: the repository is constructed with the fake Database directly;
 * the global singleton (database.ts) is never touched.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── In-memory fake (vi.hoisted is required for vi.mock factories) ────────────

interface MockRow {
  fecha_operativa: string;
  inicio: string;
  fin: string;
}

const mocks = vi.hoisted(() => {
  const rows: MockRow[] = [];

  async function execute(
    query: string,
    bindValues: unknown[] = []
  ): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    if (query.includes("INSERT INTO jornada")) {
      const [fechaOperativa, inicio, fin] = bindValues as [
        string,
        string,
        string,
      ];
      // UPSERT semantics: existing fecha -> update; absent -> insert.
      const existing = rows.find((r) => r.fecha_operativa === fechaOperativa);
      if (existing) {
        existing.inicio = inicio;
        existing.fin = fin;
      } else {
        rows.push({ fecha_operativa: fechaOperativa, inicio, fin });
      }
      return { rowsAffected: 1 };
    }
    throw new Error(`execute: unsupported query in mock: ${query}`);
  }

  async function select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    if (query.includes("FROM jornada")) {
      const [fechaOperativa] = bindValues as [string];
      const row = rows.find((r) => r.fecha_operativa === fechaOperativa);
      if (!row) {
        return [] as T;
      }
      // Projection of the repository's SELECT: inicio + fin only.
      return [{ inicio: row.inicio, fin: row.fin }] as T;
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
  SqliteJornadaRepository,
  mapJornadaRow,
} from "../sqliteJornadaRepository";
import { jornadaDefault } from "../../../domain/tiempo";
import type { JornadaTurno } from "../../../domain/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const FECHA = "2026-09-11";

const JORNADA_OVERTIME: JornadaTurno = {
  inicio: "2026-09-11T07:00:00.000Z",
  fin: "2026-09-11T19:00:00.000Z",
};

function createRepo() {
  const db = {
    execute: mocks.execute,
    select: mocks.select,
  } as unknown as Database;
  return new SqliteJornadaRepository(db);
}

function seedRow(fechaOperativa: string, jornada: JornadaTurno): void {
  mocks.rows.push({
    fecha_operativa: fechaOperativa,
    inicio: jornada.inicio,
    fin: jornada.fin,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SqliteJornadaRepository — Ticket 10.3", () => {
  beforeEach(() => {
    mocks.clear();
    vi.clearAllMocks();
  });

  // ── obtenerParaFecha ─────────────────────────────────────────────────────

  describe("obtenerParaFecha", () => {
    it("returns the jornada when a row exists", async () => {
      seedRow(FECHA, JORNADA_OVERTIME);
      const repo = createRepo();
      const jornada = await repo.obtenerParaFecha(FECHA);
      expect(jornada).toEqual(JORNADA_OVERTIME);
    });

    it("returns the default (07:00-17:00) when no row exists", async () => {
      const repo = createRepo();
      const jornada = await repo.obtenerParaFecha(FECHA);
      expect(jornada).toEqual(jornadaDefault(FECHA));
    });

    it("default fallback does NOT generate an INSERT (never persisted)", async () => {
      const repo = createRepo();
      await repo.obtenerParaFecha(FECHA);
      const insertCalls = mocks.execute.mock.calls.filter((c) =>
        (c[0] as string).includes("INSERT INTO jornada")
      );
      expect(insertCalls).toHaveLength(0);
    });

    it("rejects a fecha that is not YYYY-MM-DD", async () => {
      const repo = createRepo();
      for (const invalida of ["11-09-2026", "2026/09/11", "20260911", ""]) {
        await expect(repo.obtenerParaFecha(invalida)).rejects.toThrow(
          "fecha operativa inválida"
        );
      }
    });

    it("does not query the database for an invalid fecha", async () => {
      const repo = createRepo();
      await expect(repo.obtenerParaFecha("2026/09/11")).rejects.toThrow();
      expect(mocks.select).not.toHaveBeenCalled();
    });

    it("is isolated by fecha (another date with a row does not affect the query)", async () => {
      seedRow(FECHA, JORNADA_OVERTIME);
      const repo = createRepo();
      const otro = await repo.obtenerParaFecha("2026-09-15");
      expect(otro).toEqual(jornadaDefault("2026-09-15"));
      expect(mocks.select).toHaveBeenCalledWith(
        "SELECT inicio, fin FROM jornada WHERE fecha_operativa = $1",
        ["2026-09-15"]
      );
    });
  });

  // ── guardarJornada ───────────────────────────────────────────────────────

  describe("guardarJornada", () => {
    it("persists a valid jornada and reads it back", async () => {
      const repo = createRepo();
      await repo.guardarJornada(FECHA, JORNADA_OVERTIME);
      expect(await repo.obtenerParaFecha(FECHA)).toEqual(JORNADA_OVERTIME);
    });

    it("UPSERT: overwrites an existing jornada for the same fecha", async () => {
      seedRow(FECHA, JORNADA_OVERTIME);
      const repo = createRepo();
      const extendida: JornadaTurno = {
        inicio: "2026-09-11T07:00:00.000Z",
        fin: "2026-09-11T20:00:00.000Z",
      };
      await repo.guardarJornada(FECHA, extendida);
      expect(await repo.obtenerParaFecha(FECHA)).toEqual(extendida);
      // UPSERT updates the SAME row; it never duplicates the fecha.
      expect(mocks.rows.filter((r) => r.fecha_operativa === FECHA)).toHaveLength(1);
    });

    it("rejects a fecha that is not YYYY-MM-DD", async () => {
      const repo = createRepo();
      for (const invalida of ["11-09-2026", "2026/09/11", "20260911", ""]) {
        await expect(repo.guardarJornada(invalida, JORNADA_OVERTIME)).rejects.toThrow(
          "fecha operativa inválida"
        );
      }
    });

    it("rejects a jornada without inicio", async () => {
      const repo = createRepo();
      await expect(
        repo.guardarJornada(FECHA, { inicio: "", fin: JORNADA_OVERTIME.fin })
      ).rejects.toThrow("debe indicar el inicio de la jornada");
    });

    it("rejects a jornada without fin", async () => {
      const repo = createRepo();
      await expect(
        repo.guardarJornada(FECHA, { inicio: JORNADA_OVERTIME.inicio, fin: "" })
      ).rejects.toThrow("debe indicar el fin de la jornada");
    });

    it("rejects a jornada with fin equal to inicio", async () => {
      const repo = createRepo();
      const invalida: JornadaTurno = {
        inicio: "2026-09-11T07:00:00.000Z",
        fin: "2026-09-11T07:00:00.000Z",
      };
      await expect(repo.guardarJornada(FECHA, invalida)).rejects.toThrow(
        "el fin de la jornada debe ser posterior al inicio"
      );
    });

    it("rejects a jornada with fin before inicio", async () => {
      const repo = createRepo();
      const invalida: JornadaTurno = {
        inicio: "2026-09-11T17:00:00.000Z",
        fin: "2026-09-11T07:00:00.000Z",
      };
      await expect(repo.guardarJornada(FECHA, invalida)).rejects.toThrow(
        "el fin de la jornada debe ser posterior al inicio"
      );
    });

    it("a rejected jornada (validation) never executes SQL", async () => {
      const repo = createRepo();
      const invalida: JornadaTurno = {
        inicio: "2026-09-11T17:00:00.000Z",
        fin: "2026-09-11T07:00:00.000Z",
      };
      await expect(repo.guardarJornada(FECHA, invalida)).rejects.toThrow();
      expect(mocks.execute).not.toHaveBeenCalled();
    });

    it("a rejected fecha (validation) never executes SQL", async () => {
      const repo = createRepo();
      await expect(repo.guardarJornada("2026/09/11", JORNADA_OVERTIME)).rejects.toThrow();
      expect(mocks.execute).not.toHaveBeenCalled();
    });
  });

  // ── White-box: SQL and binding assertions ────────────────────────────────

  describe("SQL and bindings (white-box)", () => {
    it("INSERT uses ON CONFLICT UPSERT (never INSERT OR REPLACE)", async () => {
      const repo = createRepo();
      await repo.guardarJornada(FECHA, JORNADA_OVERTIME);
      const insertSql = mocks.execute.mock.calls.find((c) =>
        (c[0] as string).includes("INSERT INTO jornada")
      )?.[0] as string;
      expect(insertSql).toBeDefined();
      expect(insertSql).toContain("ON CONFLICT(fecha_operativa)");
      expect(insertSql).toContain("DO UPDATE SET");
      expect(insertSql).not.toContain("INSERT OR REPLACE");
      expect(insertSql).not.toMatch(/\?/);
    });

    it("binds exactly [fechaOperativa, inicio, fin] with $1/$2/$3", async () => {
      const repo = createRepo();
      await repo.guardarJornada(FECHA, JORNADA_OVERTIME);
      expect(mocks.execute).toHaveBeenCalledWith(
        expect.stringContaining("VALUES ($1, $2, $3)"),
        [FECHA, JORNADA_OVERTIME.inicio, JORNADA_OVERTIME.fin]
      );
    });

    it("SELECT projection and binding for obtenerParaFecha", async () => {
      seedRow(FECHA, JORNADA_OVERTIME);
      const repo = createRepo();
      await repo.obtenerParaFecha(FECHA);
      expect(mocks.select).toHaveBeenCalledWith(
        "SELECT inicio, fin FROM jornada WHERE fecha_operativa = $1",
        [FECHA]
      );
    });

    it("never issues BEGIN/COMMIT/ROLLBACK", async () => {
      const repo = createRepo();
      await repo.guardarJornada(FECHA, JORNADA_OVERTIME);
      await repo.obtenerParaFecha(FECHA);
      const allSql = [
        ...mocks.execute.mock.calls.map((c) => c[0] as string),
        ...mocks.select.mock.calls.map((c) => c[0] as string),
      ];
      for (const sql of allSql) {
        expect(sql).not.toMatch(/BEGIN|COMMIT|ROLLBACK/i);
      }
    });
  });

  // ── Error handling from the plugin ───────────────────────────────────────

  describe("plugin failures", () => {
    it("a rejected execute produces a descriptive error that keeps the cause", async () => {
      mocks.execute.mockRejectedValueOnce(new Error("database is locked"));
      const repo = createRepo();
      const err = await repo.guardarJornada(FECHA, JORNADA_OVERTIME).then(
        () => null,
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(
        'no se pudo persistir la jornada para "2026-09-11"'
      );
      // Original cause is preserved when the runtime supports Error cause.
      if ("cause" in (err as Error)) {
        expect((err as Error).cause).toEqual(
          expect.objectContaining({ message: "database is locked" })
        );
      }
      expect(mocks.rows).toHaveLength(0);
    });
  });

  // ── Mapping ──────────────────────────────────────────────────────────────

  describe("mapJornadaRow", () => {
    it("transforms a SQL row into a fresh JornadaTurno", () => {
      const row = {
        inicio: "2026-09-11T07:00:00.000Z",
        fin: "2026-09-11T19:00:00.000Z",
      };
      const jornada = mapJornadaRow(row);
      expect(jornada).toEqual({
        inicio: "2026-09-11T07:00:00.000Z",
        fin: "2026-09-11T19:00:00.000Z",
      });
      // Fresh object: mutating the result never mutates the row.
      jornada.fin = "2050-01-01T00:00:00.000Z";
      expect(row.fin).toBe("2026-09-11T19:00:00.000Z");
    });
  });
});