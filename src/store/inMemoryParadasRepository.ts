/**
 * Repositorio de paradas EN MEMORIA — ticket 02.
 * Reemplazable por SQLite en el futuro sin tocar dominio ni UI
 * (el adaptador solo implementa IParadaRepository).
 *
 * Reglas:
 * - Insert vs update explícitos: rechaza duplicados de id al insertar
 *   y updates de ids inexistentes, igual que SQLite con PRIMARY KEY.
 * - structuredClone en cada entrada y salida: mutar un resultado
 *   no contamina el repositorio.
 * - Orden cronológico por inicio para listados.
 */
import type { Parada, ParadaAbierta } from "../domain/types";
import type { IParadaRepository } from "./paradasRepository";
import { crearFixtureParadas } from "./paradasFixtures";

export class InMemoryParadaRepository implements IParadaRepository {
  private readonly porId = new Map<string, Parada>();

  /** Se siembra con el fixture automáticamente. */
  constructor(paradas: Parada[] = crearFixtureParadas()) {
    for (const p of paradas) {
      this.porId.set(p.id, structuredClone(p));
    }
  }

  async insertParada(parada: Parada): Promise<void> {
    if (this.porId.has(parada.id)) {
      throw new Error(`ya existe una parada con el id ${parada.id}`);
    }
    this.porId.set(parada.id, structuredClone(parada));
  }

  async updateParada(parada: Parada): Promise<void> {
    if (!this.porId.has(parada.id)) {
      throw new Error(`no existe una parada con el id ${parada.id}`);
    }
    this.porId.set(parada.id, structuredClone(parada));
  }

  async obtenerPorId(id: string): Promise<Parada | undefined> {
    const p = this.porId.get(id);
    return p ? structuredClone(p) : undefined;
  }

  async listarPorMaquina(maquinaId: string): Promise<Parada[]> {
    return [...this.porId.values()]
      .filter((p) => p.maquinaId === maquinaId)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((p) => structuredClone(p));
  }

  async listarPorOrden(ordenId: string): Promise<Parada[]> {
    return [...this.porId.values()]
      .filter((p) => p.ordenId === ordenId)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((p) => structuredClone(p));
  }

  async getParadaAbierta(maquinaId: string, ordenId: string | null): Promise<ParadaAbierta | null> {
    for (const p of this.porId.values()) {
      if (p.fin === null && p.maquinaId === maquinaId && p.ordenId === ordenId) {
        return structuredClone(p) as ParadaAbierta;
      }
    }
    return null;
  }
}