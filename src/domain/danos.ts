/**
 * Seam de dominio — ticket 05 (daño / eventos y sospecha de 2da).
 * Funciones PURAS: sin imports de UI, API ni persistencia.
 *
 * El daño es un evento INDEPENDIENTE de la parada: registrar un daño no crea,
 * cierra ni modifica paradas. El daño NO aporta tiempo al resumen del turno
 * (Ticket 04): solo la parada vinculada cuenta como incidencia si existe.
 *
 * Las consecuencias `causoParada` y `posibleSegunda` son flags independientes
 * que pueden darse en simultáneo. Estampado registra sospecha/origen; la
 * clasificación oficial de 1ra/2da pertenece a Acabado.
 *
 * Regla de un solo daño abierto por máquina: RESTRICCIÓN OPERATIVA TEMPORAL
 * de este ticket (el flujo actual de una sola máquina no necesita más de un
 * daño en reparación a la vez). No es una imposibilidad general del dominio;
 * puede relajarse en el futuro si el flujo operativo lo requiere.
 *
 * Dependencias de verificación: el dominio NUNCA importa repositorios. La
 * verificación de existencia/coherencia contra paradas existentes se inyecta
 * como una función simple `ObtenerParadaPorId` provista por la capa de
 * aplicación/consumo.
 */
import type { Dano, DanoAbierto, Parada, TipoDano, TipoDanoDef } from "./types";

// ---------------------------------------------------------------------------
// Catálogo de tipos de daño
// ---------------------------------------------------------------------------

const TIPOS_DANO: readonly TipoDanoDef[] = [
  { id: "electrico", nombre: "Daño eléctrico" },
  { id: "mecanico", nombre: "Daño mecánico" },
  { id: "operacional", nombre: "Daño operacional" },
] as const;

/** Devuelve el catálogo completo de tipos de daño. */
export function getTiposDano(): readonly TipoDanoDef[] {
  return TIPOS_DANO;
}

/** Busca un tipo de daño por ID; devuelve undefined si no existe. */
export function getTipoDanoPorId(id: string): TipoDanoDef | undefined {
  return TIPOS_DANO.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Dependencia explícita: lookup de parada (el dominio no importa repositorios)
// ---------------------------------------------------------------------------

/**
 * Función provista por la capa de aplicación para verificar la existencia de
 * una parada al vincularla. `undefined` = la parada no existe.
 */
export type ObtenerParadaPorId = (id: string) => Parada | undefined;

// ---------------------------------------------------------------------------
// Validaciones
// ---------------------------------------------------------------------------

function esTipoDano(valor: string): valor is TipoDano {
  return TIPOS_DANO.some((t) => t.id === valor);
}

function esTimestampValido(iso: string): boolean {
  return !Number.isNaN(new Date(iso).getTime());
}

export interface RegistrarDanoInput {
  maquinaId: "M1";
  /** null = daño sin orden (máquina ociosa / día vacío). */
  ordenId: string | null;
  /** Nombre del operario que registra el daño (obligatorio). */
  operatorName: string;
  /** "" = sin seleccionar; el dominio la rechaza con "debe seleccionar un tipo". */
  tipo: TipoDano | "";
  /** Componente afectado (obligatorio). */
  componente: string;
  /** Timestamp de inicio del daño (ISO 8601). */
  inicio: string;
  /** Flag independiente: este daño causó una parada. */
  causoParada: boolean;
  /** Parada vinculada. Obligatoria si causoParada es true; null si es false. */
  paradaId: string | null;
  /** Flag independiente: puede haber producido segunda. */
  posibleSegunda: boolean;
  /** Unidades sospechadas. Solo si posibleSegunda es true; opcional; entero ≥ 0. */
  unidadesSospechadas?: number;
  observaciones?: string;
}

export interface ResultadoDano<T = Dano> {
  dano?: T;
  errores: string[];
}

/**
 * Registra un daño ABIERTO (fin = null).
 *
 * Relación declarativa con parada:
 * - `causoParada = true`  -> `paradaId` obligatorio; la parada debe existir,
 *   pertenecer a la misma máquina, corresponder a la misma orden (incluido el
 *   caso null) y comenzar no antes que el daño (relación temporal).
 * - `causoParada = false` -> `paradaId` debe ser null.
 *
 * Sospecha de 2da (registro, nunca clasificación):
 * - `posibleSegunda = false` -> `unidadesSospechadas` debe ser undefined.
 * - `posibleSegunda = true`  -> el campo es opcional; si se informa, entero ≥ 0.
 *
 * Restricción operativa: un solo daño abierto por máquina a la vez.
 */
export function registrarDano(
  danosExistentes: Dano[],
  input: RegistrarDanoInput,
  obtenerParada: ObtenerParadaPorId,
): ResultadoDano<DanoAbierto> {
  const errores: string[] = [];

  // Tipo requerido y válido
  if (!input.tipo || input.tipo.trim() === "") {
    errores.push("debe seleccionar un tipo de daño");
  } else if (!esTipoDano(input.tipo)) {
    errores.push(`tipo de daño desconocido: ${input.tipo}`);
  }

  // Componente requerido
  if (!input.componente || input.componente.trim() === "") {
    errores.push("el componente afectado es obligatorio");
  }

  // Inicio requerido y timestamp válido
  if (!input.inicio || input.inicio.trim() === "") {
    errores.push("debe indicar el timestamp de inicio");
  } else if (!esTimestampValido(input.inicio)) {
    errores.push("el timestamp de inicio no es una fecha válida");
  }

  // Operario requerido
  if (!input.operatorName || input.operatorName.trim() === "") {
    errores.push("operatorName es obligatorio");
  }

  // Relación declarativa con parada
  if (input.causoParada) {
    if (!input.paradaId || input.paradaId.trim() === "") {
      errores.push("si el daño causó una parada, debe indicar la parada vinculada");
    } else {
      const parada = obtenerParada(input.paradaId);
      if (!parada) {
        errores.push(`la parada vinculada no existe: ${input.paradaId}`);
      } else {
        // Misma máquina
        if (parada.maquinaId !== input.maquinaId) {
          errores.push("la parada vinculada pertenece a otra máquina");
        }
        // Misma orden, incluido el caso null
        if (parada.ordenId !== input.ordenId) {
          errores.push("la parada vinculada no corresponde a la misma orden");
        }
        // Relación temporal: la parada no puede comenzar antes que el daño
        if (esTimestampValido(parada.inicio) && esTimestampValido(input.inicio)) {
          const inicioDano = new Date(input.inicio).getTime();
          const inicioParada = new Date(parada.inicio).getTime();
          if (inicioParada < inicioDano) {
            errores.push("la parada vinculada no puede comenzar antes que el daño");
          }
        }
      }
    }
  } else if (input.paradaId !== null) {
    errores.push("si el daño no causó parada, no debe indicar parada vinculada");
  }

  // Sospecha de 2da: registro, nunca clasificación
  if (!input.posibleSegunda && input.unidadesSospechadas !== undefined) {
    errores.push("si el daño no produjo sospecha de segunda, unidadesSospechadas debe ser undefined");
  }
  if (input.posibleSegunda && input.unidadesSospechadas !== undefined) {
    if (!Number.isInteger(input.unidadesSospechadas) || input.unidadesSospechadas < 0) {
      errores.push("unidadesSospechadas debe ser un entero mayor o igual a 0");
    }
  }

  // Restricción operativa: un solo daño abierto por máquina
  const abierto = danosExistentes.find(
    (d) => d.fin === null && d.maquinaId === input.maquinaId,
  );
  if (abierto) {
    errores.push("ya hay un daño abierto para la máquina. Cierre el daño actual antes de registrar otro");
  }

  if (errores.length > 0) {
    return { errores };
  }

  // Invariante: si pasó la validación, tipo ya fue verificada como TipoDano.
  const tipo = input.tipo as TipoDano;

  const dano: DanoAbierto = {
    id: crypto.randomUUID(),
    maquinaId: input.maquinaId,
    ordenId: input.ordenId,
    operatorName: input.operatorName.trim(),
    tipo,
    componente: input.componente.trim(),
    inicio: input.inicio,
    fin: null,
    causoParada: input.causoParada,
    paradaId: input.paradaId,
    posibleSegunda: input.posibleSegunda,
    unidadesSospechadas: input.posibleSegunda ? input.unidadesSospechadas : undefined,
    observaciones: input.observaciones?.trim() || undefined,
  };

  return { dano, errores: [] };
}

/**
 * Cierra un daño abierto registrando fin de reparación y solución aplicada.
 * `solucionAplicada` es obligatoria SOLO al cerrar; `fin >= inicio`.
 */
export function cerrarDano(
  dano: DanoAbierto,
  fin: string,
  solucionAplicada: string,
): ResultadoDano<Dano> {
  const errores: string[] = [];

  if (!fin || fin.trim() === "") {
    errores.push("debe indicar el timestamp de fin");
  } else if (!esTimestampValido(fin)) {
    errores.push("el timestamp de fin no es una fecha válida");
  } else if (new Date(fin).getTime() < new Date(dano.inicio).getTime()) {
    errores.push("el timestamp de fin no puede ser anterior al de inicio");
  }

  if (!solucionAplicada || solucionAplicada.trim() === "") {
    errores.push("debe indicar la solución aplicada");
  }

  if (errores.length > 0) {
    return { errores };
  }

  return {
    dano: { ...dano, fin, solucionAplicada: solucionAplicada.trim() },
    errores: [],
  };
}

/**
 * Busca el daño abierto (fin = null) de una máquina, o null si no hay ninguno.
 * Utilidad de consulta para la restricción operativa y para la UI.
 */
export function danoAbierto(
  danos: Dano[],
  maquinaId: string,
): DanoAbierto | null {
  const encontrado = danos.find(
    (d) => d.fin === null && d.maquinaId === maquinaId,
  );
  return (encontrado as DanoAbierto) ?? null;
}