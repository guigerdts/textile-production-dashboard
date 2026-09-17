/**
 * Fixture de daños — ticket 05.
 * Escenarios controlados para pruebas del repositorio:
 *  - un daño CERRADO vinculado a la parada por daño mecánico (par-002 de
 *    paradasFixtures: misma orden ord-101, parada inicia 11:00 >= daño 10:55),
 *    con sospecha de 2da cuantitativa (3 unidades)
 *  - un daño CERRADO que no causó parada y sin sospecha
 *  - un daño ABIERTO (fin = null), en otra orden
 *  - un daño CERRADO SIN orden (máquina ociosa)
 *
 * Invariante operativa respetada: un solo daño abierto por máquina (dan-003).
 * La coherencia con la parada vinculada es responsabilidad del dominio
 * (registrarDano + ObtenerParadaPorId), NO del repositorio; estas fixtures
 * solo mantienen valores coherentes para no romper el invariante de registro.
 * ids y timestamps fijos para assertions deterministas.
 */
import type { Dano } from "../domain/types";

/** máquina de referencia en todas las fixtures */
const M1 = "M1";

/** ids de orden fijos para coherencia con fixtures de órdenes */
const ORDEN_101 = "ord-101";
const ORDEN_102 = "ord-102";

/** Daño cerrado vinculado a la parada par-002 (danio_mecanico, 11:00–12:00). */
export const DANO_1_CERRADO_CON_PARADA: Dano = {
  id: "dan-001",
  maquinaId: M1,
  ordenId: ORDEN_101,
  operatorName: "Carlos Gómez",
  tipo: "mecanico",
  componente: "eje trasero",
  inicio: "2026-09-11T10:55:00.000Z",
  fin: "2026-09-11T11:20:00.000Z",
  solucionAplicada: "Cambio de eje y lubricación",
  causoParada: true,
  paradaId: "par-002",
  posibleSegunda: true,
  unidadesSospechadas: 3,
  observaciones: "vibraba la mesa al golpear",
};

/** Daño cerrado sin parada ni sospecha — misma orden 101, otra hora. */
export const DANO_2_CERRADO_SIN_PARADA: Dano = {
  id: "dan-002",
  maquinaId: M1,
  ordenId: ORDEN_101,
  operatorName: "Carlos Gómez",
  tipo: "operacional",
  componente: "manguera de tinta",
  inicio: "2026-09-11T13:00:00.000Z",
  fin: "2026-09-11T13:10:00.000Z",
  solucionAplicada: "Ajuste de manguera",
  causoParada: false,
  paradaId: null,
  posibleSegunda: false,
};

/** Daño ABIERTO — otra orden, sospecha de 2da cualitativa (sin unidades). */
export const DANO_3_ABIERTO: Dano = {
  id: "dan-003",
  maquinaId: M1,
  ordenId: ORDEN_102,
  operatorName: "Sofía Ramírez",
  tipo: "electrico",
  componente: "tablero de control",
  inicio: "2026-09-15T09:00:00.000Z",
  fin: null,
  causoParada: false,
  paradaId: null,
  posibleSegunda: true,
};

/** Daño cerrado SIN orden (máquina ociosa) — no vinculado a parada. */
export const DANO_4_SIN_ORDEN_CERRADO: Dano = {
  id: "dan-004",
  maquinaId: M1,
  ordenId: null,
  operatorName: "Luis Fernández",
  tipo: "mecanico",
  componente: "horno",
  inicio: "2026-09-11T17:45:00.000Z",
  fin: "2026-09-11T18:30:00.000Z",
  solucionAplicada: "Cambio de resistencia",
  causoParada: false,
  paradaId: null,
  posibleSegunda: false,
};

/** Crea el array completo de fixtures (copia defensiva al construir repositorio). */
export function crearFixtureDanos(): Dano[] {
  return [DANO_1_CERRADO_CON_PARADA, DANO_2_CERRADO_SIN_PARADA, DANO_3_ABIERTO, DANO_4_SIN_ORDEN_CERRADO];
}