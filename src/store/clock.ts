/**
 * Seam de reloj — CHANGE 1 (operational-event-operative-date).
 *
 * Funciones PURAS respecto al dominio: solo formatean. NO leen `toISOString()`
 * para determinar el día operativo.
 *
 * Por qué existe: la fecha operativa se PERSISTE en cada evento y es la única
 * determinants de a qué jornada pertenece. `toISOString().slice(0, 10)` devuelve
 * la fecha UTC, que para una planta al oeste de UTC es el día siguiente durante
 * las últimas horas del turno (con overtime, CONTEXT.md). Con un valor efímero
 * eso se autocorrige en el siguiente render; persistido, es una
 * misatribución irreversible. El día operativo se lee del calendario LOCAL.
 *
 * `inicio`/`fin` siguen siendo instantes UTC reales: este módulo NO cambia eso.
 * La atribución al día es explícita (`operational-event-operative-date`).
 */

/** Fuente de tiempo inyectable. Permite fijar el instante en tests. */
export type Reloj = () => Date;

/** Reloj de producción: la hora del sistema. */
export const relojDelSistema: Reloj = () => new Date();

const LOCALE_ISO = "en-CA";

/**
 * Fecha operativa (YYYY-MM-DD) del calendario LOCAL según el reloj dado.
 *
 * `en-CA` produce el formato YYYY-MM-DD de forma estable por locale, sin
 * depender de la configuración regional de la máquina.
 */
export function fechaOperativaDe(reloj: Reloj = relojDelSistema): string {
  return reloj().toLocaleDateString(LOCALE_ISO);
}

/** Fecha operativa de hoy en el calendario local (reloj real). */
export function fechaOperativaHoyLocal(): string {
  return fechaOperativaDe(relojDelSistema);
}