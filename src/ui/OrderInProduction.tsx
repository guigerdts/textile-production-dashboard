import { useState } from "react";
import type { FormEvent } from "react";
import type { Parada, ParadaAbierta, Orden } from "../domain/types";
import {
  calcularProgreso,
  golpesProducidosDesdeLecturas,
  unidadesParaGolpes,
} from "../domain/calculations";
import type { RegistrarParadaInput } from "../domain/paradas";
import { OrderDatos } from "./OrderDatos";
import { ParadasSection } from "./ParadasSection";
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

export interface ResultadoRegistroLectura {
  errores: string[];
  /** true cuando la lectura no produjo incremento (delta 0). */
  sinIncremento: boolean;
}

interface OrderInProductionProps
  extends ActividadesProps,
    ResumenTiempoProps,
    DanoSectionProps,
    InspeccionTelaSectionProps,
    MantenimientoSectionProps {
  orden: Orden;
  /** Proyección integrada por el dominio para la producción actual (SIEMPRE viva: se recalcula con lecturas/daños actuales). */
  integracion2da: ResultadoIntegracion2da;
  /** Async desde el ticket 10.4 (IOrderRepository es async). */
  onRegistrarLectura(valor: number): Promise<ResultadoRegistroLectura>;
  /** Devuelve errores de dominio vacío = éxito. Async desde el ticket 10.4. */
  onFinalizar(): Promise<string[]>;
  /** Paradas de la orden actual (abiertas y cerradas). */
  paradasDeOrden: Parada[];
  /** Parada abierta de la orden actual, si existe; activa bloqueo de lecturas y finalización. */
  paradaActivaDeOrden: ParadaAbierta | null;
  /** Devuelve errores de dominio vacío = éxito. */
  onRegistrarParada(input: RegistrarParadaInput): Promise<string[]>;
  /** Devuelve errores de dominio vacío = éxito. */
  onCerrarParada(): Promise<string[]>;
}

/** Orden en producción: datos + lecturas + restantes + registro de lectura + paradas + finalización. */
export function OrderInProduction({
  orden,
  integracion2da,
  onRegistrarLectura,
  onFinalizar,
  paradasDeOrden,
  paradaActivaDeOrden,
  onRegistrarParada,
  onCerrarParada,
  ...actividadesProps
}: OrderInProductionProps) {
  const [nuevaLectura, setNuevaLectura] = useState("");
  const [errores, setErrores] = useState<string[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erroresFin, setErroresFin] = useState<string[]>([]);

  const paradaActiva = paradaActivaDeOrden !== null;

  const golpesProducidos = golpesProducidosDesdeLecturas(orden.lecturas);
  const unidadesProducidas = unidadesParaGolpes(golpesProducidos);
  const progreso = calcularProgreso(golpesProducidos, orden.unidadesSolicitadas, orden.porcentaje2da);
  const ultimaLectura = orden.lecturas.at(-1)?.valor;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    setErroresFin([]);
    const res = await onRegistrarLectura(Number(nuevaLectura));
    setErrores(res.errores);
    if (res.errores.length > 0) {
      return;
    }
    setNuevaLectura("");
    if (res.sinIncremento) {
      setAviso("Sin incremento desde la última lectura");
    }
  }

  async function handleFinalizar() {
    setAviso(null);
    setErrores([]);
    setErroresFin(await onFinalizar());
  }

  return (
    <article className="order-card" data-testid={`orden-${orden.id}`}>
      <header className="order-card__header">
        <span className="order-card__numero">{orden.numeroOrden}</span>
        <span className="order-card__estado order-card__estado--prod">En producción</span>
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
              <dt>Lectura inicial</dt>
              <dd>{formatearNumero(orden.contadorBase ?? 0)}</dd>
            </div>
            <div className="order-card__fila">
              <dt>Última lectura</dt>
              <dd>{ultimaLectura === undefined ? "—" : formatearNumero(ultimaLectura)}</dd>
            </div>
            <div className="order-card__fila">
              <dt>Producción actual</dt>
              <dd>
                {formatearNumero(golpesProducidos)} golpes / {formatearNumero(unidadesProducidas)} unidades
              </dd>
            </div>
            <div className="order-card__fila">
              <dt>Unidades restantes</dt>
              <dd>{formatearNumero(progreso.unidadesRestantes)} unidades</dd>
            </div>
            <div className="order-card__fila">
              <dt>Golpes restantes</dt>
              <dd>{formatearNumero(progreso.golpesRestantes)} golpes</dd>
            </div>
          </>
        }
      />

      <CalidadSection integracion2da={integracion2da} />

      <form className="start-form" onSubmit={handleSubmit} aria-label="Registrar lectura">
        <h2 className="start-form__titulo">Registrar lectura</h2>
        <label className="start-form__campo">
          Nueva lectura del contador (absoluta)
          <input
            type="number"
            step={1}
            value={nuevaLectura}
            onChange={(e) => setNuevaLectura(e.currentTarget.value)}
            placeholder="Ej.: 1234"
            disabled={paradaActiva}
          />
        </label>
        <button type="submit" className="start-form__boton" disabled={paradaActiva}>
          Registrar lectura
        </button>
        {paradaActiva && (
          <p className="start-form__aviso" role="status">
            La producción está detenida por una parada activa
          </p>
        )}
        {aviso && <p className="start-form__aviso">{aviso}</p>}
        {errores.length > 0 && (
          <ul className="start-form__errores" role="alert">
            {errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </form>

      <ParadasSection
        ordenId={orden.id}
        operatorName={orden.operatorName ?? ""}
        paradasDeOrden={paradasDeOrden}
        paradaActivaDeOrden={paradaActivaDeOrden}
        onRegistrarParada={onRegistrarParada}
        onCerrarParada={onCerrarParada}
      />

      <ResumenTiempoSection {...actividadesProps} />
      <ActividadesSection {...actividadesProps} />
      <InspeccionTelaSection orden={orden} {...actividadesProps} />
      <DanoSection {...actividadesProps} />
      <MantenimientoSection {...actividadesProps} />

      <section className="finish-section">
        <button
          type="button"
          className="start-form__boton finish-btn"
          onClick={handleFinalizar}
          disabled={paradaActiva}
        >
          Finalizar producción
        </button>
        {paradaActiva && (
          <p className="start-form__aviso" role="status">
            Cierre la parada activa antes de finalizar la orden
          </p>
        )}
        {erroresFin.length > 0 && (
          <ul className="start-form__errores" role="alert">
            {erroresFin.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}