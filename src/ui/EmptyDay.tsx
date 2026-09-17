import type { ActividadesProps } from "./ActividadesSection";
import { ActividadesSection } from "./ActividadesSection";
import type { ResumenTiempoProps } from "./ResumenTiempoSection";
import { ResumenTiempoSection } from "./ResumenTiempoSection";
import type { DanoSectionProps } from "./DanoSection";
import { DanoSection } from "./DanoSection";
import type { MantenimientoSectionProps } from "./MantenimientoSection";
import { MantenimientoSection } from "./MantenimientoSection";

/** Estado de día vacío: la fecha operativa actual no tiene orden asignada. */
export function EmptyDay(props: ActividadesProps & ResumenTiempoProps & DanoSectionProps & MantenimientoSectionProps) {
  return (
    <section className="empty-day">
      <p className="empty-day__title">No hay orden asignada para hoy.</p>
      <p className="empty-day__hint">
        Las órdenes llegan de la programación semanal; el sistema solo registra su ejecución.
      </p>
      <ResumenTiempoSection {...props} />
      <ActividadesSection {...props} />
      <DanoSection {...props} />
      <MantenimientoSection {...props} />
    </section>
  );
}