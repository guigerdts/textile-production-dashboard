import type { Orden } from "../domain/types";
import { golpesProducidosDesdeLecturas, unidadesParaGolpes } from "../domain/calculations";
import { OrderDatos } from "./OrderDatos";
import type { ActividadesProps } from "./ActividadesSection";
import { ActividadesSection } from "./ActividadesSection";
import type { ResumenTiempoProps } from "./ResumenTiempoSection";
import { ResumenTiempoSection } from "./ResumenTiempoSection";
import type { DanoSectionProps } from "./DanoSection";
import { DanoSection } from "./DanoSection";
import type { InspeccionTelaSectionProps } from "./InspeccionTelaSection";
import { InspeccionTelaSection } from "./InspeccionTelaSection";
import type { MantenimientoSectionProps } from "./MantenimientoSection";
import { MantenimientoSection } from "./MantenimientoSection";
import type { ResultadoIntegracion2da } from "../domain/calidad";
import { CalidadSection } from "./CalidadSection";

function formatearNumero(n: number): string {
  return n.toLocaleString("es-AR");
}

interface OrderFinishedProps
  extends ActividadesProps,
    ResumenTiempoProps,
    DanoSectionProps,
    InspeccionTelaSectionProps,
    MantenimientoSectionProps {
  orden: Orden;
  /** Proyección integrada con los datos FINALES de la orden: queda como información histórica. */
  integracion2da: ResultadoIntegracion2da;
}

/** Orden finalizada: vista inmutable con datos base, producción real, resumen de lecturas y fecha de finalización. */
export function OrderFinished({ orden, integracion2da, ...actividadesProps }: OrderFinishedProps) {
  const golpesProducidos = golpesProducidosDesdeLecturas(orden.lecturas);
  const unidadesProducidas = unidadesParaGolpes(golpesProducidos);
  const fechaFinalizacion = orden.finalizadaEn
    ? new Date(orden.finalizadaEn).toLocaleString("es-AR")
    : "—";

  return (
    <article className="order-card" data-testid={`orden-${orden.id}`}>
      <header className="order-card__header">
        <span className="order-card__numero">{orden.numeroOrden}</span>
        <span className="order-card__estado order-card__estado--finished">Finalizada</span>
      </header>

      <OrderDatos
        orden={orden}
        filasAdicionales={
          <>
            <div className="order-card__fila">
              <dt>Operario</dt>
              <dd>{orden.operatorName}</dd>
            </div>
            <div className="order-card__fila">
              <dt>Producción real</dt>
              <dd>
                {formatearNumero(golpesProducidos)} golpes / {formatearNumero(unidadesProducidas)} unidades
              </dd>
            </div>
            <div className="order-card__fila">
              <dt>Fecha/hora de finalización</dt>
              <dd>{fechaFinalizacion}</dd>
            </div>
          </>
        }
      />

      <CalidadSection integracion2da={integracion2da} />

      <section className="lecturas-resumen">
        <h3 className="lecturas-resumen__titulo">Resumen de lecturas</h3>
        <dl className="lecturas-resumen__lista">
          {orden.lecturas.map((lec, i) => (
            <div key={i} className="order-card__fila">
              <dt>Lectura {i + 1}</dt>
              <dd>
                {formatearNumero(lec.valor)}{i === 0 ? " (base)" : ""} — delta {lec.deltaGolpes}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <ResumenTiempoSection {...actividadesProps} />
      <ActividadesSection {...actividadesProps} />
      <InspeccionTelaSection orden={orden} {...actividadesProps} />
      <DanoSection {...actividadesProps} />
      <MantenimientoSection {...actividadesProps} />
    </article>
  );
}