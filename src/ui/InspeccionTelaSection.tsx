import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
  EstadoInspeccionTela,
  EstadoItemChecklist,
  InspeccionTela,
  ItemChecklistId,
  Orden,
} from "../domain/types";
import {
  estadoInspeccion,
  getItemChecklistPorId,
  getItemsChecklist,
} from "../domain/inspeccionTela";
import type {
  RegistrarAutorizacionInput,
  RegistrarDevolucionInput,
  RegistrarInspeccionInput,
} from "../domain/inspeccionTela";
import { golpesProducidosDesdeLecturas } from "../domain/calculations";

/**
 * Sección de inspección de tela — ticket 07, Ciclo 3 (UI).
 *
 * PRESENTACIÓN PURA + formularios: NO duplica reglas de negocio; cada registro
 * o resolución DELEGA al dominio (onRegistrarInspeccion / onDevolverInspeccion /
 * onAutorizarInspeccion) y muestra los errores que el dominio devuelve.
 *
 * Comportamiento por vista (la prop `permitirRegistrar` la decide App):
 * - OrderAvailable / OrderInProduction: form de registro + historial +
 *   resolución de inspecciones con anomalía sin resolver.
 * - OrderFinished: historial SOLO (sin registros nuevos ni resoluciones).
 * - EmptyDay: la sección NO se incluye (la inspección siempre pertenece a una
 *   orden; nunca es un evento general de máquina).
 *
 * Reglas de UI que NO inventan negocio:
 * - La devolución se ofrece ÚNICAMENTE cuando la producción derivada es 0
 *   (`golpesProducidosDesdeLecturas` — función del dominio). El dominio
 *   igualmente la valida en el submit.
 * - Una inspección ya resuelta no ofrece controles de resolución (además el
 *   dominio rechaza resoluciones repetidas).
 * - El estado visible por inspección es `estadoInspeccion` (dominio).
 * - La sección NO bloquea lecturas, finalización ni ninguna otra operación.
 */

const ESTADO_LABEL: Record<EstadoInspeccionTela, string> = {
  conforme: "Conforme",
  no_usable: "No usable",
  devuelta: "Devuelta",
  uso_autorizado: "Uso autorizado",
};

/** Fecha/hora legible es-AR (presentación; el dominio valida timestamps ISO). */
function formatearFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-AR");
}

export interface InspeccionTelaSectionProps {
  /** Orden dueña de la sección (la inspección siempre está asociada a una orden). */
  orden: Orden;
  /** Inspecciones de la orden en orden cronológico (listadas por el repositorio). */
  inspecciones: InspeccionTela[];
  /** Operario precargado (el de la orden en producción); editable si no hay. */
  operatorNameInicial?: string;
  /** false = OrderFinished: historial SOLO, sin registrar inspecciones ni resolver. */
  permitirRegistrar: boolean;
  /** Devuelve errores de dominio vacíos = éxito. */
  onRegistrarInspeccion(input: RegistrarInspeccionInput): Promise<string[]>;
  /** Devuelve errores de dominio vacíos = éxito. */
  onDevolverInspeccion(inspeccionId: string, input: RegistrarDevolucionInput): Promise<string[]>;
  /** Devuelve errores de dominio vacíos = éxito. */
  onAutorizarInspeccion(inspeccionId: string, input: RegistrarAutorizacionInput): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Item de historial con resolución
// ---------------------------------------------------------------------------

interface InspeccionItemProps {
  inspeccion: InspeccionTela;
  /** Producción derivada de la orden (0 = pre-impresión → se ofrece devolución). */
  produccionGolpes: number;
  permitirRegistrar: boolean;
  operatorNameInicial?: string;
  onDevolverInspeccion(inspeccionId: string, input: RegistrarDevolucionInput): Promise<string[]>;
  onAutorizarInspeccion(inspeccionId: string, input: RegistrarAutorizacionInput): Promise<string[]>;
}

function InspeccionItem({
  inspeccion,
  produccionGolpes,
  permitirRegistrar,
  operatorNameInicial,
  onDevolverInspeccion,
  onAutorizarInspeccion,
}: InspeccionItemProps) {
  const estado = estadoInspeccion(inspeccion);
  const puedeDevolver = produccionGolpes === 0;
  const necesitaResolucion = estado === "no_usable" && permitirRegistrar;

  const [tipoResolucion, setTipoResolucion] = useState<"" | "devolucion" | "autorizacion_gerencia">("");
  const [motivo, setMotivo] = useState("");
  const [registradaPor, setRegistradaPor] = useState(operatorNameInicial ?? "");
  const [autorizadoPor, setAutorizadoPor] = useState("");
  const [obsAutorizacion, setObsAutorizacion] = useState("");
  const [errores, setErrores] = useState<string[]>([]);

  useEffect(() => {
    setRegistradaPor(operatorNameInicial ?? "");
  }, [operatorNameInicial]);

  async function handleResolver(e: FormEvent) {
    e.preventDefault();
    setErrores([]);

    if (tipoResolucion === "devolucion") {
      const res = await onDevolverInspeccion(inspeccion.id, {
        motivo: motivo.trim(),
        registradaPor: registradaPor.trim(),
        timestamp: new Date().toISOString(),
      });
      setErrores(res);
      if (res.length === 0) {
        setTipoResolucion("");
        setMotivo("");
      }
      return;
    }

    if (tipoResolucion === "autorizacion_gerencia") {
      const res = await onAutorizarInspeccion(inspeccion.id, {
        autorizadoPor: autorizadoPor.trim(),
        timestamp: new Date().toISOString(),
        observaciones: obsAutorizacion.trim() === "" ? undefined : obsAutorizacion,
      });
      setErrores(res);
      if (res.length === 0) {
        setTipoResolucion("");
        setAutorizadoPor("");
        setObsAutorizacion("");
      }
      return;
    }

    setErrores(["seleccione el tipo de resolución"]);
  }

  return (
    <li className="inspecciones__item" data-testid="inspeccion-item">
      <header className="inspecciones__item-header">
        <span
          className={`inspecciones__estado inspecciones__estado--${estado}`}
          role="status"
        >
          {ESTADO_LABEL[estado]}
        </span>
        <span className="inspecciones__item-meta">
          Lote: {inspeccion.lote ?? "—"} · {formatearFechaHora(inspeccion.timestamp)} ·{" "}
          {inspeccion.operatorName}
        </span>
      </header>

      <ul className="inspecciones__checklist">
        {inspeccion.items.map((item) => (
          <li key={item.id} className={item.estado === "anomalia" ? "inspecciones__check--anomalia" : undefined}>
            {getItemChecklistPorId(item.id)?.nombre ?? item.id}:{" "}
            {item.estado === "anomalia" ? "Anomalía" : "Conforme"}
          </li>
        ))}
      </ul>

      {inspeccion.otraAnomalia && (
        <p className="inspecciones__otra">
          <strong>Otra anomalía:</strong> {inspeccion.otraAnomalia}
        </p>
      )}
      {inspeccion.observaciones && (
        <p className="inspecciones__obs">
          <strong>Observaciones:</strong> {inspeccion.observaciones}
        </p>
      )}

      {inspeccion.resolucion?.tipo === "devolucion" && (
        <p className="inspecciones__resolucion inspecciones__resolucion--devolucion">
          <strong>Devolución:</strong>{" "}
          {inspeccion.resolucion.motivo} — registrada por{" "}
          {inspeccion.resolucion.registradaPor} el{" "}
          {formatearFechaHora(inspeccion.resolucion.timestamp)}
        </p>
      )}
      {inspeccion.resolucion?.tipo === "autorizacion_gerencia" && (
        <p className="inspecciones__resolucion inspecciones__resolucion--autorizacion">
          <strong>Uso autorizado por gerencia:</strong>{" "}
          {inspeccion.resolucion.autorizadoPor} el{" "}
          {formatearFechaHora(inspeccion.resolucion.timestamp)}
          {inspeccion.resolucion.observaciones &&
            ` — ${inspeccion.resolucion.observaciones}`}
        </p>
      )}

      {necesitaResolucion && (
        <form
          className="inspecciones__resolver"
          onSubmit={handleResolver}
          aria-label="Resolver inspección"
        >
          <label className="start-form__campo">
            Tipo de resolución
            <select
              value={tipoResolucion}
              onChange={(e) =>
                setTipoResolucion(e.currentTarget.value as typeof tipoResolucion)
              }
            >
              <option value="">Seleccionar…</option>
              {puedeDevolver && (
                <option value="devolucion">Devolución de tela</option>
              )}
              <option value="autorizacion_gerencia">Autorización de gerencia</option>
            </select>
          </label>

          {tipoResolucion === "devolucion" && (
            <>
              <label className="start-form__campo">
                Motivo (obligatorio)
                <input
                  type="text"
                  value={motivo}
                  onChange={(e) => setMotivo(e.currentTarget.value)}
                  placeholder="Ej.: absorción insuficiente"
                />
              </label>
              <label className="start-form__campo">
                Registrada por (obligatorio)
                <input
                  type="text"
                  value={registradaPor}
                  onChange={(e) => setRegistradaPor(e.currentTarget.value)}
                />
              </label>
            </>
          )}

          {tipoResolucion === "autorizacion_gerencia" && (
            <>
              <label className="start-form__campo">
                Autorizado por (obligatorio)
                <input
                  type="text"
                  value={autorizadoPor}
                  onChange={(e) => setAutorizadoPor(e.currentTarget.value)}
                  placeholder="Ej.: Gerencia turno mañana"
                />
              </label>
              <label className="start-form__campo">
                Observaciones (opcional)
                <textarea
                  value={obsAutorizacion}
                  onChange={(e) => setObsAutorizacion(e.currentTarget.value)}
                />
              </label>
            </>
          )}

          {errores.length > 0 && (
            <ul className="start-form__errores" role="alert">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <button type="submit" className="inspecciones__boton-resolver" disabled={tipoResolucion === ""}>
            Resolver inspección
          </button>
        </form>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Sección completa
// ---------------------------------------------------------------------------

export function InspeccionTelaSection({
  orden,
  inspecciones,
  operatorNameInicial,
  permitirRegistrar,
  onRegistrarInspeccion,
  onDevolverInspeccion,
  onAutorizarInspeccion,
}: InspeccionTelaSectionProps) {
  const [operatorName, setOperatorName] = useState(operatorNameInicial ?? "");
  const [lote, setLote] = useState("");
  const [checklist, setChecklist] = useState<
    Record<ItemChecklistId, EstadoItemChecklist>
  >(() =>
    Object.fromEntries(
      getItemsChecklist().map((i) => [i.id, "conforme" as const]),
    ) as Record<ItemChecklistId, EstadoItemChecklist>,
  );
  const [otraAnomalia, setOtraAnomalia] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [errores, setErrores] = useState<string[]>([]);

  // Re-sincroniza el operario si cambia la orden (p. ej. nueva orden en producción).
  useEffect(() => {
    setOperatorName(operatorNameInicial ?? "");
  }, [operatorNameInicial]);

  const produccionGolpes = golpesProducidosDesdeLecturas(orden.lecturas ?? []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrores([]);

    const input: RegistrarInspeccionInput = {
      operatorName: operatorName.trim(),
      lote: lote.trim() === "" ? undefined : lote,
      items: getItemsChecklist().map((i) => ({ id: i.id, estado: checklist[i.id] })),
      otraAnomalia: otraAnomalia.trim() === "" ? undefined : otraAnomalia,
      timestamp: new Date().toISOString(),
      observaciones: observaciones.trim() === "" ? undefined : observaciones,
    };

    const res = await onRegistrarInspeccion(input);
    setErrores(res);
    if (res.length > 0) {
      return;
    }

    setLote("");
    setChecklist(
      Object.fromEntries(
        getItemsChecklist().map((i) => [i.id, "conforme" as const]),
      ) as Record<ItemChecklistId, EstadoItemChecklist>,
    );
    setOtraAnomalia("");
    setObservaciones("");
  }

  return (
    <section
      className="inspecciones"
      data-testid="inspeccion-tela-seccion"
      aria-label="Inspección de tela"
    >
      <h2 className="inspecciones__titulo">Inspección de tela</h2>

      {permitirRegistrar && (
        <form
          className="inspecciones__form"
          onSubmit={handleSubmit}
          aria-label="Registrar inspección"
        >
          <label className="start-form__campo">
            Operario
            <input
              type="text"
              value={operatorName}
              onChange={(e) => setOperatorName(e.currentTarget.value)}
              disabled={operatorNameInicial !== undefined && operatorNameInicial !== ""}
            />
          </label>

          <label className="start-form__campo">
            Lote (opcional)
            <input
              type="text"
              value={lote}
              onChange={(e) => setLote(e.currentTarget.value)}
              placeholder="Ej.: L-103"
            />
          </label>

          <fieldset className="inspecciones__checklist-fieldset">
            <legend>Checklist de la tela</legend>
            {getItemsChecklist().map((item) => (
              <div key={item.id} className="inspecciones__checklist-fila">
                <span className="inspecciones__checklist-nombre">{item.nombre}</span>
                <label className="inspecciones__check-opcion">
                  <input
                    type="radio"
                    name={`checklist-${item.id}`}
                    checked={checklist[item.id] === "conforme"}
                    onChange={() =>
                      setChecklist((c) => ({ ...c, [item.id]: "conforme" as const }))
                    }
                  />
                  <span>{item.nombre}: Conforme</span>
                </label>
                <label className="inspecciones__check-opcion">
                  <input
                    type="radio"
                    name={`checklist-${item.id}`}
                    checked={checklist[item.id] === "anomalia"}
                    onChange={() =>
                      setChecklist((c) => ({ ...c, [item.id]: "anomalia" as const }))
                    }
                  />
                  <span>{item.nombre}: Anomalía</span>
                </label>
              </div>
            ))}
          </fieldset>

          <label className="start-form__campo">
            Otra anomalía (opcional)
            <textarea
              value={otraAnomalia}
              onChange={(e) => setOtraAnomalia(e.currentTarget.value)}
              placeholder="Ej.: olor fuerte, deformación…"
            />
          </label>

          <label className="start-form__campo">
            Observaciones (opcional)
            <textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.currentTarget.value)}
            />
          </label>

          <button type="submit" className="inspecciones__boton">
            Registrar inspección
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

      {inspecciones.length > 0 && (
        <div className="inspecciones__historial">
          <h3 className="inspecciones__historial-titulo">Historial de inspecciones</h3>
          <ul className="inspecciones__lista">
            {inspecciones.map((inspeccion) => (
              <InspeccionItem
                key={inspeccion.id}
                inspeccion={inspeccion}
                produccionGolpes={produccionGolpes}
                permitirRegistrar={permitirRegistrar}
                operatorNameInicial={operatorNameInicial}
                onDevolverInspeccion={onDevolverInspeccion}
                onAutorizarInspeccion={onAutorizarInspeccion}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}