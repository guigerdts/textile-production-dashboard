import type { ReactNode } from "react";
import type { Orden } from "../domain/types";
import { unidadesObjetivoCon2da, golpesRequeridosOrden } from "../domain/calculations";

function formatearNumero(n: number): string {
  return n.toLocaleString("es-AR");
}

/** Fila clave/valor de la tarjeta de orden. */
function Fila({ dt, dd }: { dt: string; dd: ReactNode }) {
  return (
    <div className="order-card__fila">
      <dt>{dt}</dt>
      <dd>{dd}</dd>
    </div>
  );
}

/**
 * Datos base comunes a toda vista de orden:
 * diseño, referencia de tela, tipo de pintura, solicitadas, segunda (y % si aplica),
 * objetivo proyectado y golpes requeridos. Las vistas agregan filas según el estado.
 */
export function OrderDatos({ orden, filasAdicionales }: { orden: Orden; filasAdicionales?: ReactNode }) {
  const objetivo = unidadesObjetivoCon2da(orden.unidadesSolicitadas, orden.porcentaje2da);
  const golpesRequeridos = golpesRequeridosOrden(orden.unidadesSolicitadas, orden.porcentaje2da);

  return (
    <dl className="order-card__datos">
      <Fila dt="Diseño" dd={orden.diseno} />
      <Fila dt="Referencia de tela" dd={orden.telaReferencia} />
      <Fila dt="Tipo de pintura" dd={orden.tipoPintura} />
      <Fila dt="Unidades solicitadas" dd={formatearNumero(orden.unidadesSolicitadas)} />
      <Fila dt="Segunda" dd={orden.aplicaSegunda ? "Aplica" : "No aplica"} />
      {orden.aplicaSegunda && (
        <Fila dt="Porcentaje proyectado" dd={`${(orden.porcentaje2da * 100).toFixed(1)}%`} />
      )}
      <Fila dt="Objetivo proyectado" dd={formatearNumero(objetivo)} />
      <Fila dt="Golpes requeridos" dd={`${formatearNumero(golpesRequeridos)} golpes`} />
      {filasAdicionales}
    </dl>
  );
}