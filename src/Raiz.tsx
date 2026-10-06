/**
 * Raiz — raíz de composición, dueña del día operativo (CHANGE 2, DD4/DD5)
 *
 * `main.tsx` conserva el arranque tal cual (pasos 1-4: base, los OCHO
 * repositorios, materialización y recovery del día de hoy) y delega el paso 5
 * en este componente: desde el render, el día seleccionado vive ACÁ, no en un
 * reloj leído en cada render.
 *
 * Módulo nuevo y exportado a propósito (tarea 6.1): no puede vivir dentro de
 * `main.tsx`, porque ese módulo llama `void main()` al importarse — un test que
 * lo importara de ahí re-ejecutaría todo el arranque.
 */
import { useState } from "react";
import App from "./App";
import type { IOrderRepository, ILecturaGolpeRepository } from "./store/repository";
import type { IJornadaRepository } from "./store/jornadaRepository";
import type { IParadaRepository } from "./store/paradasRepository";
import type { IActividadPlanificadaRepository } from "./store/actividadesRepository";
import type { IDanoRepository } from "./store/danosRepository";
import type { IMantenimientoRepository } from "./store/mantenimientoRepository";
import type { IInspeccionRepository } from "./store/inspeccionRepository";
import { recoverPersistedState, type RecoveryState } from "./store/sqlite/recovery";

/** Los OCHO repositorios que el arranque construye UNA sola vez (10.8). */
export interface LosOchosRepositorios {
  repository: IOrderRepository;
  jornadaRepository: IJornadaRepository;
  lecturaRepository: ILecturaGolpeRepository;
  paradaRepository: IParadaRepository;
  actividadRepository: IActividadPlanificadaRepository;
  danoRepository: IDanoRepository;
  mantenimientoRepository: IMantenimientoRepository;
  inspeccionRepository: IInspeccionRepository;
}

export interface RaizProps {
  /** Los ocho puertos, construidos UNA vez en `main()`. */
  repos: LosOchosRepositorios;
  /** Recovery del arranque, ya resuelto, para `fechaOperativaInicial`. */
  estadoInicial: RecoveryState;
  /** `fechaOperativaHoy()` leído en el arranque: el día con que pinta la vista. */
  fechaOperativaInicial: string;
}

export function Raiz({ repos, estadoInicial, fechaOperativaInicial }: RaizProps) {
  // UN solo valor de estado: el día y sus datos no pueden desacordarse (DD5).
  const [vista, setVista] = useState<{ fechaOperativa: string; estado: RecoveryState }>(
    () => ({ fechaOperativa: fechaOperativaInicial, estado: estadoInicial }),
  );
  const [cargando, setCargando] = useState(false);
  const [errorDia, setErrorDia] = useState<string | null>(null);

  async function seleccionarDia(fechaOperativa: string): Promise<void> {
    // Idempotente (H:112-117): re-elegir el día en pantalla ni siquiera consulta;
    // con una carga en vuelo no se apila una segunda.
    if (fechaOperativa === vista.fechaOperativa || cargando) return;
    setCargando(true);
    setErrorDia(null); // cada intento limpia el error anterior: es reintentable
    try {
      // Las MISMAS ocho fuentes, la misma máquina y las mismas instancias que el
      // arranque — solo cambia el día (H:105-110). "M1" explícito (ADR 0003),
      // igual que lo pasa `main.tsx` en su paso 4.
      const estado = await recoverPersistedState(
        repos.jornadaRepository,
        repos.repository,
        repos.lecturaRepository,
        repos.paradaRepository,
        repos.actividadRepository,
        repos.danoRepository,
        repos.mantenimientoRepository,
        repos.inspeccionRepository,
        fechaOperativa,
        "M1",
      );
      // Atómico: el día y sus datos cambian juntos y SOLO tras resolverse.
      setVista({ fechaOperativa, estado });
    } catch (error) {
      // FALLO VISIBLE (design §5.2): la promesa rechazada se consume acá — nada
      // escapa como unhandled rejection — y `vista` NO se toca, así la selección
      // y los datos en pantalla siguen de acuerdo. El recovery sigue rechazando;
      // solo este llamador atrapa. `errorDia` lo renderiza App (tarea 7.7) como
      // `<p className="selector-dia__error" role="alert">` junto al navegador.
      setErrorDia(error instanceof Error ? error.message : String(error));
    } finally {
      setCargando(false);
    }
  }

  return (
    <App
      /* `key`: cambiar de día DESMONTA App (DD5) — App siembra diez useState desde
         `estadoInicial`, sin remount las filas del día anterior sobrevivirían hasta
         que los loaders asíncronos resuelvan. */
      key={vista.fechaOperativa}
      {...repos}
      estadoInicial={vista.estado}
      fechaOperativa={vista.fechaOperativa}
      onSeleccionarDia={seleccionarDia}
      cargandoDia={cargando}
      errorCambioDia={errorDia}
      fechaOperativaHoy={fechaOperativaInicial}
    />
  );
}
