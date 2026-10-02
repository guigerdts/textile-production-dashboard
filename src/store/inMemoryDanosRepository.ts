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

  async insertDano(dano: Dano): Promise<void> {
    if (this.porId.has(dano.id)) {
      throw new Error(`ya existe un daño con el id ${dano.id}`);
    }
    this.porId.set(dano.id, structuredClone(dano));
  }

  async updateDano(dano: Dano): Promise<void> {
    if (!this.porId.has(dano.id)) {
      throw new Error(`no existe un daño con el id ${dano.id}`);
    }
    this.porId.set(dano.id, structuredClone(dano));
  }

  async obtenerPorId(id: string): Promise<Dano | undefined> {
    const d = this.porId.get(id);
    return d ? structuredClone(d) : undefined;
  }

  async listarPorMaquina(maquinaId: string): Promise<Dano[]> {
    return [...this.porId.values()]
      .filter((d) => d.maquinaId === maquinaId)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((d) => structuredClone(d));
  }

  /**
   * Listado de UN DÍA OPERATIVO. El filtro por día vive AQUÍ, dentro de la ruta
   * de lectura del adaptador (DD3), no en el llamador.
   *
   * La igualdad es sobre el `fechaOperativa` persistido: nunca se deriva de
   * `inicio`/`fin`. Un día sin daños devuelve `[]` y nunca un error — un día
   * vacío es un resultado legítimo, no un fallo.
   */
  async listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Dano[]> {
    return [...this.porId.values()]
      .filter((d) => d.maquinaId === maquinaId && d.fechaOperativa === fechaOperativa)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((d) => structuredClone(d));
  }

  async listarPorOrden(ordenId: string): Promise<Dano[]> {
    return [...this.porId.values()]
      .filter((d) => d.ordenId === ordenId)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((d) => structuredClone(d));
  }

  async getDanoAbierto(maquinaId: string): Promise<DanoAbierto | null> {
    for (const d of this.porId.values()) {
      if (d.fin === null && d.maquinaId === maquinaId) {
        return structuredClone(d) as DanoAbierto;
      }
    }
    return null;
  }
}