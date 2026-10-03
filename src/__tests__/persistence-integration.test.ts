/**
 * Ticket 10.8 — Integration tests (spec 12 & 13)
 *
 * Composición end-to-end con fakes ENCADENADOS, sin SQLite real y sin plugin:
 *
 *   arranque (materializar) → flujo del operario (iniciar, registrar lectura,
 *   finalizar) → reinicio SIMULADO (repositorios NUEVOS sobre el mismo almacén
 *   persistente + `recoverPersistedState`) → el estado sigue intacto.
 *
 * El almacén sobrevive a los repositorios: cada "reinicio" crea instancias
 * nuevas de los contratos sobre el mismo almacén, que es lo que hace un
 * proceso nuevo con el mismo archivo SQLite. Nótese que los fakes NO usan
 * `InMemoryOrderRepository`: ese repositorio guarda en memoria y moriría con
 * el proceso, con lo que no probaría nada de la persistencia.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactElement } from "react";
import App from "../App";
import { materializarPrograma } from "../store/sqlite/materialize";
import {
  componerOrdenConLecturas,
  recoverPersistedState,
  type RecoveryState,
} from "../store/sqlite/recovery";
import { createFakeSqliteStore } from "../store/sqlite/__tests__/fakeSqliteStore";
import { SqliteParadaRepository } from "../store/sqlite/sqliteParadaRepository";
import { SqliteActividadPlanificadaRepository } from "../store/sqlite/sqliteActividadPlanificadaRepository";
import { SqliteDanoRepository } from "../store/sqlite/sqliteDanoRepository";
import { SqliteMantenimientoRepository } from "../store/sqlite/sqliteMantenimientoRepository";
import { SqliteInspeccionTelaRepository } from "../store/sqlite/sqliteInspeccionTelaRepository";
import { FECHA_CON_ORDEN, crearFixtureOrdenes } from "../store/fixtures";
import { jornadaDefault } from "../domain/tiempo";
import { mantenimientoAbierto } from "../domain/mantenimiento";
import { proyeccionSegundaDeOrden } from "../domain/calidad";
import { estadoInspeccion } from "../domain/inspeccionTela";
import type { ILecturaGolpeRepository, IOrderRepository } from "../store/repository";
import type { IJornadaRepository } from "../store/jornadaRepository";
import type { IParadaRepository } from "../store/paradasRepository";
import type { IActividadPlanificadaRepository } from "../store/actividadesRepository";
import type { IDanoRepository } from "../store/danosRepository";
import type { IMantenimientoRepository } from "../store/mantenimientoRepository";
import type { IInspeccionRepository } from "../store/inspeccionRepository";
import type { Dano, LecturaContador, Orden, Parada } from "../domain/types";
import { InMemoryParadaRepository } from "../store/inMemoryParadasRepository";

// ── Almacén persistente falso (equivalente conceptual al archivo SQLite) ────

interface LecturaFalsa {
  ordenId: string;
  lectureId: string;
  sequence: number;
  valor: number | null;
  timestamp: string | null;
  status: "reserved" | "persisted";
}

interface AlmacenFalso {
  ordenes: Map<string, Orden>;
  lecturas: LecturaFalsa[];
}

function crearAlmacen(): AlmacenFalso {
  return { ordenes: new Map<string, Orden>(), lecturas: [] };
}

/** Falso de `IOrderRepository` ligado a un almacén: escribe/lee como SQLite. */
function crearOrdenFalsa(almacen: AlmacenFalso): IOrderRepository {
  return {
    async materializeOrder(orden: Orden): Promise<boolean> {
      if (almacen.ordenes.has(orden.id)) return false;
      almacen.ordenes.set(orden.id, structuredClone(orden));
      return true;
    },
    async saveOrder(orden: Orden): Promise<void> {
      // saveOrder NUNCA crea: es una operación de UPDATE (contrato 10.4).
      if (!almacen.ordenes.has(orden.id)) {
        throw new Error(`no se puede guardar una orden inexistente: ${orden.id}`);
      }
      almacen.ordenes.set(orden.id, structuredClone(orden));
    },
    async getOrderByFechaOperativa(fecha: string): Promise<Orden | undefined> {
      const encontrada = [...almacen.ordenes.values()].find(
        (o) => o.fechaOperativa === fecha,
      );
      if (!encontrada) return undefined;
      // El repositorio de órdenes NO consulta lectura_golpe (10.4/10.5): la
      // composición de lecturas la hace recovery/App, no el repo de órdenes.
      return { ...structuredClone(encontrada), lecturas: [] };
    },
  };
}

/** Falso de `ILecturaGolpeRepository` ligado al mismo almacén. */
function crearLecturaFalsa(almacen: AlmacenFalso): ILecturaGolpeRepository {
  return {
    async reserveSequence(ordenId: string, lectureId: string): Promise<number> {
      const previas = almacen.lecturas.filter((l) => l.ordenId === ordenId);
      const sequence = previas.length + 1;
      almacen.lecturas.push({
        ordenId,
        lectureId,
        sequence,
        valor: null,
        timestamp: null,
        status: "reserved",
      });
      return sequence;
    },
    async completeLecture(lectureId: string, valor: number, timestamp: string): Promise<void> {
      const fila = almacen.lecturas.find(
        (l) => l.lectureId === lectureId && l.status === "reserved",
      );
      if (!fila) throw new Error(`completeLecture: lectura no reservada: ${lectureId}`);
      fila.valor = valor;
      fila.timestamp = timestamp;
      fila.status = "persisted";
    },
    async findReservation(lectureId: string) {
      const fila = almacen.lecturas.find(
        (l) => l.lectureId === lectureId && l.status === "reserved",
      );
      return fila ? { ordenId: fila.ordenId, sequence: fila.sequence } : undefined;
    },
    async getLecturasByOrden(ordenId: string): Promise<LecturaContador[]> {
      // Solo `persisted`, en orden de sequence ASC (como el ORDER BY real).
      return almacen.lecturas
        .filter((l) => l.ordenId === ordenId && l.status === "persisted")
        .sort((a, b) => a.sequence - b.sequence)
        .map((l) => ({ valor: l.valor!, timestamp: l.timestamp!, deltaGolpes: 0 }));
    },
    async getMaxSequence(ordenId: string): Promise<number> {
      const propias = almacen.lecturas.filter((l) => l.ordenId === ordenId);
      return propias.length === 0 ? 0 : Math.max(...propias.map((l) => l.sequence));
    },
  };
}

/** Jornada falsa: sin registros, devuelve el default del dominio (07:00–17:00). */
function crearJornadaFalsa(): IJornadaRepository {
  return {
    async obtenerParaFecha(fecha: string) {
      return jornadaDefault(fecha);
    },
    // La jornada no se persiste en este ticket (sigue being dominio del
    // repositorio real); el falso la acepta y no la usa.
    async guardarJornada() {
      throw new Error("la jornada no se persiste en el alcance de 10.8");
    },
  };
}

/**
 * Los cinco contratos operativos vacíos (paradas, actividades, daños,
 * mantenimientos, inspecciones — G1). El recovery solo LOS LEE; los métodos
 * de escritura existen para cumplir el contrato y nunca se llaman aquí.
 */
function crearOperativosFalsos(): {
  paradaRepository: IParadaRepository;
  actividadRepository: IActividadPlanificadaRepository;
  danoRepository: IDanoRepository;
  mantenimientoRepository: IMantenimientoRepository;
  inspeccionRepository: IInspeccionRepository;
} {
  const noEscrito = () => {
    throw new Error("método de escritura no usado por recovery en este test");
  };
  return {
    paradaRepository: {
      insertParada: noEscrito,
      updateParada: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorMaquina: async () => [],
      listarPorMaquinaYFecha: async () => [],
      listarPorOrden: async () => [],
      getParadaAbierta: async () => null,
      getParadaAbiertaDeMaquina: async () => null,
    },
    actividadRepository: {
      insertActividad: noEscrito,
      updateActividad: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorMaquina: async () => [],
      listarPorMaquinaYFecha: async () => [],
      getActividadAbierta: async () => null,
    },
    danoRepository: {
      insertDano: noEscrito,
      updateDano: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorMaquina: async () => [],
      listarPorMaquinaYFecha: async () => [],
      listarPorOrden: async () => [],
      getDanoAbierto: async () => null,
    },
    mantenimientoRepository: {
      insertMantenimiento: noEscrito,
      updateMantenimiento: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorMaquina: async () => [],
      listarPorMaquinaYFecha: async () => [],
      getMantenimientoAbierto: async () => null,
    },
    inspeccionRepository: {
      insertInspeccion: noEscrito,
      updateInspeccion: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorOrden: async () => [],
    },
  };
}

// ── Utilidades de UI ────────────────────────────────────────────────────────

async function mountApp(ui: ReactElement) {
  render(ui);
  await act(async () => {});
}

/**
 * Cada test de este archivo monta la App real y la opera con `userEvent`
 * (escritura carácter a carácter). En máquinas lentas eso puede superar el
 * `testTimeout` por defecto de 5 s sin que haya un fallo real, así que los
 * tests de UI llevan un límite explícito y cómodo.
 */
const UI_TIMEOUT = 30_000;

function appDe(ordenRepo: IOrderRepository, lecturaRepo: ILecturaGolpeRepository): ReactElement {
  return createElement(App, {
    repository: ordenRepo,
    jornadaRepository: crearJornadaFalsa(),
    lecturaRepository: lecturaRepo,
    hoy: FECHA_CON_ORDEN,
    fechaOperativaHoy: FECHA_CON_ORDEN,
  });
}

/** Inicia producción: operario + lectura inicial, y envía el formulario. */
async function iniciarOrden(operario: string, lecturaInicial: string) {
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }),
    operario,
  );
  await user.type(
    screen.getByRole("spinbutton", { name: /lectura inicial/i }),
    lecturaInicial,
  );
  await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
  await act(async () => {});
}

async function registrarLectura(valor: string) {
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("spinbutton", { name: /nueva lectura/i }),
    valor,
  );
  await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));
  await act(async () => {});
}

async function finalizarOrden() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Finalizar producción/i }));
  await act(async () => {});
}

// ── Spec 12. Flujo completo y reinicio ─────────────────────────────────────

describe("12. flujo completo persiste y sobrevive a un reinicio — Ticket 10.8", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("materializa, opera la orden y la reinstancia tras 'reiniciar' con el estado intacto", async () => {
    const almacen = crearAlmacen();

    // ── Arranque: la fuente externa entra en el almacén. ──
    const ordenRepo = crearOrdenFalsa(almacen);
    const lecturaRepo = crearLecturaFalsa(almacen);
    const programa = await materializarPrograma(ordenRepo, crearFixtureOrdenes());
    expect(programa).toEqual({ insertadas: 2, existentes: 0 });
    // La materialización no creó ninguna lectura (spec G).
    expect(almacen.lecturas).toHaveLength(0);

    // ── Flujo del operario sobre esa orden. ──
    await mountApp(appDe(ordenRepo, lecturaRepo));
    await iniciarOrden("Laura", "100");
    await registrarLectura("150");

    const enProduccion = almacen.ordenes.get("ord-101")!;
    expect(enProduccion.estado).toBe("in_production");
    expect(enProduccion.operatorName).toBe("Laura");
    expect(enProduccion.contadorBase).toBe(100);
    // Dos lecturas persistidas: la base y la nueva.
    expect(almacen.lecturas.filter((l) => l.status === "persisted")).toHaveLength(2);

    // ── "Reinicio": repositorios NUEVOS sobre el MISMO almacén. ──
    const ordenRepoTrasReinicio = crearOrdenFalsa(almacen);
    const lecturaRepoTrasReinicio = crearLecturaFalsa(almacen);
    const operativos = crearOperativosFalsos();
    const estado: RecoveryState = await recoverPersistedState(
      crearJornadaFalsa(),
      ordenRepoTrasReinicio,
      lecturaRepoTrasReinicio,
      operativos.paradaRepository,
      operativos.actividadRepository,
      operativos.danoRepository,
      operativos.mantenimientoRepository,
      operativos.inspeccionRepository,
      FECHA_CON_ORDEN,
      "M1",
    );

    expect(estado.orden?.id).toBe("ord-101");
    expect(estado.orden?.estado).toBe("in_production");
    expect(estado.orden?.operatorName).toBe("Laura");
    expect(estado.lecturas.map((l) => l.valor)).toEqual([100, 150]);
    // El dominio vuelve a derivar los golpes desde las lecturas persistidas.
    expect(estado.jornada).toEqual(jornadaDefault(FECHA_CON_ORDEN));

    // La App montada de nuevo con los repositorios nuevos ve lo mismo.
    await mountApp(appDe(ordenRepoTrasReinicio, lecturaRepoTrasReinicio));
    expect(screen.getAllByText(/En producción/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Laura").length).toBeGreaterThan(0);
  }, UI_TIMEOUT);

  it("el flujo completo (iniciar, leer, finalizar) queda persistido tras el reinicio", async () => {
    const almacen = crearAlmacen();
    const ordenRepo = crearOrdenFalsa(almacen);
    const lecturaRepo = crearLecturaFalsa(almacen);
    await materializarPrograma(ordenRepo, crearFixtureOrdenes());

    await mountApp(appDe(ordenRepo, lecturaRepo));
    await iniciarOrden("Laura", "100");
    await registrarLectura("150");
    await finalizarOrden();

    const finalizada = almacen.ordenes.get("ord-101")!;
    expect(finalizada.estado).toBe("finished");
    expect(finalizada.finalizadaEn).toEqual(expect.any(String));

    // Reinicio: el estado finished NUNCA se revierte.
    const operativos = crearOperativosFalsos();
    const estado = await recoverPersistedState(
      crearJornadaFalsa(),
      crearOrdenFalsa(almacen),
      crearLecturaFalsa(almacen),
      operativos.paradaRepository,
      operativos.actividadRepository,
      operativos.danoRepository,
      operativos.mantenimientoRepository,
      operativos.inspeccionRepository,
      FECHA_CON_ORDEN,
      "M1",
    );
    expect(estado.orden?.estado).toBe("finished");
    expect(estado.lecturas.map((l) => l.valor)).toEqual([100, 150]);
  }, UI_TIMEOUT);
});

// ── Spec 13. Recovery tras crash ────────────────────────────────────────────

describe("13. recovery tras crash preserva los datos — Ticket 10.8", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("una lectura reservada y no completada (crash en medio) NO aparece en recovery, pero la orden sí", async () => {
    const almacen = crearAlmacen();
    const ordenRepo = crearOrdenFalsa(almacen);
    const lecturaRepo = crearLecturaFalsa(almacen);
    await materializarPrograma(ordenRepo, crearFixtureOrdenes());

    await mountApp(appDe(ordenRepo, lecturaRepo));
    await iniciarOrden("Laura", "100");

    // Crash simulado: la intención quedó reservada y nunca se completó.
    await lecturaRepo.reserveSequence("ord-101", "lec- abandonada");
    const reservada = almacen.lecturas.find((l) => l.lectureId === "lec- abandonada")!;
    expect(reservada.status).toBe("reserved");

    // Recovery: solo `persisted`; la reservada se excluye (10.7).
    const operativos = crearOperativosFalsos();
    const estado = await recoverPersistedState(
      crearJornadaFalsa(),
      crearOrdenFalsa(almacen),
      crearLecturaFalsa(almacen),
      operativos.paradaRepository,
      operativos.actividadRepository,
      operativos.danoRepository,
      operativos.mantenimientoRepository,
      operativos.inspeccionRepository,
      FECHA_CON_ORDEN,
      "M1",
    );
    expect(estado.orden?.estado).toBe("in_production");
    expect(estado.lecturas).toHaveLength(1);
    expect(estado.lecturas[0]?.valor).toBe(100);
  }, UI_TIMEOUT);

  it("reinicio dos veces no duplica materialización ni lecturas", async () => {
    const almacen = crearAlmacen();
    const fuente = crearFixtureOrdenes();

    // Dos arranques consecutivos: el segundo es idempotente.
    const primero = await materializarPrograma(crearOrdenFalsa(almacen), fuente);
    const segundo = await materializarPrograma(crearOrdenFalsa(almacen), fuente);
    expect(primero).toEqual({ insertadas: 2, existentes: 0 });
    expect(segundo).toEqual({ insertadas: 0, existentes: 2 });
    expect(almacen.ordenes.size).toBe(2);

    // Un ciclo completo y luego recovery: exactamente dos lecturas.
    const ordenRepo = crearOrdenFalsa(almacen);
    const lecturaRepo = crearLecturaFalsa(almacen);
    await mountApp(appDe(ordenRepo, lecturaRepo));
    await iniciarOrden("Laura", "100");
    await registrarLectura("150");

    const operativos = crearOperativosFalsos();
    const estado = await recoverPersistedState(
      crearJornadaFalsa(),
      crearOrdenFalsa(almacen),
      crearLecturaFalsa(almacen),
      operativos.paradaRepository,
      operativos.actividadRepository,
      operativos.danoRepository,
      operativos.mantenimientoRepository,
      operativos.inspeccionRepository,
      FECHA_CON_ORDEN,
      "M1",
    );
    expect(estado.lecturas).toHaveLength(2);
    expect(estado.lecturas.map((l) => l.valor)).toEqual([100, 150]);
  }, UI_TIMEOUT);
});

// ── Phase 14.8 (G2): los cinco operativos SQLite como handlers reales ───────
//
// Los tests 10.8 previos componían la App con fakes "in memory". La phase 14
// cambió la verificación: los operativos (parada, actividad, daño,
// mantenimiento, inspección) se prueban AHORA con los adaptadores SQLite
// reales sobre el doble del store (`createFakeSqliteStore`, D2b) — que, como
// el SQLite real, IMPONE las cinco FK de 004. El gestor de la App sigue siendo
// el mismo código de producción (el puerto como fuente de verdad).

describe("14. el reinicio con los cinco operativos SQLite reales — G2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("14.8a: los cinco operativos SQLite sobreviven al reinicio con los derivados idénticos", async () => {
    const almacen = crearAlmacen();
    const ordenRepo = crearOrdenFalsa(almacen);
    const lecturaRepo = crearLecturaFalsa(almacen);
    await materializarPrograma(ordenRepo, crearFixtureOrdenes());

    // El doble del store SQLite. La orden vive en el almacén de órdenes falso,
    // pero las FK de parada/daño/inspección apuntan a la tabla `orden` del
    // store: se siembra la fila destino (como `sembrarEnlaces` de los tests de
    // adaptadores) para que los INSERT pasen la FK por el id de la orden.
    const store = createFakeSqliteStore();
    store.orden.push({ id: "ord-101" });

    const operativos = {
      parada: new SqliteParadaRepository(store),
      actividad: new SqliteActividadPlanificadaRepository(store),
      dano: new SqliteDanoRepository(store),
      mantenimiento: new SqliteMantenimientoRepository(store),
      inspeccion: new SqliteInspeccionTelaRepository(store),
    };

    // ── Primer arranque: la App usa los adaptadores SQLite reales. ──
    await mountApp(
      createElement(App, {
        repository: ordenRepo,
        jornadaRepository: crearJornadaFalsa(),
        lecturaRepository: lecturaRepo,
        hoy: FECHA_CON_ORDEN,
        fechaOperativaHoy: FECHA_CON_ORDEN,
        paradaRepository: operativos.parada,
        actividadRepository: operativos.actividad,
        danoRepository: operativos.dano,
        mantenimientoRepository: operativos.mantenimiento,
        inspeccionRepository: operativos.inspeccion,
      }),
    );
    await iniciarOrden("Laura", "100");
    await registrarLectura("150");

    const user = userEvent.setup();

    // Parada con datos específicos de causa (falta_color → "Color") y cierre.
    const formParada = screen.getByRole("form", { name: /registrar parada/i });
    await user.selectOptions(
      within(formParada).getByRole("combobox", { name: /causa de la parada/i }),
      "falta_color",
    );
    await user.type(within(formParada).getByLabelText("Color"), "rojo");
    await user.type(
      within(formParada).getByLabelText(/observaciones/i),
      "se terminó la pintura roja",
    );
    await user.click(within(formParada).getByRole("button", { name: /registrar parada/i }));
    await act(async () => {});
    await user.click(screen.getByRole("button", { name: /cerrar parada/i }));
    await act(async () => {});

    // Actividad planificada (limpieza → "Qué se limpió") y cierre.
    const formActividad = screen.getByRole("form", { name: /registrar actividad/i });
    await user.selectOptions(
      within(formActividad).getByRole("combobox", { name: /tipo de actividad/i }),
      "limpieza",
    );
    await user.type(
      within(formActividad).getByLabelText(/qué se limpió/i),
      "mesa de estampado",
    );
    await user.clear(within(formActividad).getByLabelText(/operario de la actividad/i));
    await user.type(
      within(formActividad).getByLabelText(/operario de la actividad/i),
      "Laura",
    );
    await user.click(within(formActividad).getByRole("button", { name: /registrar actividad/i }));
    await act(async () => {});
    await user.click(screen.getByRole("button", { name: /cerrar actividad/i }));
    await act(async () => {});

    // Daño abierto con posible segunda (5 uds sobre 150 producidas = 3.33%).
    const formDano = screen.getByRole("form", { name: /registrar daño/i });
    await user.selectOptions(
      within(formDano).getByRole("combobox", { name: /tipo de daño/i }),
      "mecanico",
    );
    await user.type(within(formDano).getByLabelText(/componente afectado/i), "eje trasero");
    await user.click(within(formDano).getByLabelText(/posible segunda/i));
    await user.type(within(formDano).getByLabelText(/unidades sospechadas/i), "5");
    await user.click(within(formDano).getByRole("button", { name: /registrar daño/i }));
    await act(async () => {});

    // Mantenimiento preventivo EN CURSO (sin cerrar: fin queda null).
    const formMantenimiento = screen.getByRole("form", { name: /registrar mantenimiento/i });
    await user.selectOptions(
      within(formMantenimiento).getByRole("combobox", { name: /tipo de mantenimiento/i }),
      "preventivo",
    );
    await user.type(
      within(formMantenimiento).getByLabelText(/motivo/i),
      "lubricación mensual",
    );
    await user.click(within(formMantenimiento).getByRole("button", { name: /registrar mantenimiento/i }));
    await act(async () => {});

    // Inspección con anomalía (Manchas) y lote, resuelta por gerencia (la
    // devolución solo se ofrece con producción 0, y ya hay 50 golpes).
    const formInspeccion = screen.getByRole("form", { name: /registrar inspección/i });
    await user.type(within(formInspeccion).getByLabelText(/lote/i), "L-103");
    await user.click(within(formInspeccion).getByLabelText("Manchas: Anomalía"));
    await user.type(
      within(formInspeccion).getByLabelText(/otra anomalía/i),
      "olor fuerte",
    );
    await user.click(within(formInspeccion).getByRole("button", { name: /registrar inspección/i }));
    await act(async () => {});

    const formResolver = screen.getByRole("form", { name: /resolver inspección/i });
    await user.selectOptions(
      within(formResolver).getByRole("combobox", { name: /tipo de resolución/i }),
      "autorizacion_gerencia",
    );
    await user.type(
      within(formResolver).getByLabelText(/autorizado por/i),
      "Gerencia turno mañana",
    );
    await user.click(within(formResolver).getByRole("button", { name: /resolver inspección/i }));
    await act(async () => {});

    // ── "Antes": el dashboard vivo con los cinco eventos. ──
    const dashboardVivo = screen.getByTestId("dashboard-home");
    const estadoAntes = within(dashboardVivo).getByText(/ANDANDO|PARADA|OCIOSA/).textContent;
    const calidadAntes = within(dashboardVivo).getByText(/Alerta|Buena racha/).textContent;
    const bucketsAntes = {
      disponible: screen.getByTestId("dashboard-home_disponible").textContent,
      planificado: screen.getByTestId("dashboard-home_planificado").textContent,
      incidencias: screen.getByTestId("dashboard-home_incidencias").textContent,
      productivo: screen.getByTestId("dashboard-home_productivo").textContent,
    };
    expect(estadoAntes).toBe("▶ ANDANDO");
    // 5 sospechadas / 150 producidas = 3.33% > UMBRAL_ALERTA_2DA: la calidad
    // "antes" DEBE ser la alerta (no solo "Buena racha").
    expect(calidadAntes).toContain("Alerta");

    // ── Reinicio: adaptadores FRESCOS sobre el MISMO store. ──
    const reinicio = {
      parada: new SqliteParadaRepository(store),
      actividad: new SqliteActividadPlanificadaRepository(store),
      dano: new SqliteDanoRepository(store),
      mantenimiento: new SqliteMantenimientoRepository(store),
      inspeccion: new SqliteInspeccionTelaRepository(store),
    };
    const estado: RecoveryState = await recoverPersistedState(
      crearJornadaFalsa(),
      crearOrdenFalsa(almacen),
      crearLecturaFalsa(almacen),
      reinicio.parada,
      reinicio.actividad,
      reinicio.dano,
      reinicio.mantenimiento,
      reinicio.inspeccion,
      FECHA_CON_ORDEN,
      "M1",
    );

    expect(estado.orden?.estado).toBe("in_production");
    expect(estado.orden?.operatorName).toBe("Laura");
    expect(estado.lecturas.map((l) => l.valor)).toEqual([100, 150]);

    // Parada: causa, campos específicos, cierre y operario intactos.
    expect(estado.paradas).toHaveLength(1);
    expect(estado.paradas[0]).toMatchObject({
      maquinaId: "M1",
      ordenId: "ord-101",
      operatorName: "Laura",
      causaId: "falta_color",
      camposEspecificos: { color: "rojo" },
      observaciones: "se terminó la pintura roja",
    });
    expect(estado.paradas[0]!.fin).not.toBeNull();

    // Actividad: limpieza con qué se limpió y cierre.
    expect(estado.actividades).toHaveLength(1);
    expect(estado.actividades[0]).toMatchObject({
      maquinaId: "M1",
      tipo: "limpieza",
      operatorName: "Laura",
      queSeLimpio: "mesa de estampado",
    });
    expect(estado.actividades[0]!.fin).not.toBeNull();

    // Daño: abierto (fin null), con su sospecha de segunda.
    expect(estado.danos).toHaveLength(1);
    expect(estado.danos[0]).toMatchObject({
      maquinaId: "M1",
      ordenId: "ord-101",
      operatorName: "Laura",
      tipo: "mecanico",
      componente: "eje trasero",
      posibleSegunda: true,
      unidadesSospechadas: 5,
    });
    expect(estado.danos[0]!.fin).toBeNull();

    // Mantenimiento: preventivo EN CURSO, sin daño vinculado.
    expect(estado.mantenimientos).toHaveLength(1);
    expect(estado.mantenimientos[0]).toMatchObject({
      maquinaId: "M1",
      tipo: "preventivo",
      operatorName: "Laura",
      motivo: "lubricación mensual",
      danoId: null,
    });
    expect(estado.mantenimientos[0]!.fin).toBeNull();
    expect(mantenimientoAbierto(estado.mantenimientos, "M1")).not.toBeNull();

    // Inspección: checklist con la anomalía, lote y resolución por gerencia.
    expect(estado.inspecciones).toHaveLength(1);
    const inspeccion = estado.inspecciones[0]!;
    expect(inspeccion).toMatchObject({
      ordenId: "ord-101",
      operatorName: "Laura",
      lote: "L-103",
      otraAnomalia: "olor fuerte",
    });
    expect(inspeccion.items.find((i) => i.id === "manchas")?.estado).toBe("anomalia");
    expect(inspeccion.resolucion).toMatchObject({
      tipo: "autorizacion_gerencia",
      autorizadoPor: "Gerencia turno mañana",
      timestamp: expect.any(String),
    });
    expect(estadoInspeccion(inspeccion)).toBe("uso_autorizado");

    // Derivados recomputados sobre los datos recuperados: segunda >3% → alerta.
    // Recovery separa orden y lecturas (D2e); los derivados operan sobre la
    // orden compuesta, como hace la App al consumir `estadoInicial`.
    const ordenCompuesta = componerOrdenConLecturas(estado.orden!, estado.lecturas);
    const proyeccion = proyeccionSegundaDeOrden(ordenCompuesta, estado.danos);
    expect(proyeccion.proyeccion.estado).toBe("alerta");
    expect(proyeccion.proyeccion.pct).toBeCloseTo(5 / 150, 4);

    // ── "Después": la App montada de nuevo con los repos FRESCOS y el estado
    // recuperado muestra exactamente el mismo dashboard derivado. ──
    await mountApp(
      createElement(App, {
        repository: crearOrdenFalsa(almacen),
        jornadaRepository: crearJornadaFalsa(),
        lecturaRepository: crearLecturaFalsa(almacen),
        hoy: FECHA_CON_ORDEN,
        fechaOperativaHoy: FECHA_CON_ORDEN,
        estadoInicial: estado,
        paradaRepository: reinicio.parada,
        actividadRepository: reinicio.actividad,
        danoRepository: reinicio.dano,
        mantenimientoRepository: reinicio.mantenimiento,
        inspeccionRepository: reinicio.inspeccion,
      }),
    );

    const dashboards = screen.getAllByTestId("dashboard-home");
    const dashboardDespues = dashboards[dashboards.length - 1]!;
    expect(within(dashboardDespues).getByText(/ANDANDO|PARADA|OCIOSA/).textContent).toBe(
      estadoAntes,
    );
    const calidadDespues = within(dashboardDespues).getByText(/Alerta|Buena racha/).textContent;
    expect(calidadDespues).toBe(calidadAntes);
    // La alerta 2da >3% se RECOMPUTA idéntica tras el reinicio (no un
    // "Buena racha"-vs-"Buena racha" pasivo): el delta del contador se
    // reconstruye desde los valores absolutos (G2 / CORRECTION 11).
    expect(calidadDespues).toContain("Alerta");
    // Los buckets provienen de timestamps persistidos: recomputados idénticos.
    expect(screen.getAllByTestId("dashboard-home_disponible").at(-1)!.textContent).toBe(
      bucketsAntes.disponible,
    );
    expect(screen.getAllByTestId("dashboard-home_planificado").at(-1)!.textContent).toBe(
      bucketsAntes.planificado,
    );
    expect(screen.getAllByTestId("dashboard-home_incidencias").at(-1)!.textContent).toBe(
      bucketsAntes.incidencias,
    );
    expect(screen.getAllByTestId("dashboard-home_productivo").at(-1)!.textContent).toBe(
      bucketsAntes.productivo,
    );
    // El historial de inspecciones vuelve a mostrar la resolución por gerencia.
    // El texto se divide en dos nodos (<strong> + valor); se matchea el nodo
    // fuerte, igual que App.test.tsx:1534.
    expect(
      screen.getAllByText(/Uso autorizado por gerencia/).length,
    ).toBeGreaterThan(0);
  }, UI_TIMEOUT);

  it("14.8b: A1/A1b/A2 — el daño con paradaId colgado guarda por el dominio, no por la FK", async () => {
    const almacen = crearAlmacen();
    const ordenRepo = crearOrdenFalsa(almacen);
    const lecturaRepo = crearLecturaFalsa(almacen);
    await materializarPrograma(ordenRepo, crearFixtureOrdenes());

    const store = createFakeSqliteStore();
    store.orden.push({ id: "ord-101" });

    // ── A1 (control, bypass de la App): el adaptador SQLite REAL rechaza por
    // FK cuando el paradaId no existe. Sin la capa de dominio, el INSERT a
    // `dano.parada_id` no encuentra la fila en `parada` y falla. ──
    const danoRepository = new SqliteDanoRepository(store);
    const dañoConParadaColgada: Dano = {
      id: "dano-a1",
      maquinaId: "M1",
      ordenId: "ord-101",
      operatorName: "Laura",
      tipo: "mecanico",
      componente: "eje trasero",
      fechaOperativa: "2026-09-14",
      inicio: "2026-09-14T10:00:00.000Z",
      fin: null,
      causoParada: true,
      paradaId: "no-existe",
      posibleSegunda: false,
    };
    await expect(danoRepository.insertDano(dañoConParadaColgada)).rejects.toMatchObject({
      message: expect.stringContaining('no se pudo persistir el daño "dano-a1"'),
      cause: { message: "FOREIGN KEY constraint failed" },
    });
    expect(store.dano).toHaveLength(0);

    // ── A1b (control): con la parada sembrada, el MISMO insert resuelve. ──
    store.parada.push({ id: "parada-1" });
    await expect(
      danoRepository.insertDano({ ...dañoConParadaColgada, id: "dano-a1b", paradaId: "parada-1" }),
    ).resolves.toBeUndefined();
    expect(store.dano).toHaveLength(1);

    // ── A2: la App con el adaptador SQLite real: el guard del dominio corta
    // ANTES del insert → error propio, sin "FOREIGN KEY" en la UI. ──
    await mountApp(
      createElement(App, {
        repository: ordenRepo,
        jornadaRepository: crearJornadaFalsa(),
        lecturaRepository: lecturaRepo,
        hoy: FECHA_CON_ORDEN,
        fechaOperativaHoy: FECHA_CON_ORDEN,
        paradaRepository: new SqliteParadaRepository(store),
        danoRepository,
      }),
    );
    await iniciarOrden("Laura", "100");

    const user = userEvent.setup();
    const formDano = screen.getByRole("form", { name: /registrar daño/i });
    await user.selectOptions(
      within(formDano).getByRole("combobox", { name: /tipo de daño/i }),
      "mecanico",
    );
    await user.type(within(formDano).getByLabelText(/componente afectado/i), "eje trasero");
    // Sin paradas cerradas, el select "Parada vinculada" no tiene opciones:
    // se inyecta la opción colgada (mismo truco que App.test.tsx spec 14.(b)).
    await user.click(within(formDano).getByLabelText(/este daño causó una parada/i));
    const selectParada = within(formDano).getByRole("combobox", { name: /parada vinculada/i }) as HTMLSelectElement;
    const opcionColgada = document.createElement("option");
    opcionColgada.value = "no-existe";
    opcionColgada.text = "no-existe";
    selectParada.add(opcionColgada);
    selectParada.value = "no-existe";
    fireEvent.change(selectParada);
    await act(async () => {});

    await user.click(within(formDano).getByRole("button", { name: /registrar daño/i }));
    await act(async () => {});

    const errores = within(formDano).getByRole("alert").textContent ?? "";
    expect(errores).toContain("la parada vinculada no existe: no-existe");
    expect(errores).not.toContain("FOREIGN KEY");
    // El guard del dominio impidió el INSERT del daño de A2: el store conserva
    // solo el daño sembrado por A1b (nunca llega un segundo insert).
    expect(store.dano).toHaveLength(1);
  }, UI_TIMEOUT);
});

// ── OQ-4: paridad de `getParadaAbiertaDeMaquina` entre adaptadores ───────────
//
// Un puerto tiene DOS implementaciones. Un método nuevo que las dos implementan
// no está completo hasta que se demuestra que devuelven lo MISMO ante el mismo
// almacén: si difieren, el comportamiento de la aplicación depende de cuál
// adaptador se montó, y eso no es un detalle de implementación sino del
// contrato. Estos casos corren el MISMO escenario por los dos adaptadores y
// comparan el resultado, en vez de repetir la misma expectativa en dos suites
// que podrían divergir sin que nadie lo note.

describe("OQ-4: paridad InMemory/SQLite de la parada abierta de la máquina", () => {
  /** Una parada abierta con día y orden explícitos. */
  function abierta(overrides: Partial<Parada> = {}): Parada {
    return {
      id: "par-abierta",
      maquinaId: "M1",
      ordenId: null,
      operatorName: "Laura",
      causaId: "falta_tela",
      camposEspecificos: {},
      fechaOperativa: "2026-09-14",
      inicio: "2026-09-14T07:00:00.000Z",
      fin: null,
      ...overrides,
    };
  }

  /** Los dos adaptadores sembrados con las MISMAS paradas. */
  async function parDeAdaptadores(
    paradas: Parada[],
  ): Promise<{ inMemory: IParadaRepository; sqlite: IParadaRepository }> {
    const store = createFakeSqliteStore();
    for (const id of ["ord-A", "ord-B"]) {
      store.orden.push({ id });
    }
    const sqlite = new SqliteParadaRepository(store);
    for (const p of paradas) {
      // `insertParada` valida la FK: se siembra y se espera antes de comparar,
      // para no lesterear al adaptador con una lectura sobre un store a medio
      // escribir.
      await sqlite.insertParada(p);
    }
    return { inMemory: new InMemoryParadaRepository(paradas), sqlite };
  }

  it("coinciden con la máquina parada y sin orden", async () => {
    const { inMemory, sqlite } = await parDeAdaptadores([
      abierta({ id: "p-suelta", ordenId: null }),
    ]);

    const [uno, otro] = await Promise.all([
      inMemory.getParadaAbiertaDeMaquina("M1"),
      sqlite.getParadaAbiertaDeMaquina("M1"),
    ]);

    expect(uno).toEqual(otro);
    expect(uno?.id).toBe("p-suelta");
  });

  it("coinciden con la parada abierta de la orden actual", async () => {
    const { inMemory, sqlite } = await parDeAdaptadores([
      abierta({ id: "p-de-hoy", ordenId: "ord-B" }),
    ]);

    const [uno, otro] = await Promise.all([
      inMemory.getParadaAbiertaDeMaquina("M1"),
      sqlite.getParadaAbiertaDeMaquina("M1"),
    ]);

    expect(uno).toEqual(otro);
    expect(uno?.id).toBe("p-de-hoy");
  });

  it("coinciden con la parada abierta de una orden ANTERIOR tras cambiar de orden", async () => {
    const { inMemory, sqlite } = await parDeAdaptadores([
      abierta({ id: "p-de-orden-a", ordenId: "ord-A", fechaOperativa: "2026-09-14" }),
    ]);

    const [uno, otro] = await Promise.all([
      inMemory.getParadaAbiertaDeMaquina("M1"),
      sqlite.getParadaAbiertaDeMaquina("M1"),
    ]);

    expect(uno).toEqual(otro);
    // Y el día de origen intacto en ambos: no hay reatribución ni duplicado.
    expect(uno?.fechaOperativa).toBe("2026-09-14");
    expect(otro?.fechaOperativa).toBe("2026-09-14");
  });

  it("coinciden cuando la máquina no está parada", async () => {
    const { inMemory, sqlite } = await parDeAdaptadores([
      abierta({ fin: "2026-09-14T08:00:00.000Z" }),
    ]);

    const [uno, otro] = await Promise.all([
      inMemory.getParadaAbiertaDeMaquina("M1"),
      sqlite.getParadaAbiertaDeMaquina("M1"),
    ]);

    expect(uno).toBeNull();
    expect(otro).toBeNull();
  });

  it("coinciden al desambiguar varias abiertas de la misma máquina", async () => {
    const { inMemory, sqlite } = await parDeAdaptadores([
      abierta({ id: "p-tarde", inicio: "2026-09-14T08:00:00.000Z" }),
      abierta({ id: "p-temprana", inicio: "2026-09-14T07:00:00.000Z" }),
    ]);

    const [uno, otro] = await Promise.all([
      inMemory.getParadaAbiertaDeMaquina("M1"),
      sqlite.getParadaAbiertaDeMaquina("M1"),
    ]);

    expect(uno).toEqual(otro);
    expect(uno?.id).toBe("p-temprana");
  });
});
