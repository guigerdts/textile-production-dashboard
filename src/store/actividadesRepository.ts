/**
 * Interfaz pública del repositorio de actividades planificadas — ticket 03.
 * Contrato mínimo y reemplazable: hoy InMemoryActividadPlanificadaRepository,
 * mañana SqliteRepository, SIN cambiar el dominio ni la UI.
 *
 * Decisiones de diseño (mismas que IParadaRepository):
 * - INSERT/UPDATE explícitos (no upsert) para mapeo directo a SQLite
 *   con PK, permitiendo rechazar duplicados y updates de ids inexistentes.
 * - Los métodos son asíncronos: una implementación SQLite real con el plugin
 *   de Tauri es I/O y devuelve Promise. Nombres, parámetros y tipos resueltos
 *   no cambian respecto al contrato síncrono anterior; solo cambia la entrega,
 *   y el adaptador en memoria conserva exactamente el mismo comportamiento
 *   observable que hoy.
 * - Campos serializables a JSON (strings + null; sin funciones ni Map/Set).
 * - structuredClone en cada persistencia y lectura evita contaminación por
 *   referencias mutables (igual que los repos anteriores).
 *
 * Reglas de alcance (acordadas):
 * - insertActividad: registra una actividad nueva (genera el id el dominio).
 * - updateActividad: cierra o modifica una actividad existente (mismo id).
 * - listarPorMaquina: todas las actividades de la máquina (incluidas
 *   las independientes de la orden — el modelo NO lleva ordenId).
 * - getActividadAbierta: busca actividad sin cerrar para máquina + tipo.
 * - obtenerPorId: por id directo, útil para operaciones de cierre.
 */
import type { ActividadAbierta, ActividadPlanificada, TipoActividadPlanificada } from "../domain/types";

export interface IActividadPlanificadaRepository {
  /**
   * Inserta una actividad nueva. Lanza si el id ya existe.
   * Uso típico: comenzarActividad del dominio → insertActividad.
   */
  insertActividad(actividad: ActividadPlanificada): Promise<void>;

  /**
   * Actualiza una actividad existente (por id). Lanza si el id no existe.
   * Uso típico: finalizarActividad del dominio → updateActividad.
   */
  updateActividad(actividad: ActividadPlanificada): Promise<void>;

  /**
   * Devuelve la actividad con el id dado, o undefined.
   */
  obtenerPorId(id: string): Promise<ActividadPlanificada | undefined>;

  /**
   * Lista todas las actividades de una máquina (orden cronológico por inicio).
   * Sin filtro por orden: las actividades son independientes de las órdenes.
   */
  listarPorMaquina(maquinaId: string): Promise<ActividadPlanificada[]>;

  /**
   * Lista las actividades de una máquina de UN DÍA OPERATIVO, en orden
   * cronológico por `inicio`.
   *
   * `fechaOperativa` es un parámetro posicional **obligatorio** (DD1): sin él la
   * llamada no compila, así que no existe un camino de lectura sin día.
   *
   * El día es una **igualdad exacta sobre el `fechaOperativa` persistido** y
   * NUNCA se deriva de `inicio` ni de `fin`: una actividad abierta a la
   * medianoche sigue perteneciendo a su día de origen, y `fin` es `null` en los
   * registros abiertos, así que derivar de él descartaría justamente los casos
   * que este listado debe mostrar.
   *
   * Orden: `inicio.localeCompare` NO es un orden total cuando dos registros del
   * mismo día comparten `inicio`. El listado sin día tiene la misma propiedad
   * hoy; este método no añade determinismo ni lo quita (design §3.1).
   *
   * `listarPorMaquina` sobrevive intacto y completo: es la costura para una
   * vista de historia completa (DD2).
   */
  listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<ActividadPlanificada[]>;

  /**
   * Devuelve la actividad abierta (fin = null) para la máquina y tipo,
   * o null si no hay ninguna (invariante: una por máquina + tipo).
   * Devuelve ActividadAbierta para que el tipo sea utilizable en
   * finalizarActividad sin cast.
   */
  getActividadAbierta(maquinaId: string, tipo: TipoActividadPlanificada): Promise<ActividadAbierta | null>;
}