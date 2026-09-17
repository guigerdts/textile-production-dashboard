/**
 * Fixture de paradas — ticket 02.
 * Escenarios controlados para pruebas del repositorio:
 *  - paradas cerradas de distintas órdenes
 *  - una parada abierta asociada a una orden
 *  - una parada abierta sin orden
 *  - varias paradas de distintas órdenes en la misma máquina
 *  - ausencia de paradas para un orden o máquina
 *
 * ids y timestamps fijos para assertions deterministas.
 */
import type { Parada } from "../domain/types";

/** máquina de referencia en todas las fixtures */
const M1 = "M1";

/** ids de orden fijos para coherencia con fixtures de órdenes */
const ORDEN_101 = "ord-101";
const ORDEN_102 = "ord-102";

/** Paradas del día de producción de la orden 101 */
export const P1: Parada = {
  id: "par-001",
  maquinaId: M1,
  ordenId: ORDEN_101,
  operatorName: "Carlos Gómez",
  causaId: "falta_color",
  camposEspecificos: { color: "AZUL" },
  observaciones: "faltaba el azul para OP-101",
  inicio: "2026-09-11T09:30:00.000Z",
  fin: "2026-09-11T09:45:00.000Z",
};

/** Segunda parada de la orden 101 — por daño mecánico, más larga */
export const P2: Parada = {
  id: "par-002",
  maquinaId: M1,
  ordenId: ORDEN_101,
  operatorName: "Carlos Gómez",
  causaId: "danio_mecanico",
  camposEspecificos: { carro: 3, componente: "eje trasero" },
  inicio: "2026-09-11T11:00:00.000Z",
  fin: "2026-09-11T12:00:00.000Z",
};

/** Parada de la orden 102 — cerrada */
export const P3: Parada = {
  id: "par-003",
  maquinaId: M1,
  ordenId: ORDEN_102,
  operatorName: "Sofía Ramírez",
  causaId: "rotura_cuadro",
  camposEspecificos: { carro: 1 },
  inicio: "2026-09-15T10:00:00.000Z",
  fin: "2026-09-15T10:20:00.000Z",
};

/** Parada abierta — orden 101 (en curso al momento de inspección) */
export const P4_ABIERTA: Parada = {
  id: "par-004",
  maquinaId: M1,
  ordenId: ORDEN_101,
  operatorName: "Carlos Gómez",
  causaId: "atasco_tela",
  camposEspecificos: {},
  inicio: "2026-09-11T14:00:00.000Z",
  fin: null,
};

/** Parada abierta SIN orden (máquina ociosa entre turnos) */
export const P5_ABIERTA_SIN_ORDEN: Parada = {
  id: "par-005",
  maquinaId: M1,
  ordenId: null,
  operatorName: "Luis Fernández",
  causaId: "problema_horno",
  camposEspecificos: {},
  inicio: "2026-09-11T17:30:00.000Z",
  fin: null,
};

/** Crea el array completo de fixtures (copia defensiva al construir repositorio). */
export function crearFixtureParadas(): Parada[] {
  return [P1, P2, P3, P4_ABIERTA, P5_ABIERTA_SIN_ORDEN];
}
