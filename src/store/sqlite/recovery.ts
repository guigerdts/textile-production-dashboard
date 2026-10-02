/**
 * Recovery: Reconstruction of Persisted Sources (D2a / D2e / D2f)
 *
 * Composition over the existing repository contracts that reconstructs the
 * persisted sources after an application restart: the Phase 1 sources
 * (jornada, orden, persisted lecturas) plus the five operational domains
 * (paradas, actividades, daños, mantenimientos, inspecciones) — eight fields
 * in total. Recovery returns SOURCES only; derived states (progreso, time
 * summary, machine state, projected 2da, alert, buena_racha, inspection
 * estado) are computed AFTER recovery by the existing domain layer — never
 * here. `state.lecturas` keeps the read projection (`deltaGolpes: 0`
 * placeholder, ticket 10.8): the delta is recomputed at COMPOSITION time by
 * `componerOrdenConLecturas` / `mapOrdenRow(row, lecturas)` (G2 correction),
 * so the placeholder never reaches the domain layer.
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
 * - The four machine-event lists are requested ALREADY scoped to the
 *   requested day: `listarPorMaquinaYFecha(maquinaId, fechaOperativa)` applies
 *   the equality on the persisted `fechaOperativa` inside the port (DD3);
 *   recovery adds no date predicate of its own.
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
 * - The COMPOSITION callers recompute `deltaGolpes` from the absolute values
 *   with the shared `derivarDeltaGolpes` (G2 correction — the 10.8 placeholder
 *   is consumed there, never propagated): `componerOrdenConLecturas` below and
 *   `mapOrdenRow(row, lecturas)` apply the SAME derivation.
 * - iniciadaEn / contadorBase are sourced downstream by the existing
 *   `mapOrdenRow(row, lecturas)` composition from the FIRST persisted lectura;
 *   for the already-mapped Orden recovered here, `componerOrdenConLecturas`
 *   applies that same derivation (added in 10.8 for the App composition).
 * - No new columns and no migration; `IOrderRepository` never queries
 *   `lectura_golpe`. The four machine-event ports DO gain one new method
 *   (`listarPorMaquinaYFecha`) and keep `listarPorMaquina` intact (DD2).
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
import { derivarDeltaGolpes } from "./sqliteOrderRepository";

/**
 * Estado reconstruido: las OCHO fuentes persistidas (D2a: el nombre de la
 * interfaz se conserva; los campos crecen de 3 a 8).
 */
export interface RecoveryState {
  jornada: JornadaTurno; // vía IJornadaRepository (default 07:00-17:00 si no hay registro)
  orden: Orden | undefined; // vía IOrderRepository (undefined si no hay orden)
  lecturas: LecturaContador[]; // vía ILecturaGolpeRepository (solo persistidas)
  paradas: Parada[]; // vía IParadaRepository.listarPorMaquinaYFecha (día pedido)
  actividades: ActividadPlanificada[]; // vía IActividadPlanificadaRepository.listarPorMaquinaYFecha
  danos: Dano[]; // vía IDanoRepository.listarPorMaquinaYFecha
  mantenimientos: Mantenimiento[]; // vía IMantenimientoRepository.listarPorMaquinaYFecha
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

  // 4-7. Cuatro listas de eventos de máquina, acotadas a `fechaOperativa`
  //    (D2e): el día se resuelve dentro del puerto, nunca aquí. Secuencial
  //    para que un fallo sea diagnosticable en el dominio con nombre.
  const paradas = await paradaRepository.listarPorMaquinaYFecha(
    maquinaId,
    fechaOperativa
  );

  const actividades = await actividadRepository.listarPorMaquinaYFecha(
    maquinaId,
    fechaOperativa
  );

  const danos = await danoRepository.listarPorMaquinaYFecha(
    maquinaId,
    fechaOperativa
  );

  const mantenimientos = await mantenimientoRepository.listarPorMaquinaYFecha(
    maquinaId,
    fechaOperativa
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
 * Desde G2 (CORRECTION 11) también reconstruye `deltaGolpes` de los valores
 * absolutos con `derivarDeltaGolpes` — el placeholder 0 de `getLecturasByOrden`
 * se consume aquí, nunca se propaga al dominio. No persiste nada y no inventa
 * lecturas: una lista vacía deja ambos campos undefined y las lecturas vacías.
 */
export function componerOrdenConLecturas(
  orden: Orden,
  lecturas: LecturaContador[]
): Orden {
  return {
    ...orden,
    lecturas: derivarDeltaGolpes(lecturas),
    iniciadaEn: lecturas[0]?.timestamp,
    contadorBase: lecturas[0]?.valor,
  };
}