import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { InMemoryOrderRepository } from "./store/inMemoryRepository";
import { InMemoryParadaRepository } from "./store/inMemoryParadasRepository";
import { InMemoryActividadPlanificadaRepository } from "./store/inMemoryActividadesRepository";
import { InMemoryJornadaRepository } from "./store/inMemoryJornadaRepository";
import { InMemoryDanoRepository } from "./store/inMemoryDanosRepository";
import { InMemoryInspeccionRepository } from "./store/inMemoryInspeccionRepository";
import {
  DANO_1_CERRADO_CON_PARADA,
  DANO_2_CERRADO_SIN_PARADA,
  DANO_3_ABIERTO,
  DANO_4_SIN_ORDEN_CERRADO,
} from "./store/danosFixtures";
import { FECHA_CON_ORDEN, FECHA_SIN_ORDEN } from "./store/fixtures";
import { P1, P2, P4_ABIERTA } from "./store/paradasFixtures";
import {
  A1_LIMPIEZA_CERRADA,
  A2_CAMBIO_CERRADO,
  A3_LIMPIEZA_ABIERTA,
} from "./store/actividadesFixtures";
import { finalizarProduccion, iniciarProduccion, registrarLectura } from "./domain/calculations";
import { validarFinalizacionConParadas, validarLecturaConParadas } from "./domain/paradas";
import {
  getItemsChecklist,
  registrarDevolucion,
  registrarInspeccion,
} from "./domain/inspeccionTela";
import type { ActividadPlanificada, InspeccionTela, Mantenimiento, Orden } from "./domain/types";
import type { Parada, ParadaAbierta } from "./domain/types";
import type { Dano } from "./domain/types";
import type { RecoveryState } from "./store/sqlite/recovery";
import { InMemoryMantenimientoRepository } from "./store/inMemoryMantenimientoRepository";
import {
  MANT_1_REACTIVO_CON_DANO_CERRADO,
  MANT_2_REACTIVO_SIN_DANO_CERRADO,
  MANT_4_ABIERTO,
} from "./store/mantenimientoFixtures";
import { registrarMantenimiento } from "./domain/mantenimiento";
import { jornadaDefault } from "./domain/tiempo";
import type { OrderAvailable } from "./ui/OrderAvailable";
import type { OrderInProduction } from "./ui/OrderInProduction";

/**
 * Seam de captura de props (tarea 8.8). `App` compone los 15 handlers de escritura en
 * las props que le pasa a las vistas de orden; sobre un día pasado NINGÚN control del DOM
 * los alcanza (los gates de 8.2–8.6 ocultan los controles), así que las llamadas directas
 * se hacen sobre estas props capturadas — design §11: "handler-guard cases call the
 * handlers directly, not through the DOM".
 *
 * `vi.hoisted` porque el factory de `vi.mock` se eleva por encima de los imports: la
 * variable tiene que existir ANTES de que el módulo simulado se evalúe. Los wrappers
 * re-renderizan el componente real, así que el DOM de las demás pruebas no cambia.
 */
const propsVistas = vi.hoisted(() => ({
  ordenDisponible: null as unknown,
  ordenEnProduccion: null as unknown,
}));

vi.mock("./ui/OrderAvailable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ui/OrderAvailable")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    OrderAvailable: (props: Parameters<typeof actual.OrderAvailable>[0]) => {
      propsVistas.ordenDisponible = props;
      return createElement(actual.OrderAvailable, props);
    },
  };
});

vi.mock("./ui/OrderInProduction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ui/OrderInProduction")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    OrderInProduction: (props: Parameters<typeof actual.OrderInProduction>[0]) => {
      propsVistas.ordenEnProduccion = props;
      return createElement(actual.OrderInProduction, props);
    },
  };
});


/**
 * Renderiza App y descarga la carga asíncrona de la orden
 * (IOrderRepository es async desde el ticket 10.4).
 */
async function mountApp(ui: ReactElement) {
  render(ui);
  await act(async () => {});
}

async function renderApp(hoy: string) {
  return await mountApp(<App repository={new InMemoryOrderRepository()} hoy={hoy} fechaOperativaHoy={hoy} />);
}

async function renderAppConActividades(hoy: string, actividadRepository?: InMemoryActividadPlanificadaRepository) {
  return await mountApp(
    <App
      repository={new InMemoryOrderRepository()}
      actividadRepository={actividadRepository ?? new InMemoryActividadPlanificadaRepository([])}
      hoy={hoy} fechaOperativaHoy={hoy}
    />,
  );
}

/** Robusto ante doble render de desarrollo de React: acepta texto que aparece una o más veces. */
function expectTexto(texto: string | RegExp) {
  expect(screen.getAllByText(texto).length).toBeGreaterThan(0);
}

/**
 * Cada test de este archivo monta la App real en jsdom y, en varios casos, la opera
 * con `userEvent` (escritura carácter a carácter). Ese trabajo es CPU puro —aquí
 * no entra SQLite— y bajo la suite en paralelo compite por CPU con los demás
 * archivos: en máquinas lentas puede superar el `testTimeout` por defecto de 5 s
 * sin que haya un fallo real. Por eso los tests de UI llevan un límite explícito
 * y cómodo, igual que en `persistence-integration.test.ts`.
 */
const UI_TIMEOUT = 30_000;

describe("App — ciclo 1: shell, día vacío y orden disponible", () => {
  it("muestra la fecha operativa actual", async () => {
    await renderApp(FECHA_CON_ORDEN);
    expectTexto(`Fecha operativa: ${FECHA_CON_ORDEN}`);
  }, UI_TIMEOUT);

  it("día vacío: sin orden para la fecha no hay acciones de orden, sí hay actividades planificadas", async () => {
    await renderApp(FECHA_SIN_ORDEN);
    expectTexto(/No hay orden asignada para hoy/i);
    // sin acciones de orden: no hay formulario de inicio ni selector de fecha
    expect(screen.queryByRole("button", { name: /Iniciar producción/i })).toBeNull();
    expect(screen.queryByLabelText(/fecha/i)).toBeNull();
    // las actividades planificadas sí están disponibles en día vacío
    expect(screen.getByTestId("actividades")).toBeTruthy();
  }, UI_TIMEOUT);

  it("orden disponible: OP-101 (sin segunda) muestra todos los datos, objetivo = solicitadas", async () => {
    await renderApp(FECHA_CON_ORDEN);
    expectTexto("OP-101");
    expectTexto("Jessie");
    expectTexto("T-100");
    expectTexto("reactiva");
    // sin proyección: solicitadas 2.400 y objetivo 2.400 coinciden (aparecen al menos 2 veces)
    expect(screen.getAllByText("2.400").length).toBeGreaterThanOrEqual(2);
    expectTexto(/No aplica/i);
    expectTexto("800 golpes");
    expectTexto("Disponible");
  }, UI_TIMEOUT);

  it("orden disponible: OP-102 (con segunda al 5%) muestra porcentaje y objetivo proyectado", async () => {
    await renderApp("2026-09-15");
    expectTexto("OP-102");
    expectTexto("Palm");
    expectTexto("T-200");
    expectTexto("pigmento");
    expectTexto("3.600");
    expectTexto(/Aplica/i);
    expectTexto("5.0%");
    expectTexto("3.780");
    expectTexto("1.260 golpes");
  }, UI_TIMEOUT);
});

describe("App — ciclo 2: iniciar producción", () => {
  async function iniciar(
    repo: InMemoryOrderRepository,
    { operario = "Laura", lectura = "100" }: { operario?: string; lectura?: string } = {},
  ) {
    const user = userEvent.setup();
    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);
    if (operario) await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), operario);
    if (lectura) await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), lectura);
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
  }

  it("inicio exitoso: muestra la orden en producción con 0 golpes / 0 unidades", async () => {
    const repo = new InMemoryOrderRepository();
    await iniciar(repo);
    expectTexto("En producción");
    expectTexto("Laura");
    expectTexto("100");
    expectTexto("0 golpes / 0 unidades");
  }, UI_TIMEOUT);

  it("inicio exitoso: registra los datos correctamente en el repositorio", async () => {
    const repo = new InMemoryOrderRepository();
    await iniciar(repo, { operario: "Laura", lectura: "100" });
    const guardada = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    expect(guardada.estado).toBe("in_production");
    expect(guardada.operatorName).toBe("Laura");
    expect(guardada.contadorBase).toBe(100);
    expect(typeof guardada.iniciadaEn).toBe("string");
    expect(guardada.lecturas).toHaveLength(1);
    expect(guardada.lecturas[0].deltaGolpes).toBe(0);
  }, UI_TIMEOUT);

  it("operador vacío: no inicia y muestra el error del dominio", async () => {
    const repo = new InMemoryOrderRepository();
    await iniciar(repo, { operario: "" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expectTexto("operatorName es obligatorio");
    expect((await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!.estado).toBe("available");
  }, UI_TIMEOUT);

  it("lectura negativa: no inicia y muestra el error del dominio", async () => {
    const repo = new InMemoryOrderRepository();
    await iniciar(repo, { lectura: "-1" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!.estado).toBe("available");
  }, UI_TIMEOUT);

  it("orden ya iniciada: no muestra el formulario ni el botón", async () => {
    const repo = new InMemoryOrderRepository();
    const op101 = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const res = iniciarProduccion(op101, { operatorName: "Ana", lecturaInicial: 50, timestamp: "2026-09-11T07:00:00.000Z" });
    if (!res.orden) throw new Error("precondition failed");
    await repo.saveOrder(res.orden);

    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);
    expectTexto("En producción");
    expectTexto("Ana");
    expect(screen.queryByRole("button", { name: /Iniciar producción/i })).toBeNull();
  }, UI_TIMEOUT);

  it("orden finalizada: muestra la vista finalizada sin botones de acción", async () => {
    const repo = new InMemoryOrderRepository();
    const op101 = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(op101, { operatorName: "Ana", lecturaInicial: 50, timestamp: "2026-09-11T07:00:00.000Z" });
    if (!iniciada.orden) throw new Error("precondition failed");
    const finalizada = finalizarProduccion(iniciada.orden, "2026-09-11T12:00:00.000Z");
    if (!finalizada.orden) throw new Error("precondition failed");
    await repo.saveOrder(finalizada.orden);

    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);
    expectTexto("Finalizada");
    expect(screen.queryByRole("button", { name: /Iniciar producción/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Finalizar producción/i })).toBeNull();
  }, UI_TIMEOUT);
});

describe("App — ciclo 3: registrar lecturas posteriores", () => {
  async function iniciarYRegistrar(
    repo: InMemoryOrderRepository,
    lecturaInicial: string,
    nuevaLectura: string,
  ) {
    const user = userEvent.setup();
    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), lecturaInicial);
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    await user.type(screen.getByRole("spinbutton", { name: /nueva lectura/i }), nuevaLectura);
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));
  }

  it("lectura mayor: acumula golpes, deriva unidades y actualiza restantes", async () => {
    const repo = new InMemoryOrderRepository();
    await iniciarYRegistrar(repo, "100", "106");
    expectTexto("En producción");
    expectTexto("6 golpes / 18 unidades");
    // OP-101 sin segunda: objetivo 2.400 -> restantes 2.400-18=2.382; golpes 800-6=794
    expectTexto("2.382 unidades");
    expectTexto("794 golpes");
    expectTexto("Última lectura");
    const guardada = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    expect(guardada.lecturas).toHaveLength(2);
    expect(guardada.lecturas[1]).toMatchObject({ valor: 106, deltaGolpes: 6 });
  }, UI_TIMEOUT);

  it("lectura igual: delta 0, no suma producción y avisa sin incremento", async () => {
    const repo = new InMemoryOrderRepository();
    await iniciarYRegistrar(repo, "100", "100");
    expectTexto("Sin incremento desde la última lectura");
    expectTexto("0 golpes / 0 unidades");
    const guardada = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    expect(guardada.lecturas).toHaveLength(2);
    expect(guardada.lecturas[1]).toEqual(
      expect.objectContaining({ valor: 100, deltaGolpes: 0 }),
    );
  }, UI_TIMEOUT);

  it("lectura menor: rechaza con error del dominio y no muta la producción", async () => {
    const repo = new InMemoryOrderRepository();
    await iniciarYRegistrar(repo, "100", "99");
    expect(screen.getByRole("alert")).toBeTruthy();
    expectTexto("el contador no puede retroceder");
    expectTexto("0 golpes / 0 unidades");
    const guardada = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    expect(guardada.lecturas).toHaveLength(1);
    expect(guardada.estado).toBe("in_production");
  }, UI_TIMEOUT);

  it("orden finalizada: no muestra el formulario de lectura", async () => {
    const repo = new InMemoryOrderRepository();
    const op101 = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(op101, { operatorName: "Ana", lecturaInicial: 50, timestamp: "2026-09-11T07:00:00.000Z" });
    if (!iniciada.orden) throw new Error("precondition failed");
    const finalizada = finalizarProduccion(iniciada.orden, "2026-09-11T12:00:00.000Z");
    if (!finalizada.orden) throw new Error("precondition failed");
    await repo.saveOrder(finalizada.orden);

    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /nueva lectura/i })).toBeNull();
  }, UI_TIMEOUT);

  it("orden disponible: no muestra el formulario de lectura", async () => {
    await renderApp(FECHA_CON_ORDEN);
    expect(screen.getByRole("button", { name: /Iniciar producción/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /nueva lectura/i })).toBeNull();
  }, UI_TIMEOUT);
});

describe("App — ticket 02: paradas / incidencias (UI)", () => {
  afterEach(async () => {
    vi.useRealTimers();
  });

  async function iniciarOP101(opciones: { paradas?: ParadaAbierta[] } = {}) {
    const user = userEvent.setup();
    const repo = new InMemoryOrderRepository();
    const repoParadas = new InMemoryParadaRepository(opciones.paradas ?? []);
    await mountApp(<App repository={repo} paradaRepository={repoParadas} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    return { user, repo, repoParadas };
  }

  async function registrarParadaCausa(
    user: ReturnType<typeof userEvent.setup>,
    causaNombre: string | RegExp,
    campos: Record<string, string> = {},
    observaciones = "",
  ) {
    await user.selectOptions(
      screen.getByRole("combobox", { name: /causa de la parada/i }),
      screen.getByRole("option", { name: causaNombre }),
    );
    for (const [label, valor] of Object.entries(campos)) {
      await user.type(screen.getByLabelText(new RegExp(label, "i")), valor);
    }
    if (observaciones) {
      await user.type(screen.getByLabelText(/observaciones/i), observaciones);
    }
    await user.click(screen.getByRole("button", { name: /Registrar parada/i }));
  }

  it("registra una parada con causa y muestra la parada activa", async () => {
    const { user } = await iniciarOP101();
    await registrarParadaCausa(user, "Falta de color / tinta", { Color: "Rojo" });
    const activa = screen.getByTestId("parada-activa");
    expect(activa.textContent).toContain("Falta de color / tinta");
    expect(screen.getByRole("button", { name: /Cerrar parada/i })).toBeTruthy();
  }, UI_TIMEOUT);

  it("muestra la duración acumulada de la parada abierta y guarda el operario", async () => {
    // Congelamos el reloj ANTES del montaje: la UI computa la duración
    // acumulada desde el dominio (CRITICAL: duración a la vista).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T09:30:00.000Z"));
    const repo = new InMemoryOrderRepository();
    const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(base, {
      operatorName: "Laura",
      lecturaInicial: 100,
      timestamp: "2026-09-11T08:00:00.000Z",
    }).orden!;
    await repo.saveOrder(iniciada);
    const abierta: ParadaAbierta = {
      id: "par-activa-1",
      maquinaId: "M1",
      ordenId: iniciada.id,
      operatorName: "Laura",
      causaId: "atasco_tela",
      camposEspecificos: {},
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
    };
    const repoParadas = new InMemoryParadaRepository([abierta]);
    await mountApp(<App repository={repo} paradaRepository={repoParadas} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);

    const activa = screen.getByTestId("parada-activa");
    expect(activa.textContent).toContain("Atasco o rotura de tela en la máquina");
    expect(activa.textContent).toMatch(/desde las/);
    // 09:30 - 09:00 = 30 min
    expect(activa.textContent).toContain("30 min");
    // El registro lleva el operario de la orden (CRITICAL: parada con operario).
    expect((await repoParadas.getParadaAbierta("M1", iniciada.id))?.operatorName).toBe("Laura");
  }, UI_TIMEOUT);

  it("registra una parada con carro para rotura de cuadro", async () => {
    const { user } = await iniciarOP101();
    await registrarParadaCausa(user, "Rotura o deterioro del cuadro", { carro: "3" });
    expect(screen.getByTestId("parada-activa").textContent).toContain("Rotura o deterioro del cuadro");
  }, UI_TIMEOUT);

  it("muestra campos dinámicos solo para la causa elegida", async () => {
    const { user } = await iniciarOP101();
    expect(screen.queryByLabelText(/Color/i)).toBeNull();
    await user.selectOptions(
      screen.getByRole("combobox", { name: /causa de la parada/i }),
      screen.getByRole("option", { name: "Daño mecánico en carro" }),
    );
    expect(screen.getByLabelText(/Número de carro/i)).toBeTruthy();
    // label exacto del campo dinámico de la causa (no "Componente afectado" de daños)
    expect(screen.getByLabelText("Componente")).toBeTruthy();
    expect(screen.queryByLabelText(/Color/i)).toBeNull();
  }, UI_TIMEOUT);

  it("causa «otro» exige observación y muestra el error del dominio", async () => {
    const { user } = await iniciarOP101();
    await registrarParadaCausa(user, /Otro/, {}, "");
    expect(screen.getByRole("alert")).toBeTruthy();
    expectTexto(/si la causa es "Otro"/);
    expect(screen.queryByTestId("parada-activa")).toBeNull();
  }, UI_TIMEOUT);

  it("cierra la parada activa y habilita nuevamente lecturas y finalización", async () => {
    const { user } = await iniciarOP101();
    await registrarParadaCausa(user, "Falta de color / tinta", { Color: "Rojo" });
    expect(screen.getByTestId("parada-activa")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Registrar lectura/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /Finalizar producción/i }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: /Cerrar parada/i }));
    expect(screen.queryByTestId("parada-activa")).toBeNull();
    expect(screen.getByRole("button", { name: /Registrar lectura/i }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: /Finalizar producción/i }).hasAttribute("disabled")).toBe(false);
  }, UI_TIMEOUT);

  it("muestra el historial de paradas cerradas", async () => {
    const { user } = await iniciarOP101();
    await registrarParadaCausa(user, "Falta de color / tinta", { Color: "Rojo" });
    await user.click(screen.getByRole("button", { name: /Cerrar parada/i }));
    expectTexto("Historial de paradas");
    expectTexto(/Falta de color \/ tinta/);
  }, UI_TIMEOUT);

  it("una parada abierta de la orden bloquea registrar lecturas", async () => {
    const { user } = await iniciarOP101();
    await registrarParadaCausa(user, "Falta de color / tinta", { Color: "Rojo" });
    expect(screen.getByRole("spinbutton", { name: /nueva lectura/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /Registrar lectura/i }).hasAttribute("disabled")).toBe(true);
  }, UI_TIMEOUT);

  it("una parada abierta de la orden bloquea finalizar (dominio + UI)", async () => {
    const { user, repo, repoParadas } = await iniciarOP101();
    await registrarParadaCausa(user, "Falta de color / tinta", { Color: "Rojo" });
    // UI deshabilitada + aviso
    expect(screen.getByRole("button", { name: /Finalizar producción/i }).hasAttribute("disabled")).toBe(true);
    expectTexto(/detenida por una parada activa/i);
    // Dominio rechaza aunque se registre la parada en el repositorio
    const ordenId = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!.id;
    const abierta = await repoParadas.getParadaAbierta("M1", ordenId);
    expect(abierta).not.toBeNull();
    expect(validarFinalizacionConParadas([abierta!], ordenId).length).toBeGreaterThan(0);
    expect(validarLecturaConParadas([abierta!], ordenId).length).toBeGreaterThan(0);
  }, UI_TIMEOUT);

  it("una parada SIN orden no bloquea lecturas ni finalización", async () => {
    const paradaSinOrden: ParadaAbierta = {
      id: "par-sin-orden",
      maquinaId: "M1",
      ordenId: null,
      operatorName: "Luis Fernández",
      causaId: "atasco_tela",
      camposEspecificos: {},
      observaciones: "atascado",
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
    };
    const { user } = await iniciarOP101({ paradas: [paradaSinOrden] });
    // la parada sin orden NO genera banner de activa para la orden
    expect(screen.queryByTestId("parada-activa")).toBeNull();
    // lecturas habilitadas y registran producción
    await user.type(screen.getByRole("spinbutton", { name: /nueva lectura/i }), "106");
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));
    expectTexto("6 golpes / 18 unidades");
    // finalización habilitada
    await user.click(screen.getByRole("button", { name: /Finalizar producción/i }));
    expectTexto("Finalizada");
  }, UI_TIMEOUT);
});

describe("App — ciclo 4: finalización de orden", () => {
  async function iniciarParaFinalizar(lecturaInicial = "100") {
    const user = userEvent.setup();
    const repo = new InMemoryOrderRepository();
    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), lecturaInicial);
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    return { user, repo };
  }

  it("finalizar con cero golpes: muestra la vista finalizada con producción 0", async () => {
    const { user } = await iniciarParaFinalizar();
    await user.click(screen.getByRole("button", { name: /Finalizar producción/i }));
    expectTexto("Finalizada");
    expectTexto("0 golpes / 0 unidades");
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Finalizar producción/i })).toBeNull();
  }, UI_TIMEOUT);

  it("finalizar después de producir: muestra producción real", async () => {
    const { user } = await iniciarParaFinalizar();
    await user.type(screen.getByRole("spinbutton", { name: /nueva lectura/i }), "106");
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));
    await user.click(screen.getByRole("button", { name: /Finalizar producción/i }));
    expectTexto("Finalizada");
    expectTexto("6 golpes / 18 unidades");
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
  }, UI_TIMEOUT);

  it("registrar finalizadaEn en el repositorio", async () => {
    const { repo } = await iniciarParaFinalizar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Finalizar producción/i }));
    // otro user instance es innecesario pero por consistencia del helper ya tenemos el user del iniciarParaFinalizar
    // el click ya ocurrió arriba — verificamos el repo
    const guardada = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    expect(guardada.estado).toBe("finished");
    expect(typeof guardada.finalizadaEn).toBe("string");
    expect(guardada.finalizadaEn!.length).toBeGreaterThan(0);
  }, UI_TIMEOUT);

  it("transición in_production → finished: botones desaparecen y vista finalizada es inmutable", async () => {
    const { user } = await iniciarParaFinalizar();
    await user.type(screen.getByRole("spinbutton", { name: /nueva lectura/i }), "110");
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));
    await user.click(screen.getByRole("button", { name: /Finalizar producción/i }));
    expectTexto("Finalizada");
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Finalizar producción/i })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /nueva lectura/i })).toBeNull();
    expectTexto("10 golpes / 30 unidades");
  }, UI_TIMEOUT);

  it("resumen de lecturas visible en la vista finalizada", async () => {
    const { user } = await iniciarParaFinalizar();
    await user.type(screen.getByRole("spinbutton", { name: /nueva lectura/i }), "106");
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));
    await user.click(screen.getByRole("button", { name: /Finalizar producción/i }));
    expectTexto("Resumen de lecturas");
    expectTexto("Lectura 1");
    expectTexto("Lectura 2");
    // el resumen usa formato compuesto: "100 (base) — delta 0" y "106 — delta 6"
    expectTexto(/100 \(base\).*delta 0/);
    expectTexto(/106.*delta 6/);
  }, UI_TIMEOUT);
});

describe("App — ticket 03: actividades planificadas (UI)", () => {
  async function iniciarOP101ConActividades(repoActividades: InMemoryActividadPlanificadaRepository) {
    const user = userEvent.setup();
    const repo = new InMemoryOrderRepository();
    await mountApp(
      <App
        repository={repo}
        actividadRepository={repoActividades}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    return { user, repo, repoActividades };
  }

  async function seleccionarTipoActividad(
    user: ReturnType<typeof userEvent.setup>,
    tipoNombre: string | RegExp,
  ) {
    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de actividad/i }),
      screen.getByRole("option", { name: tipoNombre }),
    );
  }

  it("registra una limpieza en día vacío y muestra la actividad activa", async () => {
    const user = userEvent.setup();
    const repoActividades = new InMemoryActividadPlanificadaRepository([]);
    await renderAppConActividades(FECHA_SIN_ORDEN, repoActividades);

    await seleccionarTipoActividad(user, "Limpieza");
    await user.type(screen.getByLabelText(/qué se limpió/i), "mesa de estampado");
    await user.type(screen.getByLabelText(/operario de la actividad/i), "Laura");

    await user.click(screen.getByRole("button", { name: /Registrar actividad/i }));

    const activa = screen.getByTestId("actividad-abierta-limpieza");
    expect(activa.textContent).toContain("Limpieza");
    expect(activa.textContent).toMatch(/desde las/);
    expect((await repoActividades.getActividadAbierta("M1", "limpieza"))?.operatorName).toBe("Laura");
  }, UI_TIMEOUT);

  it("registra un cambio de diseño en orden disponible sin bloquear el inicio", async () => {
    const user = userEvent.setup();
    const repoActividades = new InMemoryActividadPlanificadaRepository([]);
    await renderAppConActividades(FECHA_CON_ORDEN, repoActividades);

    await seleccionarTipoActividad(user, "Cambio de diseño");
    await user.type(screen.getByLabelText(/operario de la actividad/i), "Carlos Gómez");
    await user.click(screen.getByRole("button", { name: /Registrar actividad/i }));

    expect(screen.getByTestId("actividad-abierta-cambio_diseno")).toBeTruthy();
    // la actividad abierta NO bloquea iniciar la orden
    expect(screen.getByRole("button", { name: /Iniciar producción/i }).hasAttribute("disabled")).toBe(false);
    expect((await repoActividades.getActividadAbierta("M1", "cambio_diseno"))?.operatorName).toBe(
      "Carlos Gómez",
    );
  }, UI_TIMEOUT);

  it(
    "registra una actividad en producción: no bloquea lecturas ni finalización",
    async () => {
      const repoActividades = new InMemoryActividadPlanificadaRepository([]);
      const { user } = await iniciarOP101ConActividades(repoActividades);

    // la sección de actividades está presente junto al flujo de producción
    await seleccionarTipoActividad(user, "Limpieza");
    await user.type(screen.getByLabelText(/qué se limpió/i), "cuadros y mesa");
    await user.click(screen.getByRole("button", { name: /Registrar actividad/i }));
    expect(screen.getByTestId("actividad-abierta-limpieza")).toBeTruthy();

    // la actividad abierta NO deshabilita lecturas ni finalización
    const botonLectura = screen.getByRole("button", { name: /Registrar lectura/i });
    expect(botonLectura.hasAttribute("disabled")).toBe(false);
    const botonFinalizar = screen.getByRole("button", { name: /Finalizar producción/i });
    expect(botonFinalizar.hasAttribute("disabled")).toBe(false);

    // y el flujo sigue funcionando
      await user.type(screen.getByRole("spinbutton", { name: /nueva lectura/i }), "106");
      await user.click(botonLectura);
      expectTexto("6 golpes / 18 unidades");
    },
    // UI de userEvent carácter a carácter: en máquinas lentas supera el timeout
    // por defecto de 5 s sin fallo real. Solo amplía el límite, no debilita aserciones.
    UI_TIMEOUT,
  );

  it("registra una actividad en orden finalizada y la muestra sin botones de orden", async () => {
    const repoActividades = new InMemoryActividadPlanificadaRepository([]);
    const repo = new InMemoryOrderRepository();
    const op101 = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(op101, {
      operatorName: "Ana",
      lecturaInicial: 50,
      timestamp: "2026-09-11T07:00:00.000Z",
    });
    if (!iniciada.orden) throw new Error("precondition failed");
    const finalizada = finalizarProduccion(iniciada.orden, "2026-09-11T12:00:00.000Z");
    if (!finalizada.orden) throw new Error("precondition failed");
    await repo.saveOrder(finalizada.orden);

    const user = userEvent.setup();
    await mountApp(
      <App
        repository={repo}
        actividadRepository={repoActividades}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );

    expectTexto("Finalizada");
    await seleccionarTipoActividad(user, "Cambio de diseño");
    await user.click(screen.getByRole("button", { name: /Registrar actividad/i }));
    expect(screen.getByTestId("actividad-abierta-cambio_diseno")).toBeTruthy();
    // sin acciones de orden en finalizada (solo las de actividades)
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Finalizar producción/i })).toBeNull();
  }, UI_TIMEOUT);

  it("«Qué se limpió» aparece solo para limpieza, y cambiar de tipo limpia el valor", async () => {
    const user = userEvent.setup();
    await renderAppConActividades(FECHA_SIN_ORDEN);

    // sin tipo elegido no hay campo de limpieza
    expect(screen.queryByLabelText(/qué se limpió/i)).toBeNull();

    await seleccionarTipoActividad(user, "Limpieza");
    const campoLimpieza = screen.getByLabelText(/qué se limpió/i);
    await user.type(campoLimpieza, "cuadros");

    // al cambiar de tipo el campo desaparece
    await seleccionarTipoActividad(user, "Cambio de diseño");
    expect(screen.queryByLabelText(/qué se limpió/i)).toBeNull();
  }, UI_TIMEOUT);

  it("limpieza y cambio de diseño pueden estar abiertos simultáneamente", async () => {
    const user = userEvent.setup();
    const repoActividades = new InMemoryActividadPlanificadaRepository([]);
    await renderAppConActividades(FECHA_SIN_ORDEN, repoActividades);

    await seleccionarTipoActividad(user, "Limpieza");
    await user.type(screen.getByLabelText(/qué se limpió/i), "mesa");
    await user.type(screen.getByLabelText(/operario de la actividad/i), "Laura");
    await user.click(screen.getByRole("button", { name: /Registrar actividad/i }));

    await seleccionarTipoActividad(user, "Cambio de diseño");
    await user.click(screen.getByRole("button", { name: /Registrar actividad/i }));

    expect(screen.getByTestId("actividad-abierta-limpieza")).toBeTruthy();
    expect(screen.getByTestId("actividad-abierta-cambio_diseno")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Cerrar actividad/i })).toHaveLength(2);
    expect(await repoActividades.getActividadAbierta("M1", "limpieza")).not.toBeNull();
    expect(await repoActividades.getActividadAbierta("M1", "cambio_diseno")).not.toBeNull();
  }, UI_TIMEOUT);

  it("cierra una actividad abierta y pasa al historial", async () => {
    const user = userEvent.setup();
    const repoActividades = new InMemoryActividadPlanificadaRepository([]);
    await renderAppConActividades(FECHA_SIN_ORDEN, repoActividades);

    await seleccionarTipoActividad(user, "Limpieza");
    await user.type(screen.getByLabelText(/qué se limpió/i), "mesa de estampado");
    await user.type(screen.getByLabelText(/operario de la actividad/i), "Laura");
    await user.click(screen.getByRole("button", { name: /Registrar actividad/i }));
    expect(screen.getByTestId("actividad-abierta-limpieza")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Cerrar actividad/i }));

    expect(screen.queryByTestId("actividad-abierta-limpieza")).toBeNull();
    expect(await repoActividades.getActividadAbierta("M1", "limpieza")).toBeNull();
    expectTexto("Historial de actividades");
    expectTexto(/Limpieza/);
  }, UI_TIMEOUT);

  it("el historial muestra las actividades cerradas preexistentes de la máquina", async () => {
    const repoActividades = new InMemoryActividadPlanificadaRepository([
      A1_LIMPIEZA_CERRADA,
      A2_CAMBIO_CERRADO,
    ]);
    await renderAppConActividades(FECHA_CON_ORDEN, repoActividades);

    expectTexto("Historial de actividades");
    expectTexto(/Limpieza/);
    expectTexto(/Cambio de diseño/);
    expectTexto(/mesa de estampado/);
  }, UI_TIMEOUT);

  it("el martes sugiere «Limpieza estándar (7:00–8:00)» editable, sin restringir el registro", async () => {
    const user = userEvent.setup();
    const repoActividades = new InMemoryActividadPlanificadaRepository([]);
    // 2026-09-15 es martes: la sugerencia es SOLO UI (editable, no crea nada, no valida)
    await renderAppConActividades("2026-09-15", repoActividades);

    await seleccionarTipoActividad(user, "Limpieza");
    const campo = screen.getByLabelText(/qué se limpió/i);
    expect((campo as HTMLInputElement).value).toBe("Limpieza estándar (7:00–8:00)");
    expect(campo.hasAttribute("disabled")).toBe(false);

    // el operario aún no está prellenado en día vacío; guarda la actividad con la sugerencia editable
    await user.type(screen.getByLabelText(/operario de la actividad/i), "Laura");
    await user.click(screen.getByRole("button", { name: /Registrar actividad/i }));

    const abierta = await repoActividades.getActividadAbierta("M1", "limpieza");
    expect(abierta?.queSeLimpio).toBe("Limpieza estándar (7:00–8:00)");
  }, UI_TIMEOUT);

  it("registrar limpieza en día que no es martes funciona sin sugerencia (no restrictivo)", async () => {
    const user = userEvent.setup();
    const repoActividades = new InMemoryActividadPlanificadaRepository([]);
    // 2026-09-11 es viernes: sin sugerencia, pero la limpieza es registrable igual
    await renderAppConActividades(FECHA_CON_ORDEN, repoActividades);

    await seleccionarTipoActividad(user, "Limpieza");
    const campo = screen.getByLabelText(/qué se limpió/i);
    expect((campo as HTMLInputElement).value).toBe("");
    await user.type(campo, "limpieza programada fuera de martes");
    await user.type(screen.getByLabelText(/operario de la actividad/i), "Sofía Ramírez");
    await user.click(screen.getByRole("button", { name: /Registrar actividad/i }));

    expect(screen.getByTestId("actividad-abierta-limpieza")).toBeTruthy();
    expect((await repoActividades.getActividadAbierta("M1", "limpieza"))?.queSeLimpio).toBe(
      "limpieza programada fuera de martes",
    );
  }, UI_TIMEOUT);

  it("una actividad abierta de la máquina no bloquea finalizar la orden", async () => {
    const repoActividades = new InMemoryActividadPlanificadaRepository([A3_LIMPIEZA_ABIERTA]);
    const { user } = await iniciarOP101ConActividades(repoActividades);

    // la actividad abierta preexistente no genera bloqueo sobre la orden
    expect(screen.getByTestId("actividad-abierta-limpieza")).toBeTruthy();
    const botonFinalizar = screen.getByRole("button", { name: /Finalizar producción/i });
    expect(botonFinalizar.hasAttribute("disabled")).toBe(false);

    await user.click(botonFinalizar);
    expectTexto("Finalizada");
    // la actividad sigue abierta al finalizar la orden (no se cierra sola ni bloquea)
    expect((await repoActividades.getActividadAbierta("M1", "limpieza"))?.id).toBe(A3_LIMPIEZA_ABIERTA.id);
  }, UI_TIMEOUT);

  it("dentro del banner de actividad activa: cerrar, y errores de cierre se muestran ahí", async () => {
    const user = userEvent.setup();
    const repoActividades = new InMemoryActividadPlanificadaRepository([]);
    await renderAppConActividades(FECHA_SIN_ORDEN, repoActividades);

    await seleccionarTipoActividad(user, "Limpieza");
    await user.type(screen.getByLabelText(/qué se limpió/i), "mesa");
    await user.type(screen.getByLabelText(/operario de la actividad/i), "Laura");
    await user.click(screen.getByRole("button", { name: /Registrar actividad/i }));

    // el botón de cierre vive DENTRO del banner
    const banner = screen.getByTestId("actividad-abierta-limpieza");
    const botonCerrar = within(banner).getByRole("button", { name: /Cerrar actividad/i });
    await user.click(botonCerrar);
    expect(screen.queryByTestId("actividad-abierta-limpieza")).toBeNull();
  }, UI_TIMEOUT);
});

describe("App — ticket 04: resumen del turno (UI)", () => {
  async function renderAppConTiempo(
    hoy: string,
    opciones: {
      paradaRepository?: InMemoryParadaRepository;
      actividadRepository?: InMemoryActividadPlanificadaRepository;
      jornadaRepository?: InMemoryJornadaRepository;
    } = {},
  ) {
    return await mountApp(
      <App
        repository={new InMemoryOrderRepository()}
        paradaRepository={opciones.paradaRepository ?? new InMemoryParadaRepository([])}
        actividadRepository={
          opciones.actividadRepository ?? new InMemoryActividadPlanificadaRepository([])
        }
        jornadaRepository={opciones.jornadaRepository ?? new InMemoryJornadaRepository([])}
        hoy={hoy} fechaOperativaHoy={hoy}
      />,
    );
  }

  /** Verifica los 4 buckets del resumen: disponible, planificado, incidencias, productivo. */
  function expectBuckets(
    disponible: string,
    planificado: string,
    incidencias: string,
    productivo: string,
  ) {
    expect(screen.getByTestId("resumen-tiempo_disponible").textContent).toBe(disponible);
    expect(screen.getByTestId("resumen-tiempo_planificado").textContent).toBe(planificado);
    expect(screen.getByTestId("resumen-tiempo_incidencias").textContent).toBe(incidencias);
    expect(screen.getByTestId("resumen-tiempo_productivo").textContent).toBe(productivo);
  }

  it("día vacío: muestra el resumen del turno con la jornada default y buckets en cero", async () => {
    await renderAppConTiempo(FECHA_SIN_ORDEN);

    const resumen = screen.getByTestId("resumen-tiempo");
    expectTexto("Resumen del turno");
    // jornada default 07:00–17:00 → 10 h disponibles
    expectBuckets("10 h", "0 min", "0 min", "10 h");
    // el productivo es derivado: NO hay entrada manual de productivo
    expect(within(resumen).queryByRole("spinbutton", { name: /productivo/i })).toBeNull();
    expect(screen.queryByLabelText(/productivo/i)).toBeNull();
  }, UI_TIMEOUT);

  it("orden disponible: el resumen del turno se muestra junto a la orden", async () => {
    await renderAppConTiempo(FECHA_CON_ORDEN);

    expectTexto("Resumen del turno");
    expect(screen.getByTestId("resumen-tiempo")).toBeTruthy();
    expectBuckets("10 h", "0 min", "0 min", "10 h");
  }, UI_TIMEOUT);

  it("orden en producción: el resumen del turno se muestra tras iniciar", async () => {
    const user = userEvent.setup();
    await renderAppConTiempo(FECHA_CON_ORDEN);

    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));

    expectTexto("En producción");
    expect(screen.getByTestId("resumen-tiempo")).toBeTruthy();
  }, UI_TIMEOUT);

  it("orden finalizada: el resumen del turno se muestra sin campos de orden", async () => {
    const user = userEvent.setup();
    await renderAppConTiempo(FECHA_CON_ORDEN);

    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    await user.click(screen.getByRole("button", { name: /Finalizar producción/i }));

    expectTexto("Finalizada");
    expect(screen.getByTestId("resumen-tiempo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
  }, UI_TIMEOUT);

  it("buckets con una actividad (1 h) y una parada (15 min) de la máquina", async () => {
    const paradaRepository = new InMemoryParadaRepository([P1]); // 09:30–09:45
    const actividadRepository = new InMemoryActividadPlanificadaRepository([
      A1_LIMPIEZA_CERRADA, // 07:00–08:00
    ]);
    await renderAppConTiempo(FECHA_CON_ORDEN, { paradaRepository, actividadRepository });

    // jornada 07:00–17:00 = 10 h; planificado = 1 h; incidencias = 15 min;
    // sin solape → productivo = 10h − (1h + 15min) = 8 h 45 min
    expectBuckets("10 h", "1 h", "15 min", "8 h 45 min");
  }, UI_TIMEOUT);

  it("overtime: extender el fin de jornada aumenta el disponible y el productivo", async () => {
    const hoy = FECHA_CON_ORDEN;
    const jornadaRepository = new InMemoryJornadaRepository([]);
    await renderAppConTiempo(hoy, { jornadaRepository });

    // fin editable visible; default 17:00 → 10 h disponibles
    const inputFin = screen.getByLabelText(/fin de jornada \(overtime incluido\)/i) as HTMLInputElement;
    expectBuckets("10 h", "0 min", "0 min", "10 h");

    fireEvent.change(inputFin, { target: { value: "19:00" } });
    await userEvent.setup().click(screen.getByRole("button", { name: /Guardar fin de jornada/i }));

    // jornada extendida a 19:00 → 12 h disponibles y productivas
    expectBuckets("12 h", "0 min", "0 min", "12 h");
    expect((await jornadaRepository.obtenerParaFecha(hoy)).fin).toBe("2026-09-11T19:00:00.000Z");
  }, UI_TIMEOUT);

  it("fin de jornada inválido: el dominio rechaza y la UI muestra el error, sin mutar el repo", async () => {
    const hoy = FECHA_CON_ORDEN;
    const jornadaRepository = new InMemoryJornadaRepository([]);
    await renderAppConTiempo(hoy, { jornadaRepository });

    const inputFin = screen.getByLabelText(/fin de jornada \(overtime incluido\)/i) as HTMLInputElement;
    fireEvent.change(inputFin, { target: { value: "06:00" } });
    await userEvent.setup().click(screen.getByRole("button", { name: /Guardar fin de jornada/i }));

    expectTexto(/el fin de la jornada debe ser posterior al inicio/i);
    // el repositorio no persistió la jornada inválida
    expect((await jornadaRepository.obtenerParaFecha(hoy)).fin).toBe("2026-09-11T17:00:00.000Z");
  }, UI_TIMEOUT);

  it("el resumen del turno no muestra «no productivo total» (solo los 4 buckets principales)", async () => {
    await renderAppConTiempo(FECHA_CON_ORDEN);

    expect(screen.queryByText(/no productivo/i)).toBeNull();
  }, UI_TIMEOUT);
});

describe("App — ticket 05: daños / eventos (UI)", () => {
  // Sin timeout: el hook es síncrono e instantáneo. UI_TIMEOUT presupuesta los tests
  // de UI, no los hooks (los otros tres afterEach del archivo tampoco lo llevan).
  afterEach(async () => {
    vi.useRealTimers();
  });

  async function iniciarOP101ConDanos(opciones: { danos?: Dano[]; paradas?: ParadaAbierta[] } = {}) {
    const user = userEvent.setup();
    const repo = new InMemoryOrderRepository();
    const repoDanos = new InMemoryDanoRepository(opciones.danos ?? []);
    const repoParadas = new InMemoryParadaRepository(opciones.paradas ?? []);
    await mountApp(
      <App
        repository={repo}
        danoRepository={repoDanos}
        paradaRepository={repoParadas}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    return { user, repo, repoDanos, repoParadas };
  }

  it("registra un daño en producción con el operario precargado y muestra el daño activo", async () => {
    const { user, repoDanos } = await iniciarOP101ConDanos();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de daño/i }),
      screen.getByRole("option", { name: "Daño mecánico" }),
    );
    await user.type(screen.getByLabelText(/componente afectado/i), "eje trasero");
    await user.click(screen.getByRole("button", { name: /Registrar daño/i }));

    const activo = screen.getByTestId("dano-abierto");
    expect(activo.textContent).toContain("Daño activo:");
    expect(activo.textContent).toContain("eje trasero");
    const guardado = (await repoDanos.listarPorMaquina("M1"))[0]!;
    expect(guardado.tipo).toBe("mecanico");
    expect(guardado.operatorName).toBe("Laura");
  }, UI_TIMEOUT);

  it("sin tipo de daño: no registra y muestra el error del dominio", async () => {
    const { user, repoDanos } = await iniciarOP101ConDanos();

    await user.type(screen.getByLabelText(/componente afectado/i), "eje trasero");
    await user.click(screen.getByRole("button", { name: /Registrar daño/i }));

    expect(screen.getByRole("alert").textContent).toContain("debe seleccionar un tipo de daño");
    expect(await repoDanos.listarPorMaquina("M1")).toHaveLength(0);
  }, UI_TIMEOUT);

  it("registra un daño que causó parada y lo vincula a la parada abierta de la orden", async () => {
    // Congelamos el reloj ANTES del montaje: el daño inicia en el submit y la parada
    // sembrada debe comenzar no antes que el daño (relación temporal del dominio).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T09:30:00.000Z"));

    const repo = new InMemoryOrderRepository();
    const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(base, {
      operatorName: "Laura",
      lecturaInicial: 100,
      timestamp: "2026-09-11T08:00:00.000Z",
    }).orden!;
    await repo.saveOrder(iniciada);

    const paradaAbierta: ParadaAbierta = {
      id: "par-activa-danio",
      maquinaId: "M1",
      ordenId: iniciada.id,
      operatorName: "Laura",
      causaId: "danio_mecanico",
      camposEspecificos: {},
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T09:30:00.000Z",
      fin: null,
    };
    const repoParadas = new InMemoryParadaRepository([paradaAbierta]);
    const repoDanos = new InMemoryDanoRepository([]);
    await mountApp(
      <App
        repository={repo}
        paradaRepository={repoParadas}
        danoRepository={repoDanos}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );

    fireEvent.change(screen.getByLabelText(/tipo de daño/i), { target: { value: "mecanico" } });
    fireEvent.change(screen.getByLabelText(/componente afectado/i), { target: { value: "eje trasero" } });
    fireEvent.click(screen.getByLabelText(/este daño causó una parada/i));
    fireEvent.change(screen.getByLabelText(/parada vinculada/i), { target: { value: "par-activa-danio" } });
    // El submit del daño es un handler async (persiste y refresca el estado):
    // con reloj falso no podemos usar user.click, así que envolvemos en act async
    // para drenar las microtareas del handler antes de leer el repositorio.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Registrar daño/i }));
    });

    const guardado = (await repoDanos.listarPorMaquina("M1"))[0]!;
    expect(guardado.causoParada).toBe(true);
    expect(guardado.paradaId).toBe("par-activa-danio");
    expect(screen.getByTestId("dano-abierto").textContent).toContain("eje trasero");
  }, UI_TIMEOUT);

  it("causó parada pero no indica la parada vinculada: error del dominio", async () => {
    const { user, repoDanos } = await iniciarOP101ConDanos();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de daño/i }),
      screen.getByRole("option", { name: "Daño mecánico" }),
    );
    await user.type(screen.getByLabelText(/componente afectado/i), "eje trasero");
    await user.click(screen.getByLabelText(/este daño causó una parada/i));
    await user.click(screen.getByRole("button", { name: /Registrar daño/i }));

    expect(screen.getByRole("alert").textContent).toContain(
      "si el daño causó una parada, debe indicar la parada vinculada",
    );
    expect(await repoDanos.listarPorMaquina("M1")).toHaveLength(0);
  }, UI_TIMEOUT);

  it("registra sospecha de segunda con unidades: muestra el campo solo al marcar la sospecha", async () => {
    const { user, repoDanos } = await iniciarOP101ConDanos();

    expect(screen.queryByLabelText(/unidades sospechadas/i)).toBeNull();
    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de daño/i }),
      screen.getByRole("option", { name: "Daño mecánico" }),
    );
    await user.type(screen.getByLabelText(/componente afectado/i), "eje trasero");
    await user.click(screen.getByLabelText(/posible segunda/i));
    await user.type(screen.getByLabelText(/unidades sospechadas/i), "3");
    await user.click(screen.getByRole("button", { name: /Registrar daño/i }));

    const guardado = (await repoDanos.listarPorMaquina("M1"))[0]!;
    expect(guardado.posibleSegunda).toBe(true);
    expect(guardado.unidadesSospechadas).toBe(3);
  }, UI_TIMEOUT);

it("cierra el daño activo con solución aplicada y lo mueve al historial", async () => {
  // Reloj congelado: el form de cierre precarga el fin al montar y el daño inicia
  // en el submit; congelado, fin (montaje) >= inicio (submit) en vez de quedar
  // anterior por los milisegundos reales entre ambos (el dominio lo rechaza).
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T09:30:00.000Z"));

  const repo = new InMemoryOrderRepository();
  const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
  const iniciada = iniciarProduccion(base, {
    operatorName: "Laura",
    lecturaInicial: 100,
    timestamp: "2026-09-11T08:00:00.000Z",
  }).orden!;
  await repo.saveOrder(iniciada);
  const repoDanos = new InMemoryDanoRepository([]);
  await mountApp(
    <App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />,
  );

  fireEvent.change(screen.getByLabelText(/tipo de daño/i), { target: { value: "mecanico" } });
  fireEvent.change(screen.getByLabelText(/componente afectado/i), { target: { value: "eje trasero" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Registrar daño/i }));
  });
  expect(screen.getByTestId("dano-abierto")).toBeTruthy();

  // el cierre del daño EXIGE fin + solución; prellenado el fin con ahora, se indica la solución
  fireEvent.change(screen.getByLabelText(/solución aplicada/i), {
    target: { value: "Cambio de eje y lubricación" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Cerrar daño/i }));
  });

  expect(screen.queryByTestId("dano-abierto")).toBeNull();
  const guardado = (await repoDanos.listarPorMaquina("M1"))[0]!;
  expect(guardado.fin).not.toBeNull();
  expect(guardado.solucionAplicada).toBe("Cambio de eje y lubricación");
  expectTexto("Historial de daños");
}, UI_TIMEOUT);

it("cierra sin solución aplicada: error del dominio", async () => {
  // Mismo reloj congelado: el único error debe ser la solución faltante (el fin
  // precargado es coherente con el inicio del daño).
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T09:30:00.000Z"));

  const repo = new InMemoryOrderRepository();
  const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
  const iniciada = iniciarProduccion(base, {
    operatorName: "Laura",
    lecturaInicial: 100,
    timestamp: "2026-09-11T08:00:00.000Z",
  }).orden!;
  await repo.saveOrder(iniciada);
  const repoDanos = new InMemoryDanoRepository([]);
  await mountApp(
    <App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />,
  );

  fireEvent.change(screen.getByLabelText(/tipo de daño/i), { target: { value: "mecanico" } });
  fireEvent.change(screen.getByLabelText(/componente afectado/i), { target: { value: "eje trasero" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Registrar daño/i }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Cerrar daño/i }));
  });

  expect(screen.getByRole("alert").textContent).toContain("debe indicar la solución aplicada");
  expect((await repoDanos.listarPorMaquina("M1"))[0]!.fin).toBeNull();
}, UI_TIMEOUT);

  it("un daño abierto preexistente de la máquina bloquea registrar otro", async () => {
    // DANO_3_ABIERTO es de la máquina M1 (aunque de otra orden): el invariante
    // operativo es uno abierto por máquina.
    const { user } = await iniciarOP101ConDanos({ danos: [DANO_3_ABIERTO] });

    expect(screen.getByTestId("dano-abierto").textContent).toContain("tablero de control");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de daño/i }),
      screen.getByRole("option", { name: "Daño mecánico" }),
    );
    await user.type(screen.getByLabelText(/componente afectado/i), "eje trasero");
    await user.click(screen.getByRole("button", { name: /Registrar daño/i }));

    expect(screen.getByRole("alert").textContent).toContain(
      "ya hay un daño abierto para la máquina",
    );
  }, UI_TIMEOUT);

  it("historial con daños cerrados sembrados en orden disponible", async () => {
    const repo = new InMemoryOrderRepository();
    const repoDanos = new InMemoryDanoRepository([
      DANO_1_CERRADO_CON_PARADA,
      DANO_2_CERRADO_SIN_PARADA,
    ]);
    await mountApp(<App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);

    expectTexto("Historial de daños");
    expectTexto(/Daño mecánico en eje trasero/);
    expectTexto(/— causó parada/);
    expectTexto(/Daño operacional en manguera de tinta/);
    expectTexto(/posible 2da \(3 uds\)/);
  }, UI_TIMEOUT);

  it("orden finalizada: histórico de daños sin formulario de registro ni cierre", async () => {
    const repo = new InMemoryOrderRepository();
    const op101 = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(op101, {
      operatorName: "Ana",
      lecturaInicial: 50,
      timestamp: "2026-09-11T07:00:00.000Z",
    }).orden!;
    const finalizada = finalizarProduccion(iniciada, "2026-09-11T12:00:00.000Z").orden!;
    await repo.saveOrder(finalizada);
    const repoDanos = new InMemoryDanoRepository([
      DANO_1_CERRADO_CON_PARADA,
      DANO_2_CERRADO_SIN_PARADA,
    ]);
    await mountApp(<App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);

    expectTexto("Finalizada");
    expectTexto("Historial de daños");
    expectTexto(/Daño mecánico en eje trasero/);
    expect(screen.queryByRole("button", { name: /Registrar daño/i })).toBeNull();
    expect(screen.queryByTestId("dano-abierto")).toBeNull();
  }, UI_TIMEOUT);
});

describe("App — ticket 06: bloque de proyección de 2da (UI)", () => {
  /** Inicia OP-101 sin producción (lectura inicial 100 = 0 golpes). */
  async function iniciarOP101ParaCalidad(opciones: { danos?: Dano[] } = {}) {
    const user = userEvent.setup();
    const repo = new InMemoryOrderRepository();
    const repoDanos = new InMemoryDanoRepository(opciones.danos ?? []);
    await mountApp(
      <App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />,
    );
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    return { user, repo, repoDanos };
  }

  /** Registra una lectura que produce `golpes` golpes (delta desde la última). */
  async function registrarLecturaCon(user: ReturnType<typeof userEvent.setup>, golpes: number) {
    const ultima = 100;
    await user.type(
      screen.getByRole("spinbutton", { name: /nueva lectura/i }),
      String(ultima + golpes),
    );
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));
  }

  function bloqueCalidad() {
    return within(screen.getByTestId("calidad-seccion"));
  }

  it("orden en producción sin producción aún: bloque con «—» (sin_datos), sin alerta", async () => {
    await iniciarOP101ParaCalidad();

    expectTexto("Proyección de 2da");
    const bloque = bloqueCalidad();
    expect(bloque.getAllByText("—").length).toBeGreaterThanOrEqual(2); // 2da proyectada y estado sin_datos
    expect(bloque.getByText(/5\s?%/)).toBeTruthy(); // meta de referencia del dominio
    expect(bloque.queryByText("Alerta")).toBeNull();
  }, UI_TIMEOUT);

  it("producción 300 uds sin sospechas: 0 % y buena racha", async () => {
    const { user } = await iniciarOP101ParaCalidad();
    await registrarLecturaCon(user, 100); // 100 golpes -> 300 unidades

    const bloque = bloqueCalidad();
    expect(bloque.getByText(/0\s?%/)).toBeTruthy();
    expect(bloque.getByText("Buena racha")).toBeTruthy();
    expect(bloque.getByText(/5\s?%/)).toBeTruthy();
  }, UI_TIMEOUT);

  it("sospechas bajo el umbral (3 uds en 300): 1 % y buena racha", async () => {
    const { user } = await iniciarOP101ParaCalidad({
      danos: [DANO_1_CERRADO_CON_PARADA], // ord-101, 3 uds sospechadas
    });
    await registrarLecturaCon(user, 100);

    const bloque = bloqueCalidad();
    expect(bloque.getByText(/1\s?%/)).toBeTruthy();
    expect(bloque.getByText("Buena racha")).toBeTruthy();
  }, UI_TIMEOUT);

  it("sospechas que superan el 3 %: alerta", async () => {
    const danoConMuchaSospecha: Dano = {
      ...DANO_1_CERRADO_CON_PARADA,
      id: "dan-t06-alerta",
      unidadesSospechadas: 12, // 12 / 300 = 4 % > 3 %
    };
    const { user } = await iniciarOP101ParaCalidad({ danos: [danoConMuchaSospecha] });
    await registrarLecturaCon(user, 100);

    const bloque = bloqueCalidad();
    expect(bloque.getByText(/4\s?%/)).toBeTruthy();
    expect(bloque.getByText("Alerta")).toBeTruthy();
  }, UI_TIMEOUT);

  it("la proyección es VIVA: nueva lectura recalcula y la alerta sube/baja sin recargar", async () => {
    const danoConMuchaSospecha: Dano = {
      ...DANO_1_CERRADO_CON_PARADA,
      id: "dan-t06-viva",
      unidadesSospechadas: 12, // con 300 uds -> 4 % (alerta)
    };
    const { user } = await iniciarOP101ParaCalidad({ danos: [danoConMuchaSospecha] });
    await registrarLecturaCon(user, 100);

    expect(bloqueCalidad().getByText("Alerta")).toBeTruthy();
    expect(bloqueCalidad().getByText(/4\s?%/)).toBeTruthy();

    // más producción: 12 / 600 = 2 % -> buena racha
    await user.type(screen.getByRole("spinbutton", { name: /nueva lectura/i }), "300");
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));

    expect(bloqueCalidad().getByText(/2\s?%/)).toBeTruthy();
    expect(bloqueCalidad().getByText("Buena racha")).toBeTruthy();
    expect(bloqueCalidad().queryByText("Alerta")).toBeNull();
  }, UI_TIMEOUT);

  it("daños de otra orden y sin orden NO se mezclan (solo cuentan los de esta orden)", async () => {
    const { user } = await iniciarOP101ParaCalidad({
      danos: [DANO_1_CERRADO_CON_PARADA, DANO_3_ABIERTO, DANO_4_SIN_ORDEN_CERRADO],
    });
    await registrarLecturaCon(user, 100);

    const bloque = bloqueCalidad();
    // DANO_1 (ord-101, 3 uds) es el único de esta orden: 3/300 = 1 %
    expect(bloque.getByText(/1\s?%/)).toBeTruthy();
    expect(bloque.getByText("Buena racha")).toBeTruthy();
  }, UI_TIMEOUT);

  it("sospecha sin unidades cuantificadas: se avisa sin inventar porcentaje", async () => {
    const danoSinUnidades: Dano = {
      ...DANO_2_CERRADO_SIN_PARADA,
      id: "dan-t06-sin-uds",
      ordenId: "ord-101",
      posibleSegunda: true,
      unidadesSospechadas: undefined, // sospecha cualitativa
    };
    const { user } = await iniciarOP101ParaCalidad({ danos: [danoSinUnidades] });
    await registrarLecturaCon(user, 100);

    const bloque = bloqueCalidad();
    expect(bloque.getByText(/0\s?%/)).toBeTruthy(); // sin unidades no mueve el pct
    expect(bloque.getByText(/1 daño con sospecha de 2da sin unidades cuantificadas/)).toBeTruthy();
  }, UI_TIMEOUT);

  it("el bloque NO bloquea: el formulario de lectura sigue operativo con alerta activa", async () => {
    const danoConMuchaSospecha: Dano = {
      ...DANO_1_CERRADO_CON_PARADA,
      id: "dan-t06-no-bloquea",
      unidadesSospechadas: 12,
    };
    const { user } = await iniciarOP101ParaCalidad({ danos: [danoConMuchaSospecha] });
    await registrarLecturaCon(user, 100);
    expect(bloqueCalidad().getByText("Alerta")).toBeTruthy();

    // el botón de lectura sigue habilitado y registra normalmente
    expect(
      screen.getByRole("button", { name: /Registrar lectura/i }).hasAttribute("disabled"),
    ).toBe(false);
    await user.type(screen.getByRole("spinbutton", { name: /nueva lectura/i }), "300");
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));
    expect(bloqueCalidad().getByText(/2\s?%/)).toBeTruthy();
  }, UI_TIMEOUT);

  it("orden finalizada: bloque histórico con los datos de cierre", async () => {
    const repo = new InMemoryOrderRepository();
    const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(base, {
      operatorName: "Ana",
      lecturaInicial: 100,
      timestamp: "2026-09-11T07:00:00.000Z",
    }).orden!;
    const conLectura = registrarLectura(iniciada, {
      valor: 200,
      timestamp: "2026-09-11T09:00:00.000Z",
    }).orden!;
    const finalizada = finalizarProduccion(conLectura, "2026-09-11T12:00:00.000Z").orden!;
    await repo.saveOrder(finalizada);
    const repoDanos = new InMemoryDanoRepository([DANO_1_CERRADO_CON_PARADA]);
    await mountApp(<App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);

    expectTexto("Finalizada");
    const bloque = bloqueCalidad();
    expect(bloque.getByText(/1\s?%/)).toBeTruthy(); // 3 uds sospechadas / 300 producidas
    expect(bloque.getByText("Buena racha")).toBeTruthy();
  }, UI_TIMEOUT);

  it("NO se muestra en orden disponible ni en día vacío", async () => {
    await renderApp(FECHA_CON_ORDEN); // available: OP-101 disponible
    expect(screen.queryByTestId("calidad-seccion")).toBeNull();

    await renderApp(FECHA_SIN_ORDEN); // día vacío
    expect(screen.queryByTestId("calidad-seccion")).toBeNull();
  }, UI_TIMEOUT);
});

describe("App — ticket 07: inspección de tela (UI)", () => {
  function seccionInspeccion() {
    return within(screen.getByTestId("inspeccion-tela-seccion"));
  }

  /** Construye una inspección ya validada por el dominio (para sembrar el repo en pruebas).
   *  `itemAnomalia` es el ID del ítem del checklist (p. ej. "manchas", "tundido"). */
  function construirInspeccion(
    orden: Orden,
    { lote, itemAnomalia, timestamp }: { lote?: string; itemAnomalia?: string; timestamp: string },
  ): InspeccionTela {
    const res = registrarInspeccion(orden, {
      operatorName: "Ana",
      lote,
      items: getItemsChecklist().map((i) => ({
        id: i.id,
        estado: i.id === itemAnomalia ? ("anomalia" as const) : ("conforme" as const),
      })),
      timestamp,
    });
    if (!res.inspeccion) {
      throw new Error("no se pudo construir la inspección");
    }
    return res.inspeccion;
  }

  /** Inicia OP-101 con un repositorio de inspecciones inyectado. */
  async function iniciarOP101ConInspecciones(opciones: { inspecciones?: InspeccionTela[] } = {}) {
    const user = userEvent.setup();
    const repo = new InMemoryOrderRepository();
    const repoInspecciones = new InMemoryInspeccionRepository(opciones.inspecciones ?? []);
    await mountApp(
      <App
        repository={repo}
        inspeccionRepository={repoInspecciones}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    return { user, repo, repoInspecciones };
  }

  /** Registra una inspección desde la UI: lote opcional + un ítem con anomalía opcional + otra anomalía opcional. */
  async function registrarInspeccionUI(
    user: ReturnType<typeof userEvent.setup>,
    { lote = "", itemAnomalia, otraAnomalia = "" }: { lote?: string; itemAnomalia?: string; otraAnomalia?: string } = {},
  ) {
    const seccion = seccionInspeccion();
    if (lote) {
      await user.type(seccion.getByLabelText(/Lote \(opcional\)/i), lote);
    }
    if (itemAnomalia) {
      await user.click(seccion.getByRole("radio", { name: `${itemAnomalia}: Anomalía` }));
    }
    if (otraAnomalia) {
      await user.type(seccion.getByLabelText(/Otra anomalía \(opcional\)/i), otraAnomalia);
    }
    await user.click(seccion.getByRole("button", { name: /Registrar inspección/i }));
  }

  it("día vacío: NO hay sección de inspección de tela", async () => {
    await renderApp(FECHA_SIN_ORDEN);
    expect(screen.queryByTestId("inspeccion-tela-seccion")).toBeNull();
  }, UI_TIMEOUT);

  it("orden disponible: registra inspección todo conforme con lote y la persiste", async () => {
    const user = userEvent.setup();
    const repoInspecciones = new InMemoryInspeccionRepository([]);
    await mountApp(
      <App
        repository={new InMemoryOrderRepository()}
        inspeccionRepository={repoInspecciones}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );

    const seccion = seccionInspeccion();
    // operario editable: todavía no hay operario de orden
    expect(seccion.getByLabelText("Operario").hasAttribute("disabled")).toBe(false);

    await user.type(seccion.getByLabelText("Operario"), "Laura");
    await user.type(seccion.getByLabelText(/Lote \(opcional\)/i), "L-77");
    await user.click(seccion.getByRole("button", { name: /Registrar inspección/i }));

    // historial visible con estado conforme
    expect(seccion.getByText(/Lote: L-77/)).toBeTruthy();
    expect(seccion.getByText("Conforme")).toBeTruthy();

    const lista = await repoInspecciones.listarPorOrden("ord-101");
    expect(lista).toHaveLength(1);
    expect(lista[0].lote).toBe("L-77");
    expect(lista[0].operatorName).toBe("Laura");
    expect(lista[0].items.every((i) => i.estado === "conforme")).toBe(true);
  }, UI_TIMEOUT);

  it("producción: registra inspección con anomalía → No usable, con otra anomalía visible", async () => {
    const { user, repoInspecciones } = await iniciarOP101ConInspecciones();
    const seccion = seccionInspeccion();
    // operario precargado y bloqueado desde la orden
    expect(seccion.getByLabelText("Operario").hasAttribute("disabled")).toBe(true);
    expect((seccion.getByLabelText("Operario") as HTMLInputElement).value).toBe("Laura");

    await registrarInspeccionUI(user, {
      lote: "L-80",
      itemAnomalia: "Manchas",
      otraAnomalia: "manchas de aceite",
    });

    expect(seccion.getByText("No usable")).toBeTruthy();
    expect(seccion.getByText(/manchas de aceite/)).toBeTruthy();

    const lista = await repoInspecciones.listarPorOrden("ord-101");
    expect(lista).toHaveLength(1);
    expect(lista[0].lote).toBe("L-80");
    expect(lista[0].items.find((i) => i.id === "manchas")?.estado).toBe("anomalia");
    expect(lista[0].otraAnomalia).toBe("manchas de aceite");
  }, UI_TIMEOUT);

  it("múltiples inspecciones por orden: historial cronológico de 2 inspecciones", async () => {
    const { user } = await iniciarOP101ConInspecciones();
    await registrarInspeccionUI(user, { lote: "L-1" });
    await registrarInspeccionUI(user, { lote: "L-2", itemAnomalia: "Tundido" });

    const items = screen.getAllByTestId("inspeccion-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("L-1");
    expect(items[1].textContent).toContain("L-2");
  }, UI_TIMEOUT);

  it("producción con 0 golpes: la inspección con anomalía se resuelve con DEvolución", async () => {
    const { user, repoInspecciones } = await iniciarOP101ConInspecciones();
    await registrarInspeccionUI(user, { lote: "L-90", itemAnomalia: "Absorción" });

    // aún sin lecturas posteriores: producción derivada 0 → se ofrece devolución
    const item = within(screen.getAllByTestId("inspeccion-item")[0]);
    expect(item.getByRole("option", { name: "Devolución de tela" })).toBeTruthy();
    await user.selectOptions(
      item.getByLabelText(/Tipo de resolución/i),
      item.getByRole("option", { name: "Devolución de tela" }),
    );
    // "Registrada por" viene precargada con el operario de la orden
    await user.type(item.getByLabelText(/Motivo \(obligatorio\)/i), "absorción insuficiente");
    await user.click(item.getByRole("button", { name: /Resolver inspección/i }));

    expect(item.getByText("Devuelta")).toBeTruthy();
    expect(item.getByText(/absorción insuficiente/)).toBeTruthy();

    const guardada = (await repoInspecciones.listarPorOrden("ord-101"))[0];
    const resolucionDevolucion = guardada.resolucion;
    expect(resolucionDevolucion?.tipo).toBe("devolucion");
    if (resolucionDevolucion?.tipo !== "devolucion") {
      throw new Error("la inspección debería estar resuelta con devolución");
    }
    expect(resolucionDevolucion.motivo).toBe("absorción insuficiente");
    expect(resolucionDevolucion.registradaPor).toBe("Laura");
  }, UI_TIMEOUT);

  it("producción > 0: la devolución NO se ofrece (solo autorización de gerencia)", async () => {
    const { user } = await iniciarOP101ConInspecciones();
    // imprimir 10 golpes: lectura 100 → 130
    await user.type(screen.getByRole("spinbutton", { name: /nueva lectura/i }), "130");
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));

    await registrarInspeccionUI(user, { itemAnomalia: "Dimensiones / medidas" });

    const item = within(screen.getAllByTestId("inspeccion-item")[0]);
    expect(item.queryByRole("option", { name: "Devolución de tela" })).toBeNull();
    expect(item.getByRole("option", { name: "Autorización de gerencia" })).toBeTruthy();
  }, UI_TIMEOUT);

  it("autorización de gerencia: exige autorizadoPor y registra Uso autorizado", async () => {
    const { user, repoInspecciones } = await iniciarOP101ConInspecciones();
    await registrarInspeccionUI(user, { itemAnomalia: "Manchas", otraAnomalia: "manchas" });

    const item = within(screen.getAllByTestId("inspeccion-item")[0]);
    await user.selectOptions(
      item.getByLabelText(/Tipo de resolución/i),
      item.getByRole("option", { name: "Autorización de gerencia" }),
    );

    // sin autorizadoPor → error del dominio, no se resuelve
    await user.click(item.getByRole("button", { name: /Resolver inspección/i }));
    expect(item.getByRole("alert").textContent).toContain("autorizadoPor es obligatorio");
    expect((await repoInspecciones.listarPorOrden("ord-101"))[0].resolucion).toBeNull();

    // con autorizadoPor → éxito
    await user.type(item.getByLabelText(/Autorizado por \(obligatorio\)/i), "Gerencia");
    await user.click(item.getByRole("button", { name: /Resolver inspección/i }));

    expect(item.getByText("Uso autorizado")).toBeTruthy();
    const guardadaAutorizada = (await repoInspecciones.listarPorOrden("ord-101"))[0];
    const resolucionAutorizacion = guardadaAutorizada.resolucion;
    expect(resolucionAutorizacion?.tipo).toBe("autorizacion_gerencia");
    if (resolucionAutorizacion?.tipo !== "autorizacion_gerencia") {
      throw new Error("la inspección debería estar resuelta con autorización");
    }
    expect(resolucionAutorizacion.autorizadoPor).toBe("Gerencia");
  }, UI_TIMEOUT);

  it("inspección conforme: NO ofrece resolución", async () => {
    const { user } = await iniciarOP101ConInspecciones();
    await registrarInspeccionUI(user, { lote: "L-ok" });

    const item = within(screen.getAllByTestId("inspeccion-item")[0]);
    expect(item.queryByRole("button", { name: /Resolver inspección/i })).toBeNull();
    expect(item.queryByLabelText(/Tipo de resolución/i)).toBeNull();
  }, UI_TIMEOUT);

  it("inspección ya resuelta: no ofrece resolver de nuevo (una sola resolución)", async () => {
    const repo = new InMemoryOrderRepository();
    const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(base, {
      operatorName: "Laura",
      lecturaInicial: 100,
      timestamp: "2026-09-11T07:00:00.000Z",
    }).orden!;
    await repo.saveOrder(iniciada);

    const inspeccion = construirInspeccion(iniciada, {
      lote: "L-dev",
      itemAnomalia: "manchas",
      timestamp: "2026-09-11T07:30:00.000Z",
    });
    const devuelta = registrarDevolucion(iniciada, inspeccion, {
      motivo: "manchas de aceite",
      registradaPor: "Laura",
      timestamp: "2026-09-11T07:31:00.000Z",
    }).inspeccion!;
    const repoInspecciones = new InMemoryInspeccionRepository([devuelta]);
    await mountApp(
      <App
        repository={repo}
        inspeccionRepository={repoInspecciones}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );

    const item = within(screen.getAllByTestId("inspeccion-item")[0]);
    expect(item.getByText("Devuelta")).toBeTruthy();
    expect(item.queryByRole("button", { name: /Resolver inspección/i })).toBeNull();
    expect(item.queryByLabelText(/Tipo de resolución/i)).toBeNull();
  }, UI_TIMEOUT);

  it("orden finalizada: historial SOLO (sin registrar ni resolver)", async () => {
    const repo = new InMemoryOrderRepository();
    const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(base, {
      operatorName: "Ana",
      lecturaInicial: 100,
      timestamp: "2026-09-11T07:00:00.000Z",
    }).orden!;
    const conLectura = registrarLectura(iniciada, {
      valor: 200,
      timestamp: "2026-09-11T09:00:00.000Z",
    }).orden!;
    const finalizada = finalizarProduccion(conLectura, "2026-09-11T12:00:00.000Z").orden!;
    await repo.saveOrder(finalizada);

    const inspeccion = construirInspeccion(finalizada, {
      lote: "L-hist",
      itemAnomalia: "tundido",
      timestamp: "2026-09-11T08:00:00.000Z",
    });
    const repoInspecciones = new InMemoryInspeccionRepository([inspeccion]);
    await mountApp(
      <App
        repository={repo}
        inspeccionRepository={repoInspecciones}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );

    // historial presente con estado derivado
    const seccion = seccionInspeccion();
    expect(seccion.getByText(/Lote: L-hist/)).toBeTruthy();
    expect(seccion.getByText("No usable")).toBeTruthy();
    // sin formulario de registro ni resolución: historial SOLO
    expect(seccion.queryByRole("button", { name: /Registrar inspección/i })).toBeNull();
    expect(seccion.queryByRole("button", { name: /Resolver inspección/i })).toBeNull();
  }, UI_TIMEOUT);
});

describe("App — ticket 08: mantenimiento (UI)", () => {
  afterEach(async () => {
    vi.useRealTimers();
  });

  async function renderAppConMantenimiento(
    hoy: string,
    opciones: { mantenimientoRepository?: InMemoryMantenimientoRepository } = {},
  ) {
    return await mountApp(
      <App
        repository={new InMemoryOrderRepository()}
        mantenimientoRepository={opciones.mantenimientoRepository ?? new InMemoryMantenimientoRepository([])}
        hoy={hoy} fechaOperativaHoy={hoy}
      />,
    );
  }

  async function iniciarOP101ConMantenimiento(
    opciones: { mantenimientos?: Mantenimiento[] } = {},
  ) {
    const user = userEvent.setup();
    const repo = new InMemoryOrderRepository();
    const repoMantenimiento = new InMemoryMantenimientoRepository(opciones.mantenimientos ?? []);
    await mountApp(
      <App
        repository={repo}
        mantenimientoRepository={repoMantenimiento}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    return { user, repo, repoMantenimiento };
  }

  /** Registra un mantenimiento desde la UI con los campos dados. */
  async function registrarMantenimientoUI(
    user: ReturnType<typeof userEvent.setup>,
    campos: {
      tipo?: string;
      motivo?: string;
      queSeRevisoReparo?: string;
      danoVinculo?: string;
      observaciones?: string;
    } = {},
  ) {
    const tipo = campos.tipo ?? "Mantenimiento reactivo";
    const motivo = campos.motivo ?? "Reparación de emergencia";

    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de mantenimiento/i }),
      screen.getByRole("option", { name: tipo }),
    );
    await user.type(screen.getByLabelText(/motivo/i), motivo);

    if (campos.danoVinculo !== undefined) {
      await user.selectOptions(
        screen.getByRole("combobox", { name: /daño vinculado/i }),
        screen.getByRole("option", { name: campos.danoVinculo }),
      );
    }

    if (campos.queSeRevisoReparo) {
      await user.type(screen.getByLabelText(/qué se revisó o reparó/i), campos.queSeRevisoReparo);
    }

    if (campos.observaciones) {
      await user.type(screen.getByLabelText(/observaciones/i), campos.observaciones);
    }

    await user.click(screen.getByRole("button", { name: /Registrar mantenimiento/i }));
  }

  it("día vacío: muestra la sección de mantenimiento con formulario de registro", async () => {
    await renderAppConMantenimiento(FECHA_SIN_ORDEN);

    expect(screen.getByTestId("mantenimiento-seccion")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /tipo de mantenimiento/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Registrar mantenimiento/i })).toBeTruthy();
  }, UI_TIMEOUT);

  it("orden disponible: muestra la sección de mantenimiento con formulario", async () => {
    await renderAppConMantenimiento(FECHA_CON_ORDEN);

    expect(screen.getByTestId("mantenimiento-seccion")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /tipo de mantenimiento/i })).toBeTruthy();
  }, UI_TIMEOUT);

  it("orden en producción: muestra la sección de mantenimiento con formulario", async () => {
    await iniciarOP101ConMantenimiento();

    expect(screen.getByTestId("mantenimiento-seccion")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /tipo de mantenimiento/i })).toBeTruthy();
  }, UI_TIMEOUT);

  it("orden finalizada: muestra SOLO historial de mantenimiento, sin formulario de registro", async () => {
    const repo = new InMemoryOrderRepository();
    const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(base, {
      operatorName: "Ana",
      lecturaInicial: 50,
      timestamp: "2026-09-11T07:00:00.000Z",
    }).orden!;
    const finalizada = finalizarProduccion(iniciada, "2026-09-11T12:00:00.000Z").orden!;
    await repo.saveOrder(finalizada);

    const repoMantenimiento = new InMemoryMantenimientoRepository([]);
    await mountApp(
      <App
        repository={repo}
        mantenimientoRepository={repoMantenimiento}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );

    expect(screen.getByTestId("mantenimiento-seccion")).toBeTruthy();
    // No hay formulario de registro en orden finalizada
    expect(screen.queryByRole("combobox", { name: /tipo de mantenimiento/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar mantenimiento/i })).toBeNull();
  }, UI_TIMEOUT);

  it("registra un mantenimiento abierto (reactivo) y muestra el banner de activo", async () => {
    const { user, repoMantenimiento } = await iniciarOP101ConMantenimiento();

    await registrarMantenimientoUI(user, { motivo: "Fusible quemado" });

    const activo = screen.getByTestId("mantenimiento-abierto");
    expect(activo.textContent).toContain("Mantenimiento reactivo");
    expect(activo.textContent).toContain("Fusible quemado");
    expect(activo.textContent).toMatch(/desde las/);
    expect(await repoMantenimiento.getMantenimientoAbierto("M1")).not.toBeNull();
  }, UI_TIMEOUT);

  it("registra un mantenimiento completo en un solo paso (reactivo con queSeRevisoReparo)", async () => {
    // Patrón del codebase: pre-construir el mantenimiento con el dominio y sembrar el repo,
    // luego verificar que la UI lo muestra correctamente como cerrado.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T09:00:00.000Z"));

    const resultado = registrarMantenimiento([], {
      maquinaId: "M1",
      tipo: "reactivo",
      operatorName: "Laura",
      motivo: "Reparación de carro 3",
      inicio: new Date().toISOString(),
      fin: new Date().toISOString(),
      queSeRevisoReparo: "Cambio de rodamiento",
      fechaOperativa: "2026-09-11",
      danoId: null,
    }, () => undefined);
    if (!resultado.mantenimiento) throw new Error("precondition: dominio debería crear el mantenimiento");

    const repoMantenimiento = new InMemoryMantenimientoRepository([resultado.mantenimiento]);
    await renderAppConMantenimiento(FECHA_CON_ORDEN, { mantenimientoRepository: repoMantenimiento });

    // No hay mantenimiento abierto porque se registró completo
    expect(screen.queryByTestId("mantenimiento-abierto")).toBeNull();
    const guardados = await repoMantenimiento.listarPorMaquina("M1");
    expect(guardados).toHaveLength(1);
    expect(guardados[0].fin).not.toBeNull();
    expect(guardados[0].queSeRevisoReparo).toBe("Cambio de rodamiento");
    expectTexto("Historial de mantenimientos");
    expectTexto(/Reparación de carro 3/);
  }, UI_TIMEOUT);

  it("cierra un mantenimiento abierto con queSeRevisoReparo y pasa al historial", async () => {
    // Fake timers: el cierre usa `new Date()` y el fin debe ser >= inicio.
    // Se usa fireEvent en vez de userEvent para compatibilidad con fake timers.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T09:00:00.000Z"));

    const repo = new InMemoryOrderRepository();
    const repoMantenimiento = new InMemoryMantenimientoRepository([]);
    await mountApp(
      <App
        repository={repo}
        mantenimientoRepository={repoMantenimiento}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), { target: { value: "Laura" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /lectura inicial/i }), { target: { value: "100" } });
    // handleIniciar es async (ticket 10.4): act descarga la persistencia y el setOrden.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    });

    // Registrar abierto — handleRegistrarMantenimiento es async: act descarga la persistencia.
    fireEvent.change(screen.getByRole("combobox", { name: /tipo de mantenimiento/i }), { target: { value: "reactivo" } });
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: "Fusible quemado" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Registrar mantenimiento/i }));
    });
    expect(screen.getByTestId("mantenimiento-abierto")).toBeTruthy();

    // Avanzar el reloj para que fin > inicio
    vi.setSystemTime(new Date("2026-09-11T09:30:00.000Z"));

    // Cerrar — scoped al banner de mantenimiento abierto
    const abierto = screen.getByTestId("mantenimiento-abierto");
    fireEvent.change(within(abierto).getByLabelText(/qué se revisó/i), { target: { value: "Cambio de fusible" } });
    // handleCerrarMantenimiento es async: act descarga la persistencia y el setMantenimientos.
    await act(async () => {
      fireEvent.click(within(abierto).getByRole("button", { name: /Cerrar mantenimiento/i }));
    });

    expect(screen.queryByTestId("mantenimiento-abierto")).toBeNull();
    const guardados = await repoMantenimiento.listarPorMaquina("M1");
    expect(guardados[0].fin).not.toBeNull();
    expect(guardados[0].queSeRevisoReparo).toBe("Cambio de fusible");
  }, UI_TIMEOUT);

  it("cierra sin queSeRevisoReparo: error del dominio", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T09:00:00.000Z"));

    const repo = new InMemoryOrderRepository();
    const repoMantenimiento = new InMemoryMantenimientoRepository([]);
    await mountApp(
      <App
        repository={repo}
        mantenimientoRepository={repoMantenimiento}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), { target: { value: "Laura" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /lectura inicial/i }), { target: { value: "100" } });
    // handleIniciar es async (ticket 10.4): act descarga la persistencia y el setOrden.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    });

    // Registrar abierto — handleRegistrarMantenimiento es async: act descarga la persistencia.
    fireEvent.change(screen.getByRole("combobox", { name: /tipo de mantenimiento/i }), { target: { value: "reactivo" } });
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: "Fusible quemado" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Registrar mantenimiento/i }));
    });
    expect(screen.getByTestId("mantenimiento-abierto")).toBeTruthy();

    // Intentar cerrar sin queSeRevisoReparo — scoped al banner
    const abierto = screen.getByTestId("mantenimiento-abierto");
    // handleCerrarMantenimiento es async: act descarga la persistencia y el setErroresCierre.
    await act(async () => {
      fireEvent.click(within(abierto).getByRole("button", { name: /Cerrar mantenimiento/i }));
    });

    expect(screen.getByRole("alert").textContent).toContain("queSeRevisoReparo es obligatorio");
    expect(await repoMantenimiento.getMantenimientoAbierto("M1")).not.toBeNull();
  }, UI_TIMEOUT);

  it("tipo preventivo: NO muestra el selector de daño vinculado", async () => {
    const { user } = await iniciarOP101ConMantenimiento();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de mantenimiento/i }),
      screen.getByRole("option", { name: "Mantenimiento preventivo" }),
    );

    expect(screen.queryByRole("combobox", { name: /daño vinculado/i })).toBeNull();
  }, UI_TIMEOUT);

  it("tipo reactivo: muestra el selector de daño con opción Sin vínculo", async () => {
    const { user } = await iniciarOP101ConMantenimiento();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de mantenimiento/i }),
      screen.getByRole("option", { name: "Mantenimiento reactivo" }),
    );

    const selectorDanio = screen.getByRole("combobox", { name: /daño vinculado/i });
    expect(selectorDanio).toBeTruthy();
    expect(screen.getByRole("option", { name: "Sin vínculo" })).toBeTruthy();
  }, UI_TIMEOUT);

  it("ya hay un mantenimiento abierto: registrar otro muestra error del dominio", async () => {
    const { user } = await iniciarOP101ConMantenimiento({ mantenimientos: [MANT_4_ABIERTO] });

    // Ya hay un abierto (MANT_4_ABIERTO)
    expect(screen.getByTestId("mantenimiento-abierto")).toBeTruthy();

    // Intentar registrar otro
    await registrarMantenimientoUI(user, { motivo: "Otro problema" });

    expect(screen.getByRole("alert").textContent).toContain("ya hay un mantenimiento abierto");
  }, UI_TIMEOUT);

  it("historial cronológico de mantenimientos cerrados sembrados", async () => {
    const mantCerrado1: Mantenimiento = {
      id: "mnt-test-1",
      maquinaId: "M1",
      tipo: "reactivo",
      operatorName: "Carlos",
      motivo: "Fuga de tinta",
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T08:00:00.000Z",
      fin: "2026-09-11T08:20:00.000Z",
      queSeRevisoReparo: "Sellado",
      danoId: null,
    };
    const mantCerrado2: Mantenimiento = {
      id: "mnt-test-2",
      maquinaId: "M1",
      tipo: "preventivo",
      operatorName: "Sofía",
      motivo: "Preventivo semanal",
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T10:00:00.000Z",
      fin: "2026-09-11T10:30:00.000Z",
      queSeRevisoReparo: "Limpieza general",
      danoId: null,
    };
    const repoMantenimiento = new InMemoryMantenimientoRepository([mantCerrado1, mantCerrado2]);
    await renderAppConMantenimiento(FECHA_CON_ORDEN, { mantenimientoRepository: repoMantenimiento });

    expectTexto("Historial de mantenimientos");
    expectTexto(/Fuga de tinta/);
    expectTexto(/Preventivo semanal/);
  }, UI_TIMEOUT);

  it("el operario se precarga desde la orden en producción", async () => {
    await iniciarOP101ConMantenimiento();

    const seccion = screen.getByTestId("mantenimiento-seccion");
    const operarioInput = within(seccion).getByLabelText(/operario/i) as HTMLInputElement;
    expect(operarioInput.value).toBe("Laura");
  }, UI_TIMEOUT);

  it("sin tipo: no registra y muestra error del dominio", async () => {
    const { user, repoMantenimiento } = await iniciarOP101ConMantenimiento();

    // No seleccionar tipo, solo motivo
    await user.type(screen.getByLabelText(/motivo/i), "Algo");
    await user.click(screen.getByRole("button", { name: /Registrar mantenimiento/i }));

    expect(screen.getByRole("alert").textContent).toContain("debe seleccionar un tipo");
    expect(await repoMantenimiento.listarPorMaquina("M1")).toHaveLength(0);
  }, UI_TIMEOUT);

  it("sin motivo: no registra y muestra error del dominio", async () => {
    const { user, repoMantenimiento } = await iniciarOP101ConMantenimiento();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de mantenimiento/i }),
      screen.getByRole("option", { name: "Mantenimiento reactivo" }),
    );
    // No escribir motivo
    await user.click(screen.getByRole("button", { name: /Registrar mantenimiento/i }));

    expect(screen.getByRole("alert").textContent).toContain("el motivo es obligatorio");
    expect(await repoMantenimiento.listarPorMaquina("M1")).toHaveLength(0);
  }, UI_TIMEOUT);

  it("mantenimiento abierto preexistente se muestra en la sección", async () => {
    const repoMantenimiento = new InMemoryMantenimientoRepository([MANT_4_ABIERTO]);
    await renderAppConMantenimiento(FECHA_CON_ORDEN, { mantenimientoRepository: repoMantenimiento });

    const activo = screen.getByTestId("mantenimiento-abierto");
    expect(activo.textContent).toContain("Mantenimiento reactivo");
    expect(activo.textContent).toContain("Fusible quemado");
  }, UI_TIMEOUT);
});

// ---------------------------------------------------------------------------
// Ticket 09-02 — DashboardHome integration tests
// ---------------------------------------------------------------------------

describe("App — ticket 09: DashboardHome", () => {
  it("renderiza DashboardHome en día vacío (OCIOSA)", async () => {
    await renderApp(FECHA_SIN_ORDEN);
    expect(screen.getByTestId("dashboard-home")).toBeTruthy();
    expectTexto(/OCIOSA/);
    // Sin orden: calidad no visible
    expect(screen.queryByText(/Buena racha/)).toBeNull();
    expect(screen.queryByText(/Alerta/)).toBeNull();
  }, UI_TIMEOUT);

  it("renderiza DashboardHome en orden disponible (OCIOSA)", async () => {
    await renderApp(FECHA_CON_ORDEN);
    expect(screen.getByTestId("dashboard-home")).toBeTruthy();
    expectTexto(/OCIOSA/);
  }, UI_TIMEOUT);

  it("renderiza DashboardHome en orden en producción (ANDANDO)", async () => {
    const user = userEvent.setup();
    await renderApp(FECHA_CON_ORDEN);
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    expectTexto(/ANDANDO/);
    // Con orden en producción: calidad visible
    expect(screen.getByTestId("dashboard-home")).toBeTruthy();
  }, UI_TIMEOUT);

  it("renderiza DashboardHome en orden finalizada (OCIOSA)", async () => {
    await renderApp(FECHA_CON_ORDEN);
    // La orden OP-101 con fecha 2026-09-10 ya está finalizada
    expectTexto(/OCIOSA/);
    expect(screen.getByTestId("dashboard-home")).toBeTruthy();
  }, UI_TIMEOUT);

  it("una parada abierta sin orden determina PARADA", async () => {
    const paradaAbierta: ParadaAbierta = {
      id: "p-sin-orden",
      maquinaId: "M1",
      ordenId: null,
      operatorName: "Carlos",
      causaId: "falta_tela",
      camposEspecificos: {},
      fechaOperativa: "2026-09-10",
      inicio: "2026-09-10T10:00:00.000Z",
      fin: null,
    };
    const repoParadas = new InMemoryParadaRepository([paradaAbierta]);
    await mountApp(
      <App
        repository={new InMemoryOrderRepository()}
        paradaRepository={repoParadas}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );
    expectTexto(/PARADA/);
    expectTexto(/Falta de materia prima/);
  }, UI_TIMEOUT);

  it("una parada abierta de la orden determina PARADA", async () => {
    const repo = new InMemoryOrderRepository();
    const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(base, {
      operatorName: "Laura",
      lecturaInicial: 100,
      timestamp: "2026-09-11T08:00:00.000Z",
    }).orden!;
    await repo.saveOrder(iniciada);
    const abierta: ParadaAbierta = {
      id: "par-activa-1",
      maquinaId: "M1",
      ordenId: iniciada.id,
      operatorName: "Laura",
      causaId: "falta_color",
      camposEspecificos: { color: "Rojo" },
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
    };
    const repoParadas = new InMemoryParadaRepository([abierta]);
    await mountApp(<App repository={repo} paradaRepository={repoParadas} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);

    expectTexto(/PARADA/);
    expectTexto(/Falta de color/);
  }, UI_TIMEOUT);

  it("calidad se oculta cuando la orden está finalizada", async () => {
    // Crear una orden finalizada
    const repo = new InMemoryOrderRepository();
    const op101 = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(op101, {
      operatorName: "Ana",
      lecturaInicial: 50,
      timestamp: "2026-09-11T07:00:00.000Z",
    });
    if (!iniciada.orden) throw new Error("precondition failed");
    const finalizada = finalizarProduccion(iniciada.orden, "2026-09-11T12:00:00.000Z");
    if (!finalizada.orden) throw new Error("precondition failed");
    await repo.saveOrder(finalizada.orden);

    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />);
    expectTexto(/OCIOSA/);
    // Calidad no visible en orden finalizada
    expect(screen.queryByText(/Buena racha/)).toBeNull();
    expect(screen.queryByText(/Alerta/)).toBeNull();
  }, UI_TIMEOUT);
});

describe("App — phase 14 (G2): el puerto como fuente de verdad (14.1–14.5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("una falla de persistencia de parada deja el estado visible intacto y no renderiza Promises", async () => {
    const repo = new InMemoryOrderRepository();
    const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(base, {
      operatorName: "Laura",
      lecturaInicial: 100,
      timestamp: "2026-09-11T08:00:00.000Z",
    }).orden!;
    await repo.saveOrder(iniciada);

    // Parada CERRADA sembrada: el loader la carga y el historial la muestra.
    const paradaSembrada: Parada = {
      id: "par-cerrada-g2",
      maquinaId: "M1",
      ordenId: iniciada.id,
      operatorName: "Laura",
      causaId: "falta_tela",
      camposEspecificos: {},
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T08:20:00.000Z",
      fin: "2026-09-11T08:35:00.000Z",
    };
    const repoParadas = new InMemoryParadaRepository([paradaSembrada]);
    vi.spyOn(repoParadas, "insertParada").mockImplementation(async () => {
      throw new Error("storage failure: paradas");
    });

    const user = userEvent.setup();
    await mountApp(
      <App repository={repo} paradaRepository={repoParadas} hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN} />,
    );
    // El historial muestra la parada sembrada antes del intento.
    expect(screen.getAllByText(/Falta de materia prima/).length).toBeGreaterThan(0);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /causa de la parada/i }),
      screen.getByRole("option", { name: /falta de materia prima/i }),
    );
    await user.click(screen.getByRole("button", { name: /Registrar parada/i }));

    // El error del puerto llega al alert (14.4) y el estado visible NO cambió.
    expect(screen.getByText("storage failure: paradas")).toBeTruthy();
    expect(screen.getAllByText(/Falta de materia prima/).length).toBeGreaterThan(0);
    // Ningún child recibió una Promise: el DOM no muestra "[object Promise]".
    expect(document.body.textContent).not.toContain("[object Promise]");
  }, UI_TIMEOUT);

  it("Approach A: un paradaId colgado cae en el dominio (no en la FK) y no escribe nada", async () => {
    const repo = new InMemoryOrderRepository();
    const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(base, {
      operatorName: "Laura",
      lecturaInicial: 100,
      timestamp: "2026-09-11T08:00:00.000Z",
    }).orden!;
    await repo.saveOrder(iniciada);

    const repoDanos = new InMemoryDanoRepository([]);
    const insertSpy = vi.spyOn(repoDanos, "insertDano");
    const user = userEvent.setup();
    await mountApp(
      <App
        repository={repo}
        danoRepository={repoDanos}
        paradaRepository={new InMemoryParadaRepository([])}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de daño/i }),
      screen.getByRole("option", { name: "Daño mecánico" }),
    );
    await user.type(screen.getByLabelText(/componente afectado/i), "eje trasero");
    await user.click(screen.getByLabelText(/este daño causó una parada/i));

    // El selector no ofrece paradas (repo vacío): se inyecta una opción con un id
    // colgado — el estado en el que quedaría una parada borrada entre renderizar
    // el selector y enviar el formulario. jsdom no permite seleccionar un valor
    // que no exista entre las opciones, así que primero se agrega al DOM.
    const selectParada = screen.getByLabelText(/parada vinculada/i) as HTMLSelectElement;
    const opcionColgada = document.createElement("option");
    opcionColgada.value = "no-existe";
    opcionColgada.text = "no-existe (borrada)";
    selectParada.add(opcionColgada);
    selectParada.value = "no-existe";
    fireEvent.change(selectParada);
    await user.click(screen.getByRole("button", { name: /Registrar daño/i }));

    // El dominio produce su propio mensaje Y el insert nunca se intenta (14.5).
    expect(screen.getByText("la parada vinculada no existe: no-existe")).toBeTruthy();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(await repoDanos.listarPorMaquina("M1")).toEqual([]);
  }, UI_TIMEOUT);

  it("Approach A: un danoId colgado en mantenimiento reactivo cae en el dominio sin escribir", async () => {
    const repo = new InMemoryOrderRepository();
    const base = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(base, {
      operatorName: "Laura",
      lecturaInicial: 100,
      timestamp: "2026-09-11T08:00:00.000Z",
    }).orden!;
    await repo.saveOrder(iniciada);

    const repoMantenimientos = new InMemoryMantenimientoRepository([]);
    const insertSpy = vi.spyOn(repoMantenimientos, "insertMantenimiento");
    const user = userEvent.setup();
    await mountApp(
      <App
        repository={repo}
        mantenimientoRepository={repoMantenimientos}
        danoRepository={new InMemoryDanoRepository([])}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de mantenimiento/i }),
      screen.getByRole("option", { name: "Mantenimiento reactivo" }),
    );
    await user.type(screen.getByLabelText(/motivo \(obligatorio\)/i), "el horno no calienta");
    // Mismo patrón que el test de daño: se inyecta la opción colgada en el DOM
    // para poder seleccionar un id que el selector jamás ofreció.
    const selectDano = screen.getByLabelText(/daño vinculado/i) as HTMLSelectElement;
    const opcionColgada = document.createElement("option");
    opcionColgada.value = "no-existe-dano";
    opcionColgada.text = "no-existe-dano (borrado)";
    selectDano.add(opcionColgada);
    selectDano.value = "no-existe-dano";
    fireEvent.change(selectDano);
    await user.click(screen.getByRole("button", { name: /Registrar mantenimiento/i }));

    expect(screen.getByText("el daño vinculado no existe: no-existe-dano")).toBeTruthy();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(await repoMantenimientos.listarPorMaquina("M1")).toEqual([]);
  }, UI_TIMEOUT);

  it("los loaders de montaje re-leen el repositorio para el hoy inyectado (el seed stale pierde)", async () => {
    // El seed (10.8) trae una parada distinta de la que el repo tiene para hoy:
    // los loaders de montaje (14.1) deben reemplazar el estado y ganar la relectura.
    const paradaSeed: ParadaAbierta = {
      id: "par-seed",
      maquinaId: "M1",
      ordenId: null,
      operatorName: "Ana",
      causaId: "falta_tela",
      camposEspecificos: {},
      fechaOperativa: "2026-09-10",
      inicio: "2026-09-10T07:00:00.000Z",
      fin: null,
    };
    const paradaRepo: ParadaAbierta = {
      id: "par-repo",
      maquinaId: "M1",
      ordenId: null,
      operatorName: "Carlos",
      causaId: "falta_color",
      camposEspecificos: { color: "Rojo" },
      fechaOperativa: "2026-09-10",
      inicio: "2026-09-10T07:00:00.000Z",
      fin: null,
    };
    const estadoInicial: RecoveryState = {
      jornada: jornadaDefault(FECHA_CON_ORDEN),
      orden: undefined,
      lecturas: [],
      paradas: [paradaSeed],
      actividades: [],
      danos: [],
      mantenimientos: [],
      inspecciones: [],
    };
    await mountApp(
      <App
        repository={new InMemoryOrderRepository()}
        paradaRepository={new InMemoryParadaRepository([paradaRepo])}
        estadoInicial={estadoInicial}
        hoy={FECHA_CON_ORDEN} fechaOperativaHoy={FECHA_CON_ORDEN}
      />,
    );

    // La parada del REPOSITORIO (Falta de color) reemplazó la del seed.
    expectTexto(/Falta de color/);
    expect(screen.queryByText(/Falta de materia prima/)).toBeNull();
  }, UI_TIMEOUT);
});

// ---------------------------------------------------------------------------
// Phase 8 (WU 8) — alcance de solo lectura (tarea 8.8)
// ---------------------------------------------------------------------------
describe("App — phase 8: el día seleccionado que no es hoy es de solo lectura", () => {
  /** Día operativo CON orden (fixture): es el día SELECCIONADO en estas pruebas. */
  const DIA = FECHA_CON_ORDEN;
  /** "Hoy" real inyectado, distinto de todo fixture → el montaje queda de solo lectura. */
  const HOY_REAL = "2026-09-20";
  /** Negación literal que devuelven los 15 handlers (tarea 7.6). */
  const RECHAZO = ["no se puede registrar en un día que no es hoy"];

  /** El fixture A3 es de otro día: hace falta una copia abierta del día seleccionado. */
  const actividadAbiertaDelDia: ActividadPlanificada = {
    ...A3_LIMPIEZA_ABIERTA,
    maquinaId: "M1",
    fechaOperativa: DIA,
  };

  /** El fixture DANO_3 es de otro día: copia abierta (con daño del día) del día seleccionado. */
  const danoAbiertoDelDia: Dano = {
    ...DANO_3_ABIERTO,
    ordenId: "ord-101",
    fechaOperativa: DIA,
    inicio: `${DIA}T09:00:00.000Z`,
  };

  /** El fixture MANT_4 es de otro día: copia en curso del día seleccionado. */
  const mantenimientoAbiertoDelDia: Mantenimiento = {
    ...MANT_4_ABIERTO,
    fechaOperativa: DIA,
    inicio: `${DIA}T09:00:00.000Z`,
  };

  async function montarDiaPasado(
    opciones: {
      ordenEnProduccion?: boolean;
      conLectura?: boolean;
      paradas?: Parada[];
      actividades?: ActividadPlanificada[];
      danos?: Dano[];
      mantenimientos?: Mantenimiento[];
      inspecciones?: InspeccionTela[];
    } = {},
  ) {
    const repository = new InMemoryOrderRepository();
    if (opciones.ordenEnProduccion) {
      const disponible = await repository.getOrderByFechaOperativa(DIA);
      if (!disponible) throw new Error("precondición: la orden del fixture no existe");
      const iniciada = iniciarProduccion(disponible, {
        operatorName: "Laura",
        lecturaInicial: 100,
        timestamp: `${DIA}T08:00:00.000Z`,
      });
      if (!iniciada.orden) throw new Error("precondición: la orden no pudo iniciar");
      let orden = iniciada.orden;
      if (opciones.conLectura) {
        const conLectura = registrarLectura(orden, {
          valor: 400,
          timestamp: `${DIA}T09:00:00.000Z`,
        });
        if (!conLectura.orden) throw new Error("precondición: la lectura no pudo registrarse");
        orden = conLectura.orden;
      }
      await repository.saveOrder(orden);
    }
    const repositorios = {
      repository,
      paradaRepository: new InMemoryParadaRepository(opciones.paradas ?? []),
      actividadRepository: new InMemoryActividadPlanificadaRepository(opciones.actividades ?? []),
      danoRepository: new InMemoryDanoRepository(opciones.danos ?? []),
      mantenimientoRepository: new InMemoryMantenimientoRepository(
        opciones.mantenimientos ?? [],
      ),
      inspeccionRepository: new InMemoryInspeccionRepository(opciones.inspecciones ?? []),
      jornadaRepository: new InMemoryJornadaRepository([]),
    };
    await mountApp(<App {...repositorios} hoy={DIA} fechaOperativaHoy={HOY_REAL} />);
    return repositorios;
  }

  it("día pasado en producción: ningún control de escritura existe en el DOM (ausente, no deshabilitado)", async () => {
    await montarDiaPasado({
      ordenEnProduccion: true,
      paradas: [P1, P2, P4_ABIERTA],
      actividades: [A1_LIMPIEZA_CERRADA, A2_CAMBIO_CERRADO, actividadAbiertaDelDia],
      danos: [DANO_1_CERRADO_CON_PARADA, DANO_2_CERRADO_SIN_PARADA, danoAbiertoDelDia],
      mantenimientos: [
        MANT_1_REACTIVO_CON_DANO_CERRADO,
        MANT_2_REACTIVO_SIN_DANO_CERRADO,
        mantenimientoAbiertoDelDia,
      ],
    });

    // Los REGISTROS siguen a la vista: se ocultan los controles, no los datos.
    expect(screen.getByTestId("parada-activa")).toBeTruthy();
    expect(screen.getByTestId("actividad-abierta-limpieza")).toBeTruthy();
    expect(screen.getByTestId("dano-abierto")).toBeTruthy();
    expect(screen.getByTestId("mantenimiento-abierto")).toBeTruthy();

    // Cierres de los registros abiertos: parada, daño y mantenimiento en curso.
    expect(screen.queryByRole("button", { name: "Cerrar parada" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cerrar actividad" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cerrar daño" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cerrar mantenimiento" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Cerrar daño" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Cerrar mantenimiento" })).toBeNull();

    // Altas de los cinco dominios.
    expect(screen.queryByRole("button", { name: "Registrar parada" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar actividad" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar daño" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar inspección" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar mantenimiento" })).toBeNull();
    // Avance de producción y cierre de jornada.
    expect(screen.queryByRole("button", { name: "Registrar lectura" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Finalizar producción" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar fin de jornada" })).toBeNull();

    // Tampoco existen los FORMULARIOS completos: nada "presente y fallando".
    expect(screen.queryByRole("form", { name: "Registrar parada" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar actividad" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar daño" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar inspección" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar mantenimiento" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar lectura" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Ajustar fin de jornada" })).toBeNull();
  }, UI_TIMEOUT);

  it("día pasado con orden disponible: el control de inicio de producción no existe en el DOM", async () => {
    await montarDiaPasado();

    expect(screen.queryByRole("button", { name: "Iniciar producción" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Iniciar producción" })).toBeNull();
    // La orden se ve igual que en un día escribible.
    expectTexto("OP-101");
    expectTexto("Disponible");
  }, UI_TIMEOUT);

  it("día pasado: la vista de solo lectura muestra todo lo que el día registró y sus valores derivados", async () => {
    const op101 = await new InMemoryOrderRepository().getOrderByFechaOperativa(DIA);
    if (!op101) throw new Error("precondición: la orden del fixture no existe");
    const inspeccion = registrarInspeccion(op101, {
      operatorName: "Ana",
      items: getItemsChecklist().map((i) => ({ id: i.id, estado: "conforme" as const })),
      timestamp: `${DIA}T07:30:00.000Z`,
    }).inspeccion;
    if (!inspeccion) throw new Error("precondición: la inspección no pudo registrarse");

    await montarDiaPasado({
      ordenEnProduccion: true,
      conLectura: true,
      paradas: [P1],
      actividades: [A1_LIMPIEZA_CERRADA],
      danos: [DANO_1_CERRADO_CON_PARADA, DANO_4_SIN_ORDEN_CERRADO],
      mantenimientos: [MANT_1_REACTIVO_CON_DANO_CERRADO, MANT_2_REACTIVO_SIN_DANO_CERRADO],
      inspecciones: [inspeccion],
    });

    // Todo lo que el día registró sigue visible.
    expectTexto("OP-101");
    expectTexto("En producción");
    expectTexto("Producción actual");
    expectTexto("300 golpes / 900 unidades");
    expect(screen.getByText("Historial de paradas")).toBeTruthy();
    expect(screen.getByText("Historial de actividades")).toBeTruthy();
    expect(screen.getByText("Historial de daños")).toBeTruthy();
    expect(screen.getByText("Historial de mantenimientos")).toBeTruthy();
    expect(screen.getAllByTestId("inspeccion-item")).toHaveLength(1);

    // Valores derivados del turno (jornada 10 h, limpieza 1 h, parada 15 min).
    expect(screen.getByTestId("resumen-tiempo_disponible").textContent).toBe("10 h");
    expect(screen.getByTestId("resumen-tiempo_planificado").textContent).toBe("1 h");
    expect(screen.getByTestId("resumen-tiempo_incidencias").textContent).toBe("15 min");
    expect(screen.getByTestId("resumen-tiempo_productivo").textContent).toBe("8 h 45 min");

    // …y SOLO los controles de escritura desaparecen.
    expect(screen.queryByRole("form", { name: "Registrar lectura" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar parada" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar actividad" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar daño" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar inspección" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar mantenimiento" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Ajustar fin de jornada" })).toBeNull();
  }, UI_TIMEOUT);

  it("los 15 handlers llamados directamente sobre un día pasado devuelven la negación y no tocan el almacén", async () => {
    // Montaje 1 — orden disponible: App le pasa 11 de los 15 handlers a OrderAvailable.
    const repos = await montarDiaPasado();
    expect(propsVistas.ordenDisponible).not.toBeNull();
    const disponibles = propsVistas.ordenDisponible as Parameters<typeof OrderAvailable>[0];

    // Montaje 2 — la misma orden pasada a en producción: OrderInProduction recibe los 4
    // restantes (lectura, finalizar, parada). El estado cambia FUERA de la app, porque en
    // un día pasado ningún control ni handler permite escribir.
    const op101 = await repos.repository.getOrderByFechaOperativa(DIA);
    if (!op101) throw new Error("precondición: la orden del fixture no existe");
    const iniciada = iniciarProduccion(op101, {
      operatorName: "Laura",
      lecturaInicial: 100,
      timestamp: `${DIA}T08:00:00.000Z`,
    });
    if (!iniciada.orden) throw new Error("precondición: la orden no pudo iniciar");
    await repos.repository.saveOrder(iniciada.orden);
    cleanup();
    await mountApp(
      <App
        repository={repos.repository}
        paradaRepository={repos.paradaRepository}
        actividadRepository={repos.actividadRepository}
        danoRepository={repos.danoRepository}
        mantenimientoRepository={repos.mantenimientoRepository}
        inspeccionRepository={repos.inspeccionRepository}
        jornadaRepository={repos.jornadaRepository}
        hoy={DIA}
        fechaOperativaHoy={HOY_REAL}
      />,
    );
    expect(propsVistas.ordenEnProduccion).not.toBeNull();
    const enProduccion = propsVistas.ordenEnProduccion as Parameters<
      typeof OrderInProduction
    >[0];

    const estadoAlmacen = async () => ({
      orden: await repos.repository.getOrderByFechaOperativa(DIA),
      paradas: await repos.paradaRepository.listarPorMaquina("M1"),
      actividades: await repos.actividadRepository.listarPorMaquina("M1"),
      danos: await repos.danoRepository.listarPorMaquina("M1"),
      mantenimientos: await repos.mantenimientoRepository.listarPorMaquina("M1"),
      inspecciones: await repos.inspeccionRepository.listarPorOrden("ord-101"),
      jornada: await repos.jornadaRepository.obtenerParaFecha(DIA),
    });
    const almacenAntes = await estadoAlmacen();

    const inspeccionInput = {
      operatorName: "Laura",
      items: getItemsChecklist().map((i) => ({ id: i.id, estado: "conforme" as const })),
      timestamp: `${DIA}T10:00:00.000Z`,
    };

    const llamadas: [string, unknown][] = [
      ["handleIniciar", await disponibles.onIniciar("Laura", 100)],
      [
        "handleRegistrarActividad",
        await disponibles.onRegistrarActividad({
          maquinaId: "M1",
          tipo: "limpieza",
          inicio: `${DIA}T10:00:00.000Z`,
          fechaOperativa: DIA,
          queSeLimpio: "mesa",
          operatorName: "Laura",
        }),
      ],
      ["handleCerrarActividad", await disponibles.onCerrarActividad("limpieza")],
      ["handleCambiarFinJornada", await disponibles.onCambiarFinJornada("19:00")],
      [
        "handleRegistrarDano",
        await disponibles.onRegistrarDano({
          maquinaId: "M1",
          ordenId: "ord-101",
          operatorName: "Laura",
          tipo: "mecanico",
          componente: "eje trasero",
          inicio: `${DIA}T10:00:00.000Z`,
          fechaOperativa: DIA,
          causoParada: false,
          paradaId: null,
          posibleSegunda: false,
        }),
      ],
      [
        "handleCerrarDano",
        await disponibles.onCerrarDano(`${DIA}T11:00:00.000Z`, "Cambio de eje"),
      ],
      ["handleRegistrarInspeccion", await disponibles.onRegistrarInspeccion(inspeccionInput)],
      [
        "handleDevolverInspeccion",
        await disponibles.onDevolverInspeccion("insp-x", {
          motivo: "Absorción insuficiente",
          registradaPor: "Laura",
          timestamp: `${DIA}T10:00:00.000Z`,
        }),
      ],
      [
        "handleAutorizarInspeccion",
        await disponibles.onAutorizarInspeccion("insp-x", {
          autorizadoPor: "Gerencia",
          timestamp: `${DIA}T10:00:00.000Z`,
        }),
      ],
      [
        "handleRegistrarMantenimiento",
        await disponibles.onRegistrarMantenimiento({
          maquinaId: "M1",
          tipo: "reactivo",
          operatorName: "Laura",
          motivo: "Fusible quemado",
          inicio: `${DIA}T10:00:00.000Z`,
          fechaOperativa: DIA,
          danoId: null,
        }),
      ],
      [
        "handleCerrarMantenimiento",
        await disponibles.onCerrarMantenimiento(
          `${DIA}T11:00:00.000Z`,
          "Cambio de fusible",
        ),
      ],
      ["handleRegistrarLectura", (await enProduccion.onRegistrarLectura(500)).errores],
      ["handleFinalizar", await enProduccion.onFinalizar()],
      [
        "handleRegistrarParada",
        await enProduccion.onRegistrarParada({
          maquinaId: "M1",
          ordenId: "ord-101",
          operatorName: "Laura",
          causaId: "falta_color",
          camposEspecificos: { color: "Rojo" },
          inicio: `${DIA}T10:00:00.000Z`,
          fechaOperativa: DIA,
        }),
      ],
      ["handleCerrarParada", await enProduccion.onCerrarParada()],
    ];

    expect(llamadas).toHaveLength(15);
    for (const [nombre, resultado] of llamadas) {
      expect(resultado, `${nombre} debe rechazar en un día pasado`).toEqual(RECHAZO);
    }
    expect(await estadoAlmacen()).toEqual(almacenAntes);
  }, UI_TIMEOUT);

  it("volver a hoy restaura todos los controles y la escritura vuelve a funcionar", async () => {
    const repository = new InMemoryOrderRepository();
    const paradaRepository = new InMemoryParadaRepository([]);
    const actividadRepository = new InMemoryActividadPlanificadaRepository([]);
    const ui = (fechaReferencia: string) => (
      <App
        repository={repository}
        paradaRepository={paradaRepository}
        actividadRepository={actividadRepository}
        hoy={DIA}
        fechaOperativaHoy={fechaReferencia}
      />
    );
    const { rerender } = render(ui(HOY_REAL));
    await act(async () => {});

    // Día pasado: los controles no existen.
    expect(screen.queryByRole("button", { name: "Iniciar producción" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar actividad" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Ajustar fin de jornada" })).toBeNull();

    // "Volver a hoy": Raiz sólo cambia la referencia inyectada; el día no cambia.
    rerender(ui(DIA));
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Iniciar producción" })).toBeTruthy();
    expect(screen.getByRole("form", { name: "Registrar actividad" })).toBeTruthy();
    expect(screen.getByRole("form", { name: "Ajustar fin de jornada" })).toBeTruthy();

    // …y la escritura vuelve a funcionar como en una app sin configurar.
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }),
      "Laura",
    );
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: "Iniciar producción" }));

    expectTexto("En producción");
    expect((await repository.getOrderByFechaOperativa(DIA))!.estado).toBe(
      "in_production",
    );
  }, UI_TIMEOUT);
});

describe("App — phase 9: navegador de un día operativo (tarea 9.5)", () => {
  /**
   * "Hoy" INYECTADO (prop `fechaOperativaHoy`), distinto del día real del reloj
   * del runner: la selección por defecto del navegador tiene que salir de esta
   * prop, no de una lectura de reloj, y `max` tiene que apuntar a este valor.
   * Es además un día CON orden (OP-102), así que sirve de marcador positivo.
   */
  const HOY = "2026-09-15";
  /** Día distinto de hoy con OTRA orden (OP-101): meta del campo de fecha. */
  const DIA_OTRA_ORDEN = "2026-09-11";
  /** Día sin orden, un día antes de `HOY`: meta de la flecha ←. */
  const DIA_SIN_ORDEN = "2026-09-14";

  function estadoVacio(dia: string): RecoveryState {
    return {
      jornada: jornadaDefault(dia),
      orden: undefined,
      lecturas: [],
      paradas: [],
      actividades: [],
      danos: [],
      mantenimientos: [],
      inspecciones: [],
    };
  }

  /**
   * Arnés de la tarea 9.5: reproduce la composición de `Raiz` (DD5) sin
   * importarlo — el día vive en la raíz, `key` DESMONTA `App` al cambiar, y los
   * tres props del navegador viajan juntos. `Raiz` no sirve acá porque su
   * `seleccionarDia` llama a `recoverPersistedState` sobre los ocho puertos; el
   * arnés resuelve el cambio con las MISMAS instancias de repositorio que ya
   * tenía, que es lo único que la especificación exige (H:105-110).
   */
  function Arnés({
    repos,
    hoy,
    estados,
    antesDeCambiar,
  }: {
    repos: {
      repository: InMemoryOrderRepository;
      paradaRepository: InMemoryParadaRepository;
      actividadRepository: InMemoryActividadPlanificadaRepository;
      danoRepository: InMemoryDanoRepository;
      mantenimientoRepository: InMemoryMantenimientoRepository;
      inspeccionRepository: InMemoryInspeccionRepository;
      jornadaRepository: InMemoryJornadaRepository;
    };
    hoy: string;
    estados: Record<string, RecoveryState | undefined>;
    antesDeCambiar?: (dia: string) => Promise<void>;
  }) {
    // Selección por defecto = el "hoy" inyectado (H:71-77), igual que `Raiz`.
    const [vista, setVista] = useState<{ dia: string; estado?: RecoveryState }>(() => ({
      dia: hoy,
      estado: estados[hoy],
    }));
    const [cargando, setCargando] = useState(false);
    const [errorDia, setErrorDia] = useState<string | null>(null);

    async function seleccionarDia(dia: string): Promise<void> {
      // Idempotente y sin apilar (misma regla que `Raiz`, H:112-117).
      if (dia === vista.dia || cargando) return;
      setCargando(true);
      setErrorDia(null);
      try {
        if (antesDeCambiar) await antesDeCambiar(dia);
        // Atómico: el día y su semilla cambian juntos y solo tras resolverse.
        setVista({ dia, estado: estados[dia] });
      } catch (error) {
        setErrorDia(error instanceof Error ? error.message : String(error));
      } finally {
        setCargando(false);
      }
    }

    return (
      <App
        key={vista.dia}
        {...repos}
        estadoInicial={vista.estado}
        hoy={vista.dia}
        fechaOperativaHoy={hoy}
        onSeleccionarDia={seleccionarDia}
        cargandoDia={cargando}
        errorCambioDia={errorDia}
      />
    );
  }

  async function montarNavegador(
    opciones: { antesDeCambiar?: (dia: string) => Promise<void> } = {},
  ) {
    const repository = new InMemoryOrderRepository();
    const ordenDeHoy = await repository.getOrderByFechaOperativa(HOY);
    if (!ordenDeHoy) throw new Error("precondición: la orden del fixture de HOY no existe");
    const repos = {
      repository,
      paradaRepository: new InMemoryParadaRepository([]),
      actividadRepository: new InMemoryActividadPlanificadaRepository([]),
      danoRepository: new InMemoryDanoRepository([]),
      mantenimientoRepository: new InMemoryMantenimientoRepository([]),
      inspeccionRepository: new InMemoryInspeccionRepository([]),
      jornadaRepository: new InMemoryJornadaRepository([]),
    };
    const estados: Record<string, RecoveryState | undefined> = {
      // La semilla del día inicial trae SU orden: sin remount, esa fila
      // sobreviviría al cambio de día hasta que los loaders resuelvan (DD5).
      [HOY]: { ...estadoVacio(HOY), orden: ordenDeHoy },
      [DIA_SIN_ORDEN]: estadoVacio(DIA_SIN_ORDEN),
      [DIA_OTRA_ORDEN]: estadoVacio(DIA_OTRA_ORDEN),
    };
    await mountApp(
      <Arnés repos={repos} hoy={HOY} estados={estados} antesDeCambiar={opciones.antesDeCambiar} />,
    );
    return { repos };
  }

  function campoFecha(): HTMLInputElement {
    return screen.getByLabelText("Fecha operativa") as HTMLInputElement;
  }

  function flecha(nombre: "Día operativo anterior" | "Día operativo siguiente") {
    return screen.getByRole("button", { name: nombre }) as HTMLButtonElement;
  }

  it("la selección por defecto es el hoy inyectado", async () => {
    await montarNavegador();

    expect(campoFecha().value).toBe(HOY);
    expectTexto(`Fecha operativa: ${HOY}`);
    // El marcador positivo del día: la orden de ese día está cargada.
    expectTexto("OP-102");
  }, UI_TIMEOUT);

  it("←, → y el campo de fecha cargan cada uno el día correcto", async () => {
    await montarNavegador();
    const user = userEvent.setup();

    // ← un día atrás: día sin orden → estado de día vacío, sin filas de hoy.
    await user.click(flecha("Día operativo anterior"));
    await act(async () => {});
    expectTexto(`Fecha operativa: ${DIA_SIN_ORDEN}`);
    expectTexto("No hay orden asignada para hoy.");
    expect(screen.queryAllByText(/OP-102/)).toHaveLength(0);

    // → vuelve a hoy: la orden de hoy reaparece.
    await user.click(flecha("Día operativo siguiente"));
    await act(async () => {});
    expectTexto(`Fecha operativa: ${HOY}`);
    expectTexto("OP-102");

    // El campo de fecha carga el día elegido: otra orden, otro día.
    fireEvent.change(campoFecha(), { target: { value: DIA_OTRA_ORDEN } });
    await act(async () => {});
    expectTexto(`Fecha operativa: ${DIA_OTRA_ORDEN}`);
    expectTexto("OP-101");
    expect(screen.queryAllByText(/OP-102/)).toHaveLength(0);
  }, UI_TIMEOUT);

  it("→ está deshabilitado en hoy y el campo de fecha tiene max = hoy", async () => {
    await montarNavegador();

    expect(flecha("Día operativo siguiente").disabled).toBe(true);
    expect(flecha("Día operativo anterior").disabled).toBe(false);
    expect(campoFecha().disabled).toBe(false);
    // `max` es la prop INYECTADA de la tarea 7.2, no una lectura del reloj.
    expect(campoFecha().getAttribute("max")).toBe(HOY);

    // Un día atrás → ← deja de ser el único camino: → se habilita.
    const user = userEvent.setup();
    await user.click(flecha("Día operativo anterior"));
    await act(async () => {});
    expect(flecha("Día operativo siguiente").disabled).toBe(false);
    expect(campoFecha().getAttribute("max")).toBe(HOY);
  }, UI_TIMEOUT);

  it("cambiar de día desmonta la App y no queda ninguna fila del día anterior", async () => {
    await montarNavegador();
    expectTexto("OP-102");
    const shellAntes = screen.getByRole("main");

    const user = userEvent.setup();
    await user.click(flecha("Día operativo anterior"));
    await act(async () => {});

    // El `key` de la raíz DESMONTA App (DD5): el nodo del shell es otro.
    expect(screen.getByRole("main")).not.toBe(shellAntes);
    // …y ninguna fila del día anterior sobrevive al cambio.
    expect(screen.queryAllByText(/OP-102/)).toHaveLength(0);
    expect(screen.queryAllByText(/OP-101/)).toHaveLength(0);
    expectTexto("No hay orden asignada para hoy.");
    expectTexto(`Fecha operativa: ${DIA_SIN_ORDEN}`);
  }, UI_TIMEOUT);

  it("ningún control acepta una fecha de inicio y una de fin", async () => {
    await montarNavegador();

    const nav = screen.getByRole("navigation", { name: "Día operativo" });
    // Un SOLO campo de fecha: sin pareja de inicio/fin (H:332-344, DD9).
    expect(nav.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(1);
    // Sin límite inferior: OQ-2 queda declarada en el JSDoc, no inventada como
    // regla (tarea 9.6).
    expect(campoFecha().getAttribute("min")).toBeNull();
    // Y sólo dos flechas de ±1 día: el día es un escalar, nunca un rango.
    expect(nav.querySelectorAll("button")).toHaveLength(2);
  }, UI_TIMEOUT);

  it("un cambio de día en vuelo deshabilita flechas y campo hasta que resuelve", async () => {
    // Puerta controlada por el test: mantiene la ventana "en vuelo" abierta
    // para observar el `disabled` de la tarea 9.4.
    let liberar = () => {};
    const puerta = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    await montarNavegador({ antesDeCambiar: () => puerta });
    const user = userEvent.setup();

    await user.click(flecha("Día operativo anterior"));

    // Ventana en vuelo: ningún control acepta un segundo cambio de día.
    expect(flecha("Día operativo anterior").disabled).toBe(true);
    expect(flecha("Día operativo siguiente").disabled).toBe(true);
    expect(campoFecha().disabled).toBe(true);
    // …y el día en pantalla sigue siendo el anterior al cambio resuelto.
    expectTexto(`Fecha operativa: ${HOY}`);

    await act(async () => {
      liberar();
      await puerta;
    });

    // Resuelto: los tres controles vuelven a operar y el día ya cambió.
    expect(flecha("Día operativo anterior").disabled).toBe(false);
    expect(campoFecha().disabled).toBe(false);
    expectTexto(`Fecha operativa: ${DIA_SIN_ORDEN}`);
  }, UI_TIMEOUT);
});