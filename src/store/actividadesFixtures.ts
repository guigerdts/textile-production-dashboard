/**
 * Fixture de actividades planificadas — ticket 03.
 * Escenarios controlados para pruebas del repositorio:
 *  - una limpieza cerrada (el clásico martes 7:00–8:00)
 *  - un cambio de diseño cerrado
 *  - una limpieza ABIERTA
 *  - un cambio de diseño ABIERTO simultáneo (invariante: una abierta
 *    por máquina + tipo, pero limpieza y cambio pueden coexistir)
 *
 * Las actividades NO llevan ordenId: son independientes de las órdenes
 * (pueden registrarse en día vacío, disponible, en producción o finalizada).
 * ids y timestamps fijos para assertions deterministas.
 */
import type { ActividadPlanificada } from "../domain/types";

/** máquina de referencia en todas las fixtures */
const M1 = "M1";

/** Limpieza cerrada — día de producción de la orden 101 */
export const A1_LIMPIEZA_CERRADA: ActividadPlanificada = {
  id: "act-001",
  maquinaId: M1,
  tipo: "limpieza",
  inicio: "2026-09-11T07:00:00.000Z",
  fin: "2026-09-11T08:00:00.000Z",
  queSeLimpio: "mesa de estampado",
  operatorName: "Carlos Gómez",
};

/** Cambio de diseño cerrado — antes de iniciar la orden 101 */
export const A2_CAMBIO_CERRADO: ActividadPlanificada = {
  id: "act-002",
  maquinaId: M1,
  tipo: "cambio_diseno",
  inicio: "2026-09-11T08:15:00.000Z",
  fin: "2026-09-11T08:45:00.000Z",
  observaciones: "cambio de cuadro Jessie",
  operatorName: "Carlos Gómez",
};

/** Limpieza ABIERTA — otro día, sin orden asociada */
export const A3_LIMPIEZA_ABIERTA: ActividadPlanificada = {
  id: "act-003",
  maquinaId: M1,
  tipo: "limpieza",
  inicio: "2026-09-15T07:00:00.000Z",
  fin: null,
  queSeLimpio: "cuadros y mesa",
  operatorName: "Sofía Ramírez",
};

/** Cambio de diseño ABIERTO — simultáneo con la limpieza abierta (invariante permitida) */
export const A4_CAMBIO_ABIERTO: ActividadPlanificada = {
  id: "act-004",
  maquinaId: M1,
  tipo: "cambio_diseno",
  inicio: "2026-09-15T08:00:00.000Z",
  fin: null,
  operatorName: "Sofía Ramírez",
};

/** Crea el array completo de fixtures (copia defensiva al construir repositorio). */
export function crearFixtureActividades(): ActividadPlanificada[] {
  return [A1_LIMPIEZA_CERRADA, A2_CAMBIO_CERRADO, A3_LIMPIEZA_ABIERTA, A4_CAMBIO_ABIERTO];
}