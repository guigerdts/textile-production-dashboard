/**
 * Interfaz pública del repositorio de mantenimiento — ticket 08.
 * Contrato mínimo y reemplazable: hoy InMemoryMantenimientoRepository,
 * mañana SqliteRepository, SIN cambiar el dominio ni la UI.
 *
 * Decisiones de diseño (mismas que IDanoRepository):
 * - INSERT/UPDATE explícitos (no upsert) para mapeo directo a SQLite
 *   con PK, permitiendo rechazar duplicados y updates de ids inexistentes.
 * - Los métodos son asíncronos: una implementación SQLite real con el plugin
 *   de Tauri es I/O y devuelve Promise. Nombres, parámetros y tipos resueltos
 *   no cambian respecto al contrato síncrono anterior; solo cambia la entrega:
 *   el dominio sigue siendo síncrono y puro.
 * - Campos serializables a JSON (strings, null, números, booleanos).
 * - structuredClone en cada persistencia y lectura evita contaminación por
 *   referencias mutables.
 *
 * Reglas de alcance:
 * - insertMantenimiento: registra un mantenimiento nuevo (genera el id el dominio).
 * - updateMantenimiento: cierra o modifica un mantenimiento existente (mismo id).
 * - listarPorMaquina: todos los mantenimientos de la máquina (orden cronológico).
 *   NO existe listarPorOrden: el mantenimiento es un registro de MÁQUINA, nunca de
 *   una orden (docs/adr/0006-maintenance-on-machine-not-chemistry.md), así que el
 *   dominio no tiene orden_id y el puerto no tiene esa consulta.
 * - obtenerPorId: por id directo, útil para operaciones de cierre.
 * - getMantenimientoAbierto: busca el mantenimiento sin cerrar de la máquina
 *   (consulta estructural).
 * - NINGÚN campo derivado se persiste (duración, estado de máquina, alerta): el
 *   mantenimiento es documental y nunca descuenta tiempo productivo
 *   (docs/adr/0007-maintenance-documentary-no-time-deduction.md).
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
  insertMantenimiento(mantenimiento: Mantenimiento): Promise<void>;

  /**
   * Actualiza un mantenimiento existente (por id). Lanza si el id no existe.
   * Uso típico: cerrarMantenimiento del dominio → updateMantenimiento.
   */
  updateMantenimiento(mantenimiento: Mantenimiento): Promise<void>;

  /**
   * Devuelve el mantenimiento con el id dado, o undefined.
   */
  obtenerPorId(id: string): Promise<Mantenimiento | undefined>;

  /**
   * Lista todos los mantenimientos de una máquina (orden cronológico por inicio).
   */
  listarPorMaquina(maquinaId: string): Promise<Mantenimiento[]>;

  /**
   * Lista los mantenimientos de una máquina de UN DÍA OPERATIVO, en orden
   * cronológico por `inicio`.
   *
   * `fechaOperativa` es un parámetro posicional **obligatorio** (DD1): sin él la
   * llamada no compila, así que no existe un camino de lectura sin día.
   *
   * El día es una **igualdad exacta sobre el `fechaOperativa` persistido** y
   * NUNCA se deriva de `inicio` ni de `fin`: un mantenimiento que cruza la
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
  listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Mantenimiento[]>;

  /**
   * Devuelve el mantenimiento abierto (fin = null) de la máquina, o null si no hay.
   * Devuelve MantenimientoAbierto para que el tipo sea utilizable en cerrarMantenimiento sin cast.
   */
  getMantenimientoAbierto(maquinaId: string): Promise<MantenimientoAbierto | null>;
}
