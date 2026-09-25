/**
 * Repositorio de órdenes EN MEMORIA — ticket 01.
 * Fuente temporal (fixture); reemplazable por SQLite en el futuro sin tocar
 * dominio ni UI (el adaptador solo implementa IOrderRepository).
 *
 * Reglas de alcance (acordadas):
 * - No crea órdenes: la orden debe existir en el índice para poder guardarla.
 * - No edita datos de la orden ni reasigna fechas: guarda el objeto completo,
 *   pero el dominio garantiza que el progreso (estado/lecturas) es lo único mutable.
 */
import type { Orden } from "../domain/types";
import type { IOrderRepository } from "./repository";
import { crearFixtureOrdenes } from "./fixtures";

export class InMemoryOrderRepository implements IOrderRepository {
  private readonly porId = new Map<string, Orden>();

  /** Se siembra con el fixture automáticamente; nada se crea desde la UI. */
  constructor(ordenes: Orden[] = crearFixtureOrdenes()) {
    for (const o of ordenes) {
      this.porId.set(o.id, structuredClone(o));
    }
  }

  async getOrderByFechaOperativa(fechaOperativa: string): Promise<Orden | undefined> {
    for (const o of this.porId.values()) {
      if (o.fechaOperativa === fechaOperativa) {
        return structuredClone(o);
      }
    }
    return undefined;
  }

  async saveOrder(orden: Orden): Promise<void> {
    if (!this.porId.has(orden.id)) {
      throw new Error(`no se puede guardar una orden inexistente: ${orden.id}`);
    }
    this.porId.set(orden.id, structuredClone(orden));
  }
}