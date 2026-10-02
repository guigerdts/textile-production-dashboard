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

  /**
   * Listado de UN DÍA OPERATIVO. El filtro por día vive AQUÍ, dentro de la ruta
   * de lectura del adaptador (DD3), no en el llamador.
   *
   * La igualdad es sobre el `fechaOperativa` persistido: nunca se deriva de
   * `inicio`/`fin`. Un día sin paradas devuelve `[]` y nunca un error — un día
   * vacío es un resultado legítimo, no un fallo.
   */
  async listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Parada[]> {
    return [...this.porId.values()]
      .filter((p) => p.maquinaId === maquinaId && p.fechaOperativa === fechaOperativa)
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

  /**
   * La parada abierta de la máquina, sea cual sea su orden y su día.
   *
   * El dominio solo admite una parada abierta por máquina, así que la
   * desambiguación es un caso patológico; aun así se resuelve como lo hace el
   * adaptador SQLite — la más antigua por `inicio` — para que ambos
   * adaptadores devuelvan lo MISMO ante el mismo almacén, y no por el orden de
   * inserción del mapa.
   */
  async getParadaAbiertaDeMaquina(maquinaId: string): Promise<ParadaAbierta | null> {
    const candidatas = [...this.porId.values()]
      .filter((p) => p.fin === null && p.maquinaId === maquinaId)
      .sort((a, b) => a.inicio.localeCompare(b.inicio));
    const primera = candidatas[0];
    return primera ? (structuredClone(primera) as ParadaAbierta) : null;
  }
}