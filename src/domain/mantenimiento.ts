/**
 * Seam de dominio — ticket 08 (mantenimiento reactivo y preventivo).
 * Funciones PURAS: sin imports de UI, API ni persistencia.
 *
 * Mantenimiento es un evento DOCUMENTAL: NUNCA toca tiempo productivo
 * (ADR 0007), no tiene ordenId, y no se puede editar ni eliminar después
 * de cerrado. `inicio` es el único campo temporal requerido; `fin` null
 * = en progreso. La duración siempre se deriva, nunca se persiste.
 *
 * Catálogo cerrado: exactamente "reactivo" y "preventivo". Reactivo puede
 * opcionalmente vincular un daño (validado por lookup inyectado); preventivo
 * nunca tiene danoId.
 *
 * Restricción operativa: un solo mantenimiento abierto por máquina a la vez
 * (temporal, relaxable si el flujo lo requiere). Un mantenimiento cerrado
 * nunca bloquea registros posteriores.
 */
import type {
  Mantenimiento,
  MantenimientoAbierto,
  ObtenerDanoPorId,
  TipoMantenimientoDef,
  TipoMantenimientoId,
} from "./types";

// ---------------------------------------------------------------------------
// Catálogo de tipos de mantenimiento
// ---------------------------------------------------------------------------

const TIPOS_MANTENIMIENTO: readonly TipoMantenimientoDef[] = [
  { id: "reactivo", nombre: "Mantenimiento reactivo" },
  { id: "preventivo", nombre: "Mantenimiento preventivo" },
] as const;

/** Devuelve el catálogo completo de tipos de mantenimiento. */
export function getTiposMantenimiento(): readonly TipoMantenimientoDef[] {
  return TIPOS_MANTENIMIENTO;
}

/** Busca un tipo de mantenimiento por ID; devuelve undefined si no existe. */
export function getTipoMantenimientoPorId(
  id: string,
): TipoMantenimientoDef | undefined {
  return TIPOS_MANTENIMIENTO.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Validaciones
// ---------------------------------------------------------------------------

function esTipoMantenimiento(valor: string): valor is TipoMantenimientoId {
  return TIPOS_MANTENIMIENTO.some((t) => t.id === valor);
}

function esTimestampValido(iso: string): boolean {
  return !Number.isNaN(new Date(iso).getTime());
}

// ---------------------------------------------------------------------------
// registrarMantenimiento
// ---------------------------------------------------------------------------

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

export interface RegistrarMantenimientoInput {
  maquinaId: "M1";
  tipo: TipoMantenimientoId;
  operatorName: string;
  motivo: string;
  inicio: string;
  /** Fecha operativa (YYYY-MM-DD) a la que se atribuye el mantenimiento. */
  fechaOperativa: string;
  fin?: string;
  queSeRevisoReparo?: string;
  danoId: string | null;
  observaciones?: string;
}

export interface ResultadoMantenimiento<T = Mantenimiento> {
  mantenimiento?: T;
  errores: string[];
}

/**
 * Registra un mantenimiento: abre uno en progreso (fin omitted → null) o
 * registra uno completo en un solo paso (fin presente).
 *
 * Reactivo: puede tener danoId (validado por lookup inyectado) o null.
 * Preventivo: siempre danoId = null.
 *
 * `inicio` es el único campo temporal requerido; `fin >= inicio` se enforce
 * cuando fin está presente. `operatorName` y `motivo` se trimmean y deben
 * permanecer no vacíos. `queSeRevisoReparo` se trimmea y solo es obligatorio
 * cuando fin está presente. `observaciones` se trimmea y se convierte en
 * undefined cuando queda vacío.
 *
 * Restricción operativa: un solo mantenimiento abierto por máquina.
 */
export function registrarMantenimiento(
  existentes: Mantenimiento[],
  input: RegistrarMantenimientoInput,
  obtenerDano: ObtenerDanoPorId,
): ResultadoMantenimiento {
  const errores: string[] = [];

  // Tipo requerido y válido
  if (!input.tipo || input.tipo.trim() === "") {
    errores.push("debe seleccionar un tipo de mantenimiento");
  } else if (!esTipoMantenimiento(input.tipo)) {
    errores.push(`tipo de mantenimiento desconocido: ${input.tipo}`);
  }

  // Operario requerido
  if (!input.operatorName || input.operatorName.trim() === "") {
    errores.push("operatorName es obligatorio");
  }

  // Motivo requerido
  if (!input.motivo || input.motivo.trim() === "") {
    errores.push("el motivo es obligatorio");
  }

  // Fecha operativa requerida (atribución explícita del día)
  validarFechaOperativa(input.fechaOperativa, errores);

  // Inicio requerido y timestamp válido
  if (!input.inicio || input.inicio.trim() === "") {
    errores.push("debe indicar el timestamp de inicio");
  } else if (!esTimestampValido(input.inicio)) {
    errores.push("el timestamp de inicio no es una fecha válida");
  }

  // Fin: si presente, válido y >= inicio
  if (input.fin !== undefined && input.fin !== null) {
    if (input.fin.trim() === "") {
      errores.push("debe indicar el timestamp de fin");
    } else if (!esTimestampValido(input.fin)) {
      errores.push("el timestamp de fin no es una fecha válida");
    } else if (
      input.inicio &&
      esTimestampValido(input.inicio) &&
      new Date(input.fin).getTime() < new Date(input.inicio).getTime()
    ) {
      errores.push("el timestamp de fin no puede ser anterior al de inicio");
    }
  }

  // queSeRevisoReparo: obligatorio cuando fin está presente
  const finPresente =
    input.fin !== undefined && input.fin !== null && input.fin.trim() !== "";
  if (finPresente) {
    if (!input.queSeRevisoReparo || input.queSeRevisoReparo.trim() === "") {
      errores.push(
        "queSeRevisoReparo es obligatorio al cerrar o en registro completo",
      );
    }
  }

  // Relación declarativa con daño
  if (input.tipo === "preventivo") {
    if (input.danoId !== null) {
      errores.push("el mantenimiento preventivo no puede tener danoId");
    }
  } else if (input.tipo === "reactivo" && input.danoId !== null) {
    const dano = obtenerDano(input.danoId);
    if (!dano) {
      errores.push(`el daño vinculado no existe: ${input.danoId}`);
    }
  }

  // Restricción operativa: un solo mantenimiento abierto por máquina
  const abierto = existentes.find(
    (m) => m.fin === null && m.maquinaId === input.maquinaId,
  );
  if (abierto) {
    errores.push(
      "ya hay un mantenimiento abierto para la máquina. Cierre el actual antes de registrar otro",
    );
  }

  if (errores.length > 0) {
    return { errores };
  }

  const tipo = input.tipo as TipoMantenimientoId;

  const mantenimiento: Mantenimiento = {
    id: crypto.randomUUID(),
    maquinaId: input.maquinaId,
    tipo,
    operatorName: input.operatorName.trim(),
    motivo: input.motivo.trim(),
    inicio: input.inicio,
    fechaOperativa: input.fechaOperativa,
    fin: finPresente ? input.fin! : null,
    queSeRevisoReparo: input.queSeRevisoReparo?.trim() || undefined,
    danoId: tipo === "preventivo" ? null : input.danoId,
    observaciones: input.observaciones?.trim() || undefined,
  };

  return { mantenimiento, errores: [] };
}

// ---------------------------------------------------------------------------
// cerrarMantenimiento
// ---------------------------------------------------------------------------

/**
 * Cierra un mantenimiento abierto registrando fin y queSeRevisoReparo.
 * Siempre devuelve un NUEVO registro cerrado (nunca muta el abierto).
 * `fin >= inicio` se enforce. `queSeRevisoReparo` es obligatorio al cerrar.
 */
export function cerrarMantenimiento(
  abierto: MantenimientoAbierto,
  fin: string,
  queSeRevisoReparo: string,
): ResultadoMantenimiento {
  const errores: string[] = [];

  if (!fin || fin.trim() === "") {
    errores.push("debe indicar el timestamp de fin");
  } else if (!esTimestampValido(fin)) {
    errores.push("el timestamp de fin no es una fecha válida");
  } else if (new Date(fin).getTime() < new Date(abierto.inicio).getTime()) {
    errores.push("el timestamp de fin no puede ser anterior al de inicio");
  }

  if (!queSeRevisoReparo || queSeRevisoReparo.trim() === "") {
    errores.push("queSeRevisoReparo es obligatorio al cerrar");
  }

  if (errores.length > 0) {
    return { errores };
  }

  return {
    mantenimiento: {
      ...abierto,
      fin,
      queSeRevisoReparo: queSeRevisoReparo.trim(),
    },
    errores: [],
  };
}

// ---------------------------------------------------------------------------
// mantenimientoAbierto (consulta)
// ---------------------------------------------------------------------------

/**
 * Busca el mantenimiento abierto (fin = null) de una máquina, o null si no
 * hay ninguno. Utilidad de consulta para la restricción operativa y para la UI.
 */
export function mantenimientoAbierto(
  mantenimientos: Mantenimiento[],
  maquinaId: string,
): MantenimientoAbierto | null {
  const encontrado = mantenimientos.find(
    (m) => m.fin === null && m.maquinaId === maquinaId,
  );
  return (encontrado as MantenimientoAbierto) ?? null;
}
