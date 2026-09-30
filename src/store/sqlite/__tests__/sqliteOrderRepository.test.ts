/**
 * Ticket 10.4 — SqliteOrderRepository Tests
 *
 * The repository receives an already-initialized Database (ticket 10.1).
 * These tests run against a faithful in-memory fake of the plugin's
 * execute/select behavior for the EXACT query patterns the repository emits:
 *   - SELECT * FROM orden WHERE fecha_operativa = $1
 *   - SELECT id FROM orden WHERE id = $1            (saveOrder pre-check)
 *   - INSERT INTO orden ... ON CONFLICT(id) DO UPDATE SET ...
 *     (single atomic UPSERT; NO INSERT OR REPLACE; created_at NOT in SET)
 *
 * Test classification (10.4, same as 10.3):
 *   - Contract tests: drive the repository through its public interface and
 *     assert observable state (read/write round-trips, missing-id rejection).
 *   - White-box statement tests: assert the exact SQL/bindings the repository
 *     emits against the installed plugin API ($N placeholders, ON CONFLICT
 *     UPSERT, never lectura_golpe, no BEGIN/COMMIT/ROLLBACK).
 *   - Mapping tests: row <-> domain transforms, D-1 derivation rules
 *     (iniciadaEn/contadorBase derived; creadaExternamenteEn never fabricated).
 *   - Real-runtime tests: PENDING — the real sqlite engine, real plugin
 *     bindings and error shapes cannot run in this Termux-only environment.
 *
 * HONESTY NOTE (10.4): these are unit tests against a controlled fake. They
 * prove the repository logic (mapping, existence guard, error branches) and
 * the exact SQL the repo emits. They do NOT prove real SQLite/runtime
 * behavior. Those remain PENDING for real-runtime validation.
 *
 * Isolation: the repository is constructed with the fake Database directly;
 * the global singleton (database.ts) is never touched.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── In-memory fake (vi.hoisted is required for vi.mock factories) ────────────

/** Fila de `orden`: 001 (14 columnas) + columnas 003 de D-1 (4). */
interface MockRow {
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
  const rows: MockRow[] = [];

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
      // UPSERT semantics (faithful to ON CONFLICT(id) DO UPDATE SET ...):
      // existing id -> update ONLY the columns in the SET list; created_at
      // and the immutable identity columns are NOT overwritten.
      const existing = rows.find((r) => r.id === id);
      if (existing) {
        existing.estado = estado;
        existing.operario = operario;
        existing.aplica_segunda = aplica_segunda;
        existing.porcentaje_2da = porcentaje_2da;
        existing.tipo_pintura = tipo_pintura;
        existing.finalizada_en = finalizada_en;
        existing.updated_at = updated_at;
        // created_at preserved; numero_orden/fecha_operativa/etc. untouched.
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
  SqliteOrderRepository,
  derivarDeltaGolpes,
  mapOrdenRow,
  mapOrdenToSql,
} from "../sqliteOrderRepository";
import type { Orden } from "../../../domain/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

const FECHA = "2026-09-11";
const TS = "2026-09-11T07:00:00.000Z";
const CREATED_AT = "2026-09-10T10:00:00.000Z";

/** Fila base con TODAS las columnas de 001 + 003. */
function seedRow(overrides: Partial<MockRow> = {}): MockRow {
  const row: MockRow = {
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("SqliteOrderRepository — Ticket 10.4", () => {
  beforeEach(() => {
    mocks.clear();
    vi.clearAllMocks();
  });

  // ── getOrderByFechaOperativa ─────────────────────────────────────────────

  it("getOrderByFechaOperativa returns order when exists", async () => {
    seedRow({ operario: "Laura" });
    const repo = createRepo();
    const orden = await repo.getOrderByFechaOperativa(FECHA);

    expect(orden).toBeDefined();
    // Mapeo de TODAS las columnas 001.
    expect(orden!.id).toBe("ord-101");
    expect(orden!.numeroOrden).toBe("OP-101");
    expect(orden!.fechaOperativa).toBe(FECHA);
    expect(orden!.telaReferencia).toBe("T-100");
    expect(orden!.diseno).toBe("Jessie"); // disenio (typo 001) -> diseno
    expect(orden!.unidadesSolicitadas).toBe(2400);
    expect(orden!.estado).toBe("available");
    expect(orden!.operatorName).toBe("Laura"); // operario -> operatorName
    expect(orden!.machineId).toBe("M1");
    expect(orden!.lecturas).toEqual([]);
    // Columnas 003 de D-1.
    expect(orden!.aplicaSegunda).toBe(true);
    expect(orden!.porcentaje2da).toBe(0.05);
    expect(orden!.tipoPintura).toBe("pigmento");
    expect(orden!.finalizadaEn).toBeUndefined(); // NULL -> undefined
    // unidades_producidas/primera/segunda NO forman parte del contrato Orden.
    expect("unidadesProducidas" in orden!).toBe(false);
    // White-box: SELECT por fecha con placeholder $1.
    expect(mocks.select).toHaveBeenCalledWith(
      "SELECT * FROM orden WHERE fecha_operativa = $1",
      [FECHA]
    );
  });

  it("getOrderByFechaOperativa returns undefined when no order", async () => {
    const repo = createRepo();
    const orden = await repo.getOrderByFechaOperativa("2026-09-12");
    // Día sin orden: caso normal, NO un error.
    expect(orden).toBeUndefined();
    expect(mocks.select).toHaveBeenCalledWith(
      "SELECT * FROM orden WHERE fecha_operativa = $1",
      ["2026-09-12"]
    );
  });

  // ── saveOrder ───────────────────────────────────────────────────────────

  it("saveOrder persists an existing order", async () => {
    seedRow();
    const repo = createRepo();
    await repo.saveOrder({
      ...ORDEN,
      estado: "in_production",
      operatorName: "Laura",
    });

    const guardada = await repo.getOrderByFechaOperativa(FECHA);
    expect(guardada).toBeDefined();
    expect(guardada!.estado).toBe("in_production");
    expect(guardada!.operatorName).toBe("Laura");
    expect(guardada!.id).toBe("ord-101");
    expect(guardada!.diseno).toBe("Jessie");
    // UPSERT atómico en UNA sentencia (patrón 10.3).
    const insertCalls = mocks.execute.mock.calls.filter((c) =>
      (c[0] as string).includes("INSERT INTO orden")
    );
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][0]).toContain("ON CONFLICT(id)");
    expect(insertCalls[0][0]).not.toContain("INSERT OR REPLACE");
  });

  it("saveOrder persists estado", async () => {
    seedRow();
    const repo = createRepo();
    for (const estado of ["available", "in_production", "finished"] as const) {
      await repo.saveOrder({ ...ORDEN, estado });
      const guardada = await repo.getOrderByFechaOperativa(FECHA);
      expect(guardada!.estado).toBe(estado);
    }
    // Una sola fila: el UPSERT actualiza, nunca duplica.
    expect(mocks.rows).toHaveLength(1);
  });

  it("saveOrder persists D-1 fields", async () => {
    seedRow();
    const repo = createRepo();
    await repo.saveOrder({
      ...ORDEN,
      aplicaSegunda: true,
      porcentaje2da: 0.07,
      tipoPintura: "reactiva",
      finalizadaEn: "2026-09-11T12:00:00.000Z",
    });

    const guardada = await repo.getOrderByFechaOperativa(FECHA);
    expect(guardada!.aplicaSegunda).toBe(true);
    expect(guardada!.porcentaje2da).toBe(0.07);
    expect(guardada!.tipoPintura).toBe("reactiva");
    expect(guardada!.finalizadaEn).toBe("2026-09-11T12:00:00.000Z");

    // Y sin finalización: NULL -> undefined.
    await repo.saveOrder({ ...ORDEN, finalizadaEn: undefined });
    const sinFin = await repo.getOrderByFechaOperativa(FECHA);
    expect(sinFin!.finalizadaEn).toBeUndefined();
  });

  it("saveOrder throws when the order id does not exist", async () => {
    // Sin seed: el id no existe en la tabla.
    const repo = createRepo();
    const fantasma: Orden = { ...ORDEN, id: "orden-fantasma" };

    await expect(repo.saveOrder(fantasma)).rejects.toThrow(
      "no se puede guardar una orden inexistente: orden-fantasma"
    );
    // Misma semántica que InMemory: esta interfaz NO crea órdenes.
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.rows).toHaveLength(0);
  });

  // ── Mapping ─────────────────────────────────────────────────────────────

  it("mapping function transforms row correctly", () => {
    const row: MockRow = {
      id: "ord-101",
      numero_orden: "OP-101",
      fecha_operativa: FECHA,
      referencia_tela: "T-100",
      disenio: "Jessie",
      unidades_solicitadas: 2400,
      unidades_producidas: 999, // ignorado: fuera del contrato Orden
      unidades_primera: 999,
      unidades_segunda: 999,
      estado: "finished",
      operario: "Laura",
      machine_id: "M1",
      created_at: CREATED_AT,
      updated_at: TS,
      aplica_segunda: 1,
      porcentaje_2da: 0.07,
      tipo_pintura: "reactiva",
      finalizada_en: TS,
    };
    const orden = mapOrdenRow(row);

    expect(orden.id).toBe("ord-101");
    expect(orden.numeroOrden).toBe("OP-101");
    expect(orden.fechaOperativa).toBe(FECHA);
    expect(orden.telaReferencia).toBe("T-100");
    expect(orden.diseno).toBe("Jessie"); // disenio -> diseno
    expect(orden.unidadesSolicitadas).toBe(2400);
    expect(orden.estado).toBe("finished");
    expect(orden.operatorName).toBe("Laura"); // operario -> operatorName
    expect(orden.machineId).toBe("M1");
    // Las 4 columnas D-1 (003).
    expect(orden.aplicaSegunda).toBe(true); // 1 -> true
    expect(orden.porcentaje2da).toBe(0.07);
    expect(orden.tipoPintura).toBe("reactiva");
    expect(orden.finalizadaEn).toBe(TS); // NULL -> undefined (probado abajo)
    expect(orden.lecturas).toEqual([]);
    expect(mapOrdenRow({ ...row, aplica_segunda: 0, finalizada_en: null }).aplicaSegunda).toBe(false);
    expect(mapOrdenRow({ ...row, finalizada_en: null }).finalizadaEn).toBeUndefined();
    // Unidades derivadas de 001: ignoradas, sin reglas nuevas.
    expect("unidadesProducidas" in orden).toBe(false);
  });

  it("mapping function transforms order correctly", () => {
    const values = mapOrdenToSql({
      ...ORDEN,
      operatorName: "Laura",
      finalizadaEn: "2026-09-11T12:00:00.000Z",
    });

    // Las 15 columnas persistidas.
    expect(values).toMatchObject({
      id: "ord-101",
      numero_orden: "OP-101",
      fecha_operativa: FECHA,
      referencia_tela: "T-100",
      disenio: "Jessie", // diseno -> disenio (typo 001 conservado)
      unidades_solicitadas: 2400,
      estado: "available",
      operario: "Laura",
      machine_id: "M1",
      aplica_segunda: 1, // true -> 1
      porcentaje_2da: 0.05,
      tipo_pintura: "pigmento",
      finalizada_en: "2026-09-11T12:00:00.000Z",
    });
    // Repo-managed: ISO 8601 en ambos.
    expect(typeof values.created_at).toBe("string");
    expect(typeof values.updated_at).toBe("string");
    expect(values.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Nullables: sin operario/finalización -> null (no undefined, no "").
    const sinOpcionales = mapOrdenToSql(ORDEN);
    expect(sinOpcionales.operario).toBeNull();
    expect(sinOpcionales.finalizada_en).toBeNull();
    expect(mapOrdenToSql({ ...ORDEN, aplicaSegunda: false, porcentaje2da: 0 }).aplica_segunda).toBe(0);
    // Nunca toca lecturas ni creadaExternamenteEn.
    expect("lecturas" in values).toBe(false);
    expect("creada_externamente_en" in values).toBe(false);
  });

  it("mapping derives iniciadaEn/contadorBase from first lectura when supplied", () => {
    const row = seedRow();
    const lecturas = [
      { valor: 100, timestamp: TS, deltaGolpes: 0 },
      { valor: 106, timestamp: "2026-09-11T08:00:00.000Z", deltaGolpes: 6 },
    ];

    const orden = mapOrdenRow(row, lecturas);
    expect(orden.iniciadaEn).toBe(TS); // lecturas[0].timestamp
    expect(orden.contadorBase).toBe(100); // lecturas[0].valor
    expect(orden.lecturas).toEqual(lecturas);

    // G2 / CORRECTION 11: con la proyección RAW del repo (placeholder 0) la
    // composición reconstruye los deltas en vez de propagar el placeholder.
    const raw = [
      { valor: 100, timestamp: TS, deltaGolpes: 0 },
      { valor: 106, timestamp: "2026-09-11T08:00:00.000Z", deltaGolpes: 0 },
    ];
    expect(mapOrdenRow(row, raw).lecturas.map((l) => l.deltaGolpes)).toEqual([0, 6]);

    // Sin lecturas provistas (lectura directa): los campos quedan undefined.
    const sinLecturas = mapOrdenRow(row);
    expect(sinLecturas.iniciadaEn).toBeUndefined();
    expect(sinLecturas.contadorBase).toBeUndefined();
  });

  it("mapping never reconstructs creadaExternamenteEn", () => {
    const row = seedRow();
    const orden = mapOrdenRow(row, [
      { valor: 100, timestamp: TS, deltaGolpes: 0 },
    ]);

    // D-1: nunca se fabrica "" ni null ni timestamp ni se deriva de created_at.
    expect(orden.creadaExternamenteEn).toBeUndefined();
    expect(orden.creadaExternamenteEn).not.toBe("");
    expect(orden.creadaExternamenteEn).not.toBe(row.created_at);
    expect("creadaExternamenteEn" in orden).toBe(false);
    // Tampoco desde el lado SQL.
    expect("creada_externamente_en" in mapOrdenToSql(ORDEN)).toBe(false);
  });

  // ── derivarDeltaGolpes — recomputación de deltas (G2 / CORRECTION 11) ────

  describe("derivarDeltaGolpes — deltas desde valores absolutos", () => {
    it("vacío y una sola lectura: base con deltaGolpes 0", () => {
      expect(derivarDeltaGolpes([])).toEqual([]);
      expect(derivarDeltaGolpes([{ valor: 100, timestamp: TS, deltaGolpes: 0 }])).toEqual([
        { valor: 100, timestamp: TS, deltaGolpes: 0 },
      ]);
    });

    it("valores crecientes: delta = valor - anterior; primera base 0", () => {
      const derivadas = derivarDeltaGolpes([
        { valor: 100, timestamp: TS, deltaGolpes: 0 },
        { valor: 106, timestamp: "2026-09-11T08:00:00.000Z", deltaGolpes: 0 },
        { valor: 112, timestamp: "2026-09-11T09:00:00.000Z", deltaGolpes: 0 },
      ]);
      expect(derivadas.map((l) => l.deltaGolpes)).toEqual([0, 6, 6]);
    });

    it("valores iguales: deltaGolpes 0 (sinIncremento)", () => {
      const derivadas = derivarDeltaGolpes([
        { valor: 100, timestamp: TS, deltaGolpes: 0 },
        { valor: 100, timestamp: "2026-09-11T08:00:00.000Z", deltaGolpes: 0 },
      ]);
      expect(derivadas.map((l) => l.deltaGolpes)).toEqual([0, 0]);
    });

    it("retroceso (fuente corrupta): PROPAGA la invariante, nunca inventa producción", () => {
      expect(() =>
        derivarDeltaGolpes([
          { valor: 106, timestamp: TS, deltaGolpes: 0 },
          { valor: 100, timestamp: "2026-09-11T08:00:00.000Z", deltaGolpes: 0 },
        ])
      ).toThrow("el contador no puede retroceder");
    });

    it("idempotente sobre lecturas ya derivadas y nunca muta la entrada", () => {
      const originales = [
        { valor: 100, timestamp: TS, deltaGolpes: 0 },
        { valor: 106, timestamp: "2026-09-11T08:00:00.000Z", deltaGolpes: 6 },
      ];
      const unaVez = derivarDeltaGolpes(originales);
      expect(unaVez).toEqual(originales);
      expect(derivarDeltaGolpes(unaVez)).toEqual(unaVez);
      expect(originales[1]!.deltaGolpes).toBe(6); // entrada intacta
    });
  });

  // ── White-box: lecturas jamás escritas ──────────────────────────────────

  it("saveOrder never writes lecturas", async () => {
    seedRow();
    const repo = createRepo();
    await repo.saveOrder({ ...ORDEN, estado: "in_production" });

    expect(mocks.execute.mock.calls.length).toBeGreaterThan(0);
    for (const [sql] of mocks.execute.mock.calls) {
      expect(sql).toContain("INTO orden");
      expect(sql).not.toMatch(/lectura/i);
    }
    for (const [sql] of mocks.select.mock.calls) {
      expect(sql).not.toMatch(/lectura/i);
    }
    // Sin transacciones desde JavaScript (patrón 10.3).
    const allSql = [
      ...mocks.execute.mock.calls.map((c) => c[0] as string),
      ...mocks.select.mock.calls.map((c) => c[0] as string),
    ];
    for (const sql of allSql) {
      expect(sql).not.toMatch(/BEGIN|COMMIT|ROLLBACK/i);
    }
  });

  // ── created_at preservado ───────────────────────────────────────────────

  it("created_at preserved on update", async () => {
    seedRow({ created_at: CREATED_AT, estado: "in_production" });
    const repo = createRepo();
    await repo.saveOrder({ ...ORDEN, estado: "finished", operatorName: "Laura" });

    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0].created_at).toBe(CREATED_AT); // NO sobrescrito
    expect(mocks.rows[0].estado).toBe("finished");
    expect(mocks.rows[0].updated_at).not.toBe(CREATED_AT); // updated_at SÍ cambia

    // White-box: created_at no figura en la lista SET del UPSERT.
    const insertSql = mocks.execute.mock.calls.find((c) =>
      (c[0] as string).includes("INSERT INTO orden")
    )?.[0] as string;
    expect(insertSql).toContain("ON CONFLICT(id)");
    expect(insertSql).toContain("DO UPDATE SET");
    expect(insertSql).not.toContain("created_at = excluded.created_at");
    expect(insertSql).not.toContain("INSERT OR REPLACE");
    expect(insertSql).not.toMatch(/\?/); // placeholders $N de SQLite
  });

  // ── Fallos del plugin ───────────────────────────────────────────────────

  it("plugin failure -> descriptive error with cause", async () => {
    seedRow();
    mocks.execute.mockRejectedValueOnce(new Error("database is locked"));
    const repo = createRepo();

    const err = await repo.saveOrder(ORDEN).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(
      'no se pudo persistir la orden "ord-101"'
    );
    // La causa original se conserva (Error cause chain, patrón 10.3).
    if ("cause" in (err as Error)) {
      expect((err as Error).cause).toEqual(
        expect.objectContaining({ message: "database is locked" })
      );
    }
    // La fila existente no cambió (la escritura fue rechazada).
    expect(mocks.rows[0].estado).toBe("available");
  });
});
