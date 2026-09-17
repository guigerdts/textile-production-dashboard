import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
  Dano,
  Mantenimiento,
  MantenimientoAbierto,
  TipoMantenimientoId,
} from "../domain/types";
import {
  getTiposMantenimiento,
  getTipoMantenimientoPorId,
} from "../domain/mantenimiento";
import { getTipoDanoPorId } from "../domain/danos";
import type { RegistrarMantenimientoInput } from "../domain/mantenimiento";

export interface MantenimientoSectionProps {
  maquinaId: "M1";
  operatorNameInicial?: string;
  mantenimientosDeMaquina: Mantenimiento[];
  mantenimientoAbiertoDeMaquina: MantenimientoAbierto | null;
  danosDeMaquina: Dano[];
  permitirRegistrar: boolean;
  onRegistrarMantenimiento(input: RegistrarMantenimientoInput): string[];
  onCerrarMantenimiento(fin: string, queSeRevisoReparo: string): string[];
}

/** Formatea un ISO a hora local es-AR (presentación). */
function formatearHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/** Duración simple en "X h / X min" para mostrar. */
function formatearDuracion(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** ISO "Z" → valor para input datetime-local. */
function fechaParaInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Sección de mantenimiento de la máquina: registro abierto, completo en un paso,
 * cierre, y cronología documental del turno/día operativo.
 *
 * Presentación PURA: sin lógica de dominio, sin persistencia.
 * Las validaciones, normalización y restricciones viven en el dominio
 * (registrarMantenimiento / cerrarMantenimiento) y en App.tsx (handlers).
 */
export function MantenimientoSection({
  maquinaId,
  operatorNameInicial,
  mantenimientosDeMaquina,
  mantenimientoAbiertoDeMaquina,
  danosDeMaquina,
  permitirRegistrar,
  onRegistrarMantenimiento,
  onCerrarMantenimiento,
}: MantenimientoSectionProps) {
  const [tipo, setTipo] = useState<TipoMantenimientoId | "">("");
  const [operatorName, setOperatorName] = useState(operatorNameInicial ?? "");
  const [motivo, setMotivo] = useState("");
  const [danoId, setDanoId] = useState<string | null>(null);
  const [observaciones, setObservaciones] = useState("");
  const [errores, setErrores] = useState<string[]>([]);
  const [modoCompleto, setModoCompleto] = useState(false);
  const [queSeRevisoReparo, setQueSeRevisoReparo] = useState("");

  // Cierre del mantenimiento abierto
  const [finInput, setFinInput] = useState(() =>
    fechaParaInput(new Date().toISOString()),
  );
  const [queSeRevisoCierre, setQueSeRevisoCierre] = useState("");
  const [erroresCierre, setErroresCierre] = useState<string[]>([]);

  // Refresco periódico de la duración acumulada del abierto (30 s).
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Re-sincroniza el operario si cambia la orden.
  useEffect(() => {
    setOperatorName(operatorNameInicial ?? "");
  }, [operatorNameInicial]);

  const mantenimientosCerrados = mantenimientosDeMaquina.filter((m) => m.fin !== null);

  function duracionMantenimiento(m: Mantenimiento): number {
    const desde = new Date(m.inicio).getTime();
    const hasta = m.fin ? new Date(m.fin).getTime() : Date.now();
    return Math.max(0, hasta - desde);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrores([]);

    const input: RegistrarMantenimientoInput = {
      maquinaId,
      tipo: tipo as TipoMantenimientoId,
      operatorName: operatorName.trim(),
      motivo: motivo.trim(),
      inicio: new Date().toISOString(),
      fin: modoCompleto ? new Date().toISOString() : undefined,
      queSeRevisoReparo: modoCompleto ? queSeRevisoReparo.trim() : undefined,
      danoId: tipo === "preventivo" ? null : danoId,
      observaciones: observaciones.trim() === "" ? undefined : observaciones,
    };

    const res = onRegistrarMantenimiento(input);
    setErrores(res);
    if (res.length > 0) return;

    // Limpiar form
    setTipo("");
    setMotivo("");
    setDanoId(null);
    setObservaciones("");
    setModoCompleto(false);
    setQueSeRevisoReparo("");
  }

  function handleCerrar(e: FormEvent) {
    e.preventDefault();
    setErroresCierre([]);
    const finIso = finInput ? new Date(finInput).toISOString() : "";
    setErroresCierre(onCerrarMantenimiento(finIso, queSeRevisoCierre));
  }

  return (
    <section className="mantenimiento" data-testid="mantenimiento-seccion">
      <h2 className="mantenimiento__titulo">Mantenimiento</h2>

      {mantenimientoAbiertoDeMaquina && (
        <div className="mantenimiento__abierto" role="status" data-testid="mantenimiento-abierto">
          <strong>Mantenimiento activo:</strong>{" "}
          {getTipoMantenimientoPorId(mantenimientoAbiertoDeMaquina.tipo)?.nombre ?? mantenimientoAbiertoDeMaquina.tipo}
          {" — "}
          {mantenimientoAbiertoDeMaquina.motivo}
          <span className="mantenimiento__abierto-desde">
            {" "}(desde las {formatearHora(mantenimientoAbiertoDeMaquina.inicio)} —{" "}
            {formatearDuracion(duracionMantenimiento(mantenimientoAbiertoDeMaquina))})
          </span>
          {permitirRegistrar && (
            <form className="mantenimiento__cierre" onSubmit={handleCerrar} aria-label="Cerrar mantenimiento">
              <label className="start-form__campo">
                Fin de la reparación
                <input
                  type="datetime-local"
                  value={finInput}
                  onChange={(e) => setFinInput(e.currentTarget.value)}
                />
              </label>
              <label className="start-form__campo">
                Qué se revisó / reparó (obligatorio)
                <textarea
                  value={queSeRevisoCierre}
                  onChange={(e) => setQueSeRevisoCierre(e.currentTarget.value)}
                  placeholder="Ej.: Cambio de fusible y revisión eléctrica"
                />
              </label>
              {erroresCierre.length > 0 && (
                <ul className="start-form__errores" role="alert">
                  {erroresCierre.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              <button type="submit" className="mantenimiento__boton-cerrar">
                Cerrar mantenimiento
              </button>
            </form>
          )}
        </div>
      )}

      {permitirRegistrar && (
        <form className="mantenimiento__form" onSubmit={handleSubmit} aria-label="Registrar mantenimiento">
          <label className="start-form__campo">
            Operario
            <input
              value={operatorName}
              onChange={(e) => setOperatorName(e.currentTarget.value)}
              disabled={operatorNameInicial !== undefined && operatorNameInicial !== ""}
            />
          </label>

          <label className="start-form__campo">
            Tipo de mantenimiento
            <select
              value={tipo}
              onChange={(e) => {
                const val = e.currentTarget.value as TipoMantenimientoId | "";
                setTipo(val);
                // Preventivo: limpiar daño vinculado
                if (val === "preventivo") setDanoId(null);
              }}
            >
              <option value="">Seleccionar tipo…</option>
              {getTiposMantenimiento().map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="start-form__campo">
            Motivo (obligatorio)
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.currentTarget.value)}
              placeholder="Ej.: Fusible quemado, fuga de tinta"
            />
          </label>

          {tipo === "reactivo" && (
            <label className="start-form__campo">
              Daño vinculado
              <select
                value={danoId ?? ""}
                onChange={(e) => setDanoId(e.currentTarget.value === "" ? null : e.currentTarget.value)}
              >
                <option value="">Sin vínculo</option>
                {danosDeMaquina
                  .filter((d) => d.maquinaId === maquinaId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {getTipoDanoPorId(d.tipo)?.nombre ?? d.tipo} — {d.componente}
                    </option>
                  ))}
              </select>
            </label>
          )}

          <label className="start-form__campo mantenimiento__flag">
            <input
              type="checkbox"
              checked={modoCompleto}
              onChange={(e) => setModoCompleto(e.currentTarget.checked)}
            />
            Registro completo (con fin)
          </label>

          {modoCompleto && (
            <label className="start-form__campo">
              Qué se revisó / reparó (obligatorio)
              <textarea
                value={queSeRevisoReparo}
                onChange={(e) => setQueSeRevisoReparo(e.currentTarget.value)}
                placeholder="Ej.: Cambio de fusible y revisión eléctrica"
              />
            </label>
          )}

          <label className="start-form__campo">
            Observaciones
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.currentTarget.value)}
            />
          </label>

          <button type="submit" className="mantenimiento__boton">
            {modoCompleto ? "Registro completo" : "Registrar mantenimiento"}
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

      {mantenimientosCerrados.length > 0 && (
        <div className="mantenimiento__historial">
          <h3>Historial de mantenimientos</h3>
          <ul>
            {mantenimientosCerrados.map((m) => (
              <li key={m.id}>
                {getTipoMantenimientoPorId(m.tipo)?.nombre ?? m.tipo} — {m.motivo}
                {" "}
                ({formatearHora(m.inicio)} → {formatearHora(m.fin!)} —{" "}
                {formatearDuracion(duracionMantenimiento(m))})
                {m.queSeRevisoReparo && ` — ${m.queSeRevisoReparo}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
