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
import type { Orden } from "../domain/types";

export interface IOrderRepository {
  /**
   * Devuelve la orden cuya fechaOperativa coincide con la fecha dada, o undefined
   * si no hay orden para ese día. La fecha se consulta directamente: la UI no
   * tiene selector de fecha; decide caso con/sin orden según esta respuesta.
   */
  getOrderByFechaOperativa(fechaOperativa: string): Orden | undefined;

  /**
   * Persiste el estado/progreso de una orden YA EXISTENTE.
   * Lanza un error si el id no existe: esta interfaz no crea órdenes.
   */
  saveOrder(orden: Orden): void;
}