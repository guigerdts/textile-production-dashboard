/**
 * Seam de dominio — ticket 02 (paradas / incidencias).
 * Funciones PURAS: sin imports de UI, API ni persistencia.
 * Catálogo de 10 causas predefinidas (CONTEXT.md).
 */
import type {
  CausaParadaDef,
  CausaParadaId,
  Parada,
  ParadaAbierta,
} from "./types";

// ---------------------------------------------------------------------------
// Catálogo de causas
// ---------------------------------------------------------------------------

const CAUSAS: readonly CausaParadaDef[] = [
  { id: "falta_color", nombre: "Falta de color / tinta", camposRequeridos: ["color"] },
  { id: "rotura_cuadro", nombre: "Rotura o deterioro del cuadro", camposRequeridos: ["carro"] },
  { id: "atasco_tela", nombre: "Atasco o rotura de tela en la máquina", camposRequeridos: [] },
  { id: "danio_mecanico", nombre: "Daño mecánico en carro", camposRequeridos: ["carro", "componente"] },
  { id: "danio_electrico", nombre: "Problema eléctrico", camposRequeridos: ["componente"] },
  { id: "ajuste_registro", nombre: "Necesidad de ajuste de registro", camposRequeridos: ["carrosAfectados"] },
  { id: "problema_horno", nombre: "Problema con el horno de secado", camposRequeridos: [] },
  { id: "falta_tela", nombre: "Falta de materia prima (tela)", camposRequeridos: [] },
  { id: "cambio_diseno_no_planificado", nombre: "Cambio de diseño no contemplado en programación", camposRequeridos: [] },
  { id: "otro", nombre: "Otro (requiere observación)", camposRequeridos: [] },
] as const;

/** Devuelve el catálogo completo de causas. */
export function getCausasParada(): readonly CausaParadaDef[] {
  return CAUSAS;
}

/** Busca una causa por ID; devuelve undefined si no existe. */
export function getCausaParadaPorId(id: CausaParadaId): CausaParadaDef | undefined {
  return CAUSAS.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// Validaciones
// ---------------------------------------------------------------------------

function esCausaParadaId(valor: string): valor is CausaParadaId {
  return CAUSAS.some((c) => c.id === valor);
}

/**
 * Valida los campos específicos de una causa y las observaciones.
 * Devuelve una lista de mensajes de error (vacía si todo está OK).
 */
export function validarCamposCausa(
  causaId: CausaParadaId,
  camposEspecificos: Record<string, unknown>,
  observaciones?: string,
): string[] {
  const errores: string[] = [];
  const causa = getCausaParadaPorId(causaId);
  if (!causa) {
    errores.push(`causa desconocida: ${causaId}`);
    return errores;
  }

  // Campos requeridos según catálogo
  for (const campo of causa.camposRequeridos) {
    const valor = camposEspecificos[campo];
    if (valor === undefined || valor === null || valor === "") {
      errores.push(`falta el campo "${campo}" para la causa "${causa.nombre}"`);
    }
    // Validación específica: carrosAfectados debe ser array no vacío
    if (campo === "carrosAfectados") {
      if (!Array.isArray(valor) || valor.length === 0) {
        errores.push(
          `el campo "carrosAfectados" debe ser un array no vacío de números`,
        );
      } else if (!(valor as unknown[]).every((v) => typeof v === "number" && v >= 1 && v <= 7)) {
        errores.push(
          `el campo "carrosAfectados" solo acepta números de carro del 1 al 7`,
        );
      }
    }
    // Carro debe ser número entero 1-7
    if (campo === "carro") {
      if (typeof valor !== "number" || !Number.isInteger(valor) || valor < 1 || valor > 7) {
        errores.push(
          `el campo "carro" debe ser un número entero del 1 al 7`,
        );
      }
    }
  }

  // "otro" requiere observación obligatoria
  if (causaId === "otro" && (!observaciones || observaciones.trim() === "")) {
    errores.push('si la causa es "Otro", debe indicar una observación');
  }

  return errores;
}

// ---------------------------------------------------------------------------
// Operaciones de dominio
// ---------------------------------------------------------------------------

export interface RegistrarParadaInput {
  maquinaId: "M1";
  ordenId: string | null;
  /** Nombre del operario que registra la parada (obligatorio). */
  operatorName: string;
  /** "" = sin seleccionar; el dominio la rechaza con "debe seleccionar una causa". */
  causaId: CausaParadaId | "";
  camposEspecificos: Record<string, unknown>;
  observaciones?: string;
  inicio: string; // ISO 8601
}

export interface ResultadoParada<T = Parada> {
  parada?: T;
  errores: string[];
}

/**
 * Registra una parada abierta (fin = null).
 * Valida: causa requerida, campos específicos, observación en "otro",
 * y que no exista ya una parada abierta para la misma máquina+orden.
 */
export function registrarParada(
  paradasExistentes: Parada[],
  input: RegistrarParadaInput,
): ResultadoParada<ParadaAbierta> {
  const errores: string[] = [];

  // Causa requerida
  if (!input.causaId || input.causaId.trim() === "") {
    errores.push("debe seleccionar una causa");
  } else if (!esCausaParadaId(input.causaId)) {
    errores.push(`causa desconocida: ${input.causaId}`);
  }

  // Inicio requerido
  if (!input.inicio || input.inicio.trim() === "") {
    errores.push("debe indicar el timestamp de inicio");
  }

  // Operario requerido
  if (!input.operatorName || input.operatorName.trim() === "") {
    errores.push("operatorName es obligatorio");
  }

  // Validar campos específicos y observaciones
  if (input.causaId && esCausaParadaId(input.causaId)) {
    errores.push(...validarCamposCausa(input.causaId, input.camposEspecificos, input.observaciones));
  }

  // Verificar que no haya parada abierta para la misma máquina + orden
  const abierta = paradasExistentes.find(
    (p) =>
      p.fin === null &&
      p.maquinaId === input.maquinaId &&
      p.ordenId === input.ordenId,
  );
  if (abierta) {
    errores.push("ya hay una parada abierta. Cierre la actual antes de registrar otra");
  }

  if (errores.length > 0) {
    return { errores };
  }

  // Invariante: si no hay errores, causaId ya fue validada como CausaParadaId
  // ("" y valores desconocidos producen error y retornan arriba).
  const causaId = input.causaId as CausaParadaId;

  const parada: ParadaAbierta = {
    id: crypto.randomUUID(),
    maquinaId: input.maquinaId,
    ordenId: input.ordenId,
    operatorName: input.operatorName.trim(),
    causaId,
    camposEspecificos: { ...input.camposEspecificos },
    observaciones: input.observaciones?.trim() || undefined,
    inicio: input.inicio,
    fin: null,
  };

  return { parada, errores: [] };
}

/**
 * Cierra una parada abierta registrando su timestamp de fin.
 * Valida que fin no sea anterior a inicio.
 */
export function cerrarParada(
  parada: ParadaAbierta,
  finTimestamp: string,
): ResultadoParada {
  const errores: string[] = [];

  if (!finTimestamp || finTimestamp.trim() === "") {
    errores.push("debe indicar el timestamp de fin");
  }

  if (finTimestamp && new Date(finTimestamp) < new Date(parada.inicio)) {
    errores.push("el timestamp de fin no puede ser anterior al de inicio");
  }

  if (errores.length > 0) {
    return { errores };
  }

  return {
    parada: { ...parada, fin: finTimestamp },
    errores: [],
  };
}

/**
 * Calcula la duración de una parada en segundos.
 * Devuelve null si la parada está abierta (sin fin).
 */
export function duracionParada(parada: Parada): number | null {
  if (parada.fin === null) return null;
  return Math.round((new Date(parada.fin).getTime() - new Date(parada.inicio).getTime()) / 1000);
}

/**
 * Duración acumulada de una parada ABIERTA hasta el instante indicado (segundos).
 * Devuelve null si la parada no está abierta; rechaza un "hasta" anterior al inicio.
 */
export function duracionAcumulada(
  parada: Parada,
  hastaTimestamp: string,
): number | null {
  if (parada.fin !== null) return null;
  if (!hastaTimestamp || hastaTimestamp.trim() === "") {
    return null;
  }
  const hasta = new Date(hastaTimestamp).getTime();
  const inicio = new Date(parada.inicio).getTime();
  if (Number.isNaN(hasta) || hasta < inicio) return null;
  return Math.round((hasta - inicio) / 1000);
}

/**
 * Busca paradas abiertas para una máquina y opcionalmente una orden específica.
 */
export function paradaAbierta(
  paradas: Parada[],
  maquinaId: string,
  ordenId: string | null = null,
): ParadaAbierta | null {
  const encontrada = paradas.find(
    (p) =>
      p.fin === null &&
      p.maquinaId === maquinaId &&
      p.ordenId === ordenId,
  );
  return (encontrada as ParadaAbierta) ?? null;
}

/**
 * Valida que una orden pueda finalizar: no debe tener paradas abiertas asociadas.
 * Las paradas sin orden (ordenId = null) no bloquean la finalización.
 */
export function validarFinalizacionConParadas(
  paradas: Parada[],
  ordenId: string,
): string[] {
  const errores: string[] = [];
  const abierta = paradaAbierta(paradas, "M1", ordenId);
  if (abierta) {
    errores.push("hay una parada abierta. Registre el fin antes de finalizar la orden");
  }
  return errores;
}

/**
 * Valida que se pueda registrar una nueva lectura: no debe haber una parada
 * abierta asociada a la orden (la máquina está detenida; no produce golpes).
 * Las paradas sin orden (ordenId = null) no bloquean las lecturas.
 */
export function validarLecturaConParadas(
  paradas: Parada[],
  ordenId: string,
): string[] {
  const errores: string[] = [];
  const abierta = paradaAbierta(paradas, "M1", ordenId);
  if (abierta) {
    errores.push("no se pueden registrar lecturas mientras hay una parada abierta");
  }
  return errores;
}
