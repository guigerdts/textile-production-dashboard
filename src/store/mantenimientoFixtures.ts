/**
 * Fixture de mantenimiento — ticket 08.
 * Escenarios controlados para pruebas del repositorio:
 *  - un mantenimiento REACTIVO CERRADO vinculado a un daño
 *  - un mantenimiento REACTIVO CERRADO sin daño vinculado
 *  - un mantenimiento PREVENTIVO CERRADO
 *  - un mantenimiento ABIERTO (fin = null)
 *
 * Invariante operativa: un solo mantenimiento abierto por máquina (mnt-004).
 * ids y timestamps fijos para assertions deterministas.
 */
import type { Mantenimiento } from "../domain/types";

/** máquina de referencia en todas las fixtures */
const M1 = "M1";

/** Mantenimiento reactivo cerrado, vinculado al daño dan-001. */
export const MANT_1_REACTIVO_CON_DANO_CERRADO: Mantenimiento = {
  id: "mnt-001",
  maquinaId: M1,
  tipo: "reactivo",
  operatorName: "Carlos Gómez",
  motivo: "Falla en carro 3",
  inicio: "2026-09-11T10:55:00.000Z",
  fin: "2026-09-11T11:20:00.000Z",
  queSeRevisoReparo: "Cambio de rodamiento",
  danoId: "dan-001",
  observaciones: "Vibración anormal en carro 3",
};

/** Mantenimiento reactivo cerrado, sin daño vinculado. */
export const MANT_2_REACTIVO_SIN_DANO_CERRADO: Mantenimiento = {
  id: "mnt-002",
  maquinaId: M1,
  tipo: "reactivo",
  operatorName: "Carlos Gómez",
  motivo: "Fuga de tinta",
  inicio: "2026-09-11T13:00:00.000Z",
  fin: "2026-09-11T13:15:00.000Z",
  queSeRevisoReparo: "Sellado de manguera",
  danoId: null,
};

/** Mantenimiento preventivo cerrado. */
export const MANT_3_PREVENTIVO_CERRADO: Mantenimiento = {
  id: "mnt-003",
  maquinaId: M1,
  tipo: "preventivo",
  operatorName: "Sofía Ramírez",
  motivo: "Preventivo semanal",
  inicio: "2026-09-12T07:30:00.000Z",
  fin: "2026-09-12T08:00:00.000Z",
  queSeRevisoReparo: "Limpieza y lubricación general",
  danoId: null,
};

/** Mantenimiento ABIERTO (fin = null) — el único abierto en las fixtures. */
export const MANT_4_ABIERTO: Mantenimiento = {
  id: "mnt-004",
  maquinaId: M1,
  tipo: "reactivo",
  operatorName: "Luis Fernández",
  motivo: "Fusible quemado",
  inicio: "2026-09-15T09:00:00.000Z",
  fin: null,
  danoId: null,
};

/** Crea el array completo de fixtures (copia defensiva al construir repositorio). */
export function crearFixtureMantenimientos(): Mantenimiento[] {
  return [
    MANT_1_REACTIVO_CON_DANO_CERRADO,
    MANT_2_REACTIVO_SIN_DANO_CERRADO,
    MANT_3_PREVENTIVO_CERRADO,
    MANT_4_ABIERTO,
  ];
}
