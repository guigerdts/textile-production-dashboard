/**
 * Repositorio de actividades planificadas EN MEMORIA — ticket 03.
 * Reemplazable por SQLite en el futuro sin tocar dominio ni UI
 * (el adaptador solo implementa IActividadPlanificadaRepository).
 *
 * Reglas (mismas que InMemoryParadaRepository):
 * - Insert vs update explícitos: rechaza duplicados de id al insertar
 *   y updates de ids inexistentes, igual que SQLite con PRIMARY KEY.
 * - structuredClone en cada entrada y salida: mutar un resultado
 *   no contamina el repositorio.
 * - Orden cronológico por inicio para listados.
 */
import type { ActividadAbierta, ActividadPlanificada, TipoActividadPlanificada } from "../domain/types";
import type { IActividadPlanificadaRepository } from "./actividadesRepository";
import { crearFixtureActividades } from "./actividadesFixtures";

export class InMemoryActividadPlanificadaRepository
  implements IActividadPlanificadaRepository
{
  private readonly porId = new Map<string, ActividadPlanificada>();

  /** Se siembra con el fixture automáticamente. */
  constructor(actividades: ActividadPlanificada[] = crearFixtureActividades()) {
    for (const a of actividades) {
      this.porId.set(a.id, structuredClone(a));
    }
  }

  async insertActividad(actividad: ActividadPlanificada): Promise<void> {
    if (this.porId.has(actividad.id)) {
      throw new Error(`ya existe una actividad con el id ${actividad.id}`);
    }
    this.porId.set(actividad.id, structuredClone(actividad));
  }

  async updateActividad(actividad: ActividadPlanificada): Promise<void> {
    if (!this.porId.has(actividad.id)) {
      throw new Error(`no existe una actividad con el id ${actividad.id}`);
    }
    this.porId.set(actividad.id, structuredClone(actividad));
  }

  async obtenerPorId(id: string): Promise<ActividadPlanificada | undefined> {
    const a = this.porId.get(id);
    return a ? structuredClone(a) : undefined;
  }

  async listarPorMaquina(maquinaId: string): Promise<ActividadPlanificada[]> {
    return [...this.porId.values()]
      .filter((a) => a.maquinaId === maquinaId)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((a) => structuredClone(a));
  }

  /**
   * Listado de UN DÍA OPERATIVO. El filtro por día vive AQUÍ, dentro de la ruta
   * de lectura del adaptador (DD3), no en el llamador.
   *
   * La igualdad es sobre el `fechaOperativa` persistido: nunca se deriva de
   * `inicio`/`fin`. Un día sin actividades devuelve `[]` y nunca un error — un
   * día vacío es un resultado legítimo, no un fallo.
   * Orden: cronológico por `inicio`. Dos registros con el `inicio` idéntico
   * quedan en orden indefinido entre sí — el método no afirma determinismo
   * ahí, y el llamador no debe suponerlo. El caso se nombra en el contrato
   * de listado por día (`dayScopedListingContract.ts`, forma 5) en vez de
   * quedar sólo como un comment.
   */
  async listarPorMaquinaYFecha(
    maquinaId: string,
    fechaOperativa: string
  ): Promise<ActividadPlanificada[]> {
    return [...this.porId.values()]
      .filter((a) => a.maquinaId === maquinaId && a.fechaOperativa === fechaOperativa)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((a) => structuredClone(a));
  }

  async getActividadAbierta(
    maquinaId: string,
    tipo: TipoActividadPlanificada,
  ): Promise<ActividadAbierta | null> {
    for (const a of this.porId.values()) {
      if (a.fin === null && a.maquinaId === maquinaId && a.tipo === tipo) {
        return structuredClone(a) as ActividadAbierta;
      }
    }
    return null;
  }
}