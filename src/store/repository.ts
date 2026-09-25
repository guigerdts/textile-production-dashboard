/**
 * Interfaz pública del repositorio de órdenes — ticket 01.
 * Contrato mínimo y reemplazable: hoy InMemoryRepository, mañana SqliteRepository,
 * SIN cambiar el dominio ni la UI.
 *
 * Reglas de alcance (acordadas):
 * - Solo lectura de órdenes existentes (llegaron de la programación semanal externa).
 * - saveOrder persiste el PROGRESO de una orden existente (inicio, lecturas, finalización).
 *   No crea, no edita datos de la orden y no reasigna fechas.
 */
import type { LecturaContador, Orden } from "../domain/types";

export interface IOrderRepository {
  /**
   * Devuelve la orden cuya fechaOperativa coincide con la fecha dada, o undefined
   * si no hay orden para ese día. La fecha se consulta directamente: la UI no
   * tiene selector de fecha; decide caso con/sin orden según esta respuesta.
   */
  getOrderByFechaOperativa(fechaOperativa: string): Promise<Orden | undefined>;

  /**
   * Persiste el estado/progreso de una orden YA EXISTENTE.
   * Lanza un error si el id no existe: esta interfaz no crea órdenes.
   */
  saveOrder(orden: Orden): Promise<void>;
}

/**
 * Repositorio de lecturas de golpe (ticket 10.2 / 10.5 / 10.6).
 * Contrato async que la implementación SQLite (ticket 10.5) satisface con el
 * mecanismo C3 aprobado: reserva por UNA sola sentencia de escritura atómica
 * (INSERT..SELECT COALESCE(MAX(sequence),0)+1), sin BEGIN/COMMIT desde JS,
 * con lectureId como clave de retry/idempotencia y UNIQUE(orden_id, sequence)
 * como barrera final (migración 002). La completion (ticket 10.6) es UNA sola
 * sentencia UPDATE atómica con guard de estado que preserva la sequence; el
 * retry de una lectura ya persistida es idempotente solo con datos idénticos
 * (conflicto si difieren; nunca se sobrescribe en silencio).
 */
export interface ILecturaGolpeRepository {
  /** Reserve a sequence atomically. Returns the reserved sequence number.
   *  Mechanism (approved C3, 2026-09-22): single atomic INSERT..SELECT
   *  COALESCE(MAX(sequence),0)+1 per order; lectureId is the retry/idempotency
   *  key; UNIQUE(orden_id, sequence) is the final barrier. No BEGIN/COMMIT. */
  reserveSequence(ordenId: string, lectureId: string): Promise<number>;
  /** Complete a reserved lecture with valor and timestamp. Persists the exact
   *  given (valor, timestamp) with a single atomic UPDATE and preserves the
   *  reserved sequence. Retry on an already-persisted lecture is idempotent
   *  only when (valor, timestamp) are identical; different data throws a
   *  conflict error (never silently overwrites). */
  completeLecture(lectureId: string, valor: number, timestamp: string): Promise<void>;
  /** Find an existing reservation by lectureId. Returns undefined if not found. */
  findReservation(lectureId: string): Promise<{ sequence: number; ordenId: string } | undefined>;
  /** Get all persisted lectures for an order, ordered by sequence ASC. */
  getLecturasByOrden(ordenId: string): Promise<LecturaContador[]>;
  /** Get the maximum sequence for an order (0 if no lectures). */
  getMaxSequence(ordenId: string): Promise<number>;
}
