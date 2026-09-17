/**
 * Fixture de órdenes — ticket 01.
 * Fuente TEMPORAL hasta que exista integración con la programación semanal externa.
 * NO inventa esa integración: simula órdenes ya creadas fuera del sistema.
 *
 * Fechas operativas controladas a propósito para poder probar:
 * - un día CON orden asignada  → FECHA_CON_ORDEN;
 * - un día SIN orden           → cualquier otra fecha (ver FECHA_SIN_ORDEN).
 * El fixture no se modifica desde la UI; la app consulta por fecha y decide.
 */
import type { Orden } from "../domain/types";

/** Día con orden asignada (para probar el flujo normal). */
export const FECHA_CON_ORDEN = "2026-09-11";

/** Día sin orden asignada (para probar el estado "día vacío"). */
export const FECHA_SIN_ORDEN = "2026-09-12";

/** Reloj por defecto de la app: hoy. La UI consulta esta fecha sin selector. */
export function fechaOperativaHoy(): string {
  return new Date().toISOString().slice(0, 10);
}

function orden(
  overrides: Partial<Orden> & Pick<Orden, "id" | "numeroOrden" | "diseno" | "unidadesSolicitadas" | "fechaOperativa">,
): Orden {
  return {
    telaReferencia: "T-100",
    aplicaSegunda: false,
    porcentaje2da: 0,
    tipoPintura: "reactiva",
    machineId: "M1",
    estado: "available",
    creadaExternamenteEn: "2026-09-10T10:00:00.000Z",
    lecturas: [],
    ...overrides,
  };
}

/** Órdenes de ejemplo cargadas automáticamente en el repositorio temporal. */
export function crearFixtureOrdenes(): Orden[] {
  return [
    orden({
      id: "ord-101",
      numeroOrden: "OP-101",
      diseno: "Jessie",
      unidadesSolicitadas: 2400,
      // Sin proyección de segunda: 2.400 -> objetivo 2.400 -> 800 golpes
      fechaOperativa: FECHA_CON_ORDEN,
    }),
    orden({
      id: "ord-102",
      numeroOrden: "OP-102",
      diseno: "Palm",
      telaReferencia: "T-200",
      unidadesSolicitadas: 3600,
      // Con proyección de segunda al 5%: 3.600 -> objetivo 3.780 -> 1.260 golpes
      aplicaSegunda: true,
      porcentaje2da: 0.05,
      tipoPintura: "pigmento",
      fechaOperativa: "2026-09-15",
    }),
  ];
}