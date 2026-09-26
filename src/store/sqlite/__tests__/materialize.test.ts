/**
 * Ticket 10.8 — Materialization Tests (spec A–E, J)
 *
 * These tests drive `SqliteOrderRepository.materializeOrder` (the SQLite
 * implementation of the evolved IOrderRepository) plus the composition function
 * `materializarPrograma` over a faithful in-memory fake of the plugin's
 * execute/select behavior for the EXACT statement patterns involved:
 *   - SELECT id FROM orden WHERE id = $1        (existence pre-check)
 *   - SELECT * FROM orden WHERE fecha_operativa = $1
 *   - INSERT INTO orden (15 columns) ... ON CONFLICT(id) DO NOTHING  (materializeOrder)
 *   - INSERT INTO orden (15 columns) ... ON CONFLICT(id) DO UPDATE ... (saveOrder, control)
 *
 * No plugin mock is needed: the repository imports the plugin type only.
 *
 * Test classification (10.8):
 * - Contract tests (A, D, E, J): observable state after materialization —
 *   insert vs no-op, idempotency, identity by `id`, nothing deleted.
 * - White-box tests (B, C): the existing row is preserved BYTE-WISE (no UPDATE
 *   is even emitted), estado is never reverted, and D-1 fields survive.
 *
 * HONESTY NOTE (10.8): these are unit tests against a controlled fake. They
 * prove the repository logic and the exact SQL emitted. They do NOT prove real
 * SQLite behavior (real ON CONFLICT semantics, rowsAffected shape, WAL): that
 * remains PENDING runtime validation.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import type Database from "@tauri-apps/plugin-sql";
import { materializarPrograma } from "../materialize";
import { SqliteOrderRepository } from "../sqliteOrderRepository";
import type { Orden } from "../../../domain/types";
import { FECHA_CON_ORDEN } from "../../fixtures";

// ── Fake de Database (mismo patrón que 10.4, con la rama DO NOTHING) ──────────

/** Fila de `orden`: 001 (14 columnas) + las 4 columnas 003 de D-1. */
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
  const statements: string[] = [];
  /** ids cuyo INSERT debe fallar (como si SQLite/plugin lo rechazara). */
  const failInserts = new Set<string>();

  async function execute(
    query: string,
    bindValues: unknown[] = []
  ): Promise<{ rowsAffected: number; lastInsertId?: number }> {
    statements.push(query);
    if (query.includes("INSERT INTO orden")) {
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
      if (failInserts.has(id)) {
        throw new Error("database is locked");
      }
      const existing = rows.find((r) => r.id === id);

      // ON CONFLICT(id) DO NOTHING (materializeOrder): la fila existente
      // queda INTACTA y la sentencia reporta rowsAffected 0.
      if (query.includes("DO NOTHING")) {
        if (existing) {
          return { rowsAffected: 0 };
        }
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
        return { rowsAffected: 1 };
      }

      // ON CONFLICT(id) DO UPDATE (saveOrder, solo como control en estas pruebas).
      if (existing) {
        existing.estado = estado;
        existing.operario = operario;
        existing.aplica_segunda = aplica_segunda;
        existing.porcentaje_2da = porcentaje_2da;
        existing.tipo_pintura = tipo_pintura;
        existing.finalizada_en = finalizada_en;
        existing.updated_at = updated_at;
        return { rowsAffected: 1 };
      }
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
      return { rowsAffected: 1 };
    }
    throw new Error(`execute: unsupported query in mock: ${query}`);
  }

  async function select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    // Pre-chequeo (saveOrder y materializeOrder): SELECT id FROM orden WHERE id = $1
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
    statements,
    failInserts,
    execute: vi.fn(execute),
    select: vi.fn(select),
    clear: () => {
      rows.splice(0, rows.length);
      statements.splice(0, statements.length);
      failInserts.clear();
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const CREATED_AT = "2026-09-10T10:00:00.000Z";
const TS = "2026-09-11T07:00:00.000Z";

/** Orden de dominio equivalente a la fila semilla (id ord-101). */
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
  fechaOperativa: FECHA_CON_ORDEN,
  estado: "available",
  creadaExternamenteEn: CREATED_AT,
  lecturas: [],
};

/** Siembra una fila con TODAS las columnas de 001 + 003 y la devuelve. */
function seedRow(overrides: Partial<MockRow> = {}): MockRow {
  const row: MockRow = {
    id: "ord-101",
    numero_orden: "OP-101",
    fecha_operativa: FECHA_CON_ORDEN,
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

function createRepo(): SqliteOrderRepository {
  const db = {
    execute: mocks.execute,
    select: mocks.select,
  } as unknown as Database;
  return new SqliteOrderRepository(db);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("materialización del programa — Ticket 10.8 (A–E, J)", () => {
  beforeEach(() => {
    mocks.clear();
    vi.clearAllMocks();
  });

  // ── A. Fuente externa + SQLite vacío ────────────────────────────────────

  it("A: SQLite vacío + fixture -> la orden se materializa y se lee por fecha", async () => {
    const repo = createRepo();
    const resultado = await materializarPrograma(repo, [ORDEN]);

    expect(resultado).toEqual({ insertadas: 1, existentes: 0 });
    expect(mocks.rows).toHaveLength(1);

    const guardada = await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN);
    expect(guardada).toBeDefined();
    expect(guardada!.id).toBe("ord-101");
    expect(guardada!.numeroOrden).toBe("OP-101");
    expect(guardada!.diseno).toBe("Jessie");
    expect(guardada!.telaReferencia).toBe("T-100");
    expect(guardada!.unidadesSolicitadas).toBe(2400);
    expect(guardada!.machineId).toBe("M1");
    // Estado exacto de la fuente externa: available, sin operario, sin 2da final.
    expect(guardada!.estado).toBe("available");
    expect(guardada!.operatorName).toBeUndefined();
    expect(guardada!.finalizadaEn).toBeUndefined();
    expect(guardada!.aplicaSegunda).toBe(true);
    expect(guardada!.porcentaje2da).toBe(0.05);
    expect(guardada!.tipoPintura).toBe("pigmento");
  });

  it("A: materialización persiste EXACTAMENTE las 15 columnas y nada más", async () => {
    const repo = createRepo();
    await repo.materializeOrder(ORDEN);

    const fila = mocks.rows[0];
    expect(Object.keys(fila).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(fila.operario).toBeNull(); // sin operario en la fuente
    expect(fila.finalizada_en).toBeNull(); // sin finalización
    // Repo-managed: created_at/updated_at los pone el repositorio.
    expect(fila.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fila.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // D-1: creadaExternamenteEn NUNCA se persiste; sin lecturas ni bases inventadas.
    expect("creada_externamente_en" in fila).toBe(false);
    const leida = await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN);
    expect(leida!.creadaExternamenteEn).toBeUndefined();
    expect(leida!.lecturas).toEqual([]);
    expect(leida!.iniciadaEn).toBeUndefined();
    expect(leida!.contadorBase).toBeUndefined();
  });

  it("A: una sola sentencia INSERT ... ON CONFLICT(id) DO NOTHING, sin transacciones", async () => {
    const repo = createRepo();
    await repo.materializeOrder(ORDEN);

    const inserts = mocks.statements.filter((s) => s.includes("INSERT INTO orden"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain("ON CONFLICT(id) DO NOTHING");
    expect(inserts[0]).not.toContain("DO UPDATE");
    expect(inserts[0]).not.toContain("INSERT OR REPLACE");
    expect(inserts[0]).not.toMatch(/\?/); // placeholders $N de SQLite
    // 15 columnas, 15 binds.
    expect(inserts[0]).toContain("VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)");
    const binds = mocks.execute.mock.calls[0][1] as unknown[];
    expect(binds).toHaveLength(15);
    // Nunca toca lectura_golpe ni transacciones.
    for (const sql of mocks.statements) {
      expect(sql).not.toMatch(/lectura/i);
      expect(sql).not.toMatch(/BEGIN|COMMIT|ROLLBACK/i);
    }
  });

  it("A: fuente externa vacía -> no inserta nada (día vacío)", async () => {
    const repo = createRepo();
    const resultado = await materializarPrograma(repo, []);

    expect(resultado).toEqual({ insertadas: 0, existentes: 0 });
    expect(mocks.rows).toHaveLength(0);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN)).toBeUndefined();
  });

  // ── B. La misma orden ya está en SQLite ────────────────────────────────

  it("B: orden ya presente -> materializeOrder devuelve false y la fila queda intacta byte a byte", async () => {
    const fila = seedRow({ estado: "in_production", operario: "Laura", updated_at: TS });
    const antes = structuredClone(fila);

    const repo = createRepo();
    const insertada = await repo.materializeOrder({ ...ORDEN, estado: "available" });

    expect(insertada).toBe(false);
    // Byte-wise: ni una columna cambió (no hubo UPDATE).
    expect(mocks.rows[0]).toEqual(antes);
    expect(mocks.rows[0].estado).toBe("in_production");
    expect(mocks.rows[0].updated_at).toBe(TS); // ni updated_at se tocó
    // Ni siquiera se emitió una escritura: el pre-chequeo alcanza.
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.select).toHaveBeenCalledWith(
      "SELECT id FROM orden WHERE id = $1",
      ["ord-101"]
    );
  });

  // ── C. Estado operativo preservado ──────────────────────────────────────

  it("C: estado operativo existente nunca se revierte por la materialización", async () => {
    // in_production
    const enProduccion = seedRow({ estado: "in_production", operario: "Laura" });
    // finished en otra fila
    const finalizada = seedRow({
      id: "ord-200",
      numero_orden: "OP-200",
      estado: "finished",
      finalizada_en: TS,
      aplica_segunda: 0,
      porcentaje_2da: 0,
      tipo_pintura: "reactiva",
    });
    const antes = structuredClone(enProduccion);
    const antesFinalizada = structuredClone(finalizada);

    const repo = createRepo();
    // La fuente externa trae 'available' para ambos ids: no debe ganar.
    await materializarPrograma(repo, [
      { ...ORDEN, estado: "available" },
      { ...ORDEN, id: "ord-200", numeroOrden: "OP-200", estado: "available" },
    ]);

    expect(mocks.rows[0]).toEqual(antes);
    expect(mocks.rows[0].estado).toBe("in_production");
    expect(mocks.rows[1]).toEqual(antesFinalizada);
    expect(mocks.rows[1].estado).toBe("finished");
  });

  it("C: finalizadaEn, aplicaSegunda, porcentaje2da y tipoPintura se preservan", async () => {
    seedRow({
      estado: "finished",
      finalizada_en: TS,
      operario: "Laura",
      aplica_segunda: 1,
      porcentaje_2da: 0.07,
      tipo_pintura: "reactiva",
    });

    const repo = createRepo();
    // La fuente externa NO trae esos datos: materializar no puede perderlos.
    await repo.materializeOrder({ ...ORDEN, estado: "available", finalizadaEn: undefined });

    const leida = await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN);
    expect(leida!.estado).toBe("finished");
    expect(leida!.finalizadaEn).toBe(TS);
    expect(leida!.aplicaSegunda).toBe(true);
    expect(leida!.porcentaje2da).toBe(0.07);
    expect(leida!.tipoPintura).toBe("reactiva");
    expect(leida!.operatorName).toBe("Laura");
  });

  // ── D. Idempotencia ─────────────────────────────────────────────────────

  it("D: materializarPrograma dos veces inserta una sola vez", async () => {
    const repo = createRepo();

    const primera = await materializarPrograma(repo, [ORDEN]);
    const segunda = await materializarPrograma(repo, [ORDEN]);

    expect(primera).toEqual({ insertadas: 1, existentes: 0 });
    expect(segunda).toEqual({ insertadas: 0, existentes: 1 });
    expect(mocks.rows).toHaveLength(1);

    // La segunda pasada no emite ninguna escritura ni duplica la fila.
    const inserts = mocks.statements.filter((s) => s.includes("INSERT INTO orden"));
    expect(inserts).toHaveLength(1);
  });

  it("D: fallo de una orden propaga y NO materializa las siguientes (fail-fast, sin éxito parcial)", async () => {
    const repo = createRepo();
    const segunda: Orden = { ...ORDEN, id: "ord-102", numeroOrden: "OP-102" };
    const tercera: Orden = { ...ORDEN, id: "ord-103", numeroOrden: "OP-103" };
    // La segunda escritura falla (como si SQLite/plugin la rechazara).
    mocks.failInserts.add("ord-102");

    await expect(
      materializarPrograma(repo, [ORDEN, segunda, tercera])
    ).rejects.toThrow('no se pudo materializar la orden "ord-102"');

    // La primera quedó insertada (idempotente para la próxima ejecución) y la
    // tercera NUNCA se intentó: el fallo aborta, no se sigue en silencio.
    expect(mocks.rows.map((r) => r.id)).toEqual(["ord-101"]);
    const selectsPorId = mocks.select.mock.calls.filter((c) =>
      (c[0] as string).includes("WHERE id = $1")
    );
    expect(selectsPorId).toHaveLength(2); // pre-chequeo de ord-102 abortó la iteración

    // Reintento idempotente: solo inserta lo que faltaba.
    mocks.failInserts.delete("ord-102");
    mocks.execute.mockClear();
    const reintento = await materializarPrograma(repo, [ORDEN, segunda, tercera]);
    expect(reintento).toEqual({ insertadas: 2, existentes: 1 });
    expect(mocks.rows.map((r) => r.id)).toEqual(["ord-101", "ord-102", "ord-103"]);
  });

  // ── E. Orden en SQLite ausente de la fuente ─────────────────────────────

  it("E: una orden en SQLite que no está en la fuente externa NUNCA se borra", async () => {
    seedRow({ id: "ord-999", numero_orden: "OP-999", fecha_operativa: "2026-09-20" });

    const repo = createRepo();
    const resultado = await materializarPrograma(repo, [ORDEN]);

    expect(resultado).toEqual({ insertadas: 1, existentes: 0 });
    expect(mocks.rows).toHaveLength(2);
    expect(mocks.rows.some((r) => r.id === "ord-999")).toBe(true);
    expect(await repo.getOrderByFechaOperativa("2026-09-20")).toBeDefined();
    // Materialización es INSERT-only: no emite DELETE ni UPDATE SET.
    for (const sql of mocks.statements) {
      expect(sql).not.toMatch(/DELETE|UPDATE SET/i);
    }
  });

  // ── J. Identidad por `id` ───────────────────────────────────────────────

  it("J: mismo id -> no-op (la identidad es el id, no el numeroOrden)", async () => {
    seedRow({ estado: "in_production" });
    const repo = createRepo();

    const insertada = await repo.materializeOrder({ ...ORDEN, estado: "available" });

    expect(insertada).toBe(false);
    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0].estado).toBe("in_production");
  });

  it("J: id diferente con el MISMO numeroOrden y fecha -> se inserta (comportamiento documentado, NO un blocker)", async () => {
    seedRow();
    const repo = createRepo();

    // Mismo negocio (numeroOrden + fecha operativa), id nuevo emitido por la
    // fuente externa: el esquema no declara UNIQUE en numero_orden ni en
    // fecha_operativa, así que se materializa como orden distinta. La
    // estabilidad de ids de la programación semanal es una decisión humana
    // pendiente, documentada en el spec 10.8 (fuera de alcance).
    const resultado = await materializarPrograma(repo, [
      ORDEN,
      { ...ORDEN, id: "ord-101-bis" },
    ]);

    expect(resultado).toEqual({ insertadas: 1, existentes: 1 });
    expect(mocks.rows.map((r) => r.id)).toEqual(["ord-101", "ord-101-bis"]);
    // getOrderByFechaOperativa devuelve rows[0]: con duplicados el día es
    // ambiguo (documentado, no resuelto en 10.8).
    const delDia = await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN);
    expect(delDia!.id).toBe("ord-101");
  });

  it("J: saveOrder NO crea órdenes (sin cambios) y materializeOrder sí — la materialización es la única vía de creación", async () => {
    const repo = createRepo();
    // saveOrder sobre una orden inexistente sigue lanzando (contrato intacto).
    await expect(repo.saveOrder(ORDEN)).rejects.toThrow(
      "no se puede guardar una orden inexistente: ord-101"
    );
    expect(mocks.execute).not.toHaveBeenCalled();

    // materializeOrder sí la crea.
    expect(await repo.materializeOrder(ORDEN)).toBe(true);
    expect(mocks.rows).toHaveLength(1);
  });
});
