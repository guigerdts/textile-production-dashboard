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
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactElement } from "react";
import App from "../App";
import { materializarPrograma } from "../store/sqlite/materialize";
import {
  recoverPersistedState,
  type RecoveryState,
} from "../store/sqlite/recovery";
import { FECHA_CON_ORDEN, crearFixtureOrdenes } from "../store/fixtures";
import { jornadaDefault } from "../domain/tiempo";
import type { ILecturaGolpeRepository, IOrderRepository } from "../store/repository";
import type { IJornadaRepository } from "../store/jornadaRepository";
import type { IParadaRepository } from "../store/paradasRepository";
import type { IActividadPlanificadaRepository } from "../store/actividadesRepository";
import type { IDanoRepository } from "../store/danosRepository";
import type { IMantenimientoRepository } from "../store/mantenimientoRepository";
import type { IInspeccionRepository } from "../store/inspeccionRepository";
import type { LecturaContador, Orden } from "../domain/types";

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
      listarPorOrden: async () => [],
      getParadaAbierta: async () => null,
    },
    actividadRepository: {
      insertActividad: noEscrito,
      updateActividad: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorMaquina: async () => [],
      getActividadAbierta: async () => null,
    },
    danoRepository: {
      insertDano: noEscrito,
      updateDano: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorMaquina: async () => [],
      listarPorOrden: async () => [],
      getDanoAbierto: async () => null,
    },
    mantenimientoRepository: {
      insertMantenimiento: noEscrito,
      updateMantenimiento: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorMaquina: async () => [],
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
