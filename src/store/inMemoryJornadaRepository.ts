/**
 * Repositorio de jornada del turno EN MEMORIA — ticket 04.
 * Reemplazable por SQLite en el futuro sin tocar dominio ni UI
 * (el adaptador solo implementa IJornadaRepository).
 *
 * Reglas (mismas que los repos en memoria anteriores):
 * - Clave = fecha operativa "YYYY-MM-DD"; un día → una jornada.
 * - Sin registro → jornadaDefault(fecha) (07:00–17:00) devuelta por defecto.
 * - structuredClone en entradas y salidas: mutar un resultado no contamina
 *   el repositorio.
 * - El repositorio NO calcula tiempos derivados: solo guarda/obtiene.
 * - Validación delegada a validarJornada del dominio (fin > inicio).
 * - Contrato async (ticket 10.2) y validación de fecha en AMBOS métodos
 *   (ticket 10.3: obtenerParaFecha también rechaza fechas fuera de formato
 *   YYYY-MM-DD, igualando el comportamiento del repo SQLite).
 */
import type { JornadaTurno } from "../domain/types";
import { jornadaDefault, validarJornada } from "../domain/tiempo";
import type { IJornadaRepository, JornadaPersistida } from "./jornadaRepository";

/** Formato estricto de fecha operativa (igual que Orden.fechaOperativa). */
const FECHA_OPERATIVA_RX = /^\d{4}-\d{2}-\d{2}$/;

/** Mensaje descriptivo común de fecha inválida (dominio/repositorios). */
function errorFechaOperativa(fechaOperativa: string): Error {
  return new Error(
    `fecha operativa inválida: "${fechaOperativa}" (formato esperado YYYY-MM-DD)`
  );
}

export class InMemoryJornadaRepository implements IJornadaRepository {
  private readonly porFecha = new Map<string, JornadaTurno>();

  /** Siembra opcional (copia defensiva). Sin fixtures por defecto. */
  constructor(seed: JornadaPersistida[] = []) {
    for (const { fechaOperativa, jornada } of seed) {
      this.porFecha.set(fechaOperativa, structuredClone(jornada));
    }
  }

  async obtenerParaFecha(fechaOperativa: string): Promise<JornadaTurno> {
    if (!FECHA_OPERATIVA_RX.test(fechaOperativa)) {
      throw errorFechaOperativa(fechaOperativa);
    }
    const guardada = this.porFecha.get(fechaOperativa);
    if (guardada) return structuredClone(guardada);
    return jornadaDefault(fechaOperativa);
  }

  async guardarJornada(fechaOperativa: string, jornada: JornadaTurno): Promise<void> {
    if (!FECHA_OPERATIVA_RX.test(fechaOperativa)) {
      throw errorFechaOperativa(fechaOperativa);
    }
    const errores = validarJornada(jornada);
    if (errores.length > 0) {
      throw new Error(errores.join("; "));
    }
    this.porFecha.set(fechaOperativa, structuredClone(jornada));
  }
}