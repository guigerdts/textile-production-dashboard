/**
 * Interfaz pública del repositorio de inspecciones de tela — ticket 07.
 * Contrato mínimo y reemplazable: hoy InMemoryInspeccionRepository,
 * mañana SqliteRepository, SIN cambiar el dominio ni la UI.
 *
 * Decisiones de diseño (mismas que IDanoRepository / IParadaRepository):
 * - INSERT/UPDATE explícitos (no upsert) para mapeo directo a SQLite
 *   con PK, permitiendo rechazar duplicados y updates de ids inexistentes.
 *   El flujo típico es: registrarInspeccion (dominio) → insertInspeccion;
 *   registrarDevolucion/registrarAutorizacionGerencia (dominio) → updateInspeccion
 *   con la inspección devuelta (mismo id, con resolución). La resolución NUNCA
 *   muta la inspección persistida: el dominio devuelve una copia nueva.
 * - Los métodos son asíncronos: una implementación SQLite real con el plugin
 *   de Tauri es I/O y devuelve Promise. Nombres, parámetros y tipos resueltos
 *   no cambian respecto al contrato síncrono anterior; solo cambia la entrega.
 * - Campos serializables a JSON (strings, arrays, objetos planos, null).
 * - structuredClone en cada persistencia y lectura: mutar un resultado o un
 *   input no contamina el repositorio.
 *
 * Reglas de alcance (acordadas en la cycle strategy del Ciclo 2):
 * - insertInspeccion: persiste una inspección nueva (el id lo genera el dominio).
 * - updateInspeccion: reemplaza una inspección existente (mismo id; resolución).
 * - obtenerPorId: búsqueda por id directo.
 * - listarPorOrden: todas las inspecciones de una orden, orden cronológico
 *   estable por `timestamp`.
 * - NO existe listarPorMaquina: el modelo aprobado del Ticket 07 NO modela la
 *   inspección con maquinaId (es SIEMPRE un evento de la orden, nunca un evento
 *   general de máquina), así que no hay necesidad real de consulta por máquina.
 *
 * Qué NO hace el repositorio:
 * - NO valida reglas de negocio (checklist completo, conAnomalia, resoluciones
 *   exclusivas, devolución pre-impresión, motivo obligatorio, autorizadoPor,
 *   múltiples inspecciones por orden). La inspección llega YA validada por el
 *   dominio (inspeccionTela.ts); aquí solo se persiste y consulta.
 * - NO crea estado global de tela ni bloquea órdenes: la tela no usable es un
 *   estado derivado POR INSPECCIÓN en el dominio, nunca aquí.
 * - NO modifica producción, lecturas, progreso, paradas, actividades, daños,
 *   calidad ni tiempo derivado.
 */
import type { InspeccionTela } from "../domain/types";

export interface IInspeccionRepository {
  /**
   * Inserta una inspección nueva. Lanza si el id ya existe o el id es inválido.
   * Uso típico: registrarInspeccion del dominio → insertInspeccion.
   */
  insertInspeccion(inspeccion: InspeccionTela): Promise<void>;

  /**
   * Reemplaza una inspección existente (por id). Lanza si el id no existe o
   * es inválido. Uso típico: registrarDevolucion / registrarAutorizacionGerencia
   * del dominio → updateInspeccion con la copia resuelta (mismo id).
   */
  updateInspeccion(inspeccion: InspeccionTela): Promise<void>;

  /**
   * Devuelve la inspección con el id dado (copia defensiva), o undefined.
   */
  obtenerPorId(id: string): Promise<InspeccionTela | undefined>;

  /**
   * Lista TODAS las inspecciones asociadas a una orden concreta, en orden
   * cronológico estable por `timestamp`. Las inspecciones de otras órdenes
   * nunca se mezclan.
   */
  listarPorOrden(ordenId: string): Promise<InspeccionTela[]>;
}