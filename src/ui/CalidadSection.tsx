import { META_MENSUAL_2DA } from "../domain/calidad";
import type { ResultadoIntegracion2da } from "../domain/calidad";

/**
 * Bloque de calidad — ticket 06 (proyección de 2da / alerta / buena racha).
 * PRESENTACIÓN PURA: no calcula, no filtra y no decide. Recibe el resultado
 * ya integrado por `proyeccionSegundaDeOrden` (dominio) y solo lo formatea:
 * - El porcentaje proyectado llega como fracción del dominio (pct).
 * - El estado (`buena_racha` | `alerta` | `sin_datos`) llega ya decidido.
 * - La meta de referencia es la constante del dominio (5 %), no un literal.
 * La UI NO duplica fórmulas, filtros, umbrales ni reglas del dominio.
 *
 * El bloque es informativo y NO bloquea lecturas, cierre ni ninguna acción.
 */

function formatearPorcentaje(pct: number): string {
  return pct.toLocaleString("es-AR", { style: "percent", maximumFractionDigits: 2 });
}

export interface CalidadSectionProps {
  /** Resultado ya integrado por el dominio (App lo deriva con el seam + repositorio). */
  integracion2da: ResultadoIntegracion2da;
}

export function CalidadSection({ integracion2da }: CalidadSectionProps) {
  const { proyeccion, danosConSospechaSinUnidades } = integracion2da;
  const sinDatos = proyeccion.estado === "sin_datos";

  const estadoLabel =
    proyeccion.estado === "alerta"
      ? "Alerta"
      : proyeccion.estado === "buena_racha"
        ? "Buena racha"
        : "—";

  return (
    <section
      className={`calidad calidad--${proyeccion.estado}`}
      data-testid="calidad-seccion"
      aria-label="Proyección de segunda"
    >
      <h2 className="calidad__titulo">Proyección de 2da</h2>
      <dl className="calidad__lista">
        <div className="calidad__fila">
          <dt>2da proyectada</dt>
          <dd>{sinDatos ? "—" : formatearPorcentaje(proyeccion.pct!)}</dd>
        </div>
        <div className="calidad__fila">
          <dt>Meta de referencia</dt>
          <dd>{formatearPorcentaje(META_MENSUAL_2DA)}</dd>
        </div>
        <div className="calidad__fila">
          <dt>Estado</dt>
          <dd
            className={`calidad__estado calidad__estado--${proyeccion.estado}`}
            role="status"
          >
            {estadoLabel}
          </dd>
        </div>
      </dl>

      {danosConSospechaSinUnidades > 0 && (
        <p className="calidad__nota" role="note">
          {danosConSospechaSinUnidades}{" "}
          {danosConSospechaSinUnidades === 1 ? "daño con" : "daños con"} sospecha de
          2da sin unidades cuantificadas
        </p>
      )}
    </section>
  );
}