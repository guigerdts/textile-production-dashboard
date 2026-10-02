/**
 * Ticket 10.8 / G1 — Composition root (startup)
 *
 * Orden de arranque (decidido en 10.8, sin provider/container/framework):
 *   1. initDatabase()                       — infraestructura SQLite (10.1)
 *   2. repositorios SQLite                  — OCHO: orden/jornada/lecturas
 *      (10.3-10.6) + paradas/actividades/daños/inspecciones/mantenimientos
 *      (adaptadores sobre la migración 004), construidos UNA sola vez
 *   3. materializarPrograma(...)            — fuente externa → SQLite, idempotente
 *   4. recoverPersistedState(...)           — las OCHO fuentes persistidas:
 *      jornada, orden, lecturas, paradas, actividades, daños, mantenimientos
 *      e inspecciones (orden de lectura D2e, secuencial)
 *   5. render(<Raiz ...>)                   — con el estado YA resuelto
 * Cualquier fallo de 1-4 renderiza una pantalla explícita de inicialización
 * fallida: la app NUNCA monta con estado parcial.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { Raiz } from "./Raiz";
import { initDatabase } from "./store/sqlite/database";
import { SqliteOrderRepository } from "./store/sqlite/sqliteOrderRepository";
import { SqliteJornadaRepository } from "./store/sqlite/sqliteJornadaRepository";
import { SqliteLecturaGolpeRepository } from "./store/sqlite/sqliteLecturaGolpeRepository";
import { SqliteParadaRepository } from "./store/sqlite/sqliteParadaRepository";
import { SqliteActividadPlanificadaRepository } from "./store/sqlite/sqliteActividadPlanificadaRepository";
import { SqliteDanoRepository } from "./store/sqlite/sqliteDanoRepository";
import { SqliteInspeccionTelaRepository } from "./store/sqlite/sqliteInspeccionTelaRepository";
import { SqliteMantenimientoRepository } from "./store/sqlite/sqliteMantenimientoRepository";
import { materializarPrograma } from "./store/sqlite/materialize";
import { recoverPersistedState } from "./store/sqlite/recovery";
import { crearFixtureOrdenes, fechaOperativaHoy } from "./store/fixtures";

/** Mensaje legible de un fallo de arranque (Error, string u otro valor lanzado). */
function mensajeDeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Pantalla local de inicialización fallida (ticket 10.8): se muestra cuando la
 * base, la materialización o el recovery fallan. El dashboard nunca renderiza
 * con estado parcial, y el mensaje va envuelto a mano en un try/catch porque un
 * fallo de render no debe volver a lanzarse.
 */
function InicializacionFallida({ message }: { message: string }) {
  return (
    <main className="app">
      <h1 className="app__titulo">No se pudo iniciar el dashboard</h1>
      <p role="alert" className="app__error">
        Error de inicialización: {message}
      </p>
      <p>El dashboard no se renderizó con datos parciales. Revise la base de datos y reinicie la aplicación.</p>
    </main>
  );
}

async function main(): Promise<void> {
  const contenedor = document.getElementById("root") as HTMLElement;
  try {
    // 1. Infraestructura SQLite (10.1).
    const db = await initDatabase();

    // 2. Repositorios SQLite (10.3 / 10.4 / 10.5-10.6 + los cinco adaptadores
    //    operativos de la migración 004): ocho instancias, construidas UNA vez.
    const repository = new SqliteOrderRepository(db);
    const jornadaRepository = new SqliteJornadaRepository(db);
    const lecturaRepository = new SqliteLecturaGolpeRepository(db);
    const paradaRepository = new SqliteParadaRepository(db);
    const actividadRepository = new SqliteActividadPlanificadaRepository(db);
    const danoRepository = new SqliteDanoRepository(db);
    const mantenimientoRepository = new SqliteMantenimientoRepository(db);
    const inspeccionRepository = new SqliteInspeccionTelaRepository(db);

    // 3. Materialización de la fuente externa: solo inserta lo que falta
    //    (fixtures hoy, programación semanal externa mañana). Va ANTES del
    //    recovery para que la orden materializada sea visible para él.
    await materializarPrograma(repository, crearFixtureOrdenes());

    // 4. Recovery: las OCHO fuentes ya persistidas — jornada, orden, lecturas,
    //    paradas, actividades, daños, mantenimientos e inspecciones (D2e:
    //    secuencial y fijo). "M1" es la máquina única (ADR 0003), pasada como
    //    parámetro explícito (D2f), nunca hardcodeada dentro del recovery.
    const estadoInicial = await recoverPersistedState(
      jornadaRepository,
      repository,
      lecturaRepository,
      paradaRepository,
      actividadRepository,
      danoRepository,
      mantenimientoRepository,
      inspeccionRepository,
      fechaOperativaHoy(),
      "M1",
    );

    // 5. Render con el estado YA resuelto (nunca una promesa).
    ReactDOM.createRoot(contenedor).render(
      <React.StrictMode>
        <Raiz
          repos={{
            repository,
            jornadaRepository,
            lecturaRepository,
            paradaRepository,
            actividadRepository,
            danoRepository,
            mantenimientoRepository,
            inspeccionRepository,
          }}
          estadoInicial={estadoInicial}
          fechaOperativaInicial={fechaOperativaHoy()}
        />
      </React.StrictMode>,
    );
  } catch (error) {
    // 6. Fallo de inicialización: pantalla explícita; App NO monta.
    try {
      ReactDOM.createRoot(contenedor).render(
        <InicializacionFallida message={mensajeDeError(error)} />,
      );
    } catch (renderError) {
      console.error("No se pudo renderizar la pantalla de error de inicialización", renderError);
    }
  }
}

void main();
