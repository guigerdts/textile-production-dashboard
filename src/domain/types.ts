/**
 * Tipos del dominio de estampado — tickets 01 y 02.
 * Vocabulario canónico según CONTEXT.md. Sin dependencias de UI, API ni persistencia.
 */

export type EstadoOrden = "available" | "in_production" | "finished";

export type TipoPintura = "reactiva" | "pigmento";

/**
 * Lectura absoluta del contador de golpes de la máquina.
 * La máquina cuenta los golpes automáticamente; la captura manual es un
 * adaptador temporal hasta que exista integración con el contador.
 * El valor es SIEMPRE una lectura absoluta, nunca una cantidad de golpes
 * producidos. La producción se deriva por diferencias entre lecturas.
 */
export interface LecturaContador {
  valor: number;
  timestamp: string; // ISO 8601
  /** Incremento respecto de la lectura anterior. 0 en la primera lectura (base). */
  deltaGolpes: number;
}

/** Orden de producción. Llega creada desde la programación semanal externa; el sistema ejecuta. */
export interface Orden {
  id: string;
  numeroOrden: string;
  diseno: string;
  telaReferencia: string;
  unidadesSolicitadas: number;
  /**
   * Proyección operativa de 2da, decidida por el usuario PARA CADA ORDEN.
   * - false: la orden no lleva proyección de segunda; porcentaje2da DEBE ser 0.
   * - true: el usuario introduce el porcentaje (5% es valor SUGERIDO, no obligatorio).
   * La segunda es una proyección operativa de Estampado, NUNCA clasificación
   * oficial de calidad (1ra/2da pertenece a Acabado).
   */
  aplicaSegunda: boolean;
  /** Fracción decimal: 0.05 = 5%. Invariante: 0 <= porcentaje2da < 1; si aplicaSegunda es false, debe ser exactamente 0. */
  porcentaje2da: number;
  tipoPintura: TipoPintura;
  machineId: "M1";
  /** Fecha operativa en que se ejecuta la orden (YYYY-MM-DD). */
  fechaOperativa: string;
  estado: EstadoOrden;
  /** Metadato de origen externo (programación semanal). Opcional desde D-1 (ticket 10.4): la persistencia NUNCA lo reconstruye ni fabrica. */
  creadaExternamenteEn?: string;
  iniciadaEn?: string;
  finalizadaEn?: string;
  operatorName?: string;
  /** Primera lectura del contador al iniciar. Toda orden en producción tiene base. */
  contadorBase?: number;
  lecturas: LecturaContador[];
}

// ---------------------------------------------------------------------------
// Ticket 02 — Paradas / Incidencias
// ---------------------------------------------------------------------------

/** Catálogo de 10 causas predefinidas de parada (CONTEXT.md). */
export type CausaParadaId =
  | "falta_color"
  | "rotura_cuadro"
  | "atasco_tela"
  | "danio_mecanico"
  | "danio_electrico"
  | "ajuste_registro"
  | "problema_horno"
  | "falta_tela"
  | "cambio_diseno_no_planificado"
  | "otro";

/** Entrada del catálogo de causas: ID, nombre visible y campos requeridos. */
export interface CausaParadaDef {
  id: CausaParadaId;
  nombre: string;
  /** Lista de nombres de campos específicos requeridos para esta causa. */
  camposRequeridos: string[];
}

/** Parada (incidencia) de la máquina. Evento temporal con inicio y opcionalmente fin. */
export interface Parada {
  id: string;
  maquinaId: "M1";
  /** ID de la orden asociada; null = parada sin orden (máquina ociosa). */
  ordenId: string | null;
  /** Nombre del operario que registró la parada (coherente con órdenes y lecturas). */
  operatorName: string;
  causaId: CausaParadaId;
  /** Campos específicos según la causa. Validados por registrarParada. */
  camposEspecificos: Record<string, unknown>;
  /** Texto libre. Obligatorio solo si causaId es "otro". */
  observaciones?: string;
  /** Fecha operativa (YYYY-MM-DD) a la que se atribuye este evento.
   *  Determina en exclusiva a que jornada pertenece; no se deriva de `inicio`
   *  ni se altera al cerrar. */
  fechaOperativa: string;
  /** Timestamp de inicio (ISO 8601). */
  inicio: string;
  /** Timestamp de fin (ISO 8601). null = parada abierta. */
  fin: string | null;
}

/** Tipo derivado: parada con fin = null (abierta). */
export type ParadaAbierta = Parada & { fin: null };

// ---------------------------------------------------------------------------
// Ticket 03 — Actividades planificadas
// ---------------------------------------------------------------------------

/** Tipos de actividad planificada (tiempo no productivo planificado). */
export type TipoActividadPlanificada =
  | "cambio_diseno"
  | "limpieza"
  | "almuerzo"
  | "pausa";

/** Definición de catálogo para un tipo de actividad (nombre oficial para UI). */
export interface TipoActividadDef {
  id: TipoActividadPlanificada;
  nombre: string;
}

/**
 * Actividad planificada (cambio de diseño o limpieza).
 * Tiempo no productivo planificado: NUNCA es parada ni incidencia.
 * Independiente de la orden: no lleva ordenId (puede registrarse en día vacío).
 */
export interface ActividadPlanificada {
  id: string;
  maquinaId: "M1";
  tipo: TipoActividadPlanificada;
  /** Fecha operativa (YYYY-MM-DD) a la que se atribuye este evento.
   *  Determina en exclusiva a que jornada pertenece; no se deriva de `inicio`
   *  ni se altera al cerrar. */
  fechaOperativa: string;
  /** Timestamp de inicio del período real (ISO 8601). */
  inicio: string;
  /** Timestamp de fin del período real (ISO 8601). null = actividad abierta. */
  fin: string | null;
  /** Qué se limpió. Obligatorio solo si tipo === "limpieza" (valida comenzarActividad). */
  queSeLimpio?: string;
  /** Texto libre. Opcional en ambos tipos. */
  observaciones?: string;
  /** Nombre del operario que registró la actividad (obligatorio). */
  operatorName: string;
}

/** Tipo derivado: actividad con fin = null (abierta). */
export type ActividadAbierta = ActividadPlanificada & { fin: null };

// ---------------------------------------------------------------------------
// Ticket 04 — Modelo de tiempo derivado
// ---------------------------------------------------------------------------

/** Ventana de jornada laboral. Default 07:00–17:00; el fin real puede extenderse por overtime. */
export interface JornadaTurno {
  /** Inicio del turno (ISO 8601). */
  inicio: string;
  /** Fin del turno (ISO 8601). Debe ser posterior al inicio (validado por validarJornada). */
  fin: string;
}

/**
 * Resumen del turno derivado por dominio (NUNCA entrada manual).
 * Todos los valores en SEGUNDOS.
 */
export interface ResumenTiempoTurno {
  /** totalDisponible = ventana de jornada (inicio → fin). */
  totalDisponible: number;
  /** planificado = unión de intervalos de actividades planificadas, recortados a la jornada. */
  planificado: number;
  /** incidencias = unión de intervalos de paradas, recortados a la jornada. */
  incidencias: number;
  /**
   * noProductivoTotal = unión de planificado e incidencias: cada minuto cubierto
   * por una actividad O una parada cuenta UNA sola vez (no doble conteo).
   */
  noProductivoTotal: number;
  /** productivo = max(0, totalDisponible − noProductivoTotal). Nunca negativo. */
  productivo: number;
}

// ---------------------------------------------------------------------------
// Ticket 05 — Daño / eventos y sospecha de 2da
// ---------------------------------------------------------------------------

/** Tipo de daño de máquina: eléctrico, mecánico u operacional (CONTEXT.md). */
export type TipoDano = "electrico" | "mecanico" | "operacional";

/** Entrada del catálogo de tipos de daño: ID y nombre visible. */
export interface TipoDanoDef {
  id: TipoDano;
  nombre: string;
}

/**
 * Evento independiente de daño de la máquina. Las consecuencias (`causoParada`,
 * `posibleSegunda`) son flags INDEPENDIENTES y pueden darse en simultáneo.
 * NO es una parada: registrar un daño no crea, cierra ni modifica paradas.
 * El daño NO aporta tiempo al resumen del turno (Ticket 04); solo la parada
 * vinculada cuenta como incidencia si existe.
 */
export interface Dano {
  id: string;
  maquinaId: "M1";
  /** Orden en curso al momento del daño; null = daño sin orden (máquina ociosa). */
  ordenId: string | null;
  /** Nombre del operario que registró el daño (obligatorio). */
  operatorName: string;
  tipo: TipoDano;
  /** Componente afectado (texto libre: "eje trasero", "horno", "carro 3"). */
  componente: string;
  /** Fecha operativa (YYYY-MM-DD) a la que se atribuye este evento.
   *  Determina en exclusiva a que jornada pertenece; no se deriva de `inicio`
   *  ni se altera al cerrar. */
  fechaOperativa: string;
  /** Timestamp de inicio del daño (ISO 8601). */
  inicio: string;
  /** Timestamp de fin de reparación. null = daño abierto (reparación en curso). */
  fin: string | null;
  /** Solución aplicada. Obligatoria SOLO al cerrar el daño. */
  solucionAplicada?: string;
  /** Flag independiente: este daño causó una parada de la máquina. */
  causoParada: boolean;
  /** ID de la parada vinculada. Obligatorio si causoParada es true; null si es false. */
  paradaId: string | null;
  /** Flag independiente: este daño puede haber producido segunda (sospecha operativa). */
  posibleSegunda: boolean;
  /** Unidades sospechadas de ser segunda. Solo si posibleSegunda es true; entero ≥ 0. */
  unidadesSospechadas?: number;
  /** Texto libre. Opcional. */
  observaciones?: string;
}

/** Tipo derivado: daño con fin = null (abierto, reparación en curso). */
export type DanoAbierto = Dano & { fin: null };

// ---------------------------------------------------------------------------
// Ticket 07 — Inspección de tela / devolución / uso autorizado
// ---------------------------------------------------------------------------

/** Ítems fijos del checklist de inspección de tela (CONTEXT.md). */
export type ItemChecklistId =
  | "absorcion"
  | "tundido"
  | "manchas"
  | "dimensiones"
  | "estado_general";

/** Estado de un ítem del checklist: SIEMPRE explícito, nunca vacío. */
export type EstadoItemChecklist = "conforme" | "anomalia";

/** Resultado de un ítem del checklist dentro de una inspección. */
export interface ItemChecklistEstado {
  id: ItemChecklistId;
  estado: EstadoItemChecklist;
}

/** Entrada del catálogo de ítems del checklist: ID y nombre visible. */
export interface ItemChecklistDef {
  id: ItemChecklistId;
  nombre: string;
}

/** Resolución de una inspección con anomalía: tres estados EXCLUSIVOS. */
export type TipoResolucionInspeccion =
  | "devolucion"
  | "autorizacion_gerencia";

/** QUIÉN/CUÁNDO y motivo de una devolución de tela (datos de registro, nunca workflow). */
export interface ResolucionDevolucion {
  tipo: "devolucion";
  motivo: string;
  registradaPor: string;
  timestamp: string; // ISO 8601
}

/**
 * Registro documental de autorización de gerencia para usar tela con anomalía.
 * Sin workflow: no crea estados pendientes, tareas ni aprobaciones posteriores.
 */
export interface ResolucionAutorizacion {
  tipo: "autorizacion_gerencia";
  autorizadoPor: string;
  timestamp: string; // ISO 8601
  /** Opcional: el registro documental es válido sin observaciones. */
  observaciones?: string;
}

/** Datos de resolución de una inspección con anomalía (excluyente). */
export type ResolucionInspeccion = ResolucionDevolucion | ResolucionAutorizacion;

/** Estado de la tela derivado DE CADA INSPECCIÓN (nunca estado global de la orden). */
export type EstadoInspeccionTela =
  | "conforme"
  | "no_usable"
  | "devuelta"
  | "uso_autorizado";

/**
 * Inspección de tela: evento asociado SIEMPRE a su orden de producción
 * (`ordenId` obligatorio), nunca evento general de máquina. Recurrente por
 * lote nuevo: pueden existir MÚLTIPLES inspecciones independientes por orden.
 * No es una parada: registrar una inspección no crea ni modifica paradas,
 * y no aporta tiempo al resumen del turno (Ticket 04).
 */
export interface InspeccionTela {
  id: string;
  /** Orden asociada (obligatoria). La inspección no existe desde día vacío. */
  ordenId: string;
  /** Nombre del operario que registró la inspección (obligatorio). */
  operatorName: string;
  /** Identificador de lote (texto libre, OPCIONAL). Sin entidad de lote persistente. */
  lote?: string;
  /** Los 5 ítems del checklist, SIEMPRE con estado explícito. */
  items: ItemChecklistEstado[];
  /** Otra anomalía detectada (texto libre, opcional). */
  otraAnomalia?: string;
  /** Timestamp de la inspección (ISO 8601). */
  timestamp: string;
  /** Texto libre. Opcional. */
  observaciones?: string;
  /** Resolución de la inspección. null = sin_resolucion. */
  resolucion: ResolucionInspeccion | null;
}

// ---------------------------------------------------------------------------
// Ticket 08 — Maintenance (reactivo and preventivo)
// ---------------------------------------------------------------------------

/** Tipo de mantenimiento: reactivo o preventivo (CONTEXT.md). */
export type TipoMantenimientoId = "reactivo" | "preventivo";

/** Entrada del catálogo de tipos de mantenimiento: ID y nombre visible. */
export interface TipoMantenimientoDef {
  id: TipoMantenimientoId;
  nombre: string;
}

/**
 * Mantenimiento de la máquina. Evento documental: NUNCA toca tiempo productivo
 * (ADR 0007), no tiene ordenId, y no se puede editar ni eliminar después de cerrado.
 * `inicio` es el único campo temporal requerido; `fin` null = en progreso.
 * La duración siempre se deriva, nunca se persiste.
 */
export interface Mantenimiento {
  id: string;
  maquinaId: "M1";
  tipo: TipoMantenimientoId;
  /** Nombre del operario que registró el mantenimiento (obligatorio). */
  operatorName: string;
  /** Motivo del mantenimiento (obligatorio). */
  motivo: string;
  /** Fecha operativa (YYYY-MM-DD) a la que se atribuye este evento.
   *  Determina en exclusiva a que jornada pertenece; no se deriva de `inicio`
   *  ni se altera al cerrar. */
  fechaOperativa: string;
  /** Timestamp de inicio (ISO 8601). Siempre requerido. */
  inicio: string;
  /** Timestamp de fin (ISO 8601). null = en progreso. */
  fin: string | null;
  /** Qué se revisó/reparó. Obligatorio al cerrar o en registro completo. */
  queSeRevisoReparo?: string;
  /** ID del daño vinculado. Solo para reactivo; preventivo siempre null. */
  danoId: string | null;
  /** Texto libre. Opcional. */
  observaciones?: string;
}

/** Tipo derivado: mantenimiento con fin = null (en progreso). */
export type MantenimientoAbierto = Mantenimiento & { fin: null };

/**
 * Función provista por la capa de aplicación para verificar la existencia de
 * un daño al vincularlo. `undefined` = el daño no existe.
 */
export type ObtenerDanoPorId = (id: string) => Dano | undefined;