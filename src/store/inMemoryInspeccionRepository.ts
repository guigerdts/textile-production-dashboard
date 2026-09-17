/**
 * Repositorio de inspecciones de tela EN MEMORIA — ticket 07, Ciclo 2.
 * Reemplazable por SQLite en el futuro sin tocar dominio ni UI
 * (el adaptador solo implementa IInspeccionRepository).
 *
 * Reglas (mismas que InMemoryDanoRepository / InMemoryParadaRepository):
 * - Insert vs update explícitos: rechaza duplicados de id al insertar y
 *   updates de ids inexistentes, igual que SQLite con PRIMARY KEY.
 * - Validación mínima de identificadores (integridad de almacenamiento,
 *   NO regla de negocio): el id debe ser un string no vacío.
 * - structuredClone en cada entrada y salida: mutar un resultado o un input
 *   no contamina el repositorio.
 * - Orden cronológico estable por `timestamp` para listarPorOrden.
 * - Sin lógica de negocio: las inspecciones llegan ya validadas por el
 *   dominio (inspeccionTela.ts); aquí solo se persiste y consulta.
 * - Almacenamiento por `id`; cada inspección vive SOLO en su orden (consulta
 *   por ordenId), nunca mezclada con inspecciones de otras órdenes.
 */
import type { InspeccionTela } from "../domain/types";
import type { IInspeccionRepository } from "./inspeccionRepository";

/** Valida identificadores no vacíos (integridad de PK, no regla de negocio). */
function validarId(id: string, contexto: string): void {
  if (!id || id.trim() === "") {
    throw new Error(`${contexto}: el id no puede estar vacío`);
  }
}

export class InMemoryInspeccionRepository implements IInspeccionRepository {
  private readonly porId = new Map<string, InspeccionTela>();

  /**
   * Seed OPCIONAL para pruebas (sin fixtures de UI). Por defecto comienza vacío.
   * Acepta inspecciones ya validadas por el dominio; se clonan al sembrar.
   */
  constructor(inspecciones: InspeccionTela[] = []) {
    for (const inspeccion of inspecciones) {
      validarId(inspeccion.id, "InMemoryInspeccionRepository");
      this.porId.set(inspeccion.id, structuredClone(inspeccion));
    }
  }

  insertInspeccion(inspeccion: InspeccionTela): void {
    validarId(inspeccion.id, "insertInspeccion");
    if (this.porId.has(inspeccion.id)) {
      throw new Error(`ya existe una inspección con el id ${inspeccion.id}`);
    }
    this.porId.set(inspeccion.id, structuredClone(inspeccion));
  }

  updateInspeccion(inspeccion: InspeccionTela): void {
    validarId(inspeccion.id, "updateInspeccion");
    if (!this.porId.has(inspeccion.id)) {
      throw new Error(`no existe una inspección con el id ${inspeccion.id}`);
    }
    this.porId.set(inspeccion.id, structuredClone(inspeccion));
  }

  obtenerPorId(id: string): InspeccionTela | undefined {
    const inspeccion = this.porId.get(id);
    return inspeccion ? structuredClone(inspeccion) : undefined;
  }

  listarPorOrden(ordenId: string): InspeccionTela[] {
    return [...this.porId.values()]
      .filter((i) => i.ordenId === ordenId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((i) => structuredClone(i));
  }
}