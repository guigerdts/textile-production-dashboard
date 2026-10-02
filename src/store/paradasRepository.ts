/**
 * Interfaz pública del repositorio de paradas — ticket 02.
 * Contrato mínimo y reemplazable: hoy InMemoryParadaRepository,
 * mañana SqliteRepository, SIN cambiar el dominio ni la UI.
 *
 * Decisiones de diseño:
 * - INSERT/UPDATE explícitos (no upsert) para mapeo directo a SQLite
 *   con PK, permitiendo rechazar duplicados y updates de ids inexistentes.
 * - Los métodos son asíncronos: una implementación SQLite real con el plugin
 *   de Tauri es I/O y devuelve Promise. Nombres, parámetros y tipos resueltos
 *   no cambian respecto al contrato síncrono anterior; solo cambia la entrega.
 * - Campos serializables a JSON: camposEspecificos es Record<string, unknown>.
 * - structuredClone en cada persistencia y lectura evita contaminación por
 *   referencias mutables (igual que IOrderRepository).
 *
 * Reglas de alcance (acordadas):
 * - insertParada: registra una parada nueva (genera el id el dominio).
 * - updateParada: cierra o modifica una parada existente (mismo id).
 * - listarPorMaquina: todas las paradas de la máquina (incluidas sin orden).
 * - listarPorOrden: solo paradas asociadas a la orden concreta (null no se incluye).
 * - getParadaAbierta: busca parada sin cerrar para máquina + orden|null.
 * - getParadaAbiertaDeMaquina: busca la parada sin cerrar de la máquina, sea
 *   cual sea su orden (o su ausencia) y sea cual sea su día.
 * - obtenerPorId: por id directo, útil para operaciones de cierre.
 */
import type { Parada, ParadaAbierta } from "../domain/types";

export interface IParadaRepository {
  /**
   * Inserta una parada nueva. Rechaza si el id ya existe.
   * Uso típico: registrarParada del dominio → insertParada.
   */
  insertParada(parada: Parada): Promise<void>;

  /**
   * Actualiza una parada existente (por id). Rechaza si el id no existe.
   * Uso típico: cerrarParada del dominio → updateParada.
   */
  updateParada(parada: Parada): Promise<void>;

  /**
   * Devuelve la parada con el id dado, o undefined.
   */
  obtenerPorId(id: string): Promise<Parada | undefined>;

  /**
   * Lista todas las paradas de una máquina (orden cronológico).
   * Incluye paradas con y sin orden asociada.
   */
  listarPorMaquina(maquinaId: string): Promise<Parada[]>;

  /**
   * Lista las paradas de una máquina de UN DÍA OPERATIVO, en orden cronológico
   * por `inicio`.
   *
   * `fechaOperativa` es un parámetro posicional **obligatorio** (DD1): sin él la
   * llamada no compila, así que no existe un camino de lectura sin día.
   *
   * El día es una **igualdad exacta sobre el `fechaOperativa` persistido** y
   * NUNCA se deriva de `inicio` ni de `fin`: un registro que empezó antes de la
   * medianoche y terminó después sigue perteneciendo a su día de origen, y `fin`
   * es `null` en los registros abiertos, así que derivar de él descartaría
   * justamente los casos que este listado debe mostrar.
   *
   * Orden: `inicio.localeCompare` NO es un orden total cuando dos registros del
   * mismo día comparten `inicio`. El listado sin día tiene la misma propiedad
   * hoy; este método no añade determinismo ni lo quita (design §3.1).
   *
   * `listarPorMaquina` sobrevive intacto y completo: es la costura para una
   * vista de historia completa (DD2).
   */
  listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Parada[]>;

  /**
   * Lista paradas asociadas a una orden concreta (orden cronológico).
   * NO incluye paradas sin orden (ordenId null).
   */
  listarPorOrden(ordenId: string): Promise<Parada[]>;

  /**
   * Devuelve la parada abierta (fin = null) para la máquina (+ orden si se indica),
   * o null si no hay ninguna. Devuelve ParadaAbierta para que el tipo
   * sea utilizable en cerrarParada sin cast.
   */
  getParadaAbierta(maquinaId: string, ordenId: string | null): Promise<ParadaAbierta | null>;

  /**
   * Devuelve la parada ABIERTA de la máquina, sin mirar su orden (puede tener
   * una o ninguna) ni su `fechaOperativa`. `null` si la máquina no está parada.
   *
   * POR QUÉ EXISTE (OQ-4 de historical-day-navigation): "¿está parada M1?" es
   * un invariante de MÁQUINA, no de la orden. Una parada abierta puede seguir
   * abierta mientras la producción cambia de orden, y en ese estado
   * `getParadaAbierta(maquinaId, ordenId)` NO la alcanza: su predicado
   * `orden_id IS $2` solo casa con esa orden exacta o con `ordenId = null`.
   * Con el listado day-scoped tampoco se alcanza, porque la parada conserva su
   * `fechaOperativa` de origen y no pertenece al día que se está mirando.
   *
   * ES DAY-FREE A PROPÓSITO: responde "¿qué está abierto AHORA?", nunca
   * "¿qué pasó en este día?". Por eso NO sustituye a los listados, que sí son
   * day-scoped (`listarPorMaquinaYFecha`). Consumirlo sobre un día histórico
   * pintaría la parada abierta de hoy sobre un día pasado y rompería la
   * atribución exclusiva por `fechaOperativa`; por eso su consumidor va
   * detrás de `soloLectura`.
   */
  getParadaAbiertaDeMaquina(maquinaId: string): Promise<ParadaAbierta | null>;
}
