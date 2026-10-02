/**
 * Interfaz pública del repositorio de daños — ticket 05.
 * Contrato mínimo y reemplazable: hoy InMemoryDanoRepository,
 * mañana SqliteRepository, SIN cambiar el dominio ni la UI.
 *
 * Decisiones de diseño (mismas que IParadaRepository / IActividadRepository):
 * - INSERT/UPDATE explícitos (no upsert) para mapeo directo a SQLite
 *   con PK, permitiendo rechazar duplicados y updates de ids inexistentes.
 * - Los métodos son asíncronos: una implementación SQLite real con el plugin
 *   de Tauri es I/O y devuelve Promise. Nombres, parámetros y tipos resueltos
 *   no cambian respecto al contrato síncrono anterior; solo cambia la entrega.
 * - Campos serializables a JSON (strings, null, números, booleanos).
 * - structuredClone en cada persistencia y lectura evita contaminación por
 *   referencias mutables (igual que los repos anteriores).
 *
 * Reglas de alcance (acordadas en el Ciclo 2):
 * - insertDano: registra un daño nuevo (genera el id el dominio).
 * - updateDano: cierra o modifica un daño existente (mismo id).
 * - listarPorMaquina: todos los daños de la máquina (incluidos sin orden).
 * - listarPorOrden: solo daños asociados a la orden concreta (null no se incluye).
 * - getDanoAbierto: busca el daño sin cerrar de la máquina (consulta
 *   estructural, misma naturaleza que getParadaAbierta/getActividadAbierta).
 * - obtenerPorId: por id directo, útil para operaciones de cierre.
 *
 * Qué NO hace el repositorio:
 * - NO valida existencias ni coherencia de paradas vinculadas. Esa regla de
 *   negocio vive en el dominio (registrarDano con ObtenerParadaPorId inyectada
 *   por la capa de aplicación: `(id) => paradaRepo.obtenerPorId(id)`). El
 *   repositorio persiste tal cual el Dano ya validado por el dominio.
 * - NO aplica la restricción de un solo daño abierto por máquina; esa es una
 *   regla operativa del dominio al registrar. getDanoAbierto solo la consulta.
 */
import type { Dano, DanoAbierto } from "../domain/types";

export interface IDanoRepository {
  /**
   * Inserta un daño nuevo. Lanza si el id ya existe.
   * Uso típico: registrarDano del dominio → insertDano.
   */
  insertDano(dano: Dano): Promise<void>;

  /**
   * Actualiza un daño existente (por id). Lanza si el id no existe.
   * Uso típico: cerrarDano del dominio → updateDano.
   */
  updateDano(dano: Dano): Promise<void>;

  /**
   * Devuelve el daño con el id dado, o undefined.
   */
  obtenerPorId(id: string): Promise<Dano | undefined>;

  /**
   * Lista todos los daños de una máquina (orden cronológico por inicio).
   * Incluye daños con y sin orden asociada.
   */
  listarPorMaquina(maquinaId: string): Promise<Dano[]>;

  /**
   * Lista los daños de una máquina de UN DÍA OPERATIVO, en orden cronológico
   * por `inicio`.
   *
   * `fechaOperativa` es un parámetro posicional **obligatorio** (DD1): sin él la
   * llamada no compila, así que no existe un camino de lectura sin día.
   *
   * El día es una **igualdad exacta sobre el `fechaOperativa` persistido** y
   * NUNCA se deriva de `inicio` ni de `fin`: un daño abierto a la medianoche
   * sigue perteneciendo a su día de origen, y `fin` es `null` en los registros
   * abiertos, así que derivar de él descartaría justamente los casos que este
   * listado debe mostrar.
   *
   * Orden: `inicio.localeCompare` NO es un orden total cuando dos registros del
   * mismo día comparten `inicio`. El listado sin día tiene la misma propiedad
   * hoy; este método no añade determinismo ni lo quita (design §3.1).
   *
   * `listarPorMaquina` sobrevive intacto y completo: es la costura para una
   * vista de historia completa (DD2).
   */
  listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Dano[]>;

  /**
   * Lista daños asociados a una orden concreta (orden cronológico).
   * NO incluye daños sin orden (ordenId null).
   */
  listarPorOrden(ordenId: string): Promise<Dano[]>;

  /**
   * Devuelve el daño abierto (fin = null) de la máquina, o null si no hay.
   * Devuelve DanoAbierto para que el tipo sea utilizable en cerrarDano sin cast.
   */
  getDanoAbierto(maquinaId: string): Promise<DanoAbierto | null>;
}