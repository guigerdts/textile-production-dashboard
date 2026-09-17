/**
 * Interfaz pública del repositorio de mantenimiento — ticket 08.
 * Contrato mínimo y reemplazable: hoy InMemoryMantenimientoRepository,
 * mañana SqliteRepository, SIN cambiar el dominio ni la UI.
 *
 * Decisiones de diseño (mismas que IDanoRepository):
 * - INSERT/UPDATE explícitos (no upsert) para mapeo directo a SQLite
 *   con PK, permitiendo rechazar duplicados y updates de ids inexistentes.
 * - Los métodos son síncronos para ser consistentes con los repos
 *   anteriores. Una implementación SQLite real con Tauri plugin requiere
 *   adaptación async.
 * - Campos serializables a JSON (strings, null, números, booleanos).
 * - structuredClone en cada persistencia y lectura evita contaminación por
 *   referencias mutables.
 *
 * Reglas de alcance:
 * - insertMantenimiento: registra un mantenimiento nuevo (genera el id el dominio).
 * - updateMantenimiento: cierra o modifica un mantenimiento existente (mismo id).
 * - listarPorMaquina: todos los mantenimientos de la máquina (orden cronológico).
 * - obtenerPorId: por id directo, útil para operaciones de cierre.
 * - getMantenimientoAbierto: busca el mantenimiento sin cerrar de la máquina
 *   (consulta estructural).
 *
 * Qué NO hace el repositorio:
 * - NO valida existencias ni coherencia de daños vinculados. Esa regla de
 *   negocio vive en el dominio (registrarMantenimiento con ObtenerDanoPorId
 *   inyectada por la capa de aplicación). El repositorio persiste tal cual
 *   el Mantenimiento ya validado por el dominio.
 * - NO aplica la restricción de un solo mantenimiento abierto por máquina;
 *   esa es una regla operativa del dominio al registrar.
 *   getMantenimientoAbierto solo la consulta.
 */
import type { Mantenimiento, MantenimientoAbierto } from "../domain/types";

export interface IMantenimientoRepository {
  /**
   * Inserta un mantenimiento nuevo. Lanza si el id ya existe.
   * Uso típico: registrarMantenimiento del dominio → insertMantenimiento.
   */
  insertMantenimiento(mantenimiento: Mantenimiento): void;

  /**
   * Actualiza un mantenimiento existente (por id). Lanza si el id no existe.
   * Uso típico: cerrarMantenimiento del dominio → updateMantenimiento.
   */
  updateMantenimiento(mantenimiento: Mantenimiento): void;

  /**
   * Devuelve el mantenimiento con el id dado, o undefined.
   */
  obtenerPorId(id: string): Mantenimiento | undefined;

  /**
   * Lista todos los mantenimientos de una máquina (orden cronológico por inicio).
   */
  listarPorMaquina(maquinaId: string): Mantenimiento[];

  /**
   * Devuelve el mantenimiento abierto (fin = null) de la máquina, o null si no hay.
   * Devuelve MantenimientoAbierto para que el tipo sea utilizable en cerrarMantenimiento sin cast.
   */
  getMantenimientoAbierto(maquinaId: string): MantenimientoAbierto | null;
}
