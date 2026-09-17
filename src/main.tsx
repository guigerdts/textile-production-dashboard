import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { InMemoryOrderRepository } from "./store/inMemoryRepository";
import { InMemoryParadaRepository } from "./store/inMemoryParadasRepository";
import { InMemoryActividadPlanificadaRepository } from "./store/inMemoryActividadesRepository";
import { InMemoryJornadaRepository } from "./store/inMemoryJornadaRepository";

// Repositorios in-memory: las órdenes vienen sembradas por fixtures; paradas y
// actividades arrancan vacías para no interferir con el flujo de órdenes.
const repository = new InMemoryOrderRepository();
const paradaRepository = new InMemoryParadaRepository([]);
const actividadRepository = new InMemoryActividadPlanificadaRepository([]);
const jornadaRepository = new InMemoryJornadaRepository([]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App
      repository={repository}
      paradaRepository={paradaRepository}
      actividadRepository={actividadRepository}
      jornadaRepository={jornadaRepository}
    />
  </React.StrictMode>,
);
