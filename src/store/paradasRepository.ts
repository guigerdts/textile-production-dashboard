/**
 * Interfaz pública del repositorio de paradas — ticket 02.
 * Contrato mínimo y reemplazable: hoy InMemoryParadaRepository,
 * mañana SqliteRepository, SIN cambiar el dominio ni la UI.
 *
 * Decisiones de diseño:
 * - INSERT/UPDATE explícitos (no upsert) para mapeo directo a SQLite
 *   con PK, permitiendo rechazar duplicados y updates de ids inexistentes.
 * - Los métodos son síncronos para ser consistentes con IOrderRepository.
 *   Una implementación SQLite real con Tauri plugin requiere adaptación async.
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
 * - obtenerPorId: por id directo, útil para operaciones de cierre.
 */
import type { Parada, ParadaAbierta } from "../domain/types";

export interface IParadaRepository {
  /**
   * Inserta una parada nueva. Lanza si el id ya existe.
   * Uso típico: registrarParada del dominio → insertParada.
   */
  insertParada(parada: Parada): void;

  /**
   * Actualiza una parada existente (por id). Lanza si el id no existe.
   * Uso típico: cerrarParada del dominio → updateParada.
   */
  updateParada(parada: Parada): void;

  /**
   * Devuelve la parada con el id dado, o undefined.
   */
  obtenerPorId(id: string): Parada | undefined;

  /**
   * Lista todas las paradas de una máquina (orden cronológico).
   * Incluye paradas con y sin orden asociada.
   */
  listarPorMaquina(maquinaId: string): Parada[];

  /**
   * Lista paradas asociadas a una orden concreta (orden cronológico).
   * NO incluye paradas sin orden (ordenId null).
   */
  listarPorOrden(ordenId: string): Parada[];

  /**
   * Devuelve la parada abierta (fin = null) para la máquina (+ orden si se indica),
   * o null si no hay ninguna. Devuelve ParadaAbierta para que el tipo
   * sea utilizable en cerrarParada sin cast.
   */
  getParadaAbierta(maquinaId: string, ordenId: string | null): ParadaAbierta | null;
}
