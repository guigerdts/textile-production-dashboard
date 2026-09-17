/**
 * Seam de dominio — ticket 06 (proyección de 2da, alerta operativa y buena racha).
 * Funciones PURAS: sin imports de UI, API ni persistencia.
 *
 * La proyección operativa de segunda es un valor DERIVADO de la sospecha
 * registrada por Estampado (Ticket 05), nunca una clasificación oficial:
 * Acabado sigue siendo dueño de la clasificación real de 1ra/2da y su
 * sincronización sigue pendiente.
 *
 * Separación de conceptos:
 * - Segunda PLANIFICADA: `orden.porcentaje2da` (Ticket 01) calcula el objetivo
 *   operativo; este seam NO la toca.
 * - Segunda SOSPECHADA: daños con `posibleSegunda` + `unidadesSospechadas`
 *   (Ticket 05); es la entrada de la proyección.
 * - Segunda OFICIAL: pertenece a Acabado; no existe en el sistema.
 *
 * La proyección no se persiste, no se edita y no modifica `porcentaje2da`,
 * `unidadesObjetivo`, `golpesRequeridos`, lecturas, progreso ni estado de la
 * orden.
 */
import type { Dano, Orden } from "./types";
import { golpesProducidosDesdeLecturas, unidadesParaGolpes } from "./calculations";

/** Umbral de alerta operativa: la proyección genera alerta SOLO si supera 3% estrictamente. */
export const UMBRAL_ALERTA_2DA = 0.03;

/**
 * Meta mensual de 2da (< 5%) como referencia de comparación únicamente.
 * NO es un agregado mensual real: solo hay datos del día operativo actual y la
 * sincronización de Acabado no existe. Se muestra como número de referencia.
 */
export const META_MENSUAL_2DA = 0.05;

export type EstadoProyeccion2da = "sin_datos" | "buena_racha" | "alerta";

export interface ResultadoProyeccion2da {
  /** % proyectado (fracción decimal, ej. 0.04 = 4%). null si no hay producción. */
  pct: number | null;
  /**
   * - "sin_datos": no hay unidades producidas.
   * - "buena_racha": hay producción y la proyección es menor o igual al 3%
   *   (riesgo operativo dentro del umbral durante la producción actual; NO
   *   demuestra racha histórica, continuidad ni uptime).
   * - "alerta": hay producción y la proyección es mayor al 3%.
   */
  estado: EstadoProyeccion2da;
  /** true si pct <= umbral, false si pct > umbral, null si sin_datos. */
  dentroUmbral: boolean | null;
}

/**
 * Proyección operativa de segunda para la producción actual.
 *
 * pct = unidadesSospechadas / unidadesProducidas.
 * Sin unidades producidas => "sin_datos" (sin división por cero, sin alerta,
 * sin buena racha). Una orden sin daños pero con producción proyecta 0%.
 * Exactamente 3% NO genera alerta (buena_racha); solo superarlo la genera.
 */
export function proyeccionSegundaProducida(
  unidadesProducidas: number,
  unidadesSospechadas: number,
): ResultadoProyeccion2da {
  if (unidadesProducidas <= 0) {
    return { pct: null, estado: "sin_datos", dentroUmbral: null };
  }
  const pct = unidadesSospechadas / unidadesProducidas;
  if (pct > UMBRAL_ALERTA_2DA) {
    return { pct, estado: "alerta", dentroUmbral: false };
  }
  return { pct, estado: "buena_racha", dentroUmbral: true };
}

// ---------------------------------------------------------------------------
// Ciclo 2 — integración calculada
// ---------------------------------------------------------------------------

export interface ResultadoIntegracion2da {
  /** Proyección operativa calculada desde producción + sospechas agregadas. */
  proyeccion: ResultadoProyeccion2da;
  /** Unidades producidas derivadas de las lecturas (lógica existente de calculations). */
  unidadesProducidas: number;
  /** Suma de unidades sospechadas SOLO de daños con posibleSegunda === true y unidades definidas. */
  unidadesSospechadas: number;
  /**
   * Daños de la orden con posibleSegunda === true pero SIN unidades definidas.
   * Permanecen visibles para la UI (Ciclo 3) pero NO aportan número: solo
   * registro la sospecha cualitativa, nunca la cuantifico.
   */
  danosConSospechaSinUnidades: number;
}

/**
 * Integración calculada — ciclo 2 del ticket 06.
 *
 * deriva el progreso ACTUAL de la orden con la lógica existente
 * (`golpesProducidosDesdeLecturas` + `unidadesParaGolpes`) y agrega las
 * sospechas de los daños de esa orden. El caller entrega los daños ya
 * consultados por `danoRepository.listarPorOrden(orden.id)`; el seam además
 * filtra por `ordenId` para no confiar en el caller (defensa ante daños de
 * otra orden o daños sin orden).
 *
 * - Considera únicamente daños con `posibleSegunda === true`.
 * - Suma únicamente `unidadesSospechadas` definidas; las sospechas sin
 *   unidades se cuentan pero NO suman (condición 6).
 * - NO muta la orden ni los daños: solo lee lecturas y agrega un acumulador.
 * - NO toca `porcentaje2da`, `unidadesSolicitadas`, `golpesRequeridos`,
 *   lecturas, progreso ni estado de la orden (condición 8).
 * - Segunda planificada, sospechada y oficial se mantienen separadas: este
 *   seam solo conoce la SOSPECHADA y delega a `proyeccionSegundaProducida`.
 */
export function proyeccionSegundaDeOrden(
  orden: Orden,
  danosDeOrden: Dano[],
): ResultadoIntegracion2da {
  const unidadesProducidas = unidadesParaGolpes(
    golpesProducidosDesdeLecturas(orden.lecturas ?? []),
  );

  let unidadesSospechadas = 0;
  let danosConSospechaSinUnidades = 0;
  for (const dano of danosDeOrden) {
    if (dano.ordenId !== orden.id) {
      // Defensa: solo daños de la orden actual (listarPorOrden ya excluye
      // daños sin orden y de otras órdenes; el seam no confía en el caller).
      continue;
    }
    if (dano.posibleSegunda !== true) {
      continue;
    }
    if (dano.unidadesSospechadas === undefined) {
      danosConSospechaSinUnidades += 1;
      continue;
    }
    unidadesSospechadas += dano.unidadesSospechadas;
  }

  return {
    proyeccion: proyeccionSegundaProducida(unidadesProducidas, unidadesSospechadas),
    unidadesProducidas,
    unidadesSospechadas,
    danosConSospechaSinUnidades,
  };
}