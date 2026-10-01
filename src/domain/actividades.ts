/**
 * Seam de dominio — ticket 03 (actividades planificadas).
 * Funciones PURAS: sin imports de UI, API ni persistencia.
 * Cambio de diseño y limpieza son tiempo no productivo planificado
 * (CONTEXT.md): NUNCA paradas ni incidencias.
 * Independientes de la orden: no llevan ordenId.
 */
import type {
  ActividadAbierta,
  ActividadPlanificada,
  TipoActividadDef,
  TipoActividadPlanificada,
} from "./types";

// ---------------------------------------------------------------------------
// Catálogo de tipos
// ---------------------------------------------------------------------------

const TIPOS: readonly TipoActividadDef[] = [
  { id: "cambio_diseno", nombre: "Cambio de diseño" },
  { id: "limpieza", nombre: "Limpieza" },
  { id: "almuerzo", nombre: "Almuerzo" },
  { id: "pausa", nombre: "Pausa" },
] as const;

/** Devuelve el catálogo completo de tipos de actividad. */
export function getTiposActividad(): readonly TipoActividadDef[] {
  return TIPOS;
}

/** Busca un tipo por ID; devuelve undefined si no existe. */
export function getTipoActividadPorId(
  id: TipoActividadPlanificada,
): TipoActividadDef | undefined {
  return TIPOS.find((t) => t.id === id);
}

function esTipoActividad(valor: string): valor is TipoActividadPlanificada {
  return TIPOS.some((t) => t.id === valor);
}

/**
 * Valida el formato de una fecha operativa (YYYY-MM-DD).
 * Copia privado por módulo del proyecto (`esTimestampValido`, `FECHA_OPERATIVA_RX`).
 * NO valida coherencia con `inicio`: la atribución al día es explícita y
 * exclusiva (operational-event-operative-date).
 */
const FECHA_OPERATIVA_RX = /^\d{4}-\d{2}-\d{2}$/;

function esFechaOperativaValida(valor: string): boolean {
  return FECHA_OPERATIVA_RX.test(valor);
}

function validarFechaOperativa(valor: string, errores: string[]): void {
  if (!valor || valor.trim() === "") {
    errores.push("debe indicar la fecha operativa");
  } else if (!esFechaOperativaValida(valor)) {
    errores.push("la fecha operativa debe tener el formato YYYY-MM-DD");
  }
}

// ---------------------------------------------------------------------------
// Operaciones de dominio
// ---------------------------------------------------------------------------

export interface RegistrarActividadInput {
  maquinaId: "M1";
  /** "" = sin seleccionar; el dominio la rechaza con "debe seleccionar un tipo". */
  tipo: TipoActividadPlanificada | "";
  /** Timestamp de inicio del período real (ISO 8601). */
  inicio: string;
  /** Qué se limpió. Obligatorio y persistido SOLO para limpieza; no aplica a otros tipos. */
  queSeLimpio?: string;
  /** Texto libre. Opcional en ambos tipos. */
  observaciones?: string;
  /** Nombre del operario que registra la actividad (obligatorio). */
  operatorName: string;
  /** Fecha operativa (YYYY-MM-DD) a la que se atribuye la actividad. */
  fechaOperativa: string;
}

export interface ResultadoActividad<T = ActividadPlanificada> {
  actividad?: T;
  errores: string[];
}

/**
 * Registra una actividad planificada abierta (fin = null).
 * Valida: tipo requerido y conocido, inicio requerido, operatorName requerido,
 * queSeLimpio obligatorio solo para limpieza (NO se persiste en otros tipos),
 * y que no exista ya una actividad abierta del mismo tipo para la misma máquina.
 * Permite simultáneamente actividades de distinto tipo abiertas.
 */
export function comenzarActividad(
  actividadesExistentes: ActividadPlanificada[],
  input: RegistrarActividadInput,
): ResultadoActividad<ActividadAbierta> {
  const errores: string[] = [];

  // Tipo requerido
  if (!input.tipo || input.tipo.trim() === "") {
    errores.push("debe seleccionar un tipo de actividad");
  } else if (!esTipoActividad(input.tipo)) {
    errores.push(`tipo de actividad desconocido: ${input.tipo}`);
  }

  // Inicio requerido
  if (!input.inicio || input.inicio.trim() === "") {
    errores.push("debe indicar el timestamp de inicio");
  }

  // Fecha operativa requerida (atribución explícita del día)
  validarFechaOperativa(input.fechaOperativa, errores);

  // Operario requerido
  if (!input.operatorName || input.operatorName.trim() === "") {
    errores.push("operatorName es obligatorio");
  }

  // queSeLimpio obligatorio solo para limpieza
  if (input.tipo === "limpieza") {
    if (!input.queSeLimpio || input.queSeLimpio.trim() === "") {
      errores.push("debe indicar qué se limpió");
    }
  }

  // Verificar que no haya actividad abierta del mismo tipo para la máquina
  if (input.tipo && esTipoActividad(input.tipo)) {
    const abierta = actividadesExistentes.find(
      (a) => a.fin === null && a.maquinaId === input.maquinaId && a.tipo === input.tipo,
    );
    if (abierta) {
      errores.push(
        `ya hay una actividad abierta de tipo "${getTipoActividadPorId(input.tipo)?.nombre ?? input.tipo}". Cierre la actual antes de registrar otra`,
      );
    }
  }

  if (errores.length > 0) {
    return { errores };
  }

  // Invariante: si no hay errores, tipo ya fue validada como TipoActividadPlanificada.
  const tipo = input.tipo as TipoActividadPlanificada;

  const actividad: ActividadAbierta = {
    id: crypto.randomUUID(),
    maquinaId: input.maquinaId,
    tipo,
    inicio: input.inicio,
    fechaOperativa: input.fechaOperativa,
    fin: null,
    // queSeLimpio solo aplica a limpieza: nunca se persiste en otros tipos.
    queSeLimpio:
      tipo === "limpieza" ? input.queSeLimpio?.trim() || undefined : undefined,
    observaciones: input.observaciones?.trim() || undefined,
    operatorName: input.operatorName.trim(),
  };

  return { actividad, errores: [] };
}

/**
 * Cierra una actividad abierta registrando su timestamp de fin.
 * Valida que fin no sea anterior a inicio.
 */
export function finalizarActividad(
  actividad: ActividadAbierta,
  finTimestamp: string,
): ResultadoActividad {
  const errores: string[] = [];

  if (!finTimestamp || finTimestamp.trim() === "") {
    errores.push("debe indicar el timestamp de fin");
  }

  if (finTimestamp && new Date(finTimestamp) < new Date(actividad.inicio)) {
    errores.push("el timestamp de fin no puede ser anterior al de inicio");
  }

  if (errores.length > 0) {
    return { errores };
  }

  return {
    actividad: { ...actividad, fin: finTimestamp },
    errores: [],
  };
}

/**
 * Calcula la duración de una actividad en segundos (período real inicio → fin).
 * Devuelve null si la actividad está abierta (sin fin).
 */
export function duracionActividad(actividad: ActividadPlanificada): number | null {
  if (actividad.fin === null) return null;
  return Math.round(
    (new Date(actividad.fin).getTime() - new Date(actividad.inicio).getTime()) / 1000,
  );
}

/**
 * Busca la actividad abierta para una máquina y un tipo específico.
 */
export function actividadAbierta(
  actividades: ActividadPlanificada[],
  maquinaId: string,
  tipo: TipoActividadPlanificada,
): ActividadAbierta | null {
  const encontrada = actividades.find(
    (a) => a.fin === null && a.maquinaId === maquinaId && a.tipo === tipo,
  );
  return (encontrada as ActividadAbierta) ?? null;
}