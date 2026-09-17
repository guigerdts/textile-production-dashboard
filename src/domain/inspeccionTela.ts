/**
 * Seam de dominio — ticket 07 (inspección de tela / devolución / uso autorizado).
 * Funciones PURAS: sin imports de UI, API ni persistencia.
 *
 * La inspección de tela es un evento RECURRENTE asociado SIEMPRE a su orden de
 * producción (ordenId obligatorio): se registra cada vez que llega un lote nuevo,
 * por lo que NO existe la restricción de "una inspección abierta por orden" ni
 * "una inspección por orden". Pueden existir múltiples inspecciones independientes
 * por orden, cada una con su lote opcional, su checklist y su resolución propia.
 *
 * NO es una parada: registrar una inspección no crea ni cierra paradas (Ticket 02),
 * no aporta tiempo al resumen del turno (Ticket 04) ni modifica lecturas, progreso
 * o estado de la orden.
 *
 * El estado de la tela es DERIVADO de cada inspección (nunca estado global de la
 * orden): conforme / no_usable / devuelta / uso_autorizado. No existe bloqueo
 * automático de producción por tela no usable (no hay workflow de bloqueo en el
 * ticket).
 *
 * Resoluciones MUTUAMENTE EXCLUYENTES: una inspección con anomalía puede quedar
 * sin resolución o resolverse con devolución O autorización de gerencia, nunca
 * ambas ni una segunda resolución. Una inspección sin anomalía no puede tener
 * resolución.
 */
import type {
  EstadoInspeccionTela,
  InspeccionTela,
  ItemChecklistEstado,
  ItemChecklistId,
  ItemChecklistDef,
  Orden,
} from "./types";
import { golpesProducidosDesdeLecturas } from "./calculations";

// ---------------------------------------------------------------------------
// Catálogo de ítems del checklist
// ---------------------------------------------------------------------------

const ITEMS_CHECKLIST: readonly ItemChecklistDef[] = [
  { id: "absorcion", nombre: "Absorción" },
  { id: "tundido", nombre: "Tundido" },
  { id: "manchas", nombre: "Manchas" },
  { id: "dimensiones", nombre: "Dimensiones / medidas" },
  { id: "estado_general", nombre: "Estado general" },
] as const;

/** Devuelve el catálogo completo de ítems del checklist. */
export function getItemsChecklist(): readonly ItemChecklistDef[] {
  return ITEMS_CHECKLIST;
}

export function getItemChecklistPorId(
  id: ItemChecklistId,
): ItemChecklistDef | undefined {
  return ITEMS_CHECKLIST.find((i) => i.id === id);
}

// ---------------------------------------------------------------------------
// Validaciones compartidas
// ---------------------------------------------------------------------------

function esTimestampValido(iso: string): boolean {
  return !Number.isNaN(new Date(iso).getTime());
}

/**
 * Valida el checklist: deben estar presentes EXACTAMENTE los 5 ítems del
 * catálogo, cada uno con estado explícito `conforme` o `anomalia`, sin
 * duplicados ni ids desconocidos. Devuelve los errores (vacío si es válido).
 */
export function validarChecklist(
  items: ItemChecklistEstado[] | undefined,
): string[] {
  const errores: string[] = [];

  if (!items || items.length === 0) {
    errores.push("debe indicar el estado de los 5 ítems del checklist");
    return errores;
  }

  const idsValidos = new Set<string>(ITEMS_CHECKLIST.map((i) => i.id));
  const vistos = new Set<string>();

  for (const item of items) {
    if (!idsValidos.has(item.id)) {
      errores.push(`ítem de checklist desconocido: ${item.id}`);
    } else if (vistos.has(item.id)) {
      errores.push(`ítem de checklist duplicado: ${item.id}`);
    }
    vistos.add(item.id);

    if (item.estado !== "conforme" && item.estado !== "anomalia") {
      errores.push(`estado inválido para el ítem ${item.id}`);
    }
  }

  // Deben estar TODOS los ítems del catálogo (nunca un checklist parcial)
  for (const def of ITEMS_CHECKLIST) {
    if (!vistos.has(def.id)) {
      errores.push(`falta el ítem del checklist: ${def.id}`);
    }
  }

  return errores;
}

/**
 * DERIVADO de los 5 ítems + `otraAnomalia`. Nunca es un booleano editable
 * desde la UI. `undefined` (sin datos) se trata como sin anomalía.
 */
export function conAnomalia(inspeccion: Pick<InspeccionTela, "items" | "otraAnomalia">): boolean {
  const itemConAnomalia = inspeccion.items.some(
    (item) => item.estado === "anomalia",
  );
  const otraAnomaliaInformada =
    inspeccion.otraAnomalia !== undefined &&
    inspeccion.otraAnomalia.trim() !== "";
  return itemConAnomalia || otraAnomaliaInformada;
}

/**
 * Estado de la tela DERIVADO de cada inspección. Nunca estado global de la
 * orden y sin bloqueo automático de producción.
 */
export function estadoInspeccion(inspeccion: InspeccionTela): EstadoInspeccionTela {
  if (!conAnomalia(inspeccion)) {
    return "conforme";
  }
  if (inspeccion.resolucion === null) {
    return "no_usable";
  }
  if (inspeccion.resolucion.tipo === "devolucion") {
    return "devuelta";
  }
  return "uso_autorizado";
}

// ---------------------------------------------------------------------------
// Registro de inspección
// ---------------------------------------------------------------------------

export interface RegistrarInspeccionInput {
  /** Nombre del operario que registra la inspección (obligatorio). */
  operatorName: string;
  /** Identificador de lote (texto libre, opcional). Sin entidad de lote persistente. */
  lote?: string;
  /** Los 5 ítems del checklist, SIEMPRE con estado explícito. */
  items: ItemChecklistEstado[];
  /** Otra anomalía detectada (texto libre, opcional). */
  otraAnomalia?: string;
  /** Timestamp de la inspección (ISO 8601). */
  timestamp: string;
  /** Texto libre. Opcional. */
  observaciones?: string;
}

export interface ResultadoInspeccion<T = InspeccionTela> {
  inspeccion?: T;
  errores: string[];
}

/**
 * Registra una inspección de tela asociada SIEMPRE a su orden (ordenId
 * obligatorio). Sin restricción de una sola por orden: cada lote nuevo genera
 * una inspección independiente. `conAnomalia` se deriva del checklist +
 * otraAnomalia; la resolución queda en `sin_resolucion`.
 *
 * NO crea ni modifica paradas, NO toca lecturas, progreso, estado de la orden
 * ni resumen de tiempo.
 */
export function registrarInspeccion(
  orden: Orden,
  input: RegistrarInspeccionInput,
): ResultadoInspeccion {
  const errores: string[] = [];

  // Orden obligatoria: la inspección nunca es un evento general de máquina
  if (!orden || !orden.id) {
    errores.push("la inspección de tela debe estar asociada a una orden de producción");
  }

  // Operario requerido
  if (!input.operatorName || input.operatorName.trim() === "") {
    errores.push("operatorName es obligatorio");
  }

  // Checklist: 5 ítems explícitos
  errores.push(...validarChecklist(input.items));

  // Timestamp requerido y válido
  if (!input.timestamp || input.timestamp.trim() === "") {
    errores.push("debe indicar el timestamp de la inspección");
  } else if (!esTimestampValido(input.timestamp)) {
    errores.push("el timestamp de la inspección no es una fecha válida");
  }

  if (errores.length > 0) {
    return { errores };
  }

  const inspeccion: InspeccionTela = {
    id: crypto.randomUUID(),
    ordenId: orden.id,
    operatorName: input.operatorName.trim(),
    lote: input.lote?.trim() || undefined,
    items: input.items.map((item) => ({ ...item })),
    otraAnomalia: input.otraAnomalia?.trim() || undefined,
    timestamp: input.timestamp,
    observaciones: input.observaciones?.trim() || undefined,
    resolucion: null,
  };

  return { inspeccion, errores: [] };
}

// ---------------------------------------------------------------------------
// Devolución de tela (solo pre-impresión)
// ---------------------------------------------------------------------------

export interface RegistrarDevolucionInput {
  /** Motivo de la devolución (obligatorio). */
  motivo: string;
  /** Quién registra la devolución (obligatorio). */
  registradaPor: string;
  /** Cuándo se registra la devolución (ISO 8601). */
  timestamp: string;
}

/**
 * Registra una devolución de tela como resolución de una inspección con
 * anomalía. PERMITIDA ÚNICAMENTE si la orden no tiene producción posterior a
 * su lectura base: `golpesProducidosDesdeLecturas(orden.lecturas) === 0`.
 * No basta con "no existe lectura" porque Ticket 01 permite una lectura base
 * con cero golpes.
 *
 * Reglas:
 * - La inspección debe tener anomalía (sin anomalía no hay resolución).
 * - La inspección no debe estar resuelta (sin segunda devolución ni
 *   autorización posterior).
 * - El motivo es obligatorio; se registra quién y cuándo.
 * - NO crea una parada, NO modifica lecturas, progreso ni estado de la orden.
 * - Sin devoluciones post-impresión.
 */
export function registrarDevolucion(
  orden: Orden,
  inspeccion: InspeccionTela,
  input: RegistrarDevolucionInput,
): ResultadoInspeccion {
  const errores: string[] = [];

  if (!conAnomalia(inspeccion)) {
    errores.push("no se puede devolver tela de una inspección sin anomalías");
  }

  if (inspeccion.resolucion !== null) {
    errores.push("la inspección ya tiene una resolución registrada");
  }

  // Pre-impresión: producción derivada igual a cero
  const golpesProducidos = golpesProducidosDesdeLecturas(orden.lecturas ?? []);
  if (golpesProducidos !== 0) {
    errores.push("la devolución de tela solo se permite antes de imprimir (producción 0)");
  }

  // Motivo requerido
  if (!input.motivo || input.motivo.trim() === "") {
    errores.push("el motivo de la devolución es obligatorio");
  }

  // Quién registra requerido
  if (!input.registradaPor || input.registradaPor.trim() === "") {
    errores.push("debe indicar quién registra la devolución");
  }

  // Cuándo: timestamp requerido y válido
  if (!input.timestamp || input.timestamp.trim() === "") {
    errores.push("debe indicar el timestamp de la devolución");
  } else if (!esTimestampValido(input.timestamp)) {
    errores.push("el timestamp de la devolución no es una fecha válida");
  }

  if (errores.length > 0) {
    return { errores };
  }

  return {
    inspeccion: {
      ...inspeccion,
      resolucion: {
        tipo: "devolucion",
        motivo: input.motivo.trim(),
        registradaPor: input.registradaPor.trim(),
        timestamp: input.timestamp,
      },
    },
    errores: [],
  };
}

// ---------------------------------------------------------------------------
// Autorización de gerencia (registro documental, sin workflow)
// ---------------------------------------------------------------------------

export interface RegistrarAutorizacionInput {
  /** Quién autoriza (gerencia/gestión) — obligatorio. */
  autorizadoPor: string;
  /** Cuándo se autoriza (ISO 8601). */
  timestamp: string;
  /** Opcional: el registro documental es válido sin observaciones. */
  observaciones?: string;
}

/**
 * Registra la autorización de gerencia para usar tela con anomalía. Registro
 * DOCUMENTAL (quién/cuándo/observaciones), sin workflow: no crea estados
 * pendientes, tareas, notificaciones ni aprobaciones posteriores.
 *
 * Reglas:
 * - La inspección debe tener anomalía (sin anomalía no hay resolución).
 * - La inspección no debe estar resuelta (sin autorización ni devolución
 *   posterior).
 * - `autorizadoPor` y el timestamp son obligatorios; observaciones opcionales.
 */
export function registrarAutorizacionGerencia(
  inspeccion: InspeccionTela,
  input: RegistrarAutorizacionInput,
): ResultadoInspeccion {
  const errores: string[] = [];

  if (!conAnomalia(inspeccion)) {
    errores.push("no se puede autorizar el uso de tela de una inspección sin anomalías");
  }

  if (inspeccion.resolucion !== null) {
    errores.push("la inspección ya tiene una resolución registrada");
  }

  // Quién autoriza requerido
  if (!input.autorizadoPor || input.autorizadoPor.trim() === "") {
    errores.push("autorizadoPor es obligatorio");
  }

  // Cuándo: timestamp requerido y válido
  if (!input.timestamp || input.timestamp.trim() === "") {
    errores.push("debe indicar el timestamp de la autorización");
  } else if (!esTimestampValido(input.timestamp)) {
    errores.push("el timestamp de la autorización no es una fecha válida");
  }

  if (errores.length > 0) {
    return { errores };
  }

  return {
    inspeccion: {
      ...inspeccion,
      resolucion: {
        tipo: "autorizacion_gerencia",
        autorizadoPor: input.autorizadoPor.trim(),
        timestamp: input.timestamp,
        observaciones: input.observaciones?.trim() || undefined,
      },
    },
    errores: [],
  };
}