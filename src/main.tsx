/**
 * Ticket 10.8 — Composition root (startup)
 *
 * Orden de arranque (decidido en 10.8, sin provider/container/framework):
 *   1. initDatabase()                       — infraestructura SQLite (10.1)
 *   2. repositorios SQLite                  — orden/jornada/lecturas (10.3-10.6)
 *   3. materializarPrograma(...)            — fuente externa → SQLite, idempotente
 *   4. recoverPhase1State(...)              — reconstruye jornada + orden + lecturas
 *   5. render(<App ...>)                    — con el estado YA resuelto
 * Cualquier fallo de 1-4 renderiza una pantalla explícita de inicialización
 * fallida: la app NUNCA monta con estado parcial. Paradas y actividades siguen
 * en memoria (tickets posteriores).
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { InMemoryParadaRepository } from "./store/inMemoryParadasRepository";
import { InMemoryActividadPlanificadaRepository } from "./store/inMemoryActividadesRepository";
import { initDatabase } from "./store/sqlite/database";
import { SqliteOrderRepository } from "./store/sqlite/sqliteOrderRepository";
import { SqliteJornadaRepository } from "./store/sqlite/sqliteJornadaRepository";
import { SqliteLecturaGolpeRepository } from "./store/sqlite/sqliteLecturaGolpeRepository";
import { materializarPrograma } from "./store/sqlite/materialize";
import { recoverPhase1State } from "./store/sqlite/recovery";
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

    // 2. Repositorios SQLite (10.3 / 10.4 / 10.5-10.6).
    const repository = new SqliteOrderRepository(db);
    const jornadaRepository = new SqliteJornadaRepository(db);
    const lecturaRepository = new SqliteLecturaGolpeRepository(db);

    // 3. Materialización de la fuente externa: solo inserta lo que falta
    //    (fixtures hoy, programación semanal externa mañana). Va ANTES del
    //    recovery para que la orden materializada sea visible para él.
    await materializarPrograma(repository, crearFixtureOrdenes());

    // 4. Recovery: jornada + orden + lecturas ya persistidas.
    const estadoInicial = await recoverPhase1State(
      jornadaRepository,
      repository,
      lecturaRepository,
      fechaOperativaHoy(),
    );

    // 5. Render con el estado YA resuelto (nunca una promesa).
    ReactDOM.createRoot(contenedor).render(
      <React.StrictMode>
        <App
          repository={repository}
          jornadaRepository={jornadaRepository}
          lecturaRepository={lecturaRepository}
          estadoInicial={estadoInicial}
          paradaRepository={new InMemoryParadaRepository([])}
          actividadRepository={new InMemoryActividadPlanificadaRepository([])}
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
