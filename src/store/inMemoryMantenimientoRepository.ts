/**
 * Repositorio de mantenimiento EN MEMORIA — ticket 08.
 * Reemplazable por SQLite en el futuro sin tocar dominio ni UI
 * (el adaptador solo implementa IMantenimientoRepository).
 *
 * Reglas (mismas que InMemoryDanoRepository):
 * - Insert vs update explícitos: rechaza duplicados de id al insertar
 *   y updates de ids inexistentes, igual que SQLite con PRIMARY KEY.
 * - structuredClone en cada entrada y salida: mutar un resultado
 *   no contamina el repositorio.
 * - Orden cronológico por inicio para listados.
 * - Sin lógica de negocio: el mantenimiento llega ya validado por el dominio
 *   (incluida la coherencia del daño vinculado); aquí solo se persiste y consulta.
 */
import type { Mantenimiento, MantenimientoAbierto } from "../domain/types";
import type { IMantenimientoRepository } from "./mantenimientoRepository";
import { crearFixtureMantenimientos } from "./mantenimientoFixtures";

export class InMemoryMantenimientoRepository implements IMantenimientoRepository {
  private readonly porId = new Map<string, Mantenimiento>();

  /** Se siembra con el fixture automáticamente. */
  constructor(mantenimientos: Mantenimiento[] = crearFixtureMantenimientos()) {
    for (const m of mantenimientos) {
      this.porId.set(m.id, structuredClone(m));
    }
  }

  async insertMantenimiento(mantenimiento: Mantenimiento): Promise<void> {
    if (this.porId.has(mantenimiento.id)) {
      throw new Error(`ya existe un mantenimiento con el id ${mantenimiento.id}`);
    }
    this.porId.set(mantenimiento.id, structuredClone(mantenimiento));
  }

  async updateMantenimiento(mantenimiento: Mantenimiento): Promise<void> {
    if (!this.porId.has(mantenimiento.id)) {
      throw new Error(`no existe un mantenimiento con el id ${mantenimiento.id}`);
    }
    this.porId.set(mantenimiento.id, structuredClone(mantenimiento));
  }

  async obtenerPorId(id: string): Promise<Mantenimiento | undefined> {
    const m = this.porId.get(id);
    return m ? structuredClone(m) : undefined;
  }

  async listarPorMaquina(maquinaId: string): Promise<Mantenimiento[]> {
    return [...this.porId.values()]
      .filter((m) => m.maquinaId === maquinaId)
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
      .map((m) => structuredClone(m));
  }

  async getMantenimientoAbierto(maquinaId: string): Promise<MantenimientoAbierto | null> {
    for (const m of this.porId.values()) {
      if (m.fin === null && m.maquinaId === maquinaId) {
        return structuredClone(m) as MantenimientoAbierto;
      }
    }
    return null;
  }
}
