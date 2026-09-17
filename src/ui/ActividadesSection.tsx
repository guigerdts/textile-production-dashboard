import { useState } from "react";
import type { FormEvent } from "react";
import type {
  ActividadAbierta,
  ActividadPlanificada,
  TipoActividadPlanificada,
} from "../domain/types";
import {
  duracionActividad,
  getTipoActividadPorId,
  getTiposActividad,
} from "../domain/actividades";
import type { RegistrarActividadInput } from "../domain/actividades";

export interface ActividadesProps {
  /** Día operativo (para la sugerencia editable del martes en limpieza). */
  hoy: string;
  /** Operario que registra la actividad; en producción/finalizada se precarga con el de la orden. */
  operatorNameInicial?: string;
  /** Todas las actividades de la máquina (abiertas y cerradas) para historial y validación. */
  actividades: ActividadPlanificada[];
  /** Actividades abiertas (0..2: limpieza y/o cambio de diseño pueden coexistir). */
  actividadesAbiertas: ActividadAbierta[];
  /** Devuelve errores de dominio vacío = éxito. */
  onRegistrarActividad(input: RegistrarActividadInput): string[];
  /** Devuelve errores de dominio vacío = éxito. */
  onCerrarActividad(tipo: TipoActividadPlanificada): string[];
}

/** La limpieza del martes 7:00–8:00 es SOLO una sugerencia editable de UI (decisión aprobada). */
const SUGERENCIA_LIMPIEZA_MARTES = "Limpieza estándar (7:00–8:00)";

function formatearHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function formatearDuracion(segundos: number): string {
  const mins = Math.round(segundos / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** True si la fecha operativa (YYYY-MM-DD) cae en martes (getDay() === 2). */
function esMartes(fechaOperativa: string): boolean {
  const [y, m, d] = fechaOperativa.split("-").map(Number);
  return new Date(y, m - 1, d).getDay() === 2;
}

/** Sección de actividades planificadas: registrar, activa y historial. Reutilizable en los 4 estados de orden. */
export function ActividadesSection({
  hoy,
  operatorNameInicial = "",
  actividades,
  actividadesAbiertas,
  onRegistrarActividad,
  onCerrarActividad,
}: ActividadesProps) {
  const [tipo, setTipo] = useState<TipoActividadPlanificada | "">("");
  const [queSeLimpio, setQueSeLimpio] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [operatorName, setOperatorName] = useState(operatorNameInicial);
  const [errores, setErrores] = useState<string[]>([]);
  const [erroresCierre, setErroresCierre] = useState<string[]>([]);

  const actividadesCerradas = actividades.filter((a) => a.fin !== null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErroresCierre([]);
    const res = onRegistrarActividad({
      maquinaId: "M1",
      tipo,
      inicio: new Date().toISOString(),
      queSeLimpio,
      observaciones,
      operatorName,
    });
    setErrores(res);
    if (res.length > 0) return;
    setTipo("");
    setQueSeLimpio("");
    setObservaciones("");
  }

  function handleCerrar(tipoActiva: TipoActividadPlanificada) {
    setErrores([]);
    setErroresCierre(onCerrarActividad(tipoActiva));
  }

  return (
    <section className="actividades" data-testid="actividades">
      <h2 className="actividades__titulo">Actividades planificadas</h2>

      {actividadesAbiertas.map((activa) => (
        <div
          key={activa.id}
          className="actividades__activa"
          role="status"
          data-testid={`actividad-abierta-${activa.tipo}`}
        >
          <strong>Actividad activa:</strong>{" "}
          {getTipoActividadPorId(activa.tipo)?.nombre ?? activa.tipo}
          <span className="actividades__activa-desde">
            {" "}
            (desde las {formatearHora(activa.inicio)})
          </span>
          <button
            type="button"
            className="actividades__cerrar"
            onClick={() => handleCerrar(activa.tipo)}
          >
            Cerrar actividad
          </button>
          {erroresCierre.length > 0 && (
            <ul className="start-form__errores" role="alert">
              {erroresCierre.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <form className="actividades__form" onSubmit={handleSubmit} aria-label="Registrar actividad">
        <label className="start-form__campo">
          Tipo de actividad
          <select
            value={tipo}
            onChange={(e) => {
              const nuevo = e.currentTarget.value as TipoActividadPlanificada | "";
              setTipo(nuevo);
              // Sugerencia SOLO de UI: si es martes y elige limpieza, precarga un texto
              // editable; no crea nada, no restringe otros días ni horarios.
              setQueSeLimpio(nuevo === "limpieza" && esMartes(hoy) ? SUGERENCIA_LIMPIEZA_MARTES : "");
            }}
          >
            <option value="">Seleccionar tipo…</option>
            {getTiposActividad().map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>

        {tipo === "limpieza" && (
          <label className="start-form__campo">
            Qué se limpió
            <input
              type="text"
              value={queSeLimpio}
              onChange={(e) => setQueSeLimpio(e.currentTarget.value)}
              placeholder="Ej.: mesa de estampado"
            />
          </label>
        )}

        <label className="start-form__campo">
          Operario de la actividad
          <input
            type="text"
            value={operatorName}
            onChange={(e) => setOperatorName(e.currentTarget.value)}
            placeholder="Nombre del operario"
          />
        </label>

        <label className="start-form__campo">
          Observaciones
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.currentTarget.value)}
            placeholder="Observaciones (opcional)"
          />
        </label>

        <button type="submit" className="start-form__boton actividades__boton">
          Registrar actividad
        </button>
        {errores.length > 0 && (
          <ul className="start-form__errores" role="alert">
            {errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </form>

      {actividadesCerradas.length > 0 && (
        <div className="actividades__historial">
          <h3>Historial de actividades</h3>
          <ul>
            {actividadesCerradas.map((a) => {
              const duracion = a.fin !== null ? duracionActividad(a) : null;
              return (
                <li key={a.id}>
                  {getTipoActividadPorId(a.tipo)?.nombre ?? a.tipo} —{" "}
                  {formatearHora(a.inicio)} → {formatearHora(a.fin!)}
                  {duracion !== null ? ` (${formatearDuracion(duracion)})` : ""}
                  {a.tipo === "limpieza" && a.queSeLimpio ? ` — ${a.queSeLimpio}` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}