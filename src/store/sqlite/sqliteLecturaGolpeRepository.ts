/**
 * Ticket 10.5 + 10.6 — SqliteLecturaGolpeRepository
 *
 * Two-phase lecture lifecycle (Q34-consistent, approved mechanism):
 *
 * 10.5 — Reservation (C3):
 * - ONE single atomic SQL write statement reserves the sequence:
 *     INSERT INTO lectura_golpe (id, orden_id, valor, timestamp, sequence, status)
 *     SELECT $1, $2, 0, $3, COALESCE(MAX(sequence), 0) + 1, 'reserved'
 *     FROM lectura_golpe
 *     WHERE orden_id = $4;
 * - lectureId is the retry/idempotency key (fast-path + PK-conflict re-check).
 * - UNIQUE(orden_id, sequence) index (migration 002) is the final barrier.
 *
 * 10.6 — Completion:
 * - ONE single atomic UPDATE transitions reserved -> persisted:
 *     UPDATE lectura_golpe
 *     SET valor = $2, timestamp = $3, status = 'persisted'
 *     WHERE id = $1 AND status = 'reserved';
 * - Sequence is NEVER recalculated or modified: a completion preserves exactly
 *   the sequence assigned at reservation.
 * - No BEGIN/COMMIT/ROLLBACK from JavaScript (tauri-plugin-sql has no
 *   transaction API and no connection affinity — documented in ticket 10.1).
 * - No Rust command; no plugin internals; only the installed public plugin API.
 *
 * Completion retry/idempotency semantics (10.6, registered in ticket):
 * - lectureId not found            -> descriptive error.
 * - status 'reserved'              -> single atomic UPDATE (status guard).
 * - already 'persisted' with the SAME (valor, timestamp) -> idempotent success
 *   (no write; no duplicate completion).
 * - already 'persisted' with DIFFERENT (valor, timestamp) -> conflict error;
 *   a persisted lecture is never silently overwritten.
 * - UPDATE with rowsAffected = 0   -> state is re-read and resolved exactly as
 *   the cases above; an unexpected non-transition never invents a completion
 *   and SQL errors always propagate.
 *
 * API notes verified from @tauri-apps/plugin-sql (dist-js/index.d.ts) and the
 * installed Rust source (tauri-plugin-sql 2.4.1):
 * - execute(query, bindValues?) => Promise<QueryResult> { rowsAffected, lastInsertId? }
 *   (Rust: pool.execute -> rows_affected() = sqlite3_changes(). For a single
 *   UPDATE: 1 = one row matched and changed, 0 = no row matched the guard).
 * - select<T>(query, bindValues?) => Promise<T>
 * - SQLite uses $1/$2/... named bind placeholders (the `?` form is MySQL-only
 *   in the plugin examples).
 * - Errors surface as rejected promises; the plugin does NOT expose a
 *   structured/documented error class. Resume/recovery of failure modes is
 *   driven by explicit SELECT re-checks, never by invented success.
 */

import type Database from "@tauri-apps/plugin-sql";
import type { LecturaContador } from "../../domain/types";
import type { ILecturaGolpeRepository } from "../repository";

/**
 * Provisional timestamp stored on a reservation. The real timestamp is
 * written at completion (ticket 10.6). Documented placeholder value.
 */
export const RESERVATION_PLACEHOLDER_TIMESTAMP = "1970-01-01T00:00:00.000Z";

/** Status used for reserved (not yet completed) lectures. */
export const RESERVED_STATUS = "reserved";

interface ReservationRow {
  sequence: number;
  orden_id: string;
  status: string;
}

/** Snapshot used by completion: adds the persisted projection for the
 *  idempotent-retry check (same (valor, timestamp) -> success, different -> conflict). */
interface LectureSnapshot extends ReservationRow {
  valor: number;
  timestamp: string;
}

export class SqliteLecturaGolpeRepository implements ILecturaGolpeRepository {
  constructor(private db: Database) {}

  /**
   * Reserve a sequence atomically (approved C3 mechanism).
   *
   * @returns The reserved sequence number (starts at 1 per order).
   * @throws If the insert fails for a non-PK-conflict reason, or if the
   *         lectureId exists in a non-reserved state after a rejected insert.
   */
  async reserveSequence(ordenId: string, lectureId: string): Promise<number> {
    // 1. Fast-path (retry/idempotency): if lectureId already reserved,
    //    return the existing sequence. No recalculation, no second row.
    const existing = await this.findReservation(lectureId);
    if (existing) {
      return existing.sequence;
    }

    // 2. ONE single atomic write statement (C3).
    //    SQLite makes a single statement atomic and serializes writers.
    try {
      const result = await this.db.execute(
        `INSERT INTO lectura_golpe (id, orden_id, valor, timestamp, sequence, status)
         SELECT $1, $2, 0, $3, COALESCE(MAX(sequence), 0) + 1, 'reserved'
         FROM lectura_golpe
         WHERE orden_id = $4`,
        [lectureId, ordenId, RESERVATION_PLACEHOLDER_TIMESTAMP, ordenId]
      );

      // 3. Success = the statement inserted a row.
      if (result.rowsAffected < 1) {
        // rowsAffected 0 with no error is unexpected for this statement;
        // treat as failure rather than silently returning a sequence.
        throw new Error(
          `reserveSequence: no se insertó ninguna fila para lectureId ${lectureId}`
        );
      }

      // 4. Read the reserved sequence back via SELECT by lectureId.
      const rows = await this.db.select<{ sequence: number }[]>(
        "SELECT sequence FROM lectura_golpe WHERE id = $1",
        [lectureId]
      );
      if (rows.length === 0) {
        throw new Error(
          `reserveSequence: lectureId ${lectureId} no encontrado tras la reserva`
        );
      }
      return rows[0].sequence;
    } catch (error) {
      // 5. PK-conflict (same lectureId) from a concurrent fast-path race:
      //    the insert was rejected because the id already exists. The plugin
      //    API does not expose a reliable structured PK/UNIQUE error class,
      //    so we re-check explicitly and only satisfy the conflict branch when
      //    the existing row is in 'reserved' status. Anything else propagates.
      const reservation = await this.findReservationRow(lectureId);
      if (reservation && reservation.status === RESERVED_STATUS) {
        return reservation.sequence;
      }
      throw error;
    }
  }

  /**
   * Find an existing reservation by lectureId.
   * Returns undefined if no row exists.
   */
  async findReservation(
    lectureId: string
  ): Promise<{ sequence: number; ordenId: string } | undefined> {
    const row = await this.findReservationRow(lectureId);
    if (!row) {
      return undefined;
    }
    return { sequence: row.sequence, ordenId: row.orden_id };
  }

  /** Internal lookup including status (used for conflict handling). */
  private async findReservationRow(
    lectureId: string
  ): Promise<ReservationRow | undefined> {
    const rows = await this.db.select<ReservationRow[]>(
      "SELECT sequence, orden_id, status FROM lectura_golpe WHERE id = $1",
      [lectureId]
    );
    if (rows.length === 0) {
      return undefined;
    }
    return rows[0];
  }

  /**
   * Complete a reserved lecture (10.6).
   *
   * Semantics (registered in ticket 10.6):
   * - Reserved row            -> ONE single atomic UPDATE with a status guard
   *                              (`WHERE id = $1 AND status = 'reserved'`),
   *                              setting valor/timestamp/status='persisted'.
   *                              Sequence is NEVER recalculated or modified.
   * - lectureId not found     -> descriptive error.
   * - Already persisted with the SAME (valor, timestamp) -> idempotent success
   *   (no write; the lecture is not completed twice).
   * - Already persisted with DIFFERENT (valor, timestamp) -> conflict error;
   *   a persisted lecture is never silently overwritten.
   * - UPDATE with rowsAffected = 0 -> the state is re-read and resolved with
   *   exactly the rules above; an unexpected non-transition throws instead of
   *   inventing a completion, and SQL errors always propagate.
   *
   * @throws If the lecture does not exist, is in an unexpected state, the
   *         retry data conflicts with already-persisted data, or the UPDATE
   *         fails.
   */
  async completeLecture(
    lectureId: string,
    valor: number,
    timestamp: string
  ): Promise<void> {
    // 1. Snapshot read to classify the current state of the lecture.
    const row = await this.findLectureSnapshot(lectureId);
    if (!row) {
      throw new Error(`completeLecture: lectura no encontrada: ${lectureId}`);
    }

    if (row.status !== RESERVED_STATUS) {
      // Already persisted (e.g. retry after crash): apply the idempotency
      // rule — identical data succeeds, different data conflicts.
      this.assertIdempotentRetry(row, lectureId, valor, timestamp);
      return;
    }

    // 2. Reserved -> ONE single atomic UPDATE. The status guard is inside the
    //    statement, and the sequence column is NOT part of the statement at
    //    all: completions never touch the sequence (implicit UNIQUE(orden_id,
    //    sequence) final barrier from migration 002 stays untouched).
    const result = await this.db.execute(
      "UPDATE lectura_golpe SET valor = $2, timestamp = $3, status = 'persisted' WHERE id = $1 AND status = 'reserved'",
      [lectureId, valor, timestamp]
    );

    // 3. rowsAffected >= 1: the reservation transitioned to persisted.
    if (result.rowsAffected >= 1) {
      return;
    }

    // 4. rowsAffected === 0: the guard matched nothing — another actor
    //    completed this lecture between our snapshot and the UPDATE. Re-read
    //    the state and resolve it with the same rules as step 1; never
    //    fabricate a completed outcome.
    const after = await this.findLectureSnapshot(lectureId);
    if (!after) {
      throw new Error(`completeLecture: lectura no encontrada: ${lectureId}`);
    }
    if (after.status === RESERVED_STATUS) {
      throw new Error(
        `completeLecture: estado inesperado: la lectura ${lectureId} sigue en estado 'reserved' tras un UPDATE de 0 filas`
      );
    }
    this.assertIdempotentRetry(after, lectureId, valor, timestamp);
  }

  /** Retry rule for an already-persisted lecture: identical data is an
   *  idempotent success; different data is a conflict (no silent overwrite). */
  private assertIdempotentRetry(
    row: LectureSnapshot,
    lectureId: string,
    valor: number,
    timestamp: string
  ): void {
    if (row.valor === valor && row.timestamp === timestamp) {
      return;
    }
    throw new Error(
      `completeLecture: conflicto: la lectura ${lectureId} ya está persistida con valores diferentes; no se sobrescribe`
    );
  }

  /** Snapshot lookup including the persisted projection (used by completion). */
  private async findLectureSnapshot(
    lectureId: string
  ): Promise<LectureSnapshot | undefined> {
    const rows = await this.db.select<LectureSnapshot[]>(
      "SELECT sequence, orden_id, status, valor, timestamp FROM lectura_golpe WHERE id = $1",
      [lectureId]
    );
    return rows[0];
  }

  /**
   * Get all PERSISTED lectures for an order, ordered by sequence ASC.
   *
   * Reserved (in-flight) lectures are intentionally excluded: only completed
   * readings are observable by consumers. Gaps in sequence are preserved —
   * ordering comes from sequence, not from row contiguity.
   *
   * NOTE on deltaGolpes: the repository persists the reading projection only;
   * delta between consecutive lectures is derived by DOMAIN logic (see domain
   * types). `deltaGolpes: 0` is the documented placeholder until the domain
   * layer consumes these rows (ticket 10.8).
   */
  async getLecturasByOrden(ordenId: string): Promise<LecturaContador[]> {
    const rows = await this.db.select<{ valor: number; timestamp: string }[]>(
      "SELECT valor, timestamp FROM lectura_golpe WHERE orden_id = $1 AND status = $2 ORDER BY sequence ASC",
      [ordenId, "persisted"]
    );
    return rows.map((row) => ({
      valor: row.valor,
      timestamp: row.timestamp,
      deltaGolpes: 0,
    }));
  }

  /**
   * Get the maximum sequence for an order (0 if no lectures).
   */
  async getMaxSequence(ordenId: string): Promise<number> {
    const rows = await this.db.select<{ max_sequence: number | null }[]>(
      "SELECT COALESCE(MAX(sequence), 0) AS max_sequence FROM lectura_golpe WHERE orden_id = $1",
      [ordenId]
    );
    return rows[0]?.max_sequence ?? 0;
  }
}