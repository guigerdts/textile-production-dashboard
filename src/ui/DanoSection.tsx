import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Dano, DanoAbierto, Parada, TipoDano } from "../domain/types";
import { getTipoDanoPorId, getTiposDano } from "../domain/danos";
import type { RegistrarDanoInput } from "../domain/danos";

export interface DanoSectionProps {
  maquinaId: "M1";
  /** Orden activa o null si la máquina está ociosa / día sin orden. */
  ordenId: string | null;
  /** Operario precargado (el de la orden en producción); undefined/"" si no hay orden y se pide en el form. */
  operatorNameInicial?: string;
  /** Todos los daños de la máquina: historial (cerrados) + abiertos. */
  danosDeMaquina: Dano[];
  /** Daño abierto de la máquina (uno solo por invariante) o null. */
  danoAbiertoDeMaquina: DanoAbierto | null;
  /** Paradas candidatas a vincular cuando causoParada (misma orden, incluido null). */
  paradasVinculables: Parada[];
  /** false = OrderFinished: historial + abiertos pendientes, SIN registrar daño nuevo. */
  permitirRegistrar: boolean;
  /** Devuelve errores de dominio vacíos = éxito. */
  onRegistrarDano(input: RegistrarDanoInput): string[];
  /** Devuelve errores de dominio vacíos = éxito. */
  onCerrarDano(fin: string, solucionAplicada: string): string[];
}

/** Formatea un ISO a hora local es-AR (solo presentación, no afecta al dominio). */
function formatearHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/** Duración simple en "X h / X min" para mostrar (formato, no regla). */
function formatearDuracion(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** ISO "Z" → valor para input datetime-local (cálculo local; el dominio valida timestamps). */
function fechaParaInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Daño en máquina: registro (tipo + componente), consecuencias simultáneas
 * independientes `causoParada` y `posibleSegunda`, vínculo con parada, cierre
 * con fin + solución aplicada, y duración acumulada del daño abierto.
 *
 * A diferencia de las paradas, el cierre del daño REQUIERE indicar `fin` y
 * `solucionAplicada` (el dominio los exige: "debe indicar el timestamp de fin"
 * y "debe indicar la solución aplicada"); la sección los recoge y el dominio
 * los valida (fin >= inicio, etc.). React no duplica reglas: solo reúne inputs
 * y muestra los errores devueltos por el dominio.
 */
export function DanoSection({
  maquinaId,
  ordenId,
  operatorNameInicial,
  danosDeMaquina,
  danoAbiertoDeMaquina,
  paradasVinculables,
  permitirRegistrar,
  onRegistrarDano,
  onCerrarDano,
}: DanoSectionProps) {
  const [operatorName, setOperatorName] = useState(operatorNameInicial ?? "");
  const [tipo, setTipo] = useState<TipoDano | "">("");
  const [componente, setComponente] = useState("");
  const [causoParada, setCausoParada] = useState(false);
  const [paradaId, setParadaId] = useState("");
  const [posibleSegunda, setPosibleSegunda] = useState(false);
  const [unidadesSospechadas, setUnidadesSospechadas] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [errores, setErrores] = useState<string[]>([]);

  // Cierre del daño abierto
  const [finInput, setFinInput] = useState(() =>
    fechaParaInput(new Date().toISOString()),
  );
  const [solucionAplicada, setSolucionAplicada] = useState("");
  const [erroresCierre, setErroresCierre] = useState<string[]>([]);

  // Refresco periódico de la duración acumulada del daño abierto (30 s).
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Re-sincroniza el operario si cambia la orden (p. ej. nueva orden en producción).
  useEffect(() => {
    setOperatorName(operatorNameInicial ?? "");
  }, [operatorNameInicial]);

  const danosCerrados = danosDeMaquina.filter((d) => d.fin !== null);

  function formatearHoraCierre(dano: Dano): string {
    return `desde las ${formatearHora(dano.inicio)}` +
      (dano.fin
        ? ` hasta las ${formatearHora(dano.fin)}`
        : "");
  }

  function duracionDaño(dano: Dano): number {
    const desde = new Date(dano.inicio).getTime();
    const hasta = dano.fin
      ? new Date(dano.fin).getTime()
      : Date.now();
    return Math.max(0, hasta - desde);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrores([]);

    const input: RegistrarDanoInput = {
      maquinaId,
      ordenId,
      operatorName: operatorName.trim(),
      tipo,
      componente: componente.trim(),
      inicio: new Date().toISOString(),
      causoParada,
      paradaId: causoParada ? (paradaId === "" ? null : paradaId) : null,
      posibleSegunda,
      unidadesSospechadas: posibleSegunda
        ? unidadesSospechadas.trim() === ""
          ? undefined
          : Number(unidadesSospechadas)
        : undefined,
      observaciones: observaciones.trim() === "" ? undefined : observaciones,
    };

    const res = onRegistrarDano(input);
    setErrores(res);
    if (res.length > 0) {
      return;
    }

    setComponente("");
    setCausoParada(false);
    setParadaId("");
    setPosibleSegunda(false);
    setUnidadesSospechadas("");
    setObservaciones("");
    setTipo("");
  }

  function handleCerrar(e: FormEvent) {
    e.preventDefault();
    setErroresCierre([]);
    // Reúne fin (datetime-local → ISO "Z") y solución; el dominio valida.
    const finIso = finInput ? new Date(finInput).toISOString() : "";
    setErroresCierre(onCerrarDano(finIso, solucionAplicada));
  }

  return (
    <section className="danos" data-testid={`danos-${ordenId ?? "sin-orden"}`}>
      <h2 className="danos__titulo">Daños / eventos</h2>

      {danoAbiertoDeMaquina && (
        <div className="danos__abierto" role="status" data-testid="dano-abierto">
          <strong>Daño activo:</strong>{" "}
          {getTipoDanoPorId(danoAbiertoDeMaquina.tipo)?.nombre ?? danoAbiertoDeMaquina.tipo}
          {" en "}
          {danoAbiertoDeMaquina.componente}
          <span className="danos__abierto-desde">
            {" "}({formatearHoraCierre(danoAbiertoDeMaquina)} —{" "}
            {formatearDuracion(duracionDaño(danoAbiertoDeMaquina))})
          </span>
          {permitirRegistrar && (
            <form className="danos__cierre" onSubmit={handleCerrar} aria-label="Cerrar daño">
              <label className="start-form__campo">
                Fin de la reparación
                <input
                  type="datetime-local"
                  value={finInput}
                  onChange={(e) => setFinInput(e.currentTarget.value)}
                />
              </label>
              <label className="start-form__campo">
                Solución aplicada (obligatoria)
                <textarea
                  value={solucionAplicada}
                  onChange={(e) => setSolucionAplicada(e.currentTarget.value)}
                  placeholder="Ej.: Cambio de eje y lubricación"
                />
              </label>
              {erroresCierre.length > 0 && (
                <ul className="start-form__errores" role="alert">
                  {erroresCierre.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              <button type="submit" className="danos__boton-cerrar">
                Cerrar daño
              </button>
            </form>
          )}
        </div>
      )}

      {permitirRegistrar && (
        <form className="danos__form" onSubmit={handleSubmit} aria-label="Registrar daño">
          <label className="start-form__campo">
            Operario
            <input
              value={operatorName}
              onChange={(e) => setOperatorName(e.currentTarget.value)}
              disabled={operatorNameInicial !== undefined && operatorNameInicial !== ""}
            />
          </label>

          <label className="start-form__campo">
            Tipo de daño
            <select
              value={tipo}
              onChange={(e) => setTipo(e.currentTarget.value as TipoDano | "")}
            >
              <option value="">Seleccionar tipo…</option>
              {getTiposDano().map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="start-form__campo">
            Componente afectado
            <input
              value={componente}
              onChange={(e) => setComponente(e.currentTarget.value)}
              placeholder="Ej.: eje trasero"
            />
          </label>

          <label className="start-form__campo danos__flag">
            <input
              type="checkbox"
              checked={causoParada}
              onChange={(e) => setCausoParada(e.currentTarget.checked)}
            />
            Este daño causó una parada
          </label>

          {causoParada && (
            <label className="start-form__campo">
              Parada vinculada
              <select
                value={paradaId}
                onChange={(e) => setParadaId(e.currentTarget.value)}
              >
                <option value="">Seleccionar parada…</option>
                {paradasVinculables.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatearHora(p.inicio)} — {p.causaId}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="start-form__campo danos__flag">
            <input
              type="checkbox"
              checked={posibleSegunda}
              onChange={(e) => setPosibleSegunda(e.currentTarget.checked)}
            />
            Posible segunda
          </label>

          {posibleSegunda && (
            <label className="start-form__campo">
              Unidades sospechadas (opcional)
              <input
                type="number"
                min={0}
                step={1}
                value={unidadesSospechadas}
                onChange={(e) => setUnidadesSospechadas(e.currentTarget.value)}
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

          <button type="submit" className="danos__boton">
            Registrar daño
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

      {danosCerrados.length > 0 && (
        <div className="danos__historial">
          <h3>Historial de daños</h3>
          <ul>
            {danosCerrados.map((d) => (
              <li key={d.id}>
                {getTipoDanoPorId(d.tipo)?.nombre ?? d.tipo} en {d.componente} —{" "}
                {formatearHora(d.inicio)} → {formatearHora(d.fin!)}
                {` (${formatearDuracion(duracionDaño(d))})`}
                {d.causoParada && " — causó parada"}
                {d.posibleSegunda &&
                  ` — posible 2da${d.unidadesSospechadas !== undefined ? ` (${d.unidadesSospechadas} uds)` : ""}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
