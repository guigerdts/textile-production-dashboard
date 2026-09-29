/**
 * Recovery: Reconstruction of Persisted Sources (D2a / D2e / D2f)
 *
 * Composition over the existing repository contracts that reconstructs the
 * persisted sources after an application restart: the Phase 1 sources
 * (jornada, orden, persisted lecturas) plus the five operational domains
 * (paradas, actividades, daños, mantenimientos, inspecciones) — eight fields
 * in total. Recovery returns SOURCES only; derived states (deltaGolpes,
 * progreso, time summary, machine state, projected 2da, alert, buena_racha,
 * inspection estado) are computed AFTER recovery by the existing domain layer
 * — never here.
 *
 * Design decisions:
 * - Contract-based composition: receives the EIGHT repository interfaces,
 *   NEVER a raw Database and NEVER issues SQL.
 * - D2a: the function is `recoverPersistedState` — the name names the promise,
 *   not a project-plan phase. The `RecoveryState` interface name is KEPT.
 * - D2e read order, sequential, each await:
 *   jornada → orden → lecturas → paradas → actividades → daños →
 *   mantenimientos → inspecciones. No `Promise.all` fan-out: a read failure
 *   PROPAGATES (never downgraded to an empty list) so a partial failure is
 *   diagnosable at a named domain. The only declared dependency is `orden`
 *   (lecturas and inspecciones are guarded by it).
 * - D2f: `maquinaId` is an explicit parameter (`main.tsx` passes `"M1"`), not
 *   a hidden coupling to ADR 0003 inside this function. Grouping: the eight
 *   repositories first, then the two scalars (`fechaOperativa`, `maquinaId`).
 * - The four machine-event lists carry the machine's FULL history: recovery
 *   applies NO date predicate (a future "read a past day" feature adds it to
 *   the ports, never to recovery).
 * - Jornada via `obtenerParaFecha(fechaOperativa)`: absent record -> domain
 *   default 07:00–17:00, which is NOT auto-persisted (repository-owned).
 * - Orden via `getOrderByFechaOperativa(fechaOperativa)`: undefined when
 *   absent; persisted `estado` is never inferred from golpe count.
 * - Persisted lecturas via `getLecturasByOrden(orden.id)`: persisted only
 *   (reserved excluded), ordered by sequence ASC (repository-owned ORDER BY);
 *   empty when there is no order.
 * - No derived computation here: `getLecturasByOrden` returns `deltaGolpes: 0`
 *   (documented placeholder); recovery must not compute deltaGolpes, progreso,
 *   machine state, time, durations, projected 2da, alerts or inspection estado.
 * - iniciadaEn / contadorBase are sourced downstream by the existing
 *   `mapOrdenRow(row, lecturas)` composition from the FIRST persisted lectura;
 *   for the already-mapped Orden recovered here, `componerOrdenConLecturas`
 *   applies that same derivation (added in 10.8 for the App composition).
 * - No new columns, no new repository methods; `IOrderRepository` never
 *   queries `lectura_golpe`.
 *
 * Honesty note (10.7): mock-based tests do not require migrations (they fake
 * the repository contracts). Runtime validation against the real SQLite schema
 * requires the migrations to exist and a Tauri environment — still PENDING.
 */

import type {
  ActividadPlanificada,
  Dano,
  InspeccionTela,
  JornadaTurno,
  LecturaContador,
  Mantenimiento,
  Orden,
  Parada,
} from "../../domain/types";
import type { IJornadaRepository } from "../jornadaRepository";
import type { IOrderRepository, ILecturaGolpeRepository } from "../repository";
import type { IParadaRepository } from "../paradasRepository";
import type { IActividadPlanificadaRepository } from "../actividadesRepository";
import type { IDanoRepository } from "../danosRepository";
import type { IMantenimientoRepository } from "../mantenimientoRepository";
import type { IInspeccionRepository } from "../inspeccionRepository";

/**
 * Estado reconstruido: las OCHO fuentes persistidas (D2a: el nombre de la
 * interfaz se conserva; los campos crecen de 3 a 8).
 */
export interface RecoveryState {
  jornada: JornadaTurno; // vía IJornadaRepository (default 07:00-17:00 si no hay registro)
  orden: Orden | undefined; // vía IOrderRepository (undefined si no hay orden)
  lecturas: LecturaContador[]; // vía ILecturaGolpeRepository (solo persistidas)
  paradas: Parada[]; // vía IParadaRepository.listarPorMaquina (historial completo)
  actividades: ActividadPlanificada[]; // vía IActividadPlanificadaRepository.listarPorMaquina
  danos: Dano[]; // vía IDanoRepository.listarPorMaquina
  mantenimientos: Mantenimiento[]; // vía IMantenimientoRepository.listarPorMaquina
  inspecciones: InspeccionTela[]; // vía IInspeccionRepository.listarPorOrden ([] sin orden)
}

/**
 * Reconstruye las ocho fuentes persistidas tras un reinicio, componiendo los
 * ocho contratos de repositorio existentes. No deriva, no persiste, no emite
 * SQL. El orden de lectura es secuencial y fijo (D2e); un fallo de lectura se
 * PROPAGA — nunca se convierte en una lista vacía.
 */
export async function recoverPersistedState(
  jornadaRepository: IJornadaRepository,
  orderRepository: IOrderRepository,
  lecturaRepository: ILecturaGolpeRepository,
  paradaRepository: IParadaRepository,
  actividadRepository: IActividadPlanificadaRepository,
  danoRepository: IDanoRepository,
  mantenimientoRepository: IMantenimientoRepository,
  inspeccionRepository: IInspeccionRepository,
  fechaOperativa: string,
  maquinaId: string
): Promise<RecoveryState> {
  // 1. Jornada: obtenerParaFecha(fechaOperativa)
  //    default 07:00-17:00 cuando no hay registro; NUNCA se auto-persiste.
  const jornada = await jornadaRepository.obtenerParaFecha(fechaOperativa);

  // 2. Orden: getOrderByFechaOperativa(fechaOperativa)
  //    undefined cuando no hay orden; estado leído tal como fue persistido.
  const orden = await orderRepository.getOrderByFechaOperativa(fechaOperativa);

  // 3. Lecturas persistidas: getLecturasByOrden(orden.id)
  //    solo persistidas (reservadas excluidas), ORDER BY sequence ASC
  //    (responsabilidad del repositorio); [] cuando no hay orden.
  const lecturas = orden
    ? await lecturaRepository.getLecturasByOrden(orden.id)
    : [];

  // 4-7. Cuatro listas de eventos de máquina: historial COMPLETO de la
  //    máquina, SIN predicado de fecha (D2e). Secuencial para que un fallo
  //    sea diagnosticable en el dominio con nombre.
  const paradas = await paradaRepository.listarPorMaquina(maquinaId);

  const actividades = await actividadRepository.listarPorMaquina(maquinaId);

  const danos = await danoRepository.listarPorMaquina(maquinaId);

  const mantenimientos = await mantenimientoRepository.listarPorMaquina(
    maquinaId
  );

  // 8. Inspecciones: requieren orden.id; MISMO guard que lecturas ([]) cuando
  //    no hay orden — la única dependencia declarada del orden D2e.
  const inspecciones = orden
    ? await inspeccionRepository.listarPorOrden(orden.id)
    : [];

  return {
    jornada,
    orden,
    lecturas,
    paradas,
    actividades,
    danos,
    mantenimientos,
    inspecciones,
  };
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