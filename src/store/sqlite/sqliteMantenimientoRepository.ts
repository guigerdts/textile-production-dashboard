/**
 * Ticket 10 (Phase 2) — Unit F2 — `sqliteMantenimientoRepository`
 *
 * WHAT THIS IS: the SQLite adapter for `IMantenimientoRepository`, the shape
 * `sqliteDanoRepository` (D2) established, applied to the maintenance record: a
 * **machine-level documentary event** that is never tied to an orden and never
 * per paint chemistry (ADR 0006), with no `duracion` column (ADR 0007). It
 * implements the port over the `mantenimiento` table declared in migration 004
 * (10 columns), with the Phase 1 pattern: an exported `Row` interface, exported
 * **pure** mappers, and a class holding `private db: Database`.
 *
 * WHAT THIS IS NOT: a SQL engine, and not a second set of rules. This file
 * contains NO domain validation whatsoever.
 *
 * ── Pure storage boundary (spec: "The ports remain a pure storage boundary") ──
 *
 * The repository does **not** validate business rules. It never checks that a
 * reactive maintenance links to a daño that really exists, that a preventive one
 * never carries a `danoId`, that `fin` is not before `inicio`, that
 * `queSeRevisoReparo` is present when closing, or that a máquina has at most one
 * open maintenance. Every one of those rules lives in `src/domain/mantenimiento.ts`
 * (`registrarMantenimiento`, `cerrarMantenimiento`), which runs BEFORE this
 * adapter is called. A record the domain would have rejected is persisted here
 * without complaint — that is the contract, not an oversight.
 *
 * What the adapter DOES check is narrower and purely structural: that a row with
 * the given `id` is absent before an INSERT and present before an UPDATE, and
 * that a stored `tipo` is one this mapper can actually rebuild. A `TEXT` column
 * is untyped — it can hold any bytes at all — so a value outside the `reactivo` /
 * `preventivo` vocabulary is a **descriptive mapping error carrying the defect
 * as `cause`**: never a fabricated `""`, never a silent default. That is
 * corruption handling at the storage boundary, not validation of a business
 * rule, and it is the same shape as the `parada` JSON check the design
 * prescribes. The id pre-check is the rejection the port documents as its own
 * ("throws if the id already exists" / "throws if the id does not exist"), and
 * its message matches the in-memory adapter's verbatim.
 *
 * ── ADR 0006 and 0007 are shapes, not checks ────────────────────────────────
 *
 * `mantenimiento` has NO `orden_id` column (ADR 0006: a maintenance is ALWAYS a
 * machine event) and NO `duracion` column (ADR 0007: duration is always derived
 * and never deducts productive time; the maintenance is documentary). Because
 * the columns do not exist, neither mapper can invent them: this file never
 * produces an order link and never produces a duration — absent by
 * construction, not by a runtime check.
 *
 * ── D1 — the mappers own the vocabulary translation ──────────────────────────
 *
 * 004 names the machine `machine_id` and the operator `operario`; the domain
 * names them `maquinaId` and `operatorName`. `mapMantenimientoRow` is the only
 * place `machine_id` becomes `maquinaId` and `operario` becomes `operatorName`;
 * `mapMantenimientoToSql` is the only place the reverse happens. The mappers are
 * **pure** — no I/O, no clock, no randomness, no `Database` — so a full round
 * trip is unit-testable with no connection in scope.
 *
 * - `fin` is preserved as `string | null`: `null` means "open" and gives
 *   `MantenimientoAbierto` its meaning.
 * - `dano_id` is preserved as `string | null`: `null` is a legitimate domain
 *   value ("preventive maintenance has no linked daño"), not a missing column.
 * - `que_se_reviso_reparo` and `observaciones` read back `?? undefined`: absence
 *   is encoded as a NULL column, never as `""`.
 *
 * ── D2j — explicit insert vs update ─────────────────────────────────────────
 *
 * `insertMantenimiento` issues a pre-check `SELECT id …` and then ONE explicit
 * `INSERT`; `updateMantenimiento` issues the same pre-check and then ONE
 * explicit `UPDATE` setting all 9 non-PK columns. No upsert, no `INSERT OR
 * REPLACE`, no branch on `rowsAffected` (its semantics across the plugin are
 * unverified — R6), no `BEGIN`/`COMMIT` (tauri-plugin-sql exposes no
 * transaction and each write is a single statement). `id` is the primary key
 * and **never** appears in a `SET` list.
 *
 * Because the `UPDATE` sets all non-PK columns, closing a maintenance REPLACES
 * its row in place: the same `id`, `fin` and `queSeRevisoReparo` set, no second
 * row, and no trace of the open state — an exact behavioural match for the
 * in-memory `map.set(record)` (D2j has no "preserve the creation timestamp"
 * wrinkle). The two rejections reuse the in-memory messages verbatim and are
 * thrown *before* the write, so they are NOT wrapped; only a failure of the
 * statement itself is wrapped as `no se pudo persistir el mantenimiento "<id>"`
 * with the original error preserved as `cause`.
 *
 * ── HONESTY NOTE (D2d) ───────────────────────────────────────────────────────
 *
 * This adapter writes the columns 004 declares. That is a fact about the SQL it
 * emits, not about a running database. It is verified here only against a
 * statement-shape double that MODELS SQLite; it never executes the real Rust
 * migration, and whether the real Tauri connection enforces FK semantics
 * (`PRAGMA foreign_keys` is a per-connection setting and the plugin may serve
 * statements from a pool) stays unverified — R5. Per D2d, no workaround is
 * added here and `src/store/sqlite/database.ts` is left untouched. A test that
 * passes over this adapter proves the repository logic and the exact SQL it
 * emits; it never proves real SQLite behaviour.
 */

import type Database from "@tauri-apps/plugin-sql";
import type { Mantenimiento, MantenimientoAbierto, TipoMantenimientoId } from "../../domain/types";
import type { IMantenimientoRepository } from "../mantenimientoRepository";

/**
 * SQL row of `mantenimiento` — the 10 columns of 004, in DDL order, with the
 * DDL's nullability and WITHOUT narrowing. `id`, `machine_id`, `tipo`,
 * `operario`, `motivo` and `inicio` are `NOT NULL`, so they admit no `null` and
 * are typed `string`; `fin`, `que_se_reviso_reparo`, `dano_id` and
 * `observaciones` admit NULL, which is how absence is encoded (never `""`,
 * never an invented state).
 *
 * `tipo` arrives as `string`, NOT as `TipoMantenimientoId`: a `TEXT` column can
 * hold any bytes, so narrowing it to the `reactivo` / `preventivo` vocabulary is
 * `mapMantenimientoRow`'s job — and it does it by validating, not by asserting.
 */
export interface MantenimientoRow {
  id: string;
  /** NOT NULL — D1: `machine_id`, never `maquinaId`. */
  machine_id: string;
  /** NOT NULL — `reactivo` | `preventivo`, narrowed in the read mapper. */
  tipo: string;
  /** NOT NULL — D1: `operario`, never `operator_name`. */
  operario: string;
  /** NOT NULL — free text, never validated here (domain rule). */
  motivo: string;
  /** NOT NULL — ISO 8601, always required. */
  inicio: string;
  /** NULL = open ("en progreso"); the state that gives `MantenimientoAbierto` its meaning. */
  fin: string | null;
  /** NULL = not yet completed at close. Optional in the domain. */
  que_se_reviso_reparo: string | null;
  /** NULL = preventive maintenance; a legitimate domain value, not absence. */
  dano_id: string | null;
  /** NULL = no observation. Optional in the domain. */
  observaciones: string | null;
  /** NOT NULL (005) — día operativo persistido (YYYY-MM-DD). No se deriva de
   * `inicio`: es el único determinante de la jornada del evento. */
  fecha_operativa: string;
}

/**
 * Bind values for the explicit INSERT: the same set of 10 columns, in the order
 * the `$1..$10` placeholders receive them. The optionals are written as an
 * explicit `null`, never as `undefined` (D2j), and `tipo` leaves as the domain
 * vocabulary (`TipoMantenimientoId`) because the write carries it verbatim.
 */
export interface MantenimientoSqlValues {
  id: string;
  machine_id: string;
  tipo: TipoMantenimientoId;
  operario: string;
  motivo: string;
  inicio: string;
  fin: string | null;
  que_se_reviso_reparo: string | null;
  dano_id: string | null;
  observaciones: string | null;
  /** NOT NULL (005) — día operativo persistido (YYYY-MM-DD). No se deriva de
   * `inicio`: es el único determinante de la jornada del evento. */
  fecha_operativa: string;
}

/**
 * SQL row → TypeScript. PURE: no I/O, no clock, no randomness, no `Database`.
 * Returns a NEW object; the row is never reused nor retained.
 *
 * - D1: `machine_id` → `maquinaId`, `operario` → `operatorName`.
 * - `tipo` is narrowed to the `reactivo` / `preventivo` catalogue by a REAL
 *   check (`tipoMantenimientoRow`), not an assertion: a stored `"REACTIVO"` or
 *   `""` can never enter the domain wearing a `TipoMantenimientoId`.
 * - `fin` and `dano_id` do NOT enter the `?? undefined` rule: `null` is a
 *   legitimate value for both (an open maintenance; a preventive without a
 *   linked daño), preserved as-is.
 * - `que_se_reviso_reparo` and `observaciones` are absent → `undefined`.
 * - NEVER an order link and NEVER a duration: the table has no `orden_id` and
 *   no `duracion` column (ADR 0006 / ADR 0007), so neither is read.
 */
export function mapMantenimientoRow(row: MantenimientoRow): Mantenimiento {
  return {
    id: row.id,
    maquinaId: row.machine_id as "M1",
    tipo: tipoMantenimientoRow(row.id, row.tipo),
    operatorName: row.operario,
    motivo: row.motivo,
    inicio: row.inicio,
    fin: row.fin,
    fechaOperativa: row.fecha_operativa,
    queSeRevisoReparo: row.que_se_reviso_reparo ?? undefined,
    danoId: row.dano_id,
    observaciones: row.observaciones ?? undefined,
  };
}

/**
 * The `reactivo` / `preventivo` vocabulary a `tipo` TEXT column may hold — the
 * only two stored values a readable `tipo` can carry (the domain catalogue
 * `TipoMantenimientoId`).
 *
 * This narrows, it does not apply a business rule: the check is that the bytes
 * are one of the two values this mapper knows how to rebuild. Anything else —
 * `""`, `"REACTIVO"`, a typo, a catalogue renamed underneath 004 — is a damaged
 * row and leaves through `errorDeMapeo` naming the maintenance id and the
 * concrete defect, with the offending value carried as `cause`. Same contract as
 * the `inspeccion_tela` checklist narrowing (E2): a corrupt state silently read
 * as a valid type would report a damaged record as a sound one, and nobody
 * would see it happen.
 *
 * The guard IS the narrowing, so the returned literal union needs no assertion.
 */
function tipoMantenimientoRow(mantenimientoId: string, valor: string): TipoMantenimientoId {
  if (valor === "reactivo" || valor === "preventivo") {
    return valor;
  }

  throw errorDeMapeo(
    mantenimientoId,
    `el tipo "${valor}" no es un tipo de mantenimiento conocido ("reactivo" | "preventivo")`,
    new Error(`valor inesperado en la columna "tipo": "${valor}"`)
  );
}

/**
 * TypeScript → SQL values for the explicit INSERT. PURE, like its inverse.
 *
 * - D1 in the other direction: `maquinaId` → `machine_id`, `operatorName` →
 *   `operario`.
 * - Absent optionals are written as `null` (NULL column), never `""`: that way
 *   the read's `?? undefined` recovers exactly the absence.
 * - `fin` and `danoId` go in verbatim: a closed maintenance carries its `fin`, a
 *   preventive its `danoId: null`; nothing is derived from either.
 * - NEVER `orden_id` and NEVER `duracion`: those columns do not exist in 004
 *   (ADR 0006 / ADR 0007), so nothing is written and nothing is invented.
 */
export function mapMantenimientoToSql(mantenimiento: Mantenimiento): MantenimientoSqlValues {
  return {
    id: mantenimiento.id,
    machine_id: mantenimiento.maquinaId,
    tipo: mantenimiento.tipo,
    operario: mantenimiento.operatorName,
    motivo: mantenimiento.motivo,
    inicio: mantenimiento.inicio,
    fin: mantenimiento.fin,
    fecha_operativa: mantenimiento.fechaOperativa,
    que_se_reviso_reparo: mantenimiento.queSeRevisoReparo ?? null,
    dano_id: mantenimiento.danoId,
    observaciones: mantenimiento.observaciones ?? null,
  };
}

/** Descriptive mapping error that preserves the concrete defect as its `cause`. */
function errorDeMapeo(mantenimientoId: string, detalle: string, causa: Error): Error {
  return new Error(`no se pudo mapear el mantenimiento "${mantenimientoId}": ${detalle}`, {
    cause: causa,
  });
}

export class SqliteMantenimientoRepository implements IMantenimientoRepository {
  constructor(private db: Database) {}

  /**
   * Inserts a new maintenance. Rejects a duplicated id.
   * Order of operations: an `id` pre-check (SELECT) and, only if it does not
   * exist, ONE INSERT statement. The rejection happens BEFORE the write, so the
   * stored record stays intact.
   *
   * @throws `ya existe un mantenimiento con el id <id>` (duplicate, in-memory
   *         adapter's message, unwrapped) or `no se pudo persistir el
   *         mantenimiento "<id>"` with the original cause if the statement
   *         itself fails.
   */
  async insertMantenimiento(mantenimiento: Mantenimiento): Promise<void> {
    // 1. Duplicate pre-check. The table answers it by `id`.
    const existentes = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM mantenimiento WHERE id = $1",
      [mantenimiento.id]
    );
    if (existentes.length > 0) {
      throw new Error(`ya existe un mantenimiento con el id ${mantenimiento.id}`);
    }

    // 2. ONE single explicit INSERT statement, with the 10 columns of 004 in the
    //    placeholder order. No upsert, no OR REPLACE, no transaction.
    const v = mapMantenimientoToSql(mantenimiento);
    try {
      await this.db.execute(
        "INSERT INTO mantenimiento (id, machine_id, tipo, operario, motivo, inicio, fin, que_se_reviso_reparo, dano_id, observaciones, fecha_operativa) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        [
          v.id,
          v.machine_id,
          v.tipo,
          v.operario,
          v.motivo,
          v.inicio,
          v.fin,
          v.que_se_reviso_reparo,
          v.dano_id,
          v.observaciones,
          v.fecha_operativa,
        ]
      );
    } catch (error) {
      // Descriptive error with context, keeping the original cause (the 10.3/10.4
      // pattern). A failure is never swallowed nor turned into a success.
      throw new Error(`no se pudo persistir el mantenimiento "${mantenimiento.id}"`, {
        cause: error,
      });
    }
  }

  /**
   * Updates an existing maintenance — closing or modifying it — by id. Rejects
   * an unknown id and NEVER creates a record out of an update.
   *
   * The `UPDATE` sets the 9 non-PK columns: 004 has no `created_at` and no
   * `updated_at`, and `id` is the primary key, so `id` never appears in a `SET`
   * list (D2j). There is no branch on `rowsAffected`: the semantics of that
   * value through the plugin are unverified (R6), and the pre-check already
   * guarantees the row exists.
   *
   * Because the `SET` is complete, closing a maintenance REPLACES its row in
   * place: no trace of the open state survives as a second row, and the update
   * never rewrites the identity with a different value.
   *
   * @throws `no existe un mantenimiento con el id <id>` (unknown, in-memory
   *         adapter's message, unwrapped) or `no se pudo persistir el
   *         mantenimiento "<id>"` with the original cause if the statement
   *         itself fails.
   */
  async updateMantenimiento(mantenimiento: Mantenimiento): Promise<void> {
    // 1. Existence pre-check. If it is absent, the write is rejected BEFORE it
    //    happens: no row is created, partial nor complete.
    const existentes = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM mantenimiento WHERE id = $1",
      [mantenimiento.id]
    );
    if (existentes.length === 0) {
      throw new Error(`no existe un mantenimiento con el id ${mantenimiento.id}`);
    }

    // 2. ONE single UPDATE statement, in the same spot: the same 9 non-PK
    //    columns, with the id bound to $1 and every other one shifted down.
    const v = mapMantenimientoToSql(mantenimiento);
    try {
      await this.db.execute(
        "UPDATE mantenimiento SET machine_id = $2, tipo = $3, operario = $4, motivo = $5, inicio = $6, fin = $7, que_se_reviso_reparo = $8, dano_id = $9, observaciones = $10, fecha_operativa = $11 WHERE id = $1",
        [
          v.id,
          v.machine_id,
          v.tipo,
          v.operario,
          v.motivo,
          v.inicio,
          v.fin,
          v.que_se_reviso_reparo,
          v.dano_id,
          v.observaciones,
          v.fecha_operativa,
        ]
      );
    } catch (error) {
      throw new Error(`no se pudo persistir el mantenimiento "${mantenimiento.id}"`, {
        cause: error,
      });
    }
  }

  /**
   * Returns the maintenance with the given id, or `undefined` if it does not
   * exist. `undefined` — never `null` — is the port's contract.
   * @throws The original SQLite/plugin error propagates (a failed read is not
   *         turned into "not found"), and so does the mapping error of a damaged
   *         row: `mapMantenimientoRow` is pure and its failure is descriptive.
   */
  async obtenerPorId(id: string): Promise<Mantenimiento | undefined> {
    const rows = await this.db.select<MantenimientoRow[]>(
      "SELECT * FROM mantenimiento WHERE id = $1",
      [id]
    );
    if (rows.length === 0) {
      return undefined;
    }
    return mapMantenimientoRow(rows[0]);
  }

  /**
   * Lists ALL maintenance records of a machine, in chronological order by
   * `inicio`. The query owns that order (`ORDER BY inicio ASC`), not the caller:
   * the adapter does not re-sort the result.
   *
   * There is NO `listarPorOrden`: a maintenance is ALWAYS a machine event (ADR
   * 0006), so the table has no `orden_id` and the port does not expose that
   * query.
   */
  async listarPorMaquina(maquinaId: string): Promise<Mantenimiento[]> {
    const rows = await this.db.select<MantenimientoRow[]>(
      "SELECT * FROM mantenimiento WHERE machine_id = $1 ORDER BY inicio ASC",
      [maquinaId]
    );
    return rows.map(mapMantenimientoRow);
  }

  /**
   * Listado de UN DÍA OPERATIVO. El filtro por día viaja en la consulta — un
   * `WHERE` más, nada más (DD3): el predicado lo aplica la base, nunca el
   * llamador.
   *
   * Un día sin mantenimientos devuelve `[]`: el SQL no lanza por cero filas.
   *
   * Sin columna, índice ni migración nueva: el predicado lo sirve el índice
   * `idx_mantenimiento_maquina_fecha (machine_id, fecha_operativa)` de la
   * migración 005.
   * Orden: cronológico por `inicio`. Dos registros con el `inicio` idéntico
   * quedan en orden indefinido entre sí — el método no afirma determinismo
   * ahí, y el llamador no debe suponerlo. El caso se nombra en el contrato
   * de listado por día (`dayScopedListingContract.ts`, forma 5) en vez de
   * quedar sólo como un comment.
   */
  async listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Mantenimiento[]> {
    const rows = await this.db.select<MantenimientoRow[]>(
      "SELECT * FROM mantenimiento WHERE machine_id = $1 AND fecha_operativa = $2 ORDER BY inicio ASC",
      [maquinaId, fechaOperativa]
    );
    return rows.map(mapMantenimientoRow);
  }

  /**
   * Returns the open maintenance (`fin = null`) of the machine, or `null` if
   * there is none.
   *
   * Deterministic when the "one open maintenance per machine" invariant is
   * violated: the oldest open wins (`ORDER BY inicio ASC LIMIT 1`), never the
   * first one inserted. The predicate `fin IS NULL` is in the query, so the
   * mapped row has `fin: null` by construction; the cast to `MantenimientoAbierto`
   * reproduces exactly what the in-memory adapter does, and leaves the value
   * usable by `cerrarMantenimiento` without a cast at the call site.
   *
   * This is a query, NOT the enforcement of the "one open per machine"
   * invariant — that rule belongs to `registrarMantenimiento` (domain).
   */
  async getMantenimientoAbierto(maquinaId: string): Promise<MantenimientoAbierto | null> {
    const rows = await this.db.select<MantenimientoRow[]>(
      "SELECT * FROM mantenimiento WHERE machine_id = $1 AND fin IS NULL ORDER BY inicio ASC LIMIT 1",
      [maquinaId]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapMantenimientoRow(rows[0]) as MantenimientoAbierto;
  }
}