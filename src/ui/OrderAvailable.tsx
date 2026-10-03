import { useState } from "react";
import type { FormEvent } from "react";
import type { Orden } from "../domain/types";
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

const ESTADO_LABEL: Record<Orden["estado"], string> = {
  available: "Disponible",
  in_production: "En producción",
  finished: "Finalizada",
};

interface OrderAvailableProps
  extends ActividadesProps,
    ResumenTiempoProps,
    DanoSectionProps,
    InspeccionTelaSectionProps,
    MantenimientoSectionProps {
  orden: Orden;
  /**
   * Ejecuta la operación de dominio (`iniciarProduccion`) + persistencia en el repositorio.
   * Devuelve los errores de dominio para mostrarlos; vacío = éxito.
   * Async desde el ticket 10.4 (IOrderRepository es async).
   */
  onIniciar(operatorName: string, lecturaInicial: number): Promise<string[]>;
}

/** Orden `available`: datos + formulario de inicio (operario + lectura inicial absoluta). */
export function OrderAvailable({
  orden,
  onIniciar,
  ...actividadesProps
}: OrderAvailableProps) {
  const [operatorName, setOperatorName] = useState("");
  const [lecturaInicial, setLecturaInicial] = useState("");
  const [errores, setErrores] = useState<string[]>([]);
  // Se lee del spread (no se saca de él) para que el resto de props siga llevando
  // `soloLectura` a ResumenTiempo/Actividades/Inspección/Daños/Mantenimiento.
  const { soloLectura } = actividadesProps;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrores(await onIniciar(operatorName, Number(lecturaInicial)));
  }

  return (
    <article className="order-card" data-testid={`orden-${orden.id}`}>
      <header className="order-card__header">
        <span className="order-card__numero">{orden.numeroOrden}</span>
        <span className="order-card__estado">{ESTADO_LABEL[orden.estado]}</span>
      </header>

      <OrderDatos orden={orden} />

      {!soloLectura && (
        <form className="start-form" onSubmit={handleSubmit} aria-label="Iniciar producción">
          <h2 className="start-form__titulo">Iniciar producción</h2>
          <label className="start-form__campo">
            Operario (obligatorio)
            <input
              type="text"
              value={operatorName}
              onChange={(e) => setOperatorName(e.currentTarget.value)}
              placeholder="Nombre del operario"
            />
          </label>
          <label className="start-form__campo">
            Lectura inicial del contador (obligatoria, ≥ 0)
            <input
              type="number"
              step={1}
              value={lecturaInicial}
              onChange={(e) => setLecturaInicial(e.currentTarget.value)}
              placeholder="Ej.: 1234"
            />
          </label>
          <button type="submit" className="start-form__boton">
            Iniciar producción
          </button>
          {errores.length > 0 && (
            <ul className="start-form__errores" role="alert">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </form>
      )}

      <ResumenTiempoSection {...actividadesProps} />
      <ActividadesSection {...actividadesProps} />
      <InspeccionTelaSection orden={orden} {...actividadesProps} />
      <DanoSection {...actividadesProps} />
      <MantenimientoSection {...actividadesProps} />
    </article>
  );
}