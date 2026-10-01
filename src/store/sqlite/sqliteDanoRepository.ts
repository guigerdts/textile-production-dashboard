/**
 * Ticket 10 (Phase 2) — Unit D2 — `sqliteDanoRepository`
 *
 * WHAT THIS IS: the SQLite adapter for `IDanoRepository`, the shape
 * `sqliteActividadPlanificadaRepository` (C2) established, extended to the two
 * things the daño table has and the actividad table does not: a **nullable
 * `orden_id` foreign key** and a **nullable `parada_id` foreign key**. It
 * implements the port over the `dano` table declared in migration 004 (14
 * columns), with the Phase 1 pattern: an exported `Row` interface, exported
 * **pure** mappers, and a class holding `private db: Database`.
 *
 * WHAT THIS IS NOT: a SQL engine, and not a second set of rules. This file
 * contains NO domain validation whatsoever.
 *
 * ── Pure storage boundary (spec: "The ports remain a pure storage boundary") ──
 *
 * The repository does **not** validate business rules. It never checks that
 * `causoParada = true` implies a non-null `paradaId`, that `posibleSegunda = true`
 * implies `unidadesSospechadas`, that `fin` is not before `inicio`, that a
 * `paradaId` points to a parada that really exists, or that a máquina has at most
 * one open daño. Every one of those rules lives in `src/domain/danos.ts`
 * (`registrarDano`, `cerrarDano`), which runs BEFORE this adapter is called. A
 * record the domain would have rejected is persisted here without complaint —
 * that is the contract, not an oversight.
 *
 * What the adapter DOES check is narrower and purely structural: that a row with
 * the given `id` is absent before an INSERT and present before an UPDATE. That is
 * the pre-check the port documents as its own rejection ("throws if the id
 * already exists" / "throws if the id does not exist"), and it matches the
 * in-memory adapter's messages verbatim.
 *
 * ── D1 — the mappers own the vocabulary translation ──────────────────────────
 *
 * 004 names the machine `machine_id` and the operator `operario`; the domain
 * names them `maquinaId` and `operatorName`. Both names are load-bearing and
 * neither may be "simplified" into the other. The two exported mappers are the
 * whole of the translation, in both directions, and nothing else in the module
 * performs it: `mapDanoRow` is the only place `machine_id` becomes `maquinaId`,
 * and `mapDanoToSql` is the only place the reverse happens. The mappers are
 * **pure** — no I/O, no clock, no randomness, no `Database` — so a full round
 * trip is unit-testable with no connection in scope.
 *
 * ── Two independent flags — they are NOT mutually exclusive ────────────────
 *
 * `causo_parada` and `posible_segunda` are separate columns, not a pair, and the
 * mapper never derives one from the other. A daño can have stopped the machine
 * and produced no suspected segunda, produced suspected segunda without
 * stopping, done both, or done neither. The stored form of a `boolean` is the
 * **integer** `0`/`1` — the same convention `sqliteOrderRepository` uses for
 * `aplica_segunda` — and it is applied only in the mappers, never by the caller.
 *
 * `unidades_sospechadas` is NULL when the field is absent. It is NOT derived
 * from `posible_segunda`: a row can carry a value there with the flag off, and
 * this adapter persists it as given. Deriving, defaulting or clearing it is the
 * domain's job, not the storage boundary's.
 *
 * ── The two foreign keys are nullable links, not cascades ────────────────────
 *
 * Unlike `actividad_planificada` (ADR 0005: a planned activity is not a parada
 * and can be registered on an empty day), a daño carries `orden_id` — null when
 * the machine was idle — and `parada_id` — null when it did not stop the
 * machine. Both are recorded as explicit `null`, never as `undefined` and never
 * as a sentinel string. This adapter never deletes a daño, never follows a link
 * and never reads another table; referential integrity is the database's
 * business (R5), and when a link cannot be resolved the underlying engine
 * rejects the write and that error propagates — see the A1 honesty note in the
 * test suite.
 *
 * ── D2j — explicit insert vs update ─────────────────────────────────────────
 *
 * `insertDano` issues a pre-check `SELECT id …` and then ONE explicit `INSERT`;
 * `updateDano` issues the same pre-check and then ONE explicit `UPDATE` setting
 * all 13 non-PK columns. No upsert, no `INSERT OR REPLACE`, no branch on
 * `rowsAffected` (its semantics across the plugin are unverified — R6), no
 * `BEGIN`/`COMMIT` (tauri-plugin-sql exposes no transaction and each write is a
 * single statement). `id` is the primary key and **never** appears in a `SET`
 * list. The two rejections reuse the in-memory messages verbatim — `ya existe un
 * daño con el id <id>` / `no existe un daño con el id <id>` — and are thrown
 * *before* the write, so they are NOT wrapped; only a failure of the statement
 * itself is wrapped as `no se pudo persistir el daño "<id>"` with the original
 * error preserved as `cause`.
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
import type { Dano, DanoAbierto, TipoDano } from "../../domain/types";
import type { IDanoRepository } from "../danosRepository";

/**
 * Fila SQL de `dano` — las 14 columnas de 004, en el orden del DDL. `machine_id`
 * y `operario` son el vocabulario de la tabla (D1) y ambos son `NOT NULL`, así
 * que no admiten `null`; `orden_id`, `parada_id`, `fin`, `solucion_aplicada`,
 * `unidades_sospechadas` y `observaciones` admiten NULL, que es como se codifican
 * "sin orden", "sin parada vinculada", "no cerrado" y "sin valor" (nunca `""`).
 *
 * `causo_parada` y `posible_segunda` llegan como enteros `0`/`1` desde SQLite,
 * no como booleanos: el mapeo a `boolean` ocurre en `mapDanoRow`.
 */
export interface DanoRow {
  id: string;
  machine_id: string;
  orden_id: string | null;
  operario: string;
  tipo: string;
  componente: string;
  inicio: string;
  fin: string | null;
  solucion_aplicada: string | null;
  causo_parada: number;
  parada_id: string | null;
  posible_segunda: number;
  unidades_sospechadas: number | null;
  observaciones: string | null;
  /** NOT NULL (005) — día operativo persistido (YYYY-MM-DD). No se deriva de
   * `inicio`: es el único determinante de la jornada del evento. */
  fecha_operativa: string;
}

/**
 * Valores de enlace para el INSERT explícito: el mismo juego de 15 columnas, en
 * el orden en que los placeholders `$1..$15` los reciben. Los opcionales se
 * escriben como `null` explícito, nunca como `undefined` (D2j), y los dos flags
 * como `0`/`1`, nunca como `true`/`false`.
 */
export interface DanoSqlValues {
  id: string;
  machine_id: string;
  orden_id: string | null;
  operario: string;
  tipo: string;
  componente: string;
  inicio: string;
  fin: string | null;
  solucion_aplicada: string | null;
  causo_parada: number;
  parada_id: string | null;
  posible_segunda: number;
  unidades_sospechadas: number | null;
  observaciones: string | null;
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
 * - NULL → `undefined` para `solucionAplicada`, `unidadesSospechadas` y
 *   `observaciones` (nunca `""`). `operario` NO entra en esa regla: es
 *   `NOT NULL`, así que se copia tal cual y un `?? ""` sería inventar un valor
 *   que la columna no puede contener.
 * - `fin` se conserva como `string | null`: `null` significa abierto y es el
 *   valor que le da sentido a `DanoAbierto`.
 * - `ordenId` y `paradaId` se conservan como `string | null`: null es un valor
 *   de dominio legítimo ("daño sin orden", "daño que no_paró la máquina"), no
 *   ausencia de dato.
 * - `causo_parada` / `posible_segunda`: `=== 1` es true. Un valor distinto de
 *   0/1 se leería como `false` sin error; la tabla no declara CHECK, así que esa
 *   garantía la da la escritura, no el DDL (R5).
 * - Nunca deriva un flag del otro ni `unidadesSospechadas` de `posibleSegunda`.
 */
export function mapDanoRow(row: DanoRow): Dano {
  return {
    id: row.id,
    maquinaId: row.machine_id as "M1",
    ordenId: row.orden_id,
    operatorName: row.operario,
    tipo: row.tipo as TipoDano,
    componente: row.componente,
    inicio: row.inicio,
    fin: row.fin,
    fechaOperativa: row.fecha_operativa,
    solucionAplicada: row.solucion_aplicada ?? undefined,
    causoParada: row.causo_parada === 1,
    paradaId: row.parada_id,
    posibleSegunda: row.posible_segunda === 1,
    unidadesSospechadas: row.unidades_sospechadas ?? undefined,
    observaciones: row.observaciones ?? undefined,
  };
}

/**
 * TypeScript → valores SQL para el INSERT explícito. PURA, como su inversa.
 *
 * - D1 en sentido contrario: `maquinaId` → `machine_id`, `operatorName` →
 *   `operario`.
 * - Los opcionales ausentes se escriben `null` (columna NULL), nunca `""`, nunca
 *   `0`: así el `?? undefined` de la lectura recupera exactamente la ausencia.
 * - `ordenId` y `paradaId` AUSENTES también se escriben `null`, porque en este
 *   dominio `null` es un valor legítimo y no "falta información".
 * - Los dos flags se traducen a `0`/`1`. No se derivan entre sí ni se
 *   normaliza `unidades_sospechadas` contra `posible_segunda`.
 */
export function mapDanoToSql(dano: Dano): DanoSqlValues {
  return {
    id: dano.id,
    machine_id: dano.maquinaId,
    orden_id: dano.ordenId ?? null,
    operario: dano.operatorName,
    tipo: dano.tipo,
    componente: dano.componente,
    inicio: dano.inicio,
    fin: dano.fin,
    fecha_operativa: dano.fechaOperativa,
    solucion_aplicada: dano.solucionAplicada ?? null,
    causo_parada: dano.causoParada ? 1 : 0,
    parada_id: dano.paradaId ?? null,
    posible_segunda: dano.posibleSegunda ? 1 : 0,
    unidades_sospechadas: dano.unidadesSospechadas ?? null,
    observaciones: dano.observaciones ?? null,
  };
}

export class SqliteDanoRepository implements IDanoRepository {
  constructor(private db: Database) {}

  /**
   * Inserta un daño nuevo. Rechaza un id duplicado.
   * Orden de operaciones: pre-chequeo por `id` (SELECT) y, sólo si no existe, UNA
   * sentencia INSERT. El rechazo ocurre ANTES de escribir, así que el registro
   * almacenado queda intacto.
   *
   * @throws `ya existe un daño con el id <id>` (duplicado, mensaje del adaptador
   *         en memoria, sin envolver) o `no se pudo persistir el daño "<id>"`
   *         con la causa original si la escritura falla.
   */
  async insertDano(dano: Dano): Promise<void> {
    // 1. Pre-chequeo de duplicado. La respuesta la da la tabla por `id`.
    const existentes = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM dano WHERE id = $1",
      [dano.id]
    );
    if (existentes.length > 0) {
      throw new Error(`ya existe un daño con el id ${dano.id}`);
    }

    // 2. UNA sola sentencia INSERT explícita, con las 14 columnas de 004 en el
    //    orden de los placeholders. Sin upsert, sin OR REPLACE, sin transacción.
    const v = mapDanoToSql(dano);
    try {
      await this.db.execute(
        "INSERT INTO dano (id, machine_id, orden_id, operario, tipo, componente, inicio, fin, solucion_aplicada, causo_parada, parada_id, posible_segunda, unidades_sospechadas, observaciones, fecha_operativa) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        [
          v.id,
          v.machine_id,
          v.orden_id,
          v.operario,
          v.tipo,
          v.componente,
          v.inicio,
          v.fin,
          v.solucion_aplicada,
          v.causo_parada,
          v.parada_id,
          v.posible_segunda,
          v.unidades_sospechadas,
          v.observaciones,
          v.fecha_operativa,
        ]
      );
    } catch (error) {
      // Error descriptivo con contexto, conservando la causa original (patrón
      // 10.3/10.4). Un fallo nunca se traga ni se convierte en un éxito.
      throw new Error(`no se pudo persistir el daño "${dano.id}"`, { cause: error });
    }
  }

  /**
   * Actualiza un daño existente (cierre o modificación), por id. Rechaza un id
   * desconocido y NUNCA crea un registro a partir de una actualización.
   *
   * El `UPDATE` fija las 13 columnas no-PK: 004 no tiene `created_at` ni
   * `updated_at`, y `id` es la clave primaria, así que `id` nunca figura en una
   * lista `SET` (D2j). No hay rama sobre `rowsAffected`: la semántica de ese
   * valor a través del plugin no está verificada (R6), y el pre-chequeo ya
   * garantiza que la fila existe.
   *
   * @throws `no existe un daño con el id <id>` (desconocido, mensaje del
   *         adaptador en memoria, sin envolver) o `no se pudo persistir el daño
   *         "<id>"` con la causa original si la escritura falla.
   */
  async updateDano(dano: Dano): Promise<void> {
    // 1. Pre-chequeo de existencia. Si no está, se rechaza ANTES de escribir:
    //    no queda fila creada, ni parcial ni completa.
    const existentes = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM dano WHERE id = $1",
      [dano.id]
    );
    if (existentes.length === 0) {
      throw new Error(`no existe un daño con el id ${dano.id}`);
    }

    // 2. UNA sola sentencia UPDATE, en el mismo lugar: mismas 13 columnas
    //    no-PK, con el id travelling en $1 y el resto desplazado.
    const v = mapDanoToSql(dano);
    try {
      await this.db.execute(
        "UPDATE dano SET machine_id = $2, orden_id = $3, operario = $4, tipo = $5, componente = $6, inicio = $7, fin = $8, solucion_aplicada = $9, causo_parada = $10, parada_id = $11, posible_segunda = $12, unidades_sospechadas = $13, observaciones = $14, fecha_operativa = $15 WHERE id = $1",
        [
          v.id,
          v.machine_id,
          v.orden_id,
          v.operario,
          v.tipo,
          v.componente,
          v.inicio,
          v.fin,
          v.solucion_aplicada,
          v.causo_parada,
          v.parada_id,
          v.posible_segunda,
          v.unidades_sospechadas,
          v.observaciones,
          v.fecha_operativa,
        ]
      );
    } catch (error) {
      throw new Error(`no se pudo persistir el daño "${dano.id}"`, { cause: error });
    }
  }

  /**
   * Devuelve el daño con el id dado, o `undefined` si no existe.
   * `undefined` — nunca `null` — es el contrato del puerto.
   * @throws El error original de SQLite/plugin propaga (una lectura fallida no
   *         se convierte en "no encontrado").
   */
  async obtenerPorId(id: string): Promise<Dano | undefined> {
    const rows = await this.db.select<DanoRow[]>("SELECT * FROM dano WHERE id = $1", [id]);
    if (rows.length === 0) {
      return undefined;
    }
    return mapDanoRow(rows[0]);
  }

  /**
   * Lista todos los daños de una máquina, en orden cronológico por `inicio`.
   * El orden lo posee la consulta (`ORDER BY inicio ASC`), no el llamador: el
   * adaptador no reordena el resultado.
   *
   * Incluye daños con y sin orden asociada: un daño en máquina ociosa tiene
   * `orden_id = NULL` y es un registro legítimo, no un ruido a excluir.
   */
  async listarPorMaquina(maquinaId: string): Promise<Dano[]> {
    const rows = await this.db.select<DanoRow[]>(
      "SELECT * FROM dano WHERE machine_id = $1 ORDER BY inicio ASC",
      [maquinaId]
    );
    return rows.map(mapDanoRow);
  }

  /**
   * Lista los daños asociados a una orden concreta, en orden cronológico por
   * `inicio`.
   *
   * NO incluye los daños sin orden: el predicado es `orden_id = $1`, y en
   * lógica de tres valores un `NULL` enlazado NO casa con ninguna igualdad, así
   * que la exclusión es del propio predicado — no hace falta un
   * `orden_id IS NOT NULL` adicional (mismo criterio que `listarPorOrden` de
   * paradas, ya establecido en C1).
   */
  async listarPorOrden(ordenId: string): Promise<Dano[]> {
    const rows = await this.db.select<DanoRow[]>(
      "SELECT * FROM dano WHERE orden_id = $1 ORDER BY inicio ASC",
      [ordenId]
    );
    return rows.map(mapDanoRow);
  }

  /**
   * Devuelve el daño abierto (`fin IS NULL`) de la máquina, o `null` si no hay
   * ninguno.
   *
   * El `ORDER BY inicio ASC LIMIT 1` coincide con el "primer caso" del adaptador
   * en memoria mientras se respete el invariante de un solo daño abierto por
   * máquina, y es *determinista* cuando no se respeta: el orden de inserción no
   * lo es. El predicado `fin IS NULL` está en la consulta, así que la fila
   * mapeada tiene `fin: null` por construcción; el cast al alias `DanoAbierto`
   * reproduce exactamente lo que hace el adaptador en memoria, y deja el valor
   * utilizable por `cerrarDano` sin cast en el llamador.
   *
   * Esto es una consulta, NO la aplicación del invariante "una abierto por
   * máquina" — esa regla es de `registrarDano` (dominio).
   */
  async getDanoAbierto(maquinaId: string): Promise<DanoAbierto | null> {
    const rows = await this.db.select<DanoRow[]>(
      "SELECT * FROM dano WHERE machine_id = $1 AND fin IS NULL ORDER BY inicio ASC LIMIT 1",
      [maquinaId]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapDanoRow(rows[0]) as DanoAbierto;
  }
}
