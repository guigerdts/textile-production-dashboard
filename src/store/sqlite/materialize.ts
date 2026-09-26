/**
 * Ticket 10.8 — Materialización de la fuente externa (programa/fixtures)
 *
 * Composición mínima sobre el contrato `IOrderRepository.materializeOrder`
 * (evolucionado en este mismo ticket). No emite SQL, no conoce SQLite y no
 * duplica reglas de negocio: solo itera la fuente externa en orden y cuenta
 * qué se materializó.
 *
 * Decisiones (spec 10.8):
 * - Es una operación SEPARADA de `saveOrder`: `saveOrder` persiste PROGRESO de
 *   una orden existente y, por contrato, lanza si el id no existe; la
 *   materialización es la ÚNICA vía de creación de órdenes.
 * - Idempotente por construcción: insertar solo lo que falta nunca modifica ni
 *   recrea lo que ya está; reintentar tras un fallo parcial inserta únicamente
 *   las órdenes que faltaban.
 * - Fail-fast: el primer error del repositorio propaga a `main` y aborta el
 *   render. Nunca se reporta un éxito parcial en silencio (las órdenes ya
 *   insertadas permanecen; la próxima ejecución las encuentra y las salta).
 * - Identidad = `id` (PK). `numeroOrden`/`fechaOperativa` NO son identidad
 *   (no tienen restricción de unicidad en el esquema); una orden con el mismo
 *   `numeroOrden` y otro `id` se inserta como orden distinta.
 */

import type { Orden } from "../../domain/types";
import type { IOrderRepository } from "../repository";

/** Resultado de una ejecución de materialización (recuento, no estado). */
export interface ResultadoMaterializacion {
  /** Órdenes de la fuente que no existían y se insertaron. */
  insertadas: number;
  /** Órdenes de la fuente que ya existían y quedaron intactas. */
  existentes: number;
}

/**
 * Materializa las órdenes de la fuente externa (hoy `crearFixtureOrdenes()`)
 * en el repositorio, en el orden de la fuente, una llamada a
 * `materializeOrder` por orden.
 *
 * @param ordenRepository repositorio dueño de la persistencia de órdenes.
 * @param ordenes fuente externa completa (puede estar vacía: no inserta nada).
 * @returns Recuento de insertadas / existentes.
 * @throws El primer error del repositorio, sin envolver ni tragar.
 */
export async function materializarPrograma(
  ordenRepository: IOrderRepository,
  ordenes: Orden[]
): Promise<ResultadoMaterializacion> {
  let insertadas = 0;
  let existentes = 0;

  for (const orden of ordenes) {
    const insertada = await ordenRepository.materializeOrder(orden);
    if (insertada) {
      insertadas += 1;
    } else {
      existentes += 1;
    }
  }

  return { insertadas, existentes };
}
