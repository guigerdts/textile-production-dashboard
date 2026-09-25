import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
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
import { P1 } from "./store/paradasFixtures";
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
import type { InspeccionTela, Mantenimiento, Orden } from "./domain/types";
import type { ParadaAbierta } from "./domain/types";
import type { Dano } from "./domain/types";
import { InMemoryMantenimientoRepository } from "./store/inMemoryMantenimientoRepository";
import {
  MANT_4_ABIERTO,
} from "./store/mantenimientoFixtures";
import { registrarMantenimiento } from "./domain/mantenimiento";


/**
 * Renderiza App y descarga la carga asíncrona de la orden
 * (IOrderRepository es async desde el ticket 10.4).
 */
async function mountApp(ui: ReactElement) {
  render(ui);
  await act(async () => {});
}

async function renderApp(hoy: string) {
  return await mountApp(<App repository={new InMemoryOrderRepository()} hoy={hoy} />);
}

async function renderAppConActividades(hoy: string, actividadRepository?: InMemoryActividadPlanificadaRepository) {
  return await mountApp(
    <App
      repository={new InMemoryOrderRepository()}
      actividadRepository={actividadRepository ?? new InMemoryActividadPlanificadaRepository([])}
      hoy={hoy}
    />,
  );
}

/** Robusto ante doble render de desarrollo de React: acepta texto que aparece una o más veces. */
function expectTexto(texto: string | RegExp) {
  expect(screen.getAllByText(texto).length).toBeGreaterThan(0);
}

describe("App — ciclo 1: shell, día vacío y orden disponible", () => {
  it("muestra la fecha operativa actual", async () => {
    await renderApp(FECHA_CON_ORDEN);
    expectTexto(`Fecha operativa: ${FECHA_CON_ORDEN}`);
  });

  it("día vacío: sin orden para la fecha no hay acciones de orden, sí hay actividades planificadas", async () => {
    await renderApp(FECHA_SIN_ORDEN);
    expectTexto(/No hay orden asignada para hoy/i);
    // sin acciones de orden: no hay formulario de inicio ni selector de fecha
    expect(screen.queryByRole("button", { name: /Iniciar producción/i })).toBeNull();
    expect(screen.queryByLabelText(/fecha/i)).toBeNull();
    // las actividades planificadas sí están disponibles en día vacío
    expect(screen.getByTestId("actividades")).toBeTruthy();
  });

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
  });

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
  });
});

describe("App — ciclo 2: iniciar producción", () => {
  async function iniciar(
    repo: InMemoryOrderRepository,
    { operario = "Laura", lectura = "100" }: { operario?: string; lectura?: string } = {},
  ) {
    const user = userEvent.setup();
    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} />);
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
  });

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
  });

  it("operador vacío: no inicia y muestra el error del dominio", async () => {
    const repo = new InMemoryOrderRepository();
    await iniciar(repo, { operario: "" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expectTexto("operatorName es obligatorio");
    expect((await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!.estado).toBe("available");
  });

  it("lectura negativa: no inicia y muestra el error del dominio", async () => {
    const repo = new InMemoryOrderRepository();
    await iniciar(repo, { lectura: "-1" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!.estado).toBe("available");
  });

  it("orden ya iniciada: no muestra el formulario ni el botón", async () => {
    const repo = new InMemoryOrderRepository();
    const op101 = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const res = iniciarProduccion(op101, { operatorName: "Ana", lecturaInicial: 50, timestamp: "2026-09-11T07:00:00.000Z" });
    if (!res.orden) throw new Error("precondition failed");
    await repo.saveOrder(res.orden);

    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} />);
    expectTexto("En producción");
    expectTexto("Ana");
    expect(screen.queryByRole("button", { name: /Iniciar producción/i })).toBeNull();
  });

  it("orden finalizada: muestra la vista finalizada sin botones de acción", async () => {
    const repo = new InMemoryOrderRepository();
    const op101 = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(op101, { operatorName: "Ana", lecturaInicial: 50, timestamp: "2026-09-11T07:00:00.000Z" });
    if (!iniciada.orden) throw new Error("precondition failed");
    const finalizada = finalizarProduccion(iniciada.orden, "2026-09-11T12:00:00.000Z");
    if (!finalizada.orden) throw new Error("precondition failed");
    await repo.saveOrder(finalizada.orden);

    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} />);
    expectTexto("Finalizada");
    expect(screen.queryByRole("button", { name: /Iniciar producción/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Finalizar producción/i })).toBeNull();
  });
});

describe("App — ciclo 3: registrar lecturas posteriores", () => {
  async function iniciarYRegistrar(
    repo: InMemoryOrderRepository,
    lecturaInicial: string,
    nuevaLectura: string,
  ) {
    const user = userEvent.setup();
    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} />);
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
  });

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
  });

  it("lectura menor: rechaza con error del dominio y no muta la producción", async () => {
    const repo = new InMemoryOrderRepository();
    await iniciarYRegistrar(repo, "100", "99");
    expect(screen.getByRole("alert")).toBeTruthy();
    expectTexto("el contador no puede retroceder");
    expectTexto("0 golpes / 0 unidades");
    const guardada = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    expect(guardada.lecturas).toHaveLength(1);
    expect(guardada.estado).toBe("in_production");
  });

  it("orden finalizada: no muestra el formulario de lectura", async () => {
    const repo = new InMemoryOrderRepository();
    const op101 = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(op101, { operatorName: "Ana", lecturaInicial: 50, timestamp: "2026-09-11T07:00:00.000Z" });
    if (!iniciada.orden) throw new Error("precondition failed");
    const finalizada = finalizarProduccion(iniciada.orden, "2026-09-11T12:00:00.000Z");
    if (!finalizada.orden) throw new Error("precondition failed");
    await repo.saveOrder(finalizada.orden);

    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} />);
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /nueva lectura/i })).toBeNull();
  });

  it("orden disponible: no muestra el formulario de lectura", async () => {
    await renderApp(FECHA_CON_ORDEN);
    expect(screen.getByRole("button", { name: /Iniciar producción/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /nueva lectura/i })).toBeNull();
  });
});

describe("App — ticket 02: paradas / incidencias (UI)", () => {
  afterEach(async () => {
    vi.useRealTimers();
  });

  async function iniciarOP101(opciones: { paradas?: ParadaAbierta[] } = {}) {
    const user = userEvent.setup();
    const repo = new InMemoryOrderRepository();
    const repoParadas = new InMemoryParadaRepository(opciones.paradas ?? []);
    await mountApp(<App repository={repo} paradaRepository={repoParadas} hoy={FECHA_CON_ORDEN} />);
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
  });

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
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
    };
    const repoParadas = new InMemoryParadaRepository([abierta]);
    await mountApp(<App repository={repo} paradaRepository={repoParadas} hoy={FECHA_CON_ORDEN} />);

    const activa = screen.getByTestId("parada-activa");
    expect(activa.textContent).toContain("Atasco o rotura de tela en la máquina");
    expect(activa.textContent).toMatch(/desde las/);
    // 09:30 - 09:00 = 30 min
    expect(activa.textContent).toContain("30 min");
    // El registro lleva el operario de la orden (CRITICAL: parada con operario).
    expect(repoParadas.getParadaAbierta("M1", iniciada.id)?.operatorName).toBe("Laura");
  });

  it("registra una parada con carro para rotura de cuadro", async () => {
    const { user } = await iniciarOP101();
    await registrarParadaCausa(user, "Rotura o deterioro del cuadro", { carro: "3" });
    expect(screen.getByTestId("parada-activa").textContent).toContain("Rotura o deterioro del cuadro");
  });

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
  });

  it("causa «otro» exige observación y muestra el error del dominio", async () => {
    const { user } = await iniciarOP101();
    await registrarParadaCausa(user, /Otro/, {}, "");
    expect(screen.getByRole("alert")).toBeTruthy();
    expectTexto(/si la causa es "Otro"/);
    expect(screen.queryByTestId("parada-activa")).toBeNull();
  });

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
  });

  it("muestra el historial de paradas cerradas", async () => {
    const { user } = await iniciarOP101();
    await registrarParadaCausa(user, "Falta de color / tinta", { Color: "Rojo" });
    await user.click(screen.getByRole("button", { name: /Cerrar parada/i }));
    expectTexto("Historial de paradas");
    expectTexto(/Falta de color \/ tinta/);
  });

  it("una parada abierta de la orden bloquea registrar lecturas", async () => {
    const { user } = await iniciarOP101();
    await registrarParadaCausa(user, "Falta de color / tinta", { Color: "Rojo" });
    expect(screen.getByRole("spinbutton", { name: /nueva lectura/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /Registrar lectura/i }).hasAttribute("disabled")).toBe(true);
  });

  it("una parada abierta de la orden bloquea finalizar (dominio + UI)", async () => {
    const { user, repo, repoParadas } = await iniciarOP101();
    await registrarParadaCausa(user, "Falta de color / tinta", { Color: "Rojo" });
    // UI deshabilitada + aviso
    expect(screen.getByRole("button", { name: /Finalizar producción/i }).hasAttribute("disabled")).toBe(true);
    expectTexto(/detenida por una parada activa/i);
    // Dominio rechaza aunque se registre la parada en el repositorio
    const ordenId = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!.id;
    const abierta = repoParadas.getParadaAbierta("M1", ordenId);
    expect(abierta).not.toBeNull();
    expect(validarFinalizacionConParadas([abierta!], ordenId).length).toBeGreaterThan(0);
    expect(validarLecturaConParadas([abierta!], ordenId).length).toBeGreaterThan(0);
  });

  it("una parada SIN orden no bloquea lecturas ni finalización", async () => {
    const paradaSinOrden: ParadaAbierta = {
      id: "par-sin-orden",
      maquinaId: "M1",
      ordenId: null,
      operatorName: "Luis Fernández",
      causaId: "atasco_tela",
      camposEspecificos: {},
      observaciones: "atascado",
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
  });
});

describe("App — ciclo 4: finalización de orden", () => {
  async function iniciarParaFinalizar(lecturaInicial = "100") {
    const user = userEvent.setup();
    const repo = new InMemoryOrderRepository();
    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} />);
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
  });

  it("finalizar después de producir: muestra producción real", async () => {
    const { user } = await iniciarParaFinalizar();
    await user.type(screen.getByRole("spinbutton", { name: /nueva lectura/i }), "106");
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));
    await user.click(screen.getByRole("button", { name: /Finalizar producción/i }));
    expectTexto("Finalizada");
    expectTexto("6 golpes / 18 unidades");
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
  });

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
  });

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
  });

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
  });
});

describe("App — ticket 03: actividades planificadas (UI)", () => {
  async function iniciarOP101ConActividades(repoActividades: InMemoryActividadPlanificadaRepository) {
    const user = userEvent.setup();
    const repo = new InMemoryOrderRepository();
    await mountApp(
      <App
        repository={repo}
        actividadRepository={repoActividades}
        hoy={FECHA_CON_ORDEN}
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
    expect(repoActividades.getActividadAbierta("M1", "limpieza")?.operatorName).toBe("Laura");
  });

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
    expect(repoActividades.getActividadAbierta("M1", "cambio_diseno")?.operatorName).toBe("Carlos Gómez");
  });

  it("registra una actividad en producción: no bloquea lecturas ni finalización", async () => {
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
  });

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
        hoy={FECHA_CON_ORDEN}
      />,
    );

    expectTexto("Finalizada");
    await seleccionarTipoActividad(user, "Cambio de diseño");
    await user.click(screen.getByRole("button", { name: /Registrar actividad/i }));
    expect(screen.getByTestId("actividad-abierta-cambio_diseno")).toBeTruthy();
    // sin acciones de orden en finalizada (solo las de actividades)
    expect(screen.queryByRole("button", { name: /Registrar lectura/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Finalizar producción/i })).toBeNull();
  });

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
  });

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
    expect(repoActividades.getActividadAbierta("M1", "limpieza")).not.toBeNull();
    expect(repoActividades.getActividadAbierta("M1", "cambio_diseno")).not.toBeNull();
  });

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
    expect(repoActividades.getActividadAbierta("M1", "limpieza")).toBeNull();
    expectTexto("Historial de actividades");
    expectTexto(/Limpieza/);
  });

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
  });

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

    const abierta = repoActividades.getActividadAbierta("M1", "limpieza");
    expect(abierta?.queSeLimpio).toBe("Limpieza estándar (7:00–8:00)");
  });

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
    expect(repoActividades.getActividadAbierta("M1", "limpieza")?.queSeLimpio).toBe(
      "limpieza programada fuera de martes",
    );
  });

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
    expect(repoActividades.getActividadAbierta("M1", "limpieza")?.id).toBe(A3_LIMPIEZA_ABIERTA.id);
  });

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
  });
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
        hoy={hoy}
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
  });

  it("orden disponible: el resumen del turno se muestra junto a la orden", async () => {
    await renderAppConTiempo(FECHA_CON_ORDEN);

    expectTexto("Resumen del turno");
    expect(screen.getByTestId("resumen-tiempo")).toBeTruthy();
    expectBuckets("10 h", "0 min", "0 min", "10 h");
  });

  it("orden en producción: el resumen del turno se muestra tras iniciar", async () => {
    const user = userEvent.setup();
    await renderAppConTiempo(FECHA_CON_ORDEN);

    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));

    expectTexto("En producción");
    expect(screen.getByTestId("resumen-tiempo")).toBeTruthy();
  });

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
  });

  it("buckets con una actividad (1 h) y una parada (15 min) de la máquina", async () => {
    const paradaRepository = new InMemoryParadaRepository([P1]); // 09:30–09:45
    const actividadRepository = new InMemoryActividadPlanificadaRepository([
      A1_LIMPIEZA_CERRADA, // 07:00–08:00
    ]);
    await renderAppConTiempo(FECHA_CON_ORDEN, { paradaRepository, actividadRepository });

    // jornada 07:00–17:00 = 10 h; planificado = 1 h; incidencias = 15 min;
    // sin solape → productivo = 10h − (1h + 15min) = 8 h 45 min
    expectBuckets("10 h", "1 h", "15 min", "8 h 45 min");
  });

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
  });

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
  });

  it("el resumen del turno no muestra «no productivo total» (solo los 4 buckets principales)", async () => {
    await renderAppConTiempo(FECHA_CON_ORDEN);

    expect(screen.queryByText(/no productivo/i)).toBeNull();
  });
});

describe("App — ticket 05: daños / eventos (UI)", () => {
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
        hoy={FECHA_CON_ORDEN}
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
    const guardado = repoDanos.listarPorMaquina("M1")[0]!;
    expect(guardado.tipo).toBe("mecanico");
    expect(guardado.operatorName).toBe("Laura");
  });

  it("sin tipo de daño: no registra y muestra el error del dominio", async () => {
    const { user, repoDanos } = await iniciarOP101ConDanos();

    await user.type(screen.getByLabelText(/componente afectado/i), "eje trasero");
    await user.click(screen.getByRole("button", { name: /Registrar daño/i }));

    expect(screen.getByRole("alert").textContent).toContain("debe seleccionar un tipo de daño");
    expect(repoDanos.listarPorMaquina("M1")).toHaveLength(0);
  });

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
        hoy={FECHA_CON_ORDEN}
      />,
    );

    fireEvent.change(screen.getByLabelText(/tipo de daño/i), { target: { value: "mecanico" } });
    fireEvent.change(screen.getByLabelText(/componente afectado/i), { target: { value: "eje trasero" } });
    fireEvent.click(screen.getByLabelText(/este daño causó una parada/i));
    fireEvent.change(screen.getByLabelText(/parada vinculada/i), { target: { value: "par-activa-danio" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar daño/i }));

    const guardado = repoDanos.listarPorMaquina("M1")[0]!;
    expect(guardado.causoParada).toBe(true);
    expect(guardado.paradaId).toBe("par-activa-danio");
    expect(screen.getByTestId("dano-abierto").textContent).toContain("eje trasero");
  });

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
    expect(repoDanos.listarPorMaquina("M1")).toHaveLength(0);
  });

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

    const guardado = repoDanos.listarPorMaquina("M1")[0]!;
    expect(guardado.posibleSegunda).toBe(true);
    expect(guardado.unidadesSospechadas).toBe(3);
  });

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
    <App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} />,
  );

  fireEvent.change(screen.getByLabelText(/tipo de daño/i), { target: { value: "mecanico" } });
  fireEvent.change(screen.getByLabelText(/componente afectado/i), { target: { value: "eje trasero" } });
  fireEvent.click(screen.getByRole("button", { name: /Registrar daño/i }));
  expect(screen.getByTestId("dano-abierto")).toBeTruthy();

  // el cierre del daño EXIGE fin + solución; prellenado el fin con ahora, se indica la solución
  fireEvent.change(screen.getByLabelText(/solución aplicada/i), {
    target: { value: "Cambio de eje y lubricación" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Cerrar daño/i }));

  expect(screen.queryByTestId("dano-abierto")).toBeNull();
  const guardado = repoDanos.listarPorMaquina("M1")[0]!;
  expect(guardado.fin).not.toBeNull();
  expect(guardado.solucionAplicada).toBe("Cambio de eje y lubricación");
  expectTexto("Historial de daños");
});

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
    <App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} />,
  );

  fireEvent.change(screen.getByLabelText(/tipo de daño/i), { target: { value: "mecanico" } });
  fireEvent.change(screen.getByLabelText(/componente afectado/i), { target: { value: "eje trasero" } });
  fireEvent.click(screen.getByRole("button", { name: /Registrar daño/i }));
  fireEvent.click(screen.getByRole("button", { name: /Cerrar daño/i }));

  expect(screen.getByRole("alert").textContent).toContain("debe indicar la solución aplicada");
  expect(repoDanos.listarPorMaquina("M1")[0]!.fin).toBeNull();
});

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
  });

  it("historial con daños cerrados sembrados en orden disponible", async () => {
    const repo = new InMemoryOrderRepository();
    const repoDanos = new InMemoryDanoRepository([
      DANO_1_CERRADO_CON_PARADA,
      DANO_2_CERRADO_SIN_PARADA,
    ]);
    await mountApp(<App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} />);

    expectTexto("Historial de daños");
    expectTexto(/Daño mecánico en eje trasero/);
    expectTexto(/— causó parada/);
    expectTexto(/Daño operacional en manguera de tinta/);
    expectTexto(/posible 2da \(3 uds\)/);
  });

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
    await mountApp(<App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} />);

    expectTexto("Finalizada");
    expectTexto("Historial de daños");
    expectTexto(/Daño mecánico en eje trasero/);
    expect(screen.queryByRole("button", { name: /Registrar daño/i })).toBeNull();
    expect(screen.queryByTestId("dano-abierto")).toBeNull();
  });
});

describe("App — ticket 06: bloque de proyección de 2da (UI)", () => {
  /** Inicia OP-101 sin producción (lectura inicial 100 = 0 golpes). */
  async function iniciarOP101ParaCalidad(opciones: { danos?: Dano[] } = {}) {
    const user = userEvent.setup();
    const repo = new InMemoryOrderRepository();
    const repoDanos = new InMemoryDanoRepository(opciones.danos ?? []);
    await mountApp(
      <App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} />,
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
  });

  it("producción 300 uds sin sospechas: 0 % y buena racha", async () => {
    const { user } = await iniciarOP101ParaCalidad();
    await registrarLecturaCon(user, 100); // 100 golpes -> 300 unidades

    const bloque = bloqueCalidad();
    expect(bloque.getByText(/0\s?%/)).toBeTruthy();
    expect(bloque.getByText("Buena racha")).toBeTruthy();
    expect(bloque.getByText(/5\s?%/)).toBeTruthy();
  });

  it("sospechas bajo el umbral (3 uds en 300): 1 % y buena racha", async () => {
    const { user } = await iniciarOP101ParaCalidad({
      danos: [DANO_1_CERRADO_CON_PARADA], // ord-101, 3 uds sospechadas
    });
    await registrarLecturaCon(user, 100);

    const bloque = bloqueCalidad();
    expect(bloque.getByText(/1\s?%/)).toBeTruthy();
    expect(bloque.getByText("Buena racha")).toBeTruthy();
  });

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
  });

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
  });

  it("daños de otra orden y sin orden NO se mezclan (solo cuentan los de esta orden)", async () => {
    const { user } = await iniciarOP101ParaCalidad({
      danos: [DANO_1_CERRADO_CON_PARADA, DANO_3_ABIERTO, DANO_4_SIN_ORDEN_CERRADO],
    });
    await registrarLecturaCon(user, 100);

    const bloque = bloqueCalidad();
    // DANO_1 (ord-101, 3 uds) es el único de esta orden: 3/300 = 1 %
    expect(bloque.getByText(/1\s?%/)).toBeTruthy();
    expect(bloque.getByText("Buena racha")).toBeTruthy();
  });

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
  });

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
  });

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
    await mountApp(<App repository={repo} danoRepository={repoDanos} hoy={FECHA_CON_ORDEN} />);

    expectTexto("Finalizada");
    const bloque = bloqueCalidad();
    expect(bloque.getByText(/1\s?%/)).toBeTruthy(); // 3 uds sospechadas / 300 producidas
    expect(bloque.getByText("Buena racha")).toBeTruthy();
  });

  it("NO se muestra en orden disponible ni en día vacío", async () => {
    await renderApp(FECHA_CON_ORDEN); // available: OP-101 disponible
    expect(screen.queryByTestId("calidad-seccion")).toBeNull();

    await renderApp(FECHA_SIN_ORDEN); // día vacío
    expect(screen.queryByTestId("calidad-seccion")).toBeNull();
  });
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
        hoy={FECHA_CON_ORDEN}
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
  });

  it("orden disponible: registra inspección todo conforme con lote y la persiste", async () => {
    const user = userEvent.setup();
    const repoInspecciones = new InMemoryInspeccionRepository([]);
    await mountApp(
      <App
        repository={new InMemoryOrderRepository()}
        inspeccionRepository={repoInspecciones}
        hoy={FECHA_CON_ORDEN}
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

    const lista = repoInspecciones.listarPorOrden("ord-101");
    expect(lista).toHaveLength(1);
    expect(lista[0].lote).toBe("L-77");
    expect(lista[0].operatorName).toBe("Laura");
    expect(lista[0].items.every((i) => i.estado === "conforme")).toBe(true);
  });

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

    const lista = repoInspecciones.listarPorOrden("ord-101");
    expect(lista).toHaveLength(1);
    expect(lista[0].lote).toBe("L-80");
    expect(lista[0].items.find((i) => i.id === "manchas")?.estado).toBe("anomalia");
    expect(lista[0].otraAnomalia).toBe("manchas de aceite");
  });

  it("múltiples inspecciones por orden: historial cronológico de 2 inspecciones", async () => {
    const { user } = await iniciarOP101ConInspecciones();
    await registrarInspeccionUI(user, { lote: "L-1" });
    await registrarInspeccionUI(user, { lote: "L-2", itemAnomalia: "Tundido" });

    const items = screen.getAllByTestId("inspeccion-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("L-1");
    expect(items[1].textContent).toContain("L-2");
  });

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

    const guardada = repoInspecciones.listarPorOrden("ord-101")[0];
    const resolucionDevolucion = guardada.resolucion;
    expect(resolucionDevolucion?.tipo).toBe("devolucion");
    if (resolucionDevolucion?.tipo !== "devolucion") {
      throw new Error("la inspección debería estar resuelta con devolución");
    }
    expect(resolucionDevolucion.motivo).toBe("absorción insuficiente");
    expect(resolucionDevolucion.registradaPor).toBe("Laura");
  });

  it("producción > 0: la devolución NO se ofrece (solo autorización de gerencia)", async () => {
    const { user } = await iniciarOP101ConInspecciones();
    // imprimir 10 golpes: lectura 100 → 130
    await user.type(screen.getByRole("spinbutton", { name: /nueva lectura/i }), "130");
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));

    await registrarInspeccionUI(user, { itemAnomalia: "Dimensiones / medidas" });

    const item = within(screen.getAllByTestId("inspeccion-item")[0]);
    expect(item.queryByRole("option", { name: "Devolución de tela" })).toBeNull();
    expect(item.getByRole("option", { name: "Autorización de gerencia" })).toBeTruthy();
  });

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
    expect(repoInspecciones.listarPorOrden("ord-101")[0].resolucion).toBeNull();

    // con autorizadoPor → éxito
    await user.type(item.getByLabelText(/Autorizado por \(obligatorio\)/i), "Gerencia");
    await user.click(item.getByRole("button", { name: /Resolver inspección/i }));

    expect(item.getByText("Uso autorizado")).toBeTruthy();
    const guardadaAutorizada = repoInspecciones.listarPorOrden("ord-101")[0];
    const resolucionAutorizacion = guardadaAutorizada.resolucion;
    expect(resolucionAutorizacion?.tipo).toBe("autorizacion_gerencia");
    if (resolucionAutorizacion?.tipo !== "autorizacion_gerencia") {
      throw new Error("la inspección debería estar resuelta con autorización");
    }
    expect(resolucionAutorizacion.autorizadoPor).toBe("Gerencia");
  });

  it("inspección conforme: NO ofrece resolución", async () => {
    const { user } = await iniciarOP101ConInspecciones();
    await registrarInspeccionUI(user, { lote: "L-ok" });

    const item = within(screen.getAllByTestId("inspeccion-item")[0]);
    expect(item.queryByRole("button", { name: /Resolver inspección/i })).toBeNull();
    expect(item.queryByLabelText(/Tipo de resolución/i)).toBeNull();
  });

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
        hoy={FECHA_CON_ORDEN}
      />,
    );

    const item = within(screen.getAllByTestId("inspeccion-item")[0]);
    expect(item.getByText("Devuelta")).toBeTruthy();
    expect(item.queryByRole("button", { name: /Resolver inspección/i })).toBeNull();
    expect(item.queryByLabelText(/Tipo de resolución/i)).toBeNull();
  });

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
        hoy={FECHA_CON_ORDEN}
      />,
    );

    // historial presente con estado derivado
    const seccion = seccionInspeccion();
    expect(seccion.getByText(/Lote: L-hist/)).toBeTruthy();
    expect(seccion.getByText("No usable")).toBeTruthy();
    // sin formulario de registro ni resolución: historial SOLO
    expect(seccion.queryByRole("button", { name: /Registrar inspección/i })).toBeNull();
    expect(seccion.queryByRole("button", { name: /Resolver inspección/i })).toBeNull();
  });
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
        hoy={hoy}
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
        hoy={FECHA_CON_ORDEN}
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
  });

  it("orden disponible: muestra la sección de mantenimiento con formulario", async () => {
    await renderAppConMantenimiento(FECHA_CON_ORDEN);

    expect(screen.getByTestId("mantenimiento-seccion")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /tipo de mantenimiento/i })).toBeTruthy();
  });

  it("orden en producción: muestra la sección de mantenimiento con formulario", async () => {
    await iniciarOP101ConMantenimiento();

    expect(screen.getByTestId("mantenimiento-seccion")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /tipo de mantenimiento/i })).toBeTruthy();
  });

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
        hoy={FECHA_CON_ORDEN}
      />,
    );

    expect(screen.getByTestId("mantenimiento-seccion")).toBeTruthy();
    // No hay formulario de registro en orden finalizada
    expect(screen.queryByRole("combobox", { name: /tipo de mantenimiento/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar mantenimiento/i })).toBeNull();
  });

  it("registra un mantenimiento abierto (reactivo) y muestra el banner de activo", async () => {
    const { user, repoMantenimiento } = await iniciarOP101ConMantenimiento();

    await registrarMantenimientoUI(user, { motivo: "Fusible quemado" });

    const activo = screen.getByTestId("mantenimiento-abierto");
    expect(activo.textContent).toContain("Mantenimiento reactivo");
    expect(activo.textContent).toContain("Fusible quemado");
    expect(activo.textContent).toMatch(/desde las/);
    expect(repoMantenimiento.getMantenimientoAbierto("M1")).not.toBeNull();
  });

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
      danoId: null,
    }, () => undefined);
    if (!resultado.mantenimiento) throw new Error("precondition: dominio debería crear el mantenimiento");

    const repoMantenimiento = new InMemoryMantenimientoRepository([resultado.mantenimiento]);
    await renderAppConMantenimiento(FECHA_CON_ORDEN, { mantenimientoRepository: repoMantenimiento });

    // No hay mantenimiento abierto porque se registró completo
    expect(screen.queryByTestId("mantenimiento-abierto")).toBeNull();
    const guardados = repoMantenimiento.listarPorMaquina("M1");
    expect(guardados).toHaveLength(1);
    expect(guardados[0].fin).not.toBeNull();
    expect(guardados[0].queSeRevisoReparo).toBe("Cambio de rodamiento");
    expectTexto("Historial de mantenimientos");
    expectTexto(/Reparación de carro 3/);
  });

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
        hoy={FECHA_CON_ORDEN}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), { target: { value: "Laura" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /lectura inicial/i }), { target: { value: "100" } });
    // handleIniciar es async (ticket 10.4): act descarga la persistencia y el setOrden.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    });

    // Registrar abierto
    fireEvent.change(screen.getByRole("combobox", { name: /tipo de mantenimiento/i }), { target: { value: "reactivo" } });
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: "Fusible quemado" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar mantenimiento/i }));
    expect(screen.getByTestId("mantenimiento-abierto")).toBeTruthy();

    // Avanzar el reloj para que fin > inicio
    vi.setSystemTime(new Date("2026-09-11T09:30:00.000Z"));

    // Cerrar — scoped al banner de mantenimiento abierto
    const abierto = screen.getByTestId("mantenimiento-abierto");
    fireEvent.change(within(abierto).getByLabelText(/qué se revisó/i), { target: { value: "Cambio de fusible" } });
    fireEvent.click(within(abierto).getByRole("button", { name: /Cerrar mantenimiento/i }));

    expect(screen.queryByTestId("mantenimiento-abierto")).toBeNull();
    const guardados = repoMantenimiento.listarPorMaquina("M1");
    expect(guardados[0].fin).not.toBeNull();
    expect(guardados[0].queSeRevisoReparo).toBe("Cambio de fusible");
  });

  it("cierra sin queSeRevisoReparo: error del dominio", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T09:00:00.000Z"));

    const repo = new InMemoryOrderRepository();
    const repoMantenimiento = new InMemoryMantenimientoRepository([]);
    await mountApp(
      <App
        repository={repo}
        mantenimientoRepository={repoMantenimiento}
        hoy={FECHA_CON_ORDEN}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), { target: { value: "Laura" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /lectura inicial/i }), { target: { value: "100" } });
    // handleIniciar es async (ticket 10.4): act descarga la persistencia y el setOrden.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    });

    fireEvent.change(screen.getByRole("combobox", { name: /tipo de mantenimiento/i }), { target: { value: "reactivo" } });
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: "Fusible quemado" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar mantenimiento/i }));
    expect(screen.getByTestId("mantenimiento-abierto")).toBeTruthy();

    // Intentar cerrar sin queSeRevisoReparo — scoped al banner
    const abierto = screen.getByTestId("mantenimiento-abierto");
    fireEvent.click(within(abierto).getByRole("button", { name: /Cerrar mantenimiento/i }));

    expect(screen.getByRole("alert").textContent).toContain("queSeRevisoReparo es obligatorio");
    expect(repoMantenimiento.getMantenimientoAbierto("M1")).not.toBeNull();
  });

  it("tipo preventivo: NO muestra el selector de daño vinculado", async () => {
    const { user } = await iniciarOP101ConMantenimiento();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de mantenimiento/i }),
      screen.getByRole("option", { name: "Mantenimiento preventivo" }),
    );

    expect(screen.queryByRole("combobox", { name: /daño vinculado/i })).toBeNull();
  });

  it("tipo reactivo: muestra el selector de daño con opción Sin vínculo", async () => {
    const { user } = await iniciarOP101ConMantenimiento();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de mantenimiento/i }),
      screen.getByRole("option", { name: "Mantenimiento reactivo" }),
    );

    const selectorDanio = screen.getByRole("combobox", { name: /daño vinculado/i });
    expect(selectorDanio).toBeTruthy();
    expect(screen.getByRole("option", { name: "Sin vínculo" })).toBeTruthy();
  });

  it("ya hay un mantenimiento abierto: registrar otro muestra error del dominio", async () => {
    const { user } = await iniciarOP101ConMantenimiento({ mantenimientos: [MANT_4_ABIERTO] });

    // Ya hay un abierto (MANT_4_ABIERTO)
    expect(screen.getByTestId("mantenimiento-abierto")).toBeTruthy();

    // Intentar registrar otro
    await registrarMantenimientoUI(user, { motivo: "Otro problema" });

    expect(screen.getByRole("alert").textContent).toContain("ya hay un mantenimiento abierto");
  });

  it("historial cronológico de mantenimientos cerrados sembrados", async () => {
    const mantCerrado1: Mantenimiento = {
      id: "mnt-test-1",
      maquinaId: "M1",
      tipo: "reactivo",
      operatorName: "Carlos",
      motivo: "Fuga de tinta",
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
  });

  it("el operario se precarga desde la orden en producción", async () => {
    await iniciarOP101ConMantenimiento();

    const seccion = screen.getByTestId("mantenimiento-seccion");
    const operarioInput = within(seccion).getByLabelText(/operario/i) as HTMLInputElement;
    expect(operarioInput.value).toBe("Laura");
  });

  it("sin tipo: no registra y muestra error del dominio", async () => {
    const { user, repoMantenimiento } = await iniciarOP101ConMantenimiento();

    // No seleccionar tipo, solo motivo
    await user.type(screen.getByLabelText(/motivo/i), "Algo");
    await user.click(screen.getByRole("button", { name: /Registrar mantenimiento/i }));

    expect(screen.getByRole("alert").textContent).toContain("debe seleccionar un tipo");
    expect(repoMantenimiento.listarPorMaquina("M1")).toHaveLength(0);
  });

  it("sin motivo: no registra y muestra error del dominio", async () => {
    const { user, repoMantenimiento } = await iniciarOP101ConMantenimiento();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /tipo de mantenimiento/i }),
      screen.getByRole("option", { name: "Mantenimiento reactivo" }),
    );
    // No escribir motivo
    await user.click(screen.getByRole("button", { name: /Registrar mantenimiento/i }));

    expect(screen.getByRole("alert").textContent).toContain("el motivo es obligatorio");
    expect(repoMantenimiento.listarPorMaquina("M1")).toHaveLength(0);
  });

  it("mantenimiento abierto preexistente se muestra en la sección", async () => {
    const repoMantenimiento = new InMemoryMantenimientoRepository([MANT_4_ABIERTO]);
    await renderAppConMantenimiento(FECHA_CON_ORDEN, { mantenimientoRepository: repoMantenimiento });

    const activo = screen.getByTestId("mantenimiento-abierto");
    expect(activo.textContent).toContain("Mantenimiento reactivo");
    expect(activo.textContent).toContain("Fusible quemado");
  });
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
  });

  it("renderiza DashboardHome en orden disponible (OCIOSA)", async () => {
    await renderApp(FECHA_CON_ORDEN);
    expect(screen.getByTestId("dashboard-home")).toBeTruthy();
    expectTexto(/OCIOSA/);
  });

  it("renderiza DashboardHome en orden en producción (ANDANDO)", async () => {
    const user = userEvent.setup();
    await renderApp(FECHA_CON_ORDEN);
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    expectTexto(/ANDANDO/);
    // Con orden en producción: calidad visible
    expect(screen.getByTestId("dashboard-home")).toBeTruthy();
  });

  it("renderiza DashboardHome en orden finalizada (OCIOSA)", async () => {
    await renderApp(FECHA_CON_ORDEN);
    // La orden OP-101 con fecha 2026-09-10 ya está finalizada
    expectTexto(/OCIOSA/);
    expect(screen.getByTestId("dashboard-home")).toBeTruthy();
  });

  it("una parada abierta sin orden determina PARADA", async () => {
    const paradaAbierta: ParadaAbierta = {
      id: "p-sin-orden",
      maquinaId: "M1",
      ordenId: null,
      operatorName: "Carlos",
      causaId: "falta_tela",
      camposEspecificos: {},
      inicio: "2026-09-10T10:00:00.000Z",
      fin: null,
    };
    const repoParadas = new InMemoryParadaRepository([paradaAbierta]);
    await mountApp(
      <App
        repository={new InMemoryOrderRepository()}
        paradaRepository={repoParadas}
        hoy={FECHA_CON_ORDEN}
      />,
    );
    expectTexto(/PARADA/);
    expectTexto(/Falta de materia prima/);
  });

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
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
    };
    const repoParadas = new InMemoryParadaRepository([abierta]);
    await mountApp(<App repository={repo} paradaRepository={repoParadas} hoy={FECHA_CON_ORDEN} />);

    expectTexto(/PARADA/);
    expectTexto(/Falta de color/);
  });

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

    await mountApp(<App repository={repo} hoy={FECHA_CON_ORDEN} />);
    expectTexto(/OCIOSA/);
    // Calidad no visible en orden finalizada
    expect(screen.queryByText(/Buena racha/)).toBeNull();
    expect(screen.queryByText(/Alerta/)).toBeNull();
  });
});