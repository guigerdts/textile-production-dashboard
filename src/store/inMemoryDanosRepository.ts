/**
 * Repositorio de daños EN MEMORIA — ticket 05.
 * Reemplazable por SQLite en el futuro sin tocar dominio ni UI
 * (el adaptador solo implementa IDanoRepository).
 *
 * Reglas (mismas que InMemoryParadaRepository / InMemoryActividadRepository):
 * - Insert vs update explícitos: rechaza duplicados de id al insertar
 *   y updates de ids inexistentes, igual que SQLite con PRIMARY KEY.
 * - structuredClone en cada entrada y salida: mutar un resultado
 *   no contamina el repositorio.
 * - Orden cronológico por inicio para listados.
 * - Sin lógica de negocio: el daño llega ya validado por el dominio
 *   (incluida la parada vinculada); aquí solo se persiste y consulta.
 */
import type { Dano, DanoAbierto } from "../domain/types";
import type { IDanoRepository } from "./danosRepository";
import { crearFixtureDanos } from "./danosFixtures";

export class InMemoryDanoRepository implements IDanoRepository {
  private readonly porId = new Map<string, Dano>();

  /** Se siembra con el fixture automáticamente. */
  constructor(danos: Dano[] = crearFixtureDanos()) {
    for (const d of danos) {
      this.porId.set(d.id, structuredClone(d));
    }
  }

  insertDano(dano: Dano): void {
    if (this.porId.has(dano.id)) {
      throw new Error(`ya existe un daño con el id ${dano.id}`);
    }
    this.porId.set(dano.id, structuredClone(dano));
  }

  updateDano(dano: Dano): void {
    if (!this.porId.has(dano.id)) {
      throw new Error(`no existe un daño con el id ${dano.id}`);
    }
    this.porId.set(dano.id, structuredClone(dano));
  }

  obtenerPorId(id: string): Dano | undefined {
    const d = this.porId.get(id);
    return d ? structuredClone(d) : undefined;
  }

  listarPorMaquina(maquinaId: string): Dano[] {
    return [...this.porId.values()]
      .filter((d) => d.maquinaId === maquinaId)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((d) => structuredClone(d));
  }

  listarPorOrden(ordenId: string): Dano[] {
    return [...this.porId.values()]
      .filter((d) => d.ordenId === ordenId)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((d) => structuredClone(d));
  }

  getDanoAbierto(maquinaId: string): DanoAbierto | null {
    for (const d of this.porId.values()) {
      if (d.fin === null && d.maquinaId === maquinaId) {
        return structuredClone(d) as DanoAbierto;
      }
    }
    return null;
  }
}