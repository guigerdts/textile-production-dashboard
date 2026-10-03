import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { CausaParadaId, Parada, ParadaAbierta } from "../domain/types";
import {
  duracionAcumulada,
  duracionParada,
  getCausaParadaPorId,
  getCausasParada,
} from "../domain/paradas";
import type { RegistrarParadaInput } from "../domain/paradas";

interface ParadasSectionProps {
  ordenId: string;
  /** Día operativo (YYYY-MM-DD) en el que se ATRIBUYE el evento nuevo. No se
   * deriva de `inicio`: es un dato explícito y persistido (CHANGE 1).
   * Hoy la app lo inyecta con el día consultado; al navegar a un día
   * histórico será ese día (CHANGE 2), no el de hoy. */
  fechaOperativa: string;
  /** true cuando el día seleccionado NO es hoy: todo control de escritura queda oculto. */
  soloLectura: boolean;
  /** Operario que registra la parada (el de la orden en producción). */
  operatorName: string;
  /** Paradas de la orden actual (abiertas y cerradas). */
  paradasDeOrden: Parada[];
  /** Parada abierta de la orden actual, si existe. */
  paradaActivaDeOrden: ParadaAbierta | null;
  /** Devuelve errores de dominio vacío = éxito. */
  onRegistrarParada(input: RegistrarParadaInput): Promise<string[]>;
  /** Devuelve errores de dominio vacío = éxito. */
  onCerrarParada(): Promise<string[]>;
}

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

/** Parsea el texto "1,3,5" a un array de números (el dominio valida rangos y vacíos). */
function parsearCarros(texto: string): number[] {
  return texto
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
}

/** Sección de paradas de una orden en producción: registrar, activa y historial. */
export function ParadasSection({
  ordenId,
  operatorName,
  paradasDeOrden,
  paradaActivaDeOrden,
  fechaOperativa,
  soloLectura,
  onRegistrarParada,
  onCerrarParada,
}: ParadasSectionProps) {
  const [causaId, setCausaId] = useState<CausaParadaId | "">("");
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [observaciones, setObservaciones] = useState("");
  const [errores, setErrores] = useState<string[]>([]);
  const [erroresCierre, setErroresCierre] = useState<string[]>([]);

  const causa = causaId ? getCausaParadaPorId(causaId) : undefined;
  const paradasCerradas = paradasDeOrden.filter((p) => p.fin !== null);

  // Refresco periódico de la duración acumulada de la parada abierta (30 s).
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const duracionActiva = paradaActivaDeOrden
    ? duracionAcumulada(paradaActivaDeOrden, new Date().toISOString())
    : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErroresCierre([]);
    // Sin guard local de causa: el dominio valida "debe seleccionar una causa".
    const camposEspecificos: Record<string, unknown> = {};
    for (const campo of causa?.camposRequeridos ?? []) {
      const crudo = campos[campo] ?? "";
      // El dominio espera "carro" como número entero 1-7 (lo valida él mismo).
      camposEspecificos[campo] =
        campo === "carro"
          ? crudo === ""
            ? ""
            : Number(crudo)
          : campo === "carrosAfectados"
            ? parsearCarros(crudo)
            : crudo;
    }
    const res = await onRegistrarParada({
      maquinaId: "M1",
      ordenId,
      operatorName,
      causaId,
      camposEspecificos,
      observaciones,
      inicio: new Date().toISOString(),
      fechaOperativa,
    });
    setErrores(res);
    if (res.length > 0) return;
    setCausaId("");
    setCampos({});
    setObservaciones("");
  }

  async function handleCerrar() {
    setErrores([]);
    setErroresCierre(await onCerrarParada());
  }

  return (
    <section className="paradas" data-testid={`paradas-${ordenId}`}>
      <h2 className="paradas__titulo">Paradas / incidencias</h2>

      {paradaActivaDeOrden && (
        <div className="paradas__activa" role="status" data-testid="parada-activa">
          <strong>Parada activa:</strong>{" "}
          {getCausaParadaPorId(paradaActivaDeOrden.causaId)?.nombre ?? paradaActivaDeOrden.causaId}
          <span className="paradas__activa-desde">
            (desde las {formatearHora(paradaActivaDeOrden.inicio)}
            {duracionActiva !== null ? ` — ${formatearDuracion(duracionActiva)}` : ""})
          </span>
          {!soloLectura && (
            <button type="button" className="paradas__cerrar" onClick={handleCerrar}>
              Cerrar parada
            </button>
          )}
          {erroresCierre.length > 0 && (
            <ul className="start-form__errores" role="alert">
              {erroresCierre.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!soloLectura && (
        <form className="paradas__form" onSubmit={handleSubmit} aria-label="Registrar parada">
          <label className="start-form__campo">
            Causa de la parada
            <select
              value={causaId}
              onChange={(e) => {
                const nuevo = e.currentTarget.value as CausaParadaId | "";
                setCausaId(nuevo);
                setCampos({});
              }}
              disabled={paradaActivaDeOrden !== null}
            >
              <option value="">Seleccionar causa…</option>
              {getCausasParada().map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>

          {causa?.camposRequeridos.map((campo) => (
            <label className="start-form__campo" key={campo}>
              {campo === "carrosAfectados"
                ? "Carros afectados (separados por coma)"
                : campo === "carro"
                  ? "Número de carro"
                  : campo === "color"
                    ? "Color"
                    : "Componente"}
              <input
                type={campo === "carro" ? "number" : "text"}
                step={campo === "carro" ? 1 : undefined}
                value={campos[campo] ?? ""}
                onChange={(e) => {
                  const valor = e.currentTarget.value;
                  setCampos((p) => ({ ...p, [campo]: valor }));
                }}
                disabled={paradaActivaDeOrden !== null}
              />
            </label>
          ))}

          <label className="start-form__campo">
            Observaciones
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.currentTarget.value)}
              placeholder="Observaciones (obligatorias si la causa es «Otro»)"
              disabled={paradaActivaDeOrden !== null}
            />
          </label>

          <button
            type="submit"
            className="start-form__boton paradas__boton"
            disabled={paradaActivaDeOrden !== null}
          >
            Registrar parada
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

      {paradasCerradas.length > 0 && (
        <div className="paradas__historial">
          <h3>Historial de paradas</h3>
          <ul>
            {paradasCerradas.map((p) => {
              const duracion = p.fin !== null ? duracionParada(p) : null;
              return (
                <li key={p.id}>
                  {getCausaParadaPorId(p.causaId)?.nombre ?? p.causaId} —{" "}
                  {formatearHora(p.inicio)} → {formatearHora(p.fin!)}
                  {duracion !== null ? ` (${formatearDuracion(duracion)})` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}