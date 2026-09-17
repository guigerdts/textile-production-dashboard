/**
 * DashboardHome — sección de resumen del estado de la máquina (ticket 09).
 * Componente 100% presentational: recibe props derivadas y las renderiza.
 * Sin imports de dominio, repositorios, cálculos de negocio ni persistencia.
 */
import { useEffect, useState } from "react";

export interface DashboardHomeProps {
  /** Estado derivado de la máquina. No persistido. */
  estadoMaquina: "andando" | "parada" | "ociosa";

  /** Datos de la parada abierta, si existe. null = sin parada abierta. */
  paradaAbierta: {
    causa: string;
    duracionSegundos: number;
  } | null;

  /** Datos del mantenimiento abierto, si existe. null = sin mantenimiento abierto. */
  mantenimientoAbierto: {
    tipo: "reactivo" | "preventivo";
    motivo: string;
    duracionSegundos: number;
  } | null;

  /** Proyección de calidad. null cuando no existe orden (sección oculta). */
  calidad: {
    estado: "buena_racha" | "alerta";
    porcentaje: number;
  } | null;

  /** Resumen del turno. Siempre presente. */
  resumenTiempo: {
    totalDisponible: number;
    planificado: number;
    incidencias: number;
    productivo: number;
  };
}

const ICONO_ESTADO: Record<DashboardHomeProps["estadoMaquina"], string> = {
  andando: "▶",
  parada: "⏸",
  ociosa: "—",
};

const TEXTO_ESTADO: Record<DashboardHomeProps["estadoMaquina"], string> = {
  andando: "ANDANDO",
  parada: "PARADA",
  ociosa: "OCIOSA",
};

function formatearDuracion(segundos: number): string {
  const mins = Math.round(segundos / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function formatoPorcentaje(porcentaje: number): string {
  return `${(porcentaje * 100).toFixed(1)}%`;
}

export function DashboardHome({
  estadoMaquina,
  paradaAbierta,
  mantenimientoAbierto,
  calidad,
  resumenTiempo,
}: DashboardHomeProps) {
  const causa = paradaAbierta?.causa || "Causa desconocida";

  // Refresco periódico de duraciones acumuladas (30 s). Pattern from MantenimientoSection.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="dashboard-home" role="status" aria-label="Estado de la máquina" data-testid="dashboard-home">
      {/* 1. Estado de la máquina */}
      <p className={`dashboard-home__estado dashboard-home__estado--${estadoMaquina}`}>
        {ICONO_ESTADO[estadoMaquina]} {TEXTO_ESTADO[estadoMaquina]}
      </p>

      {/* 2. Parada abierta */}
      {paradaAbierta && (
        <p className="dashboard-home__parada">
          {ICONO_ESTADO.parada} PARADA — {causa} · {formatearDuracion(paradaAbierta.duracionSegundos)}
        </p>
      )}

      {/* 3. Mantenimiento abierto */}
      {mantenimientoAbierto && (
        <p className="dashboard-home__mantenimiento">
          🔧 Mantenimiento {mantenimientoAbierto.tipo} — {mantenimientoAbierto.motivo} ·{" "}
          {formatearDuracion(mantenimientoAbierto.duracionSegundos)}
        </p>
      )}

      {/* 4. Calidad (solo si hay orden) */}
      {calidad && (
        <p className="dashboard-home__calidad">
          {calidad.estado === "buena_racha" ? "Buena racha" : "Alerta"} ·{" "}
          {formatoPorcentaje(calidad.porcentaje)}
        </p>
      )}

      {/* 5. Resumen de tiempo (siempre visible) */}
      <dl className="dashboard-home__tiempo">
        <div className="dashboard-home__bucket">
          <dt>Tiempo disponible</dt>
          <dd data-testid="dashboard-home_disponible">
            {formatearDuracion(resumenTiempo.totalDisponible)}
          </dd>
        </div>
        <div className="dashboard-home__bucket">
          <dt>Planificado</dt>
          <dd data-testid="dashboard-home_planificado">
            {formatearDuracion(resumenTiempo.planificado)}
          </dd>
        </div>
        <div className="dashboard-home__bucket">
          <dt>Incidencias</dt>
          <dd data-testid="dashboard-home_incidencias">
            {formatearDuracion(resumenTiempo.incidencias)}
          </dd>
        </div>
        <div className="dashboard-home__bucket">
          <dt>Productivo</dt>
          <dd data-testid="dashboard-home_productivo">
            {formatearDuracion(resumenTiempo.productivo)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
