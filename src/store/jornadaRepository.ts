/**
 * Interfaz pública del repositorio de jornada del turno — ticket 04.
 * Contrato mínimo y reemplazable: hoy InMemoryJornadaRepository,
 * mañana SQLite, SIN cambiar el dominio ni la UI.
 *
 * Decisiones de diseño (mismas que IActividadPlanificadaRepository):
 * - La clave es la FECHA OPERATIVA en formato "YYYY-MM-DD" (igual que
 *   Orden.fechaOperativa). Un día → una jornada.
 * - Los métodos son ASYNC (contrato evolucionado en ticket 10.2; 10.3
 *   implementa la variante SQLite sobre este contrato async).
 * - structuredClone en cada persistencia y lectura evita contaminación por
 *   referencias mutables.
 *
 * Responsabilidad ÚNICA: guardar/obtener la ventana de jornada por día.
 * - NO calcula tiempos derivados (eso vive en resumenTiempoTurno del dominio).
 * - La validación de la jornada (fin > inicio) la delega a validarJornada del
 *   dominio; el repositorio lanza si la jornada es inválida.
 * - La validación de la fecha (YYYY-MM-DD) aplica a AMBOS métodos (ticket 10.3
 *   extiende la regla a obtenerParaFecha, igualando el comportamiento de los
 *   repos SQLite).
 * - El fin guardado representa el FIN REAL de la jornada (puede extenderse por
 *   overtime, ej. hasta 19:00), NO un tiempo efectivamente trabajado
 *   garantizado: es la ventana disponible, no un compromiso de producción.
 */
import type { JornadaTurno } from "../domain/types";

/** Entrada de persistencia: par fecha operativa (YYYY-MM-DD) → jornada. */
export interface JornadaPersistida {
  fechaOperativa: string;
  jornada: JornadaTurno;
}

export interface IJornadaRepository {
  /**
   * Devuelve la jornada guardada para la fecha operativa dada.
   * Si no hay registro, devuelve la jornada por defecto (07:00–17:00)
   * construida para esa fecha (jornadaDefault).
   * Lanza si la fecha no tiene formato YYYY-MM-DD.
   */
  obtenerParaFecha(fechaOperativa: string): Promise<JornadaTurno>;

  /**
   * Guarda/sobrescribe la jornada del turno de la fecha operativa dada.
   * Valida la fecha (YYYY-MM-DD) y la jornada (fin > inicio) y lanza si es
   * inválida. Persiste una copia defensiva: mutar `jornada` después de la
   * llamada no contamina el repositorio.
   */
  guardarJornada(fechaOperativa: string, jornada: JornadaTurno): Promise<void>;
}