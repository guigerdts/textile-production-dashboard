/**
 * Ticket 10.7 — Recovery: Reconstruction of Phase 1 Sources
 *
 * Composition over the existing repository contracts that reconstructs the
 * persisted Phase 1 sources (jornada, orden, persisted lecturas) after an
 * application restart. Recovery returns SOURCES only; derived states
 * (deltaGolpes, progreso, time summary, machine state) are computed AFTER
 * recovery by the existing domain layer — never here.
 *
 * Design decisions:
 * - Contract-based composition: receives the three repository interfaces,
 *   NEVER a raw Database and NEVER issues SQL.
 * - Jornada via `obtenerParaFecha(fechaOperativa)`: absent record -> domain
 *   default 07:00–17:00, which is NOT auto-persisted (repository-owned).
 * - Orden via `getOrderByFechaOperativa(fechaOperativa)`: undefined when
 *   absent; persisted `estado` is never inferred from golpe count.
 * - Persisted lecturas via `getLecturasByOrden(orden.id)`: persisted only
 *   (reserved excluded), ordered by sequence ASC (repository-owned ORDER BY);
 *   empty when there is no order.
 * - No derived computation here: `getLecturasByOrden` returns `deltaGolpes: 0`
 *   (documented placeholder); recovery must not compute deltaGolpes, progreso,
 *   machine state or time.
 * - iniciadaEn / contadorBase are sourced downstream by the existing
 *   `mapOrdenRow(row, lecturas)` composition from the FIRST persisted lectura;
 *   for the already-mapped Orden recovered here, `componerOrdenConLecturas`
 *   applies that same derivation (added in 10.8 for the App composition).
 * - No new columns, no new repository methods; `IOrderRepository` never
 *   queries `lectura_golpe`.
 *
 * Honesty note (10.7): mock-based tests do not require migration 003 (they
 * fake the repository contracts). Runtime validation against the real SQLite
 * schema requires migration 003 to exist (external ticket) — see ticket 10.7.
 */

import type { JornadaTurno, LecturaContador, Orden } from "../../domain/types";
import type { IJornadaRepository } from "../jornadaRepository";
import type { IOrderRepository, ILecturaGolpeRepository } from "../repository";

/** Estado reconstruido: las tres fuentes persistentes de la Fase 1. */
export interface RecoveryState {
  jornada: JornadaTurno; // vía IJornadaRepository (default 07:00-17:00 si no hay registro)
  orden: Orden | undefined; // vía IOrderRepository (undefined si no hay orden)
  lecturas: LecturaContador[]; // vía ILecturaGolpeRepository (solo persistidas)
}

/**
 * Reconstruye las fuentes de la Fase 1 tras un reinicio, componiendo los tres
 * contratos de repositorio existentes. No deriva, no persiste, no emite SQL.
 */
export async function recoverPhase1State(
  jornadaRepository: IJornadaRepository,
  orderRepository: IOrderRepository,
  lecturaRepository: ILecturaGolpeRepository,
  fechaOperativa: string
): Promise<RecoveryState> {
  // 1. Jornada: obtenerParaFecha(fechaOperativa)
  //    default 07:00-17:00 cuando no hay registro; NUNCA se auto-persiste.
  const jornada = await jornadaRepository.obtenerParaFecha(fechaOperativa);

  // 2. Orden: getOrderByFechaOperativa(fechaOperativa)
  //    undefined cuando no hay orden; estado leído tal como fue persistido.
  const orden = await orderRepository.getOrderByFechaOperativa(fechaOperativa);

  // 3. Lecturas persistidas: getLecturasByOrden(orden.id)
  //    solo persistidas (reservadas excluidas), ORDER BY sequence ASC
  //    (responsabilidad del repositorio).
  const lecturas = orden
    ? await lecturaRepository.getLecturasByOrden(orden.id)
    : [];

  return { jornada, orden, lecturas };
}

/**
 * Compone sobre la orden las lecturas YA PERSISTIDAS que devuelve
 * `ILecturaGolpeRepository` (ticket 10.8). Necesario porque
 * `IOrderRepository.getOrderByFechaOperativa` nunca consulta `lectura_golpe`
 * (10.4/10.5: cada tabla tiene su dueño), mientras que el dominio exige que
 * una orden en producción tenga su base y su historial de lecturas.
 *
 * Es la MISMA derivación que aplica `mapOrdenRow(row, lecturas)` (10.4):
 * `iniciadaEn = lecturas[0].timestamp` y `contadorBase = lecturas[0].valor`.
 * No calcula deltas, progreso ni tiempo (eso es del dominio), no persiste
 * nada y no inventa lecturas: una lista vacía deja ambos campos undefined.
 */
export function componerOrdenConLecturas(
  orden: Orden,
  lecturas: LecturaContador[]
): Orden {
  return {
    ...orden,
    lecturas,
    iniciadaEn: lecturas[0]?.timestamp,
    contadorBase: lecturas[0]?.valor,
  };
}