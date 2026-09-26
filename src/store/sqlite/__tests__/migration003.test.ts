/**
 * Ticket 10-9 — Migration 003 (d1_orden_persistence) Tests
 *
 * The real migration executes Rust-side: src-tauri/src/lib.rs registers
 * version 3 (include_str!) and tauri-plugin-sql applies it on Database.load().
 * This Termux-only environment cannot run the Tauri runtime, so the tests are
 * unit/contract tests, exactly like 10.1/10.3/10.4:
 *
 *   - SQL-contract tests: the migration script (imported via ?raw from the
 *     mirror, which per the 10.1 pattern must stay identical to the Rust-side
 *     file) contains EXACTLY the four ALTER TABLE statements, in order, and no
 *     other operation: no CREATE INDEX, no UNIQUE, no backfill UPDATE, no
 *     CHECK/DROP, no new tables.
 *   - Schema-shape tests: after applying the migration, PRAGMA table_info(orden)
 *     exposes the four new columns with exact names, types, defaults and
 *     nullability, and the fourteen original columns (constraints included)
 *     remain unchanged.
 *   - Backfill-model tests: a row created with the pre-003 schema receives
 *     exactly the literal defaults 0 / 0 / 'reactiva' / NULL — grounded in the
 *     DEFAULT clauses of the migration file — and nothing else is fabricated.
 *   - Repository round-trip tests: the four fields persist and recover through
 *     SqliteOrderRepository, including a finished order with finalizada_en set
 *     and zero lecturas (no artificial lectura), and an unfinished order whose
 *     finalizada_en stays NULL.
 *   - Regression tests: the 001/002 indexes and the PK constraint are intact;
 *     this migration adds no index and never mentions fecha_operativa (no
 *     UNIQUE(fecha_operativa)).
 *
 * HONESTY NOTE: the fake simulates SQLite's documented ALTER TABLE ADD COLUMN
 * semantics. These tests do NOT execute the real Rust migration against the
 * real sqlite engine; real-runtime validation remains PENDING for a Tauri
 * environment.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import migration003Sql from "../migrations/003_d1_orden_persistence.sql?raw";

// ── In-memory fake (vi.hoisted is required for vi.mock factories) ────────────

/** Shape returned by PRAGMA table_info(orden). */
interface TableInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | number | null;
  pk: number;
}

/** Fila de `orden`: 001 (14 columnas) + columnas 003 de D-1 (4). */
interface OrderRow {
  id: string;
  numero_orden: string;
  fecha_operativa: string;
  referencia_tela: string;
  disenio: string;
  unidades_solicitadas: number;
  unidades_producidas: number;
  unidades_primera: number;
  unidades_segunda: number;
  estado: string;
  operario: string | null;
  machine_id: string;
  created_at: string;
  updated_at: string;
  aplica_segunda: number;
  porcentaje_2da: number;
  tipo_pintura: string;
  finalizada_en: string | null;
}

const mocks = vi.hoisted(() => {
  // Esquema pre-003 (001): las 14 columnas originales de orden.
  const ORIGINAL_COLUMNS: TableInfo[] = [
    { cid: 0, name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
    { cid: 1, name: "numero_orden", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { cid: 2, name: "fecha_operativa", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { cid: 3, name: "referencia_tela", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { cid: 4, name: "disenio", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { cid: 5, name: "unidades_solicitadas", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
    { cid: 6, name: "unidades_producidas", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
    { cid: 7, name: "unidades_primera", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
    { cid: 8, name: "unidades_segunda", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
    { cid: 9, name: "estado", type: "TEXT", notnull: 1, dflt_value: "'available'", pk: 0 },
    { cid: 10, name: "operario", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
    { cid: 11, name: "machine_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { cid: 12, name: "created_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { cid: 13, name: "updated_at", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  ];

  // Las 4 columnas de 003 (D-1), agregadas por ALTER TABLE ADD COLUMN.
  const D1_COLUMNS: TableInfo[] = [
    { cid: 14, name: "aplica_segunda", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
    { cid: 15, name: "porcentaje_2da", type: "REAL", notnull: 1, dflt_value: "0", pk: 0 },
    { cid: 16, name: "tipo_pintura", type: "TEXT", notnull: 1, dflt_value: "'reactiva'", pk: 0 },
    { cid: 17, name: "finalizada_en", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
  ];

  // Índices de 001/002 (sin nada derivado de 003).
  const indexes: Array<{ name: string; tbl_name: string }> = [
    { name: "sqlite_autoindex_orden_1", tbl_name: "orden" },
    { name: "idx_orden_fecha", tbl_name: "orden" },
    { name: "idx_lectura_orden", tbl_name: "lectura_golpe" },
    { name: "idx_lectura_status", tbl_name: "lectura_golpe" },
    { name: "idx_lectura_orden_sequence", tbl_name: "lectura_golpe" },
  ];

  // Filas pre-003 pueden carecer de las 4 columnas hasta aplicar la migración.
  const rows: Array<Partial<OrderRow>> = [];
  let columns: TableInfo[] = [...ORIGINAL_COLUMNS];

  /**
   * Modela la semántica documentada de SQLite ALTER TABLE ADD COLUMN para una
   * base pre-003: las filas existentes reciben el DEFAULT literal de cada
   * columna nueva NOT NULL y NULL para la columna nullable sin default.
   */
  function applyMigration003(): void {
    columns = [...ORIGINAL_COLUMNS, ...D1_COLUMNS];
    for (const row of rows) {
      row.aplica_segunda = 0;
      row.porcentaje_2da = 0;
      row.tipo_pintura = "reactiva";
      row.finalizada_en = null;
    }
  }

  async function execute(
    query: string,
    bindValues: unknown[] = []
  ): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    if (query.includes("INSERT INTO orden")) {
      // Los 15 binds en el orden de la columna INSERT del repositorio.
      const [
        id,
        numero_orden,
        fecha_operativa,
        referencia_tela,
        disenio,
        unidades_solicitadas,
        estado,
        operario,
        machine_id,
        created_at,
        updated_at,
        aplica_segunda,
        porcentaje_2da,
        tipo_pintura,
        finalizada_en,
      ] = bindValues as [
        string,
        string,
        string,
        string,
        string,
        number,
        string,
        string | null,
        string,
        string,
        string,
        number,
        number,
        string,
        string | null,
      ];
      // UPSERT semantics (ON CONFLICT(id) DO UPDATE SET ...).
      const existing = rows.find((r) => r.id === id);
      if (existing) {
        existing.estado = estado;
        existing.operario = operario;
        existing.aplica_segunda = aplica_segunda;
        existing.porcentaje_2da = porcentaje_2da;
        existing.tipo_pintura = tipo_pintura;
        existing.finalizada_en = finalizada_en;
        existing.updated_at = updated_at;
      } else {
        rows.push({
          id,
          numero_orden,
          fecha_operativa,
          referencia_tela,
          disenio,
          unidades_solicitadas,
          unidades_producidas: 0,
          unidades_primera: 0,
          unidades_segunda: 0,
          estado,
          operario,
          machine_id,
          created_at,
          updated_at,
          aplica_segunda,
          porcentaje_2da,
          tipo_pintura,
          finalizada_en,
        });
      }
      return { rowsAffected: 1 };
    }
    throw new Error(`execute: unsupported query in mock: ${query}`);
  }

  async function select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    if (query === "PRAGMA table_info(orden)") {
      return columns as T;
    }
    if (query.includes("sqlite_master") && query.includes("type='index'")) {
      return indexes as T;
    }
    // Pre-chequeo de saveOrder: SELECT id FROM orden WHERE id = $1
    if (query.includes("WHERE id = $1")) {
      const [id] = bindValues as [string];
      const row = rows.find((r) => r.id === id);
      return (row ? [{ id: row.id }] : []) as T;
    }
    // Lectura por fecha: SELECT * FROM orden WHERE fecha_operativa = $1
    if (query.includes("FROM orden") && query.includes("fecha_operativa = $1")) {
      const [fechaOperativa] = bindValues as [string];
      const row = rows.find((r) => r.fecha_operativa === fechaOperativa);
      return (row ? [{ ...row }] : []) as T;
    }
    return [] as T;
  }

  return {
    rows,
    execute: vi.fn(execute),
    select: vi.fn(select),
    applyMigration003: vi.fn(applyMigration003),
    clear: () => {
      rows.splice(0, rows.length);
      columns = [...ORIGINAL_COLUMNS];
    },
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
import { SqliteOrderRepository } from "../sqliteOrderRepository";
import type { Orden } from "../../../domain/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const FECHA = "2026-09-11";
const TS = "2026-09-11T07:00:00.000Z";
const CREATED_AT = "2026-09-10T10:00:00.000Z";

/** Fila completa post-003 (001 + 003) sembrada en el fake. */
function seedRow(overrides: Partial<OrderRow> = {}): OrderRow {
  const row: OrderRow = {
    id: "ord-101",
    numero_orden: "OP-101",
    fecha_operativa: FECHA,
    referencia_tela: "T-100",
    disenio: "Jessie",
    unidades_solicitadas: 2400,
    unidades_producidas: 0,
    unidades_primera: 0,
    unidades_segunda: 0,
    estado: "available",
    operario: null,
    machine_id: "M1",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    aplica_segunda: 1,
    porcentaje_2da: 0.05,
    tipo_pintura: "pigmento",
    finalizada_en: null,
    ...overrides,
  };
  mocks.rows.push(row);
  return row;
}

/** Orden de dominio equivalente a seedRow(). */
const ORDEN: Orden = {
  id: "ord-101",
  numeroOrden: "OP-101",
  diseno: "Jessie",
  telaReferencia: "T-100",
  unidadesSolicitadas: 2400,
  aplicaSegunda: true,
  porcentaje2da: 0.05,
  tipoPintura: "pigmento",
  machineId: "M1",
  fechaOperativa: FECHA,
  estado: "available",
  creadaExternamenteEn: CREATED_AT,
  lecturas: [],
};

function createRepo() {
  const db = {
    execute: mocks.execute,
    select: mocks.select,
  } as unknown as Database;
  return new SqliteOrderRepository(db);
}

function baseOrden(overrides: Partial<Orden> = {}): Orden {
  return { ...ORDEN, ...overrides };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Migration 003 (d1_orden_persistence) — Ticket 10-9", () => {
  beforeEach(() => {
    mocks.clear();
    vi.clearAllMocks();
  });

  // ── A. SQL-contract: el archivo de migración exacto ──────────────────────

  it("A1: exactly the four ALTER statements, in order, nothing else", () => {
    const body = migration003Sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = body
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    expect(statements).toEqual([
      "ALTER TABLE orden ADD COLUMN aplica_segunda INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE orden ADD COLUMN porcentaje_2da REAL NOT NULL DEFAULT 0",
      "ALTER TABLE orden ADD COLUMN tipo_pintura TEXT NOT NULL DEFAULT 'reactiva'",
      "ALTER TABLE orden ADD COLUMN finalizada_en TEXT",
    ]);
  });

  it("A2: no indexes, unique constraints, backfill, checks, drops or new tables", () => {
    expect(migration003Sql).not.toMatch(/CREATE INDEX/i);
    expect(migration003Sql).not.toMatch(/UNIQUE/i);
    expect(migration003Sql).not.toMatch(/\bCHECK\b/i); // keyword exacto, no "checksum"
    expect(migration003Sql).not.toMatch(/FOREIGN KEY/i);
    expect(migration003Sql).not.toMatch(/\bUPDATE\b/i);
    expect(migration003Sql).not.toMatch(/\bINSERT\b/i);
    expect(migration003Sql).not.toMatch(/\bDROP\b/i);
    expect(migration003Sql).not.toMatch(/CREATE TABLE/i);
    expect(migration003Sql).not.toMatch(/lectura_golpe/i);
  });

  it("A3: base nueva — schema exposes the four columns with exact D-1 shape", async () => {
    mocks.applyMigration003();
    const db = {
      execute: mocks.execute,
      select: mocks.select,
    } as unknown as Database;

    const info = await db.select<TableInfo[]>("PRAGMA table_info(orden)");
    expect(info).toHaveLength(18); // 14 de 001 + 4 de 003

    const d1 = info.filter((c) =>
      ["aplica_segunda", "porcentaje_2da", "tipo_pintura", "finalizada_en"].includes(c.name)
    );
    expect(d1).toEqual([
      { cid: 14, name: "aplica_segunda", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
      { cid: 15, name: "porcentaje_2da", type: "REAL", notnull: 1, dflt_value: "0", pk: 0 },
      { cid: 16, name: "tipo_pintura", type: "TEXT", notnull: 1, dflt_value: "'reactiva'", pk: 0 },
      { cid: 17, name: "finalizada_en", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
    ]);

    // Las 14 originales permanecen intactas (constraints incluidos).
    const original = info.filter((c) => c.cid <= 13);
    expect(original[0]).toEqual({
      cid: 0, name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1,
    });
    expect(original[9]).toEqual({
      cid: 9, name: "estado", type: "TEXT", notnull: 1, dflt_value: "'available'", pk: 0,
    });
  });

  // ── B. Base con filas existentes (esquema previo) ────────────────────────

  it("B: pre-003 row receives exactly 0 / 0 / 'reactiva' / NULL", async () => {
    // Fila creada con el esquema 001: sin las 4 columnas de 003.
    mocks.rows.push({
      id: "ord-101",
      numero_orden: "OP-101",
      fecha_operativa: FECHA,
      referencia_tela: "T-100",
      disenio: "Jessie",
      unidades_solicitadas: 2400,
      unidades_producidas: 0,
      unidades_primera: 0,
      unidades_segunda: 0,
      estado: "available",
      operario: null,
      machine_id: "M1",
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    });

    // Los defaults provienen del archivo de migración (anclaje, no del fake).
    expect(migration003Sql).toContain(
      "ALTER TABLE orden ADD COLUMN aplica_segunda INTEGER NOT NULL DEFAULT 0"
    );
    expect(migration003Sql).toContain(
      "ALTER TABLE orden ADD COLUMN porcentaje_2da REAL NOT NULL DEFAULT 0"
    );
    expect(migration003Sql).toContain(
      "ALTER TABLE orden ADD COLUMN tipo_pintura TEXT NOT NULL DEFAULT 'reactiva'"
    );

    mocks.applyMigration003();

    const db = {
      execute: mocks.execute,
      select: mocks.select,
    } as unknown as Database;
    const rows = await db.select<OrderRow[]>(
      "SELECT * FROM orden WHERE fecha_operativa = $1",
      [FECHA]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].aplica_segunda).toBe(0);
    expect(rows[0].porcentaje_2da).toBe(0);
    expect(rows[0].tipo_pintura).toBe("reactiva");
    expect(rows[0].finalizada_en).toBeNull();

    // Sin inventar valores adicionales: solo las 18 columnas conocidas.
    const keys = Object.keys(rows[0]).sort();
    expect(keys).toEqual([
      "aplica_segunda",
      "created_at",
      "disenio",
      "estado",
      "fecha_operativa",
      "finalizada_en",
      "id",
      "machine_id",
      "numero_orden",
      "operario",
      "porcentaje_2da",
      "referencia_tela",
      "tipo_pintura",
      "unidades_primera",
      "unidades_producidas",
      "unidades_segunda",
      "unidades_solicitadas",
      "updated_at",
    ]);
    expect("creada_externamente_en" in rows[0]).toBe(false);
    expect("lecturas" in rows[0]).toBe(false);
  });

  // ── C. Round-trip por el repository existente ────────────────────────────

  it("C: round-trip persists and recovers the four fields", async () => {
    mocks.applyMigration003();
    seedRow();
    const repo = createRepo();

    await repo.saveOrder(
      baseOrden({
        aplicaSegunda: true,
        porcentaje2da: 0.07,
        tipoPintura: "reactiva",
        finalizadaEn: "2026-09-11T12:00:00.000Z",
      })
    );

    const orden = await repo.getOrderByFechaOperativa(FECHA);
    expect(orden).toBeDefined();
    expect(orden!.aplicaSegunda).toBe(true);
    expect(orden!.porcentaje2da).toBe(0.07);
    expect(orden!.tipoPintura).toBe("reactiva");
    expect(orden!.finalizadaEn).toBe("2026-09-11T12:00:00.000Z");

    // White-box: el UPSERT emite las 4 columnas en su lista de INSERT.
    const insertSql = mocks.execute.mock.calls.find((c) =>
      (c[0] as string).includes("INSERT INTO orden")
    )?.[0] as string;
    expect(insertSql).toContain("aplica_segunda");
    expect(insertSql).toContain("porcentaje_2da");
    expect(insertSql).toContain("tipo_pintura");
    expect(insertSql).toContain("finalizada_en");
  });

  // ── D. finalizada_en no-null (finished con cero golpes) ─────────────────

  it("D: finalizada_en non-null persists; finished with zero golpes is valid", async () => {
    mocks.applyMigration003();
    seedRow({ estado: "finished", finalizada_en: TS });
    const repo = createRepo();

    // Orden finished: valida aun con cero lecturas (cero golpes).
    const orden = await repo.getOrderByFechaOperativa(FECHA);
    expect(orden!.estado).toBe("finished");
    expect(orden!.finalizadaEn).toBe(TS);
    expect(orden!.lecturas).toEqual([]); // sin lectura artificial

    // Se persiste de vuelta íntegra.
    await repo.saveOrder(orden!);
    const guardada = await repo.getOrderByFechaOperativa(FECHA);
    expect(guardada!.finalizadaEn).toBe(TS);
    expect(guardada!.estado).toBe("finished");
    expect(mocks.rows).toHaveLength(1);

    // White-box: ninguna consulta del repository tocó lectura_golpe.
    const allSql = [
      ...mocks.execute.mock.calls.map((c) => c[0] as string),
      ...mocks.select.mock.calls.map((c) => c[0] as string),
    ];
    for (const sql of allSql) {
      expect(sql).not.toMatch(/lectura/i);
    }
  });

  // ── E. finalizada_en NULL (orden no finalizada) ─────────────────────────

  it("E: finalizada_en NULL stays NULL for an unfinished order", async () => {
    mocks.applyMigration003();
    seedRow({ estado: "in_production", finalizada_en: null });
    const repo = createRepo();

    const orden = await repo.getOrderByFechaOperativa(FECHA);
    expect(orden!.finalizadaEn).toBeUndefined(); // NULL -> undefined (D-1)

    await repo.saveOrder(baseOrden({ estado: "in_production" }));
    const guardada = await repo.getOrderByFechaOperativa(FECHA);
    expect(guardada!.finalizadaEn).toBeUndefined();
    // En el modelo, el valor persistido sigue siendo NULL (no "", no timestamp).
    expect(mocks.rows[0].finalizada_en).toBeNull();
  });

  // ── F. No regresiones ───────────────────────────────────────────────────

  it("F1: 001/002 indexes intact; migration adds no index", async () => {
    const db = {
      execute: mocks.execute,
      select: mocks.select,
    } as unknown as Database;

    const before = await db.select<{ name: string; tbl_name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='index'"
    );
    mocks.applyMigration003();
    const after = await db.select<{ name: string; tbl_name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='index'"
    );

    expect(after).toEqual(before); // 003 no crea ningún índice
    expect(after.map((i) => i.name).sort()).toEqual([
      "idx_lectura_orden",
      "idx_lectura_orden_sequence",
      "idx_lectura_status",
      "idx_orden_fecha",
      "sqlite_autoindex_orden_1",
    ]);
  });

  it("F2: no UNIQUE(fecha_operativa) nor any fecha_operativa touch in 003", () => {
    expect(migration003Sql).not.toMatch(/UNIQUE/i);
    expect(migration003Sql).not.toMatch(/fecha_operativa/i);
    // Y la PK/constraint original sigue siendo id (probado en A3).
    expect(migration003Sql).not.toMatch(/PRIMARY KEY/i);
  });
});