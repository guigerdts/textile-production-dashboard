/**
 * Seam de dominio — ticket 04 (modelo de tiempo derivado).
 * Funciones PURAS: sin imports de UI, API ni persistencia.
 *
 * El tiempo productivo NUNCA se escribe manualmente: se deriva de la jornada,
 * la unión de actividades planificadas y la unión de paradas (incidencias).
 * Reglas (modelo funcional aprobado):
 *  - actividades y paradas ABIERTAS se computan hasta `instanteConsulta`;
 *  - los intervalos se RECORTAN a la ventana de jornada (07:00–17:00 default);
 *  - la unión de intervalos evita doble conteo: actividades entre sí, paradas
 *    entre sí, y actividades+paradas;
 *  - productivo = max(0, disponible − unión(planificado, incidencias));
 *  - los registros originales NUNCA se mutan durante el cálculo.
 */
import type {
  ActividadPlanificada,
  JornadaTurno,
  Parada,
  ResumenTiempoTurno,
} from "./types";

// ---------------------------------------------------------------------------
// Jornada
// ---------------------------------------------------------------------------

/** Hora de inicio por defecto de la jornada (07:00). */
export const HORA_INICIO_DEFAULT = "T07:00:00.000Z";
/** Hora de fin por defecto de la jornada (17:00). */
export const HORA_FIN_DEFAULT = "T17:00:00.000Z";

/** Construye la jornada por defecto (07:00–17:00) para una fecha operativa (YYYY-MM-DD). */
export function jornadaDefault(fechaOperativa: string): JornadaTurno {
  return {
    inicio: `${fechaOperativa}${HORA_INICIO_DEFAULT}`,
    fin: `${fechaOperativa}${HORA_FIN_DEFAULT}`,
  };
}

/**
 * Valida una jornada: inicio y fin requeridos, fin posterior al inicio.
 * Devuelve lista de errores (vacía si está OK).
 */
export function validarJornada(jornada: JornadaTurno): string[] {
  const errores: string[] = [];

  if (!jornada.inicio || jornada.inicio.trim() === "") {
    errores.push("debe indicar el inicio de la jornada");
  }
  if (!jornada.fin || jornada.fin.trim() === "") {
    errores.push("debe indicar el fin de la jornada");
  }

  const inicio = new Date(jornada.inicio).getTime();
  const fin = new Date(jornada.fin).getTime();
  if (
    !Number.isNaN(inicio) &&
    !Number.isNaN(fin) &&
    fin <= inicio
  ) {
    errores.push("el fin de la jornada debe ser posterior al inicio");
  }

  return errores;
}

// ---------------------------------------------------------------------------
// Intervalos (helpers privados)
// ---------------------------------------------------------------------------

interface Intervalo {
  /** Inicio efectivo (ms epoch). */
  inicio: number;
  /** Fin efectivo (ms epoch). Siempre > inicio. */
  fin: number;
}

/**
 * Normaliza un período real (inicio → fin, o abierto hasta instanteConsulta)
 * y lo recorta a la ventana de jornada. Devuelve null si no hay cobertura
 * dentro de la ventana o si algún timestamp es inválido.
 */
function intervaloRecortado(
  inicio: string,
  fin: string | null,
  instanteConsulta: string,
  jornadaInicioMs: number,
  jornadaFinMs: number,
): Intervalo | null {
  const inicioMs = new Date(inicio).getTime();
  if (Number.isNaN(inicioMs)) return null;

  const finMs =
    fin !== null ? new Date(fin).getTime() : new Date(instanteConsulta).getTime();
  if (Number.isNaN(finMs)) return null;

  const inicioEf = Math.max(inicioMs, jornadaInicioMs);
  const finEf = Math.min(finMs, jornadaFinMs);

  if (inicioEf >= finEf) return null;
  return { inicio: inicioEf, fin: finEf };
}

/**
 * Une intervalos superpuestos/adyacentes (sorted merge).
 * No muta el array de entrada: devuelve una nueva lista.
 */
function unirIntervalos(intervalos: Intervalo[]): Intervalo[] {
  const ordenados = [...intervalos].sort((a, b) => a.inicio - b.inicio);
  const unidos: Intervalo[] = [];

  for (const actual of ordenados) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && actual.inicio <= ultimo.fin) {
      ultimo.fin = Math.max(ultimo.fin, actual.fin);
    } else {
      unidos.push({ ...actual });
    }
  }

  return unidos;
}

/** Duración total de una lista de intervalos en segundos (redondeada). */
function duracionSegundos(intervalos: Intervalo[]): number {
  const ms = intervalos.reduce((total, i) => total + (i.fin - i.inicio), 0);
  return Math.round(ms / 1000);
}

// ---------------------------------------------------------------------------
// Resumen del turno
// ---------------------------------------------------------------------------

export interface ResumenTiempoTurnoInput {
  /** Ventana de jornada (07:00–17:00 default; fin extensible por overtime). */
  jornada: JornadaTurno;
  actividades: ActividadPlanificada[];
  paradas: Parada[];
  /** Instante de consulta (ISO 8601): las abiertas se computan hasta aquí. */
  instanteConsulta: string;
}

export interface ResultadoResumenTiempo {
  resumen?: ResumenTiempoTurno;
  errores: string[];
}

/**
 * Calcula los 4 buckets del turno + noProductivoTotal (segundos).
 * - planificado = unión de actividades recortadas a la jornada.
 * - incidencias = unión de paradas recortadas a la jornada.
 * - noProductivoTotal = unión(planificado ∪ incidencias): cada minuto UNA vez.
 * - productivo = max(0, totalDisponible − noProductivoTotal).
 * No muta `actividades` ni `paradas`.
 */
export function resumenTiempoTurno(
  input: ResumenTiempoTurnoInput,
): ResultadoResumenTiempo {
  const errores = validarJornada(input.jornada);

  if (!input.instanteConsulta || input.instanteConsulta.trim() === "") {
    errores.push("debe indicar el instante de consulta");
  }

  if (errores.length > 0) {
    return { errores };
  }

  const jornadaInicioMs = new Date(input.jornada.inicio).getTime();
  const jornadaFinMs = new Date(input.jornada.fin).getTime();
  const totalDisponible = Math.round((jornadaFinMs - jornadaInicioMs) / 1000);

  // Intervalos recortados — sin mutar los registros originales.
  const intervalosActividad: Intervalo[] = [];
  for (const a of input.actividades) {
    const intervalo = intervaloRecortado(
      a.inicio,
      a.fin,
      input.instanteConsulta,
      jornadaInicioMs,
      jornadaFinMs,
    );
    if (intervalo) intervalosActividad.push(intervalo);
  }

  const intervalosParada: Intervalo[] = [];
  for (const p of input.paradas) {
    const intervalo = intervaloRecortado(
      p.inicio,
      p.fin,
      input.instanteConsulta,
      jornadaInicioMs,
      jornadaFinMs,
    );
    if (intervalo) intervalosParada.push(intervalo);
  }

  const planificado = duracionSegundos(unirIntervalos(intervalosActividad));
  const incidencias = duracionSegundos(unirIntervalos(intervalosParada));
  const noProductivoTotal = duracionSegundos(
    unirIntervalos([...intervalosActividad, ...intervalosParada]),
  );
  const productivo = Math.max(0, totalDisponible - noProductivoTotal);

  return {
    resumen: {
      totalDisponible,
      planificado,
      incidencias,
      noProductivoTotal,
      productivo,
    },
    errores: [],
  };
}