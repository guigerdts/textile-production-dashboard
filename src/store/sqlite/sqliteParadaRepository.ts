/**
 * WHAT THIS IS
 * ============
 * `SqliteParadaRepository` — the durable SQLite adapter for `IParadaRepository`
 * (Phase 2, Unit B2). It stores paradas in the `parada` table of migrations
 * 004+005 (10 columns) and implements the same port contract as
 * `InMemoryParadaRepository`: insert vs update explicit, pre-check + one
 * statement (D2j), chronological order by `inicio` for listados, a
 * null-safe `getParadaAbierta` bound to machine + optional order, and a
 * machine-scoped `getParadaAbiertaDeMaquina` that ignores both the order and
 * the operative day to answer the machine's current operational state (OQ-4).
 *
 * WHAT THIS IS NOT
 * ================
 * NOT a place for domain rules. Business validation (causa requerida, campos
 * específicos, "otro" exige observación, una sola parada abierta por
 * máquina+orden) lives in `src/domain/paradas.ts` and runs BEFORE this
 * adapter is reached. This file only maps Parada <-> row and persists. The
 * catálogo of 10 causas below is a type-protection channel guard (D2c/E2): a
 * corrupted TEXT never disguises itself as a `CausaParadaId` — it fails the
 * mapping loudly, with cause. It is NOT the business rule about which campos
 * a causa requires; that rule never runs here.
 *
 * D1 — vocabulary lives in the mapper only: `machine_id` <-> `maquinaId`,
 * `operario` <-> `operatorName`, `orden_id` <-> `ordenId`,
 * `causa_id` <-> `causaId`, `campos_especificos` <-> `camposEspecificos`.
 * Nowhere else in the adapter does the SQL column name leak into the domain.
 *
 * D2j — every write is pre-check + exactly one statement: a
 * `SELECT id FROM parada WHERE id = $1` answers existence, then the single
 * INSERT/UPDATE runs. `id` appears in `WHERE` only, never in SET. No
 * BEGIN/COMMIT, no transactions, no upserts (SQLite RESULT_CONSTRAINT would
 * refuse without giving us the human message the in-memory port owns).
 *
 * D2d — closes in place. The `close()` of the consumed connection is a
 * storage-boundary concern; nothing here keeps a second reference. (The
 * honesty note in the suite pins this.)
 *
 * The `campos_especificos` JSON TEXT check is the same shape the design
 * prescribes for `parada`: `JSON.stringify` on the way in, `JSON.parse` on
 * the way out; invalid JSON is a mapping error with cause, never a silent
 * `{}`.
 *
 * HONESTY NOTE (D2d): migration 004 creates `parada` with all 9 columns NOT
 * NULL except `orden_id`, `observaciones`, and `fin`. The adapter preserves
 * that nullability exactly: a parada without an order keeps `orden_id NULL`
 * (three-valued `=` would never match it in `listarPorOrden`, matching the
 * in-memory port), and `getParadaAbierta` uses the null-safe `IS $2` binder
 * so its second parameter may legitimately be `null`.
 */
import type Database from "@tauri-apps/plugin-sql";
import type { CausaParadaId, Parada, ParadaAbierta } from "../../domain/types";
import type { IParadaRepository } from "../paradasRepository";

// ---------------------------------------------------------------------------
// Mapeo puro Parada <-> fila SQL
// ---------------------------------------------------------------------------

/**
 * Fila de la tabla `parada`: 10 columnas, nullabilidad DDL.
 *
 * `fecha_operativa` (migración 005) es NOT NULL y sin DEFAULT: el día al que
 * pertenece la parada es un dato persistido, nunca derivado de `inicio`.
 */
export interface ParadaRow {
  id: string;
  machine_id: "M1";
  orden_id: string | null;
  operario: string;
  causa_id: string;
  /** JSON TEXT: los campos específicos de la causa, stringificados. */
  campos_especificos: string;
  observaciones: string | null;
  inicio: string;
  fin: string | null;
  fecha_operativa: string;
}

/** Valores ligados de un INSERT/UPDATE: `campos_especificos` ya es JSON text. */
export interface ParadaSqlValues {
  id: string;
  machine_id: "M1";
  orden_id: string | null;
  operario: string;
  causa_id: CausaParadaId;
  campos_especificos: string;
  observaciones: string | null;
  inicio: string;
  fin: string | null;
  fecha_operativa: string;
}

/** Catálogo de las 10 causas: guardia del canal, no regla de negocio (E2). */
const CAUSAS_CONOCIDAS: ReadonlySet<string> = new Set([
  "falta_color",
  "rotura_cuadro",
  "atasco_tela",
  "danio_mecanico",
  "danio_electrico",
  "ajuste_registro",
  "problema_horno",
  "falta_tela",
  "cambio_diseno_no_planificado",
  "otro",
]);

function errorDeMapeo(paradaId: string, causa: unknown): Error {
  const mensaje = causa instanceof Error ? causa.message : String(causa);
  return new Error(`no se pudo mapear la parada "${paradaId}": ${mensaje}`, {
    cause: causa,
  });
}

/** Valida el `causa_id` textual contra el catálogo; falla en voz alta si no. */
function causaParadaRow(paradaId: string, causaId: string): CausaParadaId {
  if (!CAUSAS_CONOCIDAS.has(causaId)) {
    throw errorDeMapeo(
      paradaId,
      `causa_id desconocido: "${causaId}" (el catálogo tiene 10 causas)`,
    );
  }
  return causaId as CausaParadaId;
}

/** Lee `campos_especificos` JSON text; el JSON inválido es un error, no `{}`. */
function camposEspecificosRow(paradaId: string, texto: string): Record<string, unknown> {
  try {
    const valor: unknown = JSON.parse(texto);
    if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
      throw new Error("campos_especificos no es un objeto JSON");
    }
    return valor as Record<string, unknown>;
  } catch (causa) {
    throw errorDeMapeo(paradaId, causa);
  }
}

/** Puro: Parada -> valores SQL (JSON ya stringificado). Ninguna Database aquí. */
export function mapParadaToSql(parada: Parada): ParadaSqlValues {
  return {
    id: parada.id,
    machine_id: parada.maquinaId,
    orden_id: parada.ordenId,
    operario: parada.operatorName,
    causa_id: parada.causaId,
    campos_especificos: JSON.stringify(parada.camposEspecificos),
    observaciones: parada.observaciones ?? null,
    inicio: parada.inicio,
    fin: parada.fin,
    fecha_operativa: parada.fechaOperativa,
  };
}

/** Puro: fila SQL -> Parada. Nunca una referencia a la fila de entrada. */
export function mapParadaRow(fila: ParadaRow): Parada {
  return {
    id: fila.id,
    maquinaId: fila.machine_id,
    ordenId: fila.orden_id,
    operatorName: fila.operario,
    causaId: causaParadaRow(fila.id, fila.causa_id),
    camposEspecificos: camposEspecificosRow(fila.id, fila.campos_especificos),
    observaciones: fila.observaciones ?? undefined,
    inicio: fila.inicio,
    fin: fila.fin,
    fechaOperativa: fila.fecha_operativa,
  };
}

// ---------------------------------------------------------------------------
// Adaptador
// ---------------------------------------------------------------------------

/**
 * Persiste paradas en SQLite con el mismo contrato que el port en memoria:
 * - insert/update explícitos con pre-check (D2j): duplicado y desconocido
 *   son rechazos humanos, no violaciones de constraint.
 * - `orden_id IS $2` null-safe en `getParadaAbierta`: una sola sentencia
 *   cubre "sin orden" (bind null) y "de una orden" (bind con id).
 * - Los fallos de ejecución viajan envueltos con la causa subyacente; los
 *   rechazos esperados viajan verbatim, como in-memory.
 */
export class SqliteParadaRepository implements IParadaRepository {
  constructor(private readonly db: Database) {}

  async insertParada(parada: Parada): Promise<void> {
    // Rechazo esperado, igual que el port en memoria: el id ya existe.
    const previa = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM parada WHERE id = $1",
      [parada.id],
    );
    if (previa.length > 0) {
      throw new Error(`ya existe una parada con el id ${parada.id}`);
    }

    const valores = mapParadaToSql(parada);
    try {
      await this.db.execute(
        `INSERT INTO parada (id, machine_id, orden_id, operario, causa_id, campos_especificos, observaciones, inicio, fin, fecha_operativa) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          valores.id,
          valores.machine_id,
          valores.orden_id,
          valores.operario,
          valores.causa_id,
          valores.campos_especificos,
          valores.observaciones,
          valores.inicio,
          valores.fin,
          valores.fecha_operativa,
        ],
      );
    } catch (causa) {
      throw new Error(`no se pudo persistir la parada "${parada.id}"`, {
        cause: causa,
      });
    }
  }

  async updateParada(parada: Parada): Promise<void> {
    // Rechazo esperado, igual que el port en memoria: el id no existe.
    const previa = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM parada WHERE id = $1",
      [parada.id],
    );
    if (previa.length === 0) {
      throw new Error(`no existe una parada con el id ${parada.id}`);
    }

    const valores = mapParadaToSql(parada);
    try {
      // D2j: `id` solo en WHERE, nunca en SET; los 8 no-PK van en SET.
      await this.db.execute(
        `UPDATE parada SET machine_id = $2, orden_id = $3, operario = $4, causa_id = $5, campos_especificos = $6, observaciones = $7, inicio = $8, fin = $9, fecha_operativa = $10 WHERE id = $1`,
        [
          valores.id,
          valores.machine_id,
          valores.orden_id,
          valores.operario,
          valores.causa_id,
          valores.campos_especificos,
          valores.observaciones,
          valores.inicio,
          valores.fin,
          valores.fecha_operativa,
        ],
      );
    } catch (causa) {
      throw new Error(`no se pudo actualizar la parada "${parada.id}"`, {
        cause: causa,
      });
    }
  }

  async obtenerPorId(id: string): Promise<Parada | undefined> {
    const filas = await this.db.select<ParadaRow[]>(
      "SELECT * FROM parada WHERE id = $1",
      [id],
    );
    const fila = filas[0];
    return fila ? mapParadaRow(fila) : undefined;
  }

  async listarPorMaquina(maquinaId: string): Promise<Parada[]> {
    const filas = await this.db.select<ParadaRow[]>(
      "SELECT * FROM parada WHERE machine_id = $1 ORDER BY inicio ASC",
      [maquinaId],
    );
    return filas.map((fila) => mapParadaRow(fila));
  }

  /**
   * Listado de UN DÍA OPERATIVO. El filtro por día viaja en la consulta — un
   * `WHERE` más, nada más (DD3): el predicado lo aplica la base, nunca el
   * llamador.
   *
   * Un día sin paradas devuelve `[]`: el SQL no lanza por cero filas.
   *
   * Sin columna, índice ni migración nueva: el predicado lo sirve el índice
   * `idx_parada_maquina_fecha (machine_id, fecha_operativa)` de la migración 005.
   * Orden: cronológico por `inicio`. Dos registros con el `inicio` idéntico
   * quedan en orden indefinido entre sí — el método no afirma determinismo
   * ahí, y el llamador no debe suponerlo. El caso se nombra en el contrato
   * de listado por día (`dayScopedListingContract.ts`, forma 5) en vez de
   * quedar sólo como un comment.
   */
  async listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Parada[]> {
    const filas = await this.db.select<ParadaRow[]>(
      "SELECT * FROM parada WHERE machine_id = $1 AND fecha_operativa = $2 ORDER BY inicio ASC",
      [maquinaId, fechaOperativa],
    );
    return filas.map((fila) => mapParadaRow(fila));
  }

  async listarPorOrden(ordenId: string): Promise<Parada[]> {
    const filas = await this.db.select<ParadaRow[]>(
      "SELECT * FROM parada WHERE orden_id = $1 ORDER BY inicio ASC",
      [ordenId],
    );
    return filas.map((fila) => mapParadaRow(fila));
  }

  async getParadaAbierta(
    maquinaId: string,
    ordenId: string | null,
  ): Promise<ParadaAbierta | null> {
    // `IS $2` es null-safe: bind null casa solo las paradas sin orden, un id
    // casa solo las de esa orden — la misma semántica que el port en memoria.
    const filas = await this.db.select<ParadaRow[]>(
      "SELECT * FROM parada WHERE machine_id = $1 AND fin IS NULL AND orden_id IS $2 ORDER BY inicio ASC LIMIT 1",
      [maquinaId, ordenId],
    );
    const fila = filas[0];
    // `fin IS NULL` en la sentencia hace la cast segura, igual que el port.
    return fila ? (mapParadaRow(fila) as ParadaAbierta) : null;
  }

  /**
   * La parada abierta de la máquina, sea cual sea su orden y su día (OQ-4).
   *
   * Mismo predicado que `getParadaAbiertaDeMaquina` del port en memoria:
   * `fin IS NULL` y NINGUNA condición sobre `orden_id` ni `fecha_operativa`.
   * `ORDER BY inicio ASC LIMIT 1` desambigua igual que allí, de modo que los
   * dos adaptadores devuelven la misma parada ante el mismo almacén.
   *
   * NO es un listado: no devuelve historial ni toca `fechaOperativa`. Responde
   * solo por el estado operativo actual de la máquina.
   */
  async getParadaAbiertaDeMaquina(maquinaId: string): Promise<ParadaAbierta | null> {
    const filas = await this.db.select<ParadaRow[]>(
      "SELECT * FROM parada WHERE machine_id = $1 AND fin IS NULL ORDER BY inicio ASC LIMIT 1",
      [maquinaId],
    );
    const fila = filas[0];
    return fila ? (mapParadaRow(fila) as ParadaAbierta) : null;
  }
}