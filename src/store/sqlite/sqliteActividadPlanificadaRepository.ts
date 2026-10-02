/**
 * Ticket 10 (Phase 2) — Unit C2 — `sqliteActividadPlanificadaRepository`
 *
 * WHAT THIS IS: the first SQLite operational adapter, and the shape the other
 * three copy (D3). It implements `IActividadPlanificadaRepository` over the
 * `actividad_planificada` table declared in migration 004 (8 columns), with the
 * Phase 1 pattern from `sqliteOrderRepository.ts`: an exported `Row` interface,
 * exported **pure** mappers, and a class holding `private db: Database`.
 *
 * WHAT THIS IS NOT: a SQL engine, and not a second set of rules. This file
 * contains NO domain validation whatsoever.
 *
 * ── Pure storage boundary (spec: "The ports remain a pure storage boundary") ──
 *
 * The repository does **not** validate business rules. It never checks that
 * `tipo` is a known catalog value, that `queSeLimpio` is present for
 * `limpieza`, that `inicio` precedes `fin`, or that there is at most one open
 * activity per machine + type. `getActividadAbierta` is a **query**, not the
 * enforcement of that invariant. Every one of those rules lives in
 * `src/domain/actividades.ts` (`comenzarActividad`, `finalizarActividad`), which
 * runs BEFORE this adapter is called. A record the domain would have rejected is
 * persisted here without complaint — that is the contract, not an oversight.
 *
 * ── D1 — the mapper owns the vocabulary translation ─────────────────────────
 *
 * 004 names the machine `machine_id` and the operator `operario`; the domain
 * names them `maquinaId` and `operatorName`. Both names are load-bearing and
 * neither may be "simplified" into the other. The two exported mappers are the
 * whole of the translation, in both directions, and nothing else in the module
 * performs it: `mapActividadPlanificadaRow` is the only place `machine_id`
 * becomes `maquinaId`, and `mapActividadPlanificadaToSql` is the only place the
 * reverse happens. The mappers are **pure** — no I/O, no clock, no randomness,
 * no `Database` — so a full round trip is unit-testable with no connection in
 * scope.
 *
 * ── No order link, by design ────────────────────────────────────────────────
 *
 * There is **no** `orden_id` column on `actividad_planificada` (ADR 0005: a
 * planned activity is not a parada and can be registered on an empty day). The
 * mappers therefore never produce an order link, and this port has no
 * `listarPorOrden` to implement. `fin = NULL` is the only open/closed signal;
 * `ActividadAbierta` is a TypeScript type alias, never a stored value.
 *
 * ── D2j — explicit insert vs update ─────────────────────────────────────────
 *
 * `insertActividad` issues a pre-check `SELECT id …` and then ONE explicit
 * `INSERT`; `updateActividad` issues the same pre-check and then ONE explicit
 * `UPDATE` setting all 7 non-PK columns. No upsert, no `INSERT OR REPLACE`, no
 * branch on `rowsAffected` (its semantics across the plugin are unverified —
 * R6), no `BEGIN`/`COMMIT` (tauri-plugin-sql exposes no transaction and each
 * write is a single statement). `id` is the primary key and **never** appears in
 * a `SET` list. The two rejections reuse the in-memory messages verbatim —
 * `ya existe una actividad con el id <id>` / `no existe una actividad con el id
 * <id>` — and are thrown *before* the write, so they are NOT wrapped; only a
 * failure of the statement itself is wrapped as `no se pudo persistir la
 * actividad "<id>"` with the original error preserved as `cause`.
 *
 * ── HONESTY NOTE (D2d) ───────────────────────────────────────────────────────
 *
 * This adapter writes the columns 004 declares. That is a fact about the SQL it
 * emits, not about a running database. It is verified here only against a
 * statement-shape double that MODELS SQLite; it never executes the real Rust
 * migration, and whether the real Tauri connection enforces FK semantics
 * (`PRAGMA foreign_keys` is a per-connection setting and the plugin may serve
 * statements from a pool) stays unverified — R5. Per D2d, no workaround is added
 * here and `src/store/sqlite/database.ts` is left untouched. A test that passes
 * over this adapter proves the repository logic and the exact SQL it emits; it
 * never proves real SQLite behaviour.
 */

import type Database from "@tauri-apps/plugin-sql";
import type {
  ActividadAbierta,
  ActividadPlanificada,
  TipoActividadPlanificada,
} from "../../domain/types";
import type { IActividadPlanificadaRepository } from "../actividadesRepository";

/**
 * Fila SQL de `actividad_planificada` — las 8 columnas de 004, en el orden del
 * DDL. `machine_id` y `operario` son el vocabulario de la tabla (D1); `fin`,
 * `que_se_limpio` y `observaciones` admiten NULL, que es como se codifica
 * "no cerrado" y "sin valor" (nunca `""`).
 */
export interface ActividadPlanificadaRow {
  id: string;
  machine_id: string;
  tipo: string;
  inicio: string;
  fin: string | null;
  que_se_limpio: string | null;
  observaciones: string | null;
  operario: string;
  /** NOT NULL (005) — día operativo persistido (YYYY-MM-DD). No se deriva de
   * `inicio`: es el único determinante de la jornada del evento. */
  fecha_operativa: string;
}

/**
 * Valores de enlace para el INSERT explícito: el mismo juego de 9 columnas, en
 * el orden en que los placeholders `$1..$9` los reciben. Los opcionales se
 * escriben como `null` explícito, nunca como `undefined` (D2j).
 */
export interface ActividadPlanificadaSqlValues {
  id: string;
  machine_id: string;
  tipo: string;
  inicio: string;
  fin: string | null;
  que_se_limpio: string | null;
  observaciones: string | null;
  operario: string;
  /** NOT NULL (005) — día operativo persistido (YYYY-MM-DD). No se deriva de
   * `inicio`: es el único determinante de la jornada del evento. */
  fecha_operativa: string;
}

/**
 * SQL Row → TypeScript. PURA: sin I/O, sin reloj, sin azar, sin `Database`.
 * Devuelve un objeto NUEVO; la fila nunca se reutiliza ni se conserva.
 *
 * - D1: `machine_id` → `maquinaId`, `operario` → `operatorName`, `tipo` se
 *   estrecha al catálogo que el dominio ya validó. El mapper no verifica el
 *   catálogo: traduce lo que hay.
 * - NULL → `undefined` para `queSeLimpio` y `observaciones` (nunca `""`).
 * - `fin` se conserva como `string | null`: `null` significa abierta y es el
 *   valor que le da sentido a `ActividadAbierta`.
 * - Nunca inventa `ordenId`: esta tabla no tiene enlace a la orden.
 */
export function mapActividadPlanificadaRow(row: ActividadPlanificadaRow): ActividadPlanificada {
  return {
    id: row.id,
    maquinaId: row.machine_id as "M1",
    tipo: row.tipo as TipoActividadPlanificada,
    inicio: row.inicio,
    fin: row.fin,
    queSeLimpio: row.que_se_limpio ?? undefined,
    observaciones: row.observaciones ?? undefined,
    operatorName: row.operario,
    fechaOperativa: row.fecha_operativa,
  };
}

/**
 * TypeScript → valores SQL para el INSERT explícito. PURA, como su inversa.
 *
 * - D1 en sentido contrario: `maquinaId` → `machine_id`, `operatorName` →
 *   `operario`.
 * - Los opcionales ausentes se escriben `null` (columna NULL), nunca `""`, nunca
 *   `0`: así el `?? undefined` de la lectura recupera exactamente la ausencia.
 * - No toca `fin` más allá de copiarlo: una actividad abierta se persiste con
 *   `fin = null` y una cerrada con su timestamp, sin regla adicional.
 */
export function mapActividadPlanificadaToSql(
  actividad: ActividadPlanificada
): ActividadPlanificadaSqlValues {
  return {
    id: actividad.id,
    machine_id: actividad.maquinaId,
    tipo: actividad.tipo,
    inicio: actividad.inicio,
    fin: actividad.fin,
    que_se_limpio: actividad.queSeLimpio ?? null,
    observaciones: actividad.observaciones ?? null,
    operario: actividad.operatorName,
    fecha_operativa: actividad.fechaOperativa,
  };
}

export class SqliteActividadPlanificadaRepository implements IActividadPlanificadaRepository {
  constructor(private db: Database) {}

  /**
   * Inserta una actividad nueva. Rechaza un id duplicado.
   * Orden de operaciones: pre-chequeo por `id` (SELECT) y, sólo si no existe, UNA
   * sentencia INSERT. El rechazo ocurre ANTES de escribir, así que el registro
   * almacenado queda intacto.
   *
   * @throws `ya existe una actividad con el id <id>` (duplicado, mensaje del
   *         adaptador en memoria, sin envolver) o `no se pudo persistir la
   *         actividad "<id>"` con la causa original si la escritura falla.
   */
  async insertActividad(actividad: ActividadPlanificada): Promise<void> {
    // 1. Pre-chequeo de duplicado. La respuesta la da la tabla por `id`.
    const existentes = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM actividad_planificada WHERE id = $1",
      [actividad.id]
    );
    if (existentes.length > 0) {
      throw new Error(`ya existe una actividad con el id ${actividad.id}`);
    }

    // 2. UNA sola sentencia INSERT explícita, con las 8 columnas de 004 en el
    //    orden de los placeholders. Sin upsert, sin OR REPLACE, sin transacción.
    const v = mapActividadPlanificadaToSql(actividad);
    try {
      await this.db.execute(
        "INSERT INTO actividad_planificada (id, machine_id, tipo, inicio, fin, que_se_limpio, observaciones, operario, fecha_operativa) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [v.id, v.machine_id, v.tipo, v.inicio, v.fin, v.que_se_limpio, v.observaciones, v.operario, v.fecha_operativa]
      );
    } catch (error) {
      // Error descriptivo con contexto, conservando la causa original (patrón
      // 10.3/10.4). Un fallo nunca se traga ni se convierte en un éxito.
      throw new Error(`no se pudo persistir la actividad "${actividad.id}"`, {
        cause: error,
      });
    }
  }

  /**
   * Actualiza una actividad existente (cierre o modificación), por id. Rechaza
   * un id desconocido y NUNCA crea un registro a partir de una actualización.
   *
   * El `UPDATE` fija las 7 columnas no-PK: 004 no tiene `created_at` ni
   * `updated_at`, y `id` es la clave primaria, así que `id` nunca figura en una
   * lista `SET` (D2j). No hay rama sobre `rowsAffected`: la semántica de ese
   * valor a través del plugin no está verificada (R6), y el pre-chequeo ya
   * garantiza que la fila existe.
   *
   * @throws `no existe una actividad con el id <id>` (desconocido, mensaje del
   *         adaptador en memoria, sin envolver) o `no se pudo persistir la
   *         actividad "<id>"` con la causa original si la escritura falla.
   */
  async updateActividad(actividad: ActividadPlanificada): Promise<void> {
    // 1. Pre-chequeo de existencia. Si no está, se rechaza ANTES de escribir:
    //    no queda fila creada, ni parcial ni completa.
    const existentes = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM actividad_planificada WHERE id = $1",
      [actividad.id]
    );
    if (existentes.length === 0) {
      throw new Error(`no existe una actividad con el id ${actividad.id}`);
    }

    // 2. UNA sola sentencia UPDATE, en el mismo lugar: mismas 7 columnas no-PK.
    const v = mapActividadPlanificadaToSql(actividad);
    try {
      await this.db.execute(
        "UPDATE actividad_planificada SET machine_id = $2, tipo = $3, inicio = $4, fin = $5, que_se_limpio = $6, observaciones = $7, operario = $8, fecha_operativa = $9 WHERE id = $1",
        [v.id, v.machine_id, v.tipo, v.inicio, v.fin, v.que_se_limpio, v.observaciones, v.operario, v.fecha_operativa]
      );
    } catch (error) {
      throw new Error(`no se pudo persistir la actividad "${actividad.id}"`, {
        cause: error,
      });
    }
  }

  /**
   * Devuelve la actividad con el id dado, o `undefined` si no existe.
   * `undefined` — nunca `null` — es el contrato del puerto.
   * @throws El error original de SQLite/plugin propaga (una lectura fallida no
   *         se convierte en "no encontrada").
   */
  async obtenerPorId(id: string): Promise<ActividadPlanificada | undefined> {
    const rows = await this.db.select<ActividadPlanificadaRow[]>(
      "SELECT * FROM actividad_planificada WHERE id = $1",
      [id]
    );
    if (rows.length === 0) {
      return undefined;
    }
    return mapActividadPlanificadaRow(rows[0]);
  }

  /**
   * Lista todas las actividades de una máquina, en orden cronológico por
   * `inicio`. El orden lo posee la consulta (`ORDER BY inicio ASC`), no el
   * llamador: el adaptador no reordena el resultado.
   *
   * Sin filtro por orden — este dominio no lleva `ordenId` (ADR 0005), así que no
   * existe un `listarPorOrden` que implementar.
   */
  async listarPorMaquina(maquinaId: string): Promise<ActividadPlanificada[]> {
    const rows = await this.db.select<ActividadPlanificadaRow[]>(
      "SELECT * FROM actividad_planificada WHERE machine_id = $1 ORDER BY inicio ASC",
      [maquinaId]
    );
    return rows.map(mapActividadPlanificadaRow);
  }

  /**
   * Listado de UN DÍA OPERATIVO. El filtro por día viaja en la consulta — un
   * `WHERE` más, nada más (DD3): el predicado lo aplica la base, nunca el
   * llamador.
   *
   * Un día sin actividades devuelve `[]`: el SQL no lanza por cero filas.
   *
   * Sin columna, índice ni migración nueva: el predicado lo sirve el índice
   * `idx_actividad_maquina_fecha (machine_id, fecha_operativa)` de la migración 005.
   */
  async listarPorMaquinaYFecha(
    maquinaId: string,
    fechaOperativa: string
  ): Promise<ActividadPlanificada[]> {
    const rows = await this.db.select<ActividadPlanificadaRow[]>(
      "SELECT * FROM actividad_planificada WHERE machine_id = $1 AND fecha_operativa = $2 ORDER BY inicio ASC",
      [maquinaId, fechaOperativa]
    );
    return rows.map(mapActividadPlanificadaRow);
  }

  /**
   * Devuelve la actividad abierta (`fin IS NULL`) para máquina + tipo, o `null`
   * si no hay ninguna.
   *
   * El `ORDER BY inicio ASC LIMIT 1` coincide con el "primer caso" del adaptador
   * en memoria mientras se respete el invariante de una sola abierta por máquina
   * + tipo, y es *determinista* cuando no se respeta: el orden de inserción no lo
   * es. El predicado `fin IS NULL` está en la consulta, así que la fila mapeada
   * tiene `fin: null` por construcción; el cast al alias `ActividadAbierta`
   * reproduce exactamente lo que hace el adaptador en memoria, y deja el valor
   * utilizable por `finalizarActividad` sin cast en el llamador.
   *
   * Esto es una consulta, NO la aplicación del invariante "una abierta por
   * máquina + tipo" — esa regla es de `comenzarActividad` (dominio).
   */
  async getActividadAbierta(
    maquinaId: string,
    tipo: TipoActividadPlanificada
  ): Promise<ActividadAbierta | null> {
    const rows = await this.db.select<ActividadPlanificadaRow[]>(
      "SELECT * FROM actividad_planificada WHERE machine_id = $1 AND tipo = $2 AND fin IS NULL ORDER BY inicio ASC LIMIT 1",
      [maquinaId, tipo]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapActividadPlanificadaRow(rows[0]) as ActividadAbierta;
  }
}
