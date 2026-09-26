/**
 * Ticket 10.4 — SqliteOrderRepository
 *
 * SQLite implementation of IOrderRepository. Persists the production order
 * and its execution state (estado + D-1 fields) across restarts, following
 * the pattern established by SqliteJornadaRepository (ticket 10.3).
 *
 * Async contract: IOrderRepository is async (debt from 10.2, paid in 10.4).
 * The plugin's execute/select return Promises; this repo implements the
 * async interface.
 *
 * Tables (migration 001 UNTOUCHED + migration 003 columns decided by D-1,
 * NOT implemented by this ticket — they must exist at runtime):
 *   orden(id, numero_orden, fecha_operativa, referencia_tela, disenio,
 *         unidades_solicitadas, unidades_producidas, unidades_primera,
 *         unidades_segunda, estado, operario, machine_id, created_at,
 *         updated_at [, aplica_segunda, porcentaje_2da, tipo_pintura,
 *         finalizada_en])
 *
 * Design decisions:
 * - getOrderByFechaOperativa(fecha):
 *     1. SELECT * FROM orden WHERE fecha_operativa = $1;
 *     2. no row -> undefined (a day without order is normal, NOT an error);
 *     3. row -> mapOrdenRow(row) — maps ONLY columns that exist in 001+003;
 *     4. lecturas are NEVER queried here (lectura_golpe belongs to
 *        ILecturaGolpeRepository, tickets 10.5/10.6). The 10.8 composition
 *        supplies persisted lecturas so the mapper can derive
 *        iniciadaEn / contadorBase from lecturas[0].
 * - saveOrder(orden):
 *     1. existence pre-check: SELECT id FROM orden WHERE id = $1; absent ->
 *        descriptive error (same semantic as InMemoryOrderRepository: this
 *        interface does NOT create orders);
 *     2. ONE single atomic UPSERT statement (pattern 10.3):
 *          INSERT INTO orden (15 persisted columns) VALUES ($1..$15)
 *          ON CONFLICT(id) DO UPDATE SET estado, operario, aplica_segunda,
 *            porcentaje_2da, tipo_pintura, finalizada_en,
 *            updated_at = excluded.updated_at
 *        created_at is NOT in the SET list -> preserved on update; it is
 *        bound only so the dead INSERT branch is valid SQL.
 *        NO INSERT OR REPLACE; no BEGIN/COMMIT (single atomic write).
 *     3. NEVER touches lectura_golpe — lecture writes belong to 10.5/10.6;
 *     4. does NOT calculate deltaGolpes, progreso, tiempo, nor estado —
 *        the domain owns all derivation and transition rules;
 *     5. plugin rejection -> descriptive error with the original cause
 *        (Error cause chain, pattern 10.3).
 * - materializeOrder(orden) (added in 10.8, saveOrder UNCHANGED): existence
 *     pre-check by `id`; present -> no-op returning false; absent -> ONE single
 *     atomic INSERT ... ON CONFLICT(id) DO NOTHING of the same 15 columns
 *     (mapOrdenToSql). INSERT-only by construction: it can never update an
 *     existing row, never change estado, never recreate an order, and never
 *     persists lecturas, creadaExternamenteEn, iniciadaEn or contadorBase.
 * - D-1 persistence: aplica_segunda / porcentaje_2da / tipo_pintura /
 *   finalizada_en ARE persisted; iniciadaEn / contadorBase are DERIVED from
 *   the supplied lecturas[0]; creadaExternamenteEn is NEVER persisted,
 *   NEVER reconstructed and NEVER fabricated (stays undefined on read).
 * - unidades_producidas / unidades_primera / unidades_segunda exist in 001
 *   but are NOT part of the domain Orden contract: ignored by the mapping.
 * - Placeholders: SQLite uses $1/$2/... (pattern 10.3 / 10.5).
 */

import type Database from "@tauri-apps/plugin-sql";
import type {
  EstadoOrden,
  LecturaContador,
  Orden,
  TipoPintura,
} from "../../domain/types";
import type { IOrderRepository } from "../repository";

/** Fila SQL de `orden` (projection de lectura: 001 + columnas 003 de D-1). */
export interface OrdenRow {
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
  // Migration 003 columns (decided by D-1; must exist at runtime; NOT
  // created by this ticket).
  aplica_segunda: number;
  porcentaje_2da: number;
  tipo_pintura: string;
  finalizada_en: string | null;
}

/**
 * Columnas persistidas por saveOrder (15): las 001 salvo las unidades
 * derivadas (producidas/primera/segunda) + las 4 columnas 003 de D-1.
 */
export interface OrdenSqlValues {
  id: string;
  numero_orden: string;
  fecha_operativa: string;
  referencia_tela: string;
  disenio: string;
  unidades_solicitadas: number;
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

/**
 * SQL Row → TypeScript. Maps ONLY real columns (001 + 003). Returns a NEW
 * object; the row is never reused.
 *
 * - Derives iniciadaEn/contadorBase from lecturas[0] when the 10.8
 *   composition supplies persisted lecturas; without them both stay
 *   undefined (no columns exist for them).
 * - NEVER reconstructs creadaExternamenteEn (D-1: out of persistence) and
 *   NEVER fabricates values for absent fields.
 * - unidades_producidas/unidades_primera/unidades_segunda: ignored (not part
 *   of the domain Orden contract; production is derived from lecturas).
 */
export function mapOrdenRow(
  row: OrdenRow,
  lecturas: LecturaContador[] = []
): Orden {
  return {
    id: row.id,
    numeroOrden: row.numero_orden,
    diseno: row.disenio,
    telaReferencia: row.referencia_tela,
    unidadesSolicitadas: row.unidades_solicitadas,
    aplicaSegunda: row.aplica_segunda === 1,
    porcentaje2da: row.porcentaje_2da,
    tipoPintura: row.tipo_pintura as TipoPintura,
    machineId: row.machine_id as "M1",
    fechaOperativa: row.fecha_operativa,
    estado: row.estado as EstadoOrden,
    iniciadaEn: lecturas[0]?.timestamp,
    finalizadaEn: row.finalizada_en ?? undefined,
    operatorName: row.operario ?? undefined,
    contadorBase: lecturas[0]?.valor,
    lecturas,
    // creadaExternamenteEn intentionally absent (D-1: never fabricated).
  };
}

/**
 * TypeScript → SQL values for the 15 persisted columns.
 *
 * - disenio receives orden.diseno (001 column typo kept as-is);
 * - aplica_segunda = orden.aplicaSegunda ? 1 : 0;
 * - operario = orden.operatorName ?? null; finalizada_en = orden.finalizadaEn ?? null;
 * - created_at/updated_at are repo-managed: created_at is bound only for
 *   the dead INSERT branch (never in the UPDATE SET list), updated_at is
 *   set on every save.
 * - Does not touch creadaExternamenteEn, lecturas, deltas, progreso, tiempo.
 */
export function mapOrdenToSql(orden: Orden): OrdenSqlValues {
  const now = new Date().toISOString();
  return {
    id: orden.id,
    numero_orden: orden.numeroOrden,
    fecha_operativa: orden.fechaOperativa,
    referencia_tela: orden.telaReferencia,
    disenio: orden.diseno,
    unidades_solicitadas: orden.unidadesSolicitadas,
    estado: orden.estado,
    operario: orden.operatorName ?? null,
    machine_id: orden.machineId,
    created_at: now,
    updated_at: now,
    aplica_segunda: orden.aplicaSegunda ? 1 : 0,
    porcentaje_2da: orden.porcentaje2da,
    tipo_pintura: orden.tipoPintura,
    finalizada_en: orden.finalizadaEn ?? null,
  };
}

export class SqliteOrderRepository implements IOrderRepository {
  constructor(private db: Database) {}

  /**
   * Devuelve la orden de la fecha operativa, o undefined si ese día no tiene
   * orden (día vacío: caso normal, NO un error).
   * @throws Si SQLite/plugin rechaza la lectura (el error original propaga).
   */
  async getOrderByFechaOperativa(
    fechaOperativa: string
  ): Promise<Orden | undefined> {
    // Las lecturas NO se consultan aquí (10.5/10.6 son dueños de
    // lectura_golpe): la composición 10.8 las provee ordenadas por sequence.
    const rows = await this.db.select<OrdenRow[]>(
      "SELECT * FROM orden WHERE fecha_operativa = $1",
      [fechaOperativa]
    );
    if (rows.length === 0) {
      return undefined;
    }
    return mapOrdenRow(rows[0]);
  }

  /**
   * Persiste el progreso de una orden YA EXISTENTE (UPSERT atómico por id).
   * @throws Si el id no existe (esta interfaz no crea órdenes: mismo
   *         semántica/mensaje que InMemoryOrderRepository), o si SQLite/plugin
   *         rechaza la escritura (error descriptivo con la causa original).
   */
  async saveOrder(orden: Orden): Promise<void> {
    // 1. Pre-chequeo de existencia: esta interfaz nunca crea órdenes.
    const existentes = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM orden WHERE id = $1",
      [orden.id]
    );
    if (existentes.length === 0) {
      throw new Error(`no se puede guardar una orden inexistente: ${orden.id}`);
    }

    // 2. UNA sola sentencia UPSERT atómica (patrón 10.3). created_at no
    //    figura en el SET: se preserva en el update.
    const v = mapOrdenToSql(orden);
    try {
      await this.db.execute(
        `INSERT INTO orden (id, numero_orden, fecha_operativa, referencia_tela,
           disenio, unidades_solicitadas, estado, operario, machine_id,
           created_at, updated_at, aplica_segunda, porcentaje_2da,
           tipo_pintura, finalizada_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT(id) DO UPDATE SET
           estado = excluded.estado,
           operario = excluded.operario,
           aplica_segunda = excluded.aplica_segunda,
           porcentaje_2da = excluded.porcentaje_2da,
           tipo_pintura = excluded.tipo_pintura,
           finalizada_en = excluded.finalizada_en,
           updated_at = excluded.updated_at`,
        [
          v.id,
          v.numero_orden,
          v.fecha_operativa,
          v.referencia_tela,
          v.disenio,
          v.unidades_solicitadas,
          v.estado,
          v.operario,
          v.machine_id,
          v.created_at,
          v.updated_at,
          v.aplica_segunda,
          v.porcentaje_2da,
          v.tipo_pintura,
          v.finalizada_en,
        ]
      );
    } catch (error) {
      // Error descriptivo con contexto, conservando la causa original.
      throw new Error(`no se pudo persistir la orden "${orden.id}"`, {
        cause: error,
      });
    }
    // 3. NUNCA escribe lectura_golpe; 4. no deriva deltas/progreso/tiempo/estado.
  }

  /**
   * Materialización de la fuente externa (ticket 10.8): asegura que la orden
   * EXISTA, y solo si falta. `id` (PK) es la identidad.
   *
   * - pre-chequeo `SELECT id FROM orden WHERE id = $1`: si existe -> false
   *   (no-op absoluto: ni INSERT, ni UPDATE; el estado persistido manda);
   * - si no existe -> UNA sola sentencia atómica (patrón 10.3, sin
   *   BEGIN/COMMIT) `INSERT ... ON CONFLICT(id) DO NOTHING`. El DO NOTHING es
   *   la barrera final: ni siquiera bajo una carrera puede tocar una fila
   *   existente (misma filosofía que UNIQUE(orden_id, sequence) en 10.5).
   * - persiste las mismas 15 columnas que saveOrder (mapOrdenToSql) y NADA
   *   más: sin lecturas, sin creadaExternamenteEn, sin iniciadaEn/contadorBase
   *   (no hay columnas y no se inventan). Crea solo la fila `orden`.
   * - NO toca el estado de órdenes ya existentes: no puede revertir
   *   in_production/finished, ni perder finalizada_en/aplica_segunda/
   *   porcentaje_2da/tipo_pintura.
   *
   * @returns true si insertó, false si la orden ya existía.
   * @throws Si SQLite/plugin rechaza la escritura (error descriptivo con la
   *         causa original). El error propaga: nunca se traga un fallo.
   */
  async materializeOrder(orden: Orden): Promise<boolean> {
    // 1. Pre-chequeo de existencia: la fila existente es intocable.
    const existentes = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM orden WHERE id = $1",
      [orden.id]
    );
    if (existentes.length > 0) {
      return false;
    }

    // 2. UNA sola sentencia INSERT-only (patrón 10.3). created_at/updated_at
    //    los gestiona el repositorio; finalizada_en llega null desde el fixture.
    const v = mapOrdenToSql(orden);
    try {
      const result = await this.db.execute(
        `INSERT INTO orden (id, numero_orden, fecha_operativa, referencia_tela,
           disenio, unidades_solicitadas, estado, operario, machine_id,
           created_at, updated_at, aplica_segunda, porcentaje_2da,
           tipo_pintura, finalizada_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT(id) DO NOTHING`,
        [
          v.id,
          v.numero_orden,
          v.fecha_operativa,
          v.referencia_tela,
          v.disenio,
          v.unidades_solicitadas,
          v.estado,
          v.operario,
          v.machine_id,
          v.created_at,
          v.updated_at,
          v.aplica_segunda,
          v.porcentaje_2da,
          v.tipo_pintura,
          v.finalizada_en,
        ]
      );
      // rowsAffected 1 = insertó; 0 = el DO NOTHING de la barrera final saltó
      // la sentencia (fila creada por otra materialización entre el pre-chequeo
      // y el INSERT). Ambos casos son correctos: nunca se actualizó nada.
      return result.rowsAffected >= 1;
    } catch (error) {
      throw new Error(
        `no se pudo materializar la orden "${orden.id}"`,
        { cause: error }
      );
    }
  }
}
