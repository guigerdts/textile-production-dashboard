import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { JornadaTurno, ResumenTiempoTurno } from "../domain/types";

/**
 * Props de la sección de resumen del turno — ticket 04.
 * La sección NO calcula duraciones ni aplica reglas del dominio: recibe el
 * resumen ya derivado por `resumenTiempoTurno` y solo lo presenta.
 */
export interface ResumenTiempoProps {
  /** Ventana de jornada vigente (default 07:00–17:00; fin extensible por overtime). */
  jornada: JornadaTurno;
  /** Resumen del turno ya calculado por dominio (4 valores derivados). */
  resumenTiempo: ResumenTiempoTurno;
  /** Devuelve errores de dominio vacío = éxito. Recibe el fin editado como "HH:MM". */
  onCambiarFinJornada(fin: string): string[];
}

/** "HH:MM" de 24 h a partir de un timestamp ISO (para el input type="time").
 * Los timestamps del dominio viajan en UTC; se formatean explícitamente en UTC
 * para que la jornada se muestre como se registró (07:00–17:00) en cualquier
 * zona horaria del navegador. */
function horaParaInput(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

function formatearDuracion(segundos: number): string {
  const mins = Math.round(segundos / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Resumen del turno: jornada visible con fin editable (overtime) y los 4
 * buckets derivados (disponible, planificado, incidencias, productivo).
 * Reutilizable en los 4 estados de orden (día vacío, disponible, en
 * producción, finalizada); el Ticket 09 la reutilizará en su dashboard.
 */
export function ResumenTiempoSection({
  jornada,
  resumenTiempo,
  onCambiarFinJornada,
}: ResumenTiempoProps) {
  const [finInput, setFinInput] = useState(() => horaParaInput(jornada.fin));
  const [errores, setErrores] = useState<string[]>([]);

  // Sincroniza el input cuando la jornada cambia desde el padre (ej. después de guardar).
  useEffect(() => {
    setFinInput(horaParaInput(jornada.fin));
  }, [jornada.fin]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrores(onCambiarFinJornada(finInput));
  }

  return (
    <section className="resumen-tiempo" data-testid="resumen-tiempo">
      <h2 className="resumen-tiempo__titulo">Resumen del turno</h2>

      <p className="resumen-tiempo__jornada" role="status">
        Jornada: {horaParaInput(jornada.inicio)} → {horaParaInput(jornada.fin)}
      </p>

      <dl className="resumen-tiempo__buckets">
        <div className="resumen-tiempo__bucket">
          <dt>Tiempo disponible</dt>
          <dd data-testid="resumen-tiempo_disponible">
            {formatearDuracion(resumenTiempo.totalDisponible)}
          </dd>
        </div>
        <div className="resumen-tiempo__bucket">
          <dt>Planificado</dt>
          <dd data-testid="resumen-tiempo_planificado">
            {formatearDuracion(resumenTiempo.planificado)}
          </dd>
        </div>
        <div className="resumen-tiempo__bucket">
          <dt>Incidencias</dt>
          <dd data-testid="resumen-tiempo_incidencias">
            {formatearDuracion(resumenTiempo.incidencias)}
          </dd>
        </div>
        <div className="resumen-tiempo__bucket">
          <dt>Productivo</dt>
          <dd data-testid="resumen-tiempo_productivo">
            {formatearDuracion(resumenTiempo.productivo)}
          </dd>
        </div>
      </dl>

      <form
        className="resumen-tiempo__form"
        onSubmit={handleSubmit}
        aria-label="Ajustar fin de jornada"
      >
        <label className="start-form__campo">
          Fin de jornada (overtime incluido)
          <input
            type="time"
            value={finInput}
            onChange={(e) => setFinInput(e.currentTarget.value)}
          />
        </label>
        <button type="submit" className="start-form__boton resumen-tiempo__boton">
          Guardar fin de jornada
        </button>
        {errores.length > 0 && (
          <ul className="start-form__errores" role="alert">
            {errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </form>
    </section>
  );
}