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