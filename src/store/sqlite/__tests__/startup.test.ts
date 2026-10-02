/**
 * Ticket 10.8 — Startup Tests (spec F, H, I)
 *
 * Two layers, no plugin mock and no real SQLite:
 *
 * 1. F — composition of contracts: after `materializarPrograma`, the real
 *    `recoverPersistedState` finds the materialized order AND its persisted
 *    lecturas. Driven by fakes of the repository interfaces (same style as the
 *    10.7 recovery suite).
 *
 * 2. H / I — the real `src/main.tsx` composition root, with ONLY the SQLite
 *    boundary faked (initDatabase + the EIGHT SQLite repository classes +
 *    react-dom/client). `materializarPrograma` and `recoverPersistedState` run
 *    for real, so the asserted order is the real startup sequence:
 *    initDatabase -> repos -> materializar -> recovery -> render(App).
 *    I asserts that a failure in materialization or recovery aborts the
 *    startup and renders the explicit initialization-error screen, never a
 *    partially initialized App.
 *
 * HONESTY NOTE (10.8): `main.tsx` is verified against fakes of the plugin
 * boundary. Real Tauri/SQLite startup (migrations applied by the Rust side,
 * WAL, real INSERT ... ON CONFLICT, close/reopen) remains PENDING runtime
 * validation.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";

import { materializarPrograma } from "../materialize";
import { recoverPersistedState, type RecoveryState } from "../recovery";
import type { IJornadaRepository } from "../../jornadaRepository";
import type { IOrderRepository, ILecturaGolpeRepository } from "../../repository";
import type { IParadaRepository } from "../../paradasRepository";
import type { IActividadPlanificadaRepository } from "../../actividadesRepository";
import type { IDanoRepository } from "../../danosRepository";
import type { IMantenimientoRepository } from "../../mantenimientoRepository";
import type { IInspeccionRepository } from "../../inspeccionRepository";
import type { LecturaContador, Orden } from "../../../domain/types";
import { jornadaDefault } from "../../../domain/tiempo";
import { FECHA_CON_ORDEN } from "../../fixtures";

const FECHA = FECHA_CON_ORDEN;
const TS = "2026-09-11T07:00:00.000Z";

/** Orden de la fuente externa (equivalente al fixture ord-101). */
const ORDEN: Orden = {
  id: "ord-101",
  numeroOrden: "OP-101",
  diseno: "Jessie",
  telaReferencia: "T-100",
  unidadesSolicitadas: 2400,
  aplicaSegunda: false,
  porcentaje2da: 0,
  tipoPintura: "reactiva",
  machineId: "M1",
  fechaOperativa: FECHA,
  estado: "available",
  creadaExternamenteEn: "2026-09-10T10:00:00.000Z",
  lecturas: [],
};

// ── Fakes de contratos (encadenados sobre el mismo almacén) ──────────────────

interface LecturaFila {
  ordenId: string;
  sequence: number;
  valor: number;
  timestamp: string;
  status: "reserved" | "persisted";
}

/** Fakes de los tres contratos sobre almacenes en memoria, con bitácora. */
function crearFakes(bitacora: string[] = []) {
  const ordenes = new Map<string, Orden>();
  const lecturas: LecturaFila[] = [];

  const jornadaRepository: IJornadaRepository = {
    obtenerParaFecha: vi.fn(async (fecha: string) => {
      bitacora.push("jornada:obtenerParaFecha");
      return jornadaDefault(fecha);
    }),
    guardarJornada: vi.fn(async () => {
      bitacora.push("jornada:guardarJornada");
    }),
  };

  const orderRepository: IOrderRepository = {
    getOrderByFechaOperativa: vi.fn(async (fecha: string) => {
      bitacora.push("orden:getOrderByFechaOperativa");
      for (const o of ordenes.values()) {
        if (o.fechaOperativa === fecha) return structuredClone(o);
      }
      return undefined;
    }),
    saveOrder: vi.fn(async (orden: Orden) => {
      bitacora.push("orden:saveOrder");
      if (!ordenes.has(orden.id)) {
        throw new Error(`no se puede guardar una orden inexistente: ${orden.id}`);
      }
      ordenes.set(orden.id, structuredClone(orden));
    }),
    materializeOrder: vi.fn(async (orden: Orden) => {
      bitacora.push("orden:materializeOrder");
      if (ordenes.has(orden.id)) return false;
      ordenes.set(orden.id, structuredClone(orden));
      return true;
    }),
  };

  const lecturaRepository: ILecturaGolpeRepository = {
    reserveSequence: vi.fn(async (ordenId: string, lectureId: string) => {
      bitacora.push("lectura:reserveSequence");
      const existente = lecturas.find((l) => l.ordenId === ordenId);
      const sequence = (existente?.sequence ?? 0) + 1;
      lecturas.push({ ordenId, sequence, valor: 0, timestamp: lectureId, status: "reserved" });
      return sequence;
    }),
    completeLecture: vi.fn(async (lectureId: string, valor: number, timestamp: string) => {
      bitacora.push("lectura:completeLecture");
      const fila = lecturas.find((l) => l.timestamp === lectureId && l.status === "reserved");
      if (!fila) throw new Error(`completeLecture: lectura no encontrada: ${lectureId}`);
      fila.valor = valor;
      fila.timestamp = timestamp;
      fila.status = "persisted";
    }),
    findReservation: vi.fn(async () => undefined),
    getLecturasByOrden: vi.fn(async (ordenId: string): Promise<LecturaContador[]> => {
      bitacora.push("lectura:getLecturasByOrden");
      return lecturas
        .filter((l) => l.ordenId === ordenId && l.status === "persisted")
        .sort((a, b) => a.sequence - b.sequence)
        .map((l) => ({ valor: l.valor, timestamp: l.timestamp, deltaGolpes: 0 }));
    }),
    getMaxSequence: vi.fn(async () => 0),
  };

  // Los cinco dominios operativos (G1): recovery los LEE por contrato; los
  // métodos de escritura existen para cumplir el contrato y nunca se llaman
  // en el arranque.
  const paradaRepository: IParadaRepository = {
    insertParada: vi.fn(async () => {}),
    updateParada: vi.fn(async () => {}),
    obtenerPorId: vi.fn(async () => undefined),
    listarPorMaquina: vi.fn(async () => {
      bitacora.push("parada:listarPorMaquina");
      return [];
    }),
    listarPorOrden: vi.fn(async () => []),
    getParadaAbierta: vi.fn(async () => null),
    getParadaAbiertaDeMaquina: vi.fn(async () => null),
  };

  const actividadRepository: IActividadPlanificadaRepository = {
    insertActividad: vi.fn(async () => {}),
    updateActividad: vi.fn(async () => {}),
    obtenerPorId: vi.fn(async () => undefined),
    listarPorMaquina: vi.fn(async () => {
      bitacora.push("actividad:listarPorMaquina");
      return [];
    }),
    getActividadAbierta: vi.fn(async () => null),
  };

  const danoRepository: IDanoRepository = {
    insertDano: vi.fn(async () => {}),
    updateDano: vi.fn(async () => {}),
    obtenerPorId: vi.fn(async () => undefined),
    listarPorMaquina: vi.fn(async () => {
      bitacora.push("dano:listarPorMaquina");
      return [];
    }),
    listarPorOrden: vi.fn(async () => []),
    getDanoAbierto: vi.fn(async () => null),
  };

  const mantenimientoRepository: IMantenimientoRepository = {
    insertMantenimiento: vi.fn(async () => {}),
    updateMantenimiento: vi.fn(async () => {}),
    obtenerPorId: vi.fn(async () => undefined),
    listarPorMaquina: vi.fn(async () => {
      bitacora.push("mantenimiento:listarPorMaquina");
      return [];
    }),
    getMantenimientoAbierto: vi.fn(async () => null),
  };

  const inspeccionRepository: IInspeccionRepository = {
    insertInspeccion: vi.fn(async () => {}),
    updateInspeccion: vi.fn(async () => {}),
    obtenerPorId: vi.fn(async () => undefined),
    listarPorOrden: vi.fn(async () => {
      bitacora.push("inspeccion:listarPorOrden");
      return [];
    }),
  };

  return {
    ordenes,
    lecturas,
    jornadaRepository,
    orderRepository,
    lecturaRepository,
    paradaRepository,
    actividadRepository,
    danoRepository,
    mantenimientoRepository,
    inspeccionRepository,
  };
}

// ── F. Materialización + recovery ───────────────────────────────────────────

describe("F: materialización + recovery — Ticket 10.8", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("F: tras materializar, recoverPersistedState encuentra la orden y sus lecturas persistidas", async () => {
    const bitacora: string[] = [];
    const fakes = crearFakes(bitacora);

    // 1. Startup: materializa la fuente externa.
    const programa = await materializarPrograma(fakes.orderRepository, [ORDEN]);
    expect(programa).toEqual({ insertadas: 1, existentes: 0 });

    // 2. La orden existe; el operario inicia y registra una lectura real.
    const lectureId = "lec-1";
    const sequence = await fakes.lecturaRepository.reserveSequence(ORDEN.id, lectureId);
    expect(sequence).toBe(1); // primera lectura real: sequence 1
    await fakes.lecturaRepository.completeLecture(lectureId, 100, TS);
    const iniciada = await fakes.orderRepository.getOrderByFechaOperativa(FECHA);
    await fakes.orderRepository.saveOrder({
      ...iniciada!,
      estado: "in_production",
      operatorName: "Laura",
    });

    // 3. Recovery (restart) encuentra la orden, las lecturas persistidas y los
    //    cinco dominios operativos (G1: 8 fuentes).
    const estado: RecoveryState = await recoverPersistedState(
      fakes.jornadaRepository,
      fakes.orderRepository,
      fakes.lecturaRepository,
      fakes.paradaRepository,
      fakes.actividadRepository,
      fakes.danoRepository,
      fakes.mantenimientoRepository,
      fakes.inspeccionRepository,
      FECHA,
      "M1",
    );

    expect(estado.orden).toBeDefined();
    expect(estado.orden!.id).toBe("ord-101");
    expect(estado.orden!.estado).toBe("in_production");
    expect(estado.orden!.operatorName).toBe("Laura");
    expect(estado.lecturas).toEqual([{ valor: 100, timestamp: TS, deltaGolpes: 0 }]);
    expect(estado.jornada).toEqual(jornadaDefault(FECHA));
    // Los cinco dominios operativos llegan desde su contrato (vacíos hoy).
    expect(estado.paradas).toEqual([]);
    expect(estado.actividades).toEqual([]);
    expect(estado.danos).toEqual([]);
    expect(estado.mantenimientos).toEqual([]);
    expect(estado.inspecciones).toEqual([]);

    // Orden de la fuente antes que el de la lectura: materialización primero.
    const fuenteIndex = bitacora.indexOf("orden:materializeOrder");
    const lecturaIndex = bitacora.indexOf("lectura:getLecturasByOrden");
    expect(fuenteIndex).toBeLessThan(lecturaIndex);
  });

  it("F: día vacío (fuente sin órdenes) -> recovery devuelve orden undefined y lecturas vacías", async () => {
    const fakes = crearFakes();
    const programa = await materializarPrograma(fakes.orderRepository, []);
    expect(programa).toEqual({ insertadas: 0, existentes: 0 });

    const estado = await recoverPersistedState(
      fakes.jornadaRepository,
      fakes.orderRepository,
      fakes.lecturaRepository,
      fakes.paradaRepository,
      fakes.actividadRepository,
      fakes.danoRepository,
      fakes.mantenimientoRepository,
      fakes.inspeccionRepository,
      FECHA,
      "M1",
    );
    expect(estado.orden).toBeUndefined();
    expect(estado.lecturas).toEqual([]);
    expect(fakes.lecturaRepository.getLecturasByOrden).not.toHaveBeenCalled();
    // Sin orden, el guard de inspecciones tampoco consulta (mismo guard que lecturas).
    expect(fakes.inspeccionRepository.listarPorOrden).not.toHaveBeenCalled();
  });
});

// ── H / I. La composición raíz real (main.tsx) ──────────────────────────────

/**
 * Carga `src/main.tsx` con la frontera SQLite simulada. Devuelve la bitácora de
 * la secuencia de arranque y el elemento renderizado.
 */
async function arrancarMain(overrides: {
  /** Falla al materializar (repo de órdenes que lanza en materializeOrder). */
  fallaMaterializacion?: boolean;
  /** Falla el recovery (repo de órdenes que lanza al leer por fecha). */
  fallaRecovery?: boolean;
  /** Falla un dominio operativo del recovery (paradas que lanzan al listar). */
  fallaRecoveryOperativo?: boolean;
} = {}) {
  vi.resetModules();

  const bitacora: string[] = [];
  const renderSpy = vi.fn((elemento: ReactElement<Record<string, unknown>>) => {
    bitacora.push("render");
    return elemento;
  });
  const dbFalso = { execute: vi.fn(), select: vi.fn() };
  /** db con la que se construyó cada repositorio (orden de construcción). */
  const dbsRecibidas: unknown[] = [];

  vi.doMock("react-dom/client", () => ({
    default: {
      createRoot: vi.fn(() => ({ render: renderSpy, unmount: vi.fn() })),
    },
  }));

  vi.doMock("../database", () => ({
    initDatabase: vi.fn(async () => {
      bitacora.push("initDatabase");
      return dbFalso;
    }),
    getDatabase: vi.fn(() => dbFalso),
  }));

  // La vista `App` NO es sujeto de esta suite: con `react-dom/client` simulado
  // nada se renderiza, así que su implementación jamais se ejecuta — solo se
  // compara su IDENTIDAD contra lo que main.tsx montó (`toBe` / `not.toBe`).
  // Importarla de verdad costaba el módulo completo de `App` (medido: 3.8-6.1 s
  // en frío, contra ~250 ms del resto de la suite) y reventaba el default de
  // 5 s bajo contención, sin aportar una sola aserción de comportamiento.
  // El centinela conserva la aserción exacta: main.tsx montó App y NO la
  // pantalla de error. La construcción del elemento JSX sigue ocurriendo igual.
  vi.doMock("../../../App", () => ({
    default: function AppDelArranque() {
      return null;
    },
  }));

  function claseFalsa(nombre: string, contrato: object) {
    return vi.fn(function (db: unknown) {
      bitacora.push(`construir:${nombre}`);
      dbsRecibidas.push(db);
      // `new` con un constructor que devuelve un objeto: main recibe el fake
      // del contrato (mismos vi.fn observables desde el test).
      return contrato;
    });
  }

  // main.tsx construye los repositorios reales: se reemplazan por fakes de los
  // contratos en el momento de instanciarlos (bitácora + errores opcionales).
  const fakes = crearFakes(bitacora);
  if (overrides.fallaMaterializacion) {
    vi.spyOn(fakes.orderRepository, "materializeOrder").mockImplementation(async () => {
      bitacora.push("orden:materializeOrder:error");
      throw new Error('no se pudo materializar la orden "ord-101"');
    });
  }
  if (overrides.fallaRecovery) {
    vi.spyOn(fakes.orderRepository, "getOrderByFechaOperativa").mockImplementation(async () => {
      bitacora.push("orden:getOrderByFechaOperativa:error");
      throw new Error("SQLite no disponible");
    });
  }
  if (overrides.fallaRecoveryOperativo) {
    vi.spyOn(fakes.paradaRepository, "listarPorMaquina").mockImplementation(async () => {
      bitacora.push("parada:listarPorMaquina:error");
      throw new Error("no se pudo recuperar las paradas de la máquina M1");
    });
  }

  const OrdenRepo = claseFalsa("orden", fakes.orderRepository);
  const JornadaRepo = claseFalsa("jornada", fakes.jornadaRepository);
  const LecturaRepo = claseFalsa("lectura", fakes.lecturaRepository);
  const ParadaRepo = claseFalsa("parada", fakes.paradaRepository);
  const ActividadRepo = claseFalsa("actividad", fakes.actividadRepository);
  const DanoRepo = claseFalsa("dano", fakes.danoRepository);
  const MantenimientoRepo = claseFalsa("mantenimiento", fakes.mantenimientoRepository);
  const InspeccionRepo = claseFalsa("inspeccion", fakes.inspeccionRepository);

  vi.doMock("../sqliteOrderRepository", () => ({ SqliteOrderRepository: OrdenRepo }));
  vi.doMock("../sqliteJornadaRepository", () => ({ SqliteJornadaRepository: JornadaRepo }));
  vi.doMock("../sqliteLecturaGolpeRepository", () => ({
    SqliteLecturaGolpeRepository: LecturaRepo,
  }));
  vi.doMock("../sqliteParadaRepository", () => ({ SqliteParadaRepository: ParadaRepo }));
  vi.doMock("../sqliteActividadPlanificadaRepository", () => ({
    SqliteActividadPlanificadaRepository: ActividadRepo,
  }));
  vi.doMock("../sqliteDanoRepository", () => ({ SqliteDanoRepository: DanoRepo }));
  vi.doMock("../sqliteMantenimientoRepository", () => ({
    SqliteMantenimientoRepository: MantenimientoRepo,
  }));
  vi.doMock("../sqliteInspeccionTelaRepository", () => ({
    SqliteInspeccionTelaRepository: InspeccionRepo,
  }));

  await import("../../../main");
  await vi.waitFor(() => {
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  // App importada del MISMO registro de módulos que usó main (post reset).
  const { default: AppDelArranque } = await import("../../../App");
  const elemento = renderSpy.mock.calls[0][0];
  return {
    bitacora,
    elemento,
    AppDelArranque,
    renderSpy,
    fakes,
    dbFalso,
    dbsRecibidas,
    clases: {
      OrdenRepo,
      JornadaRepo,
      LecturaRepo,
      ParadaRepo,
      ActividadRepo,
      DanoRepo,
      MantenimientoRepo,
      InspeccionRepo,
    },
  };
}

describe("H/I: secuencia de arranque de main.tsx — Ticket 10.8", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    // Reloj fijado en la fecha operativa del fixture: `fechaOperativaHoy()` de
    // main.tsx debe devolver el día que tiene orden materializada.
    vi.useFakeTimers({
      now: new Date("2026-09-11T12:00:00.000Z"),
      shouldAdvanceTime: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("H: initDatabase -> repositorios -> materializar -> recovery -> App con el estado resuelto", async () => {
    const {
      bitacora,
      elemento,
      AppDelArranque,
      fakes,
      dbFalso,
      dbsRecibidas,
      clases: { OrdenRepo, JornadaRepo, LecturaRepo, ParadaRepo, ActividadRepo, DanoRepo, MantenimientoRepo, InspeccionRepo },
    } = await arrancarMain();

    // La secuencia del arranque, en orden exacto: base -> los OCHO adaptadores.
    expect(bitacora[0]).toBe("initDatabase");
    expect(bitacora.slice(1, 9)).toEqual([
      "construir:orden",
      "construir:jornada",
      "construir:lectura",
      "construir:parada",
      "construir:actividad",
      "construir:dano",
      "construir:mantenimiento",
      "construir:inspeccion",
    ]);
    expect(bitacora[9]).toBe("orden:materializeOrder"); // materialización ANTES del recovery
    expect(bitacora).toContain("orden:getOrderByFechaOperativa"); // recovery
    expect(bitacora[bitacora.length - 1]).toBe("render");

    // Los OCHO repositorios se construyeron UNA sola vez y con la db de
    // initDatabase (nunca una db distinta por repositorio).
    expect(vi.mocked(OrdenRepo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(JornadaRepo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(LecturaRepo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ParadaRepo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ActividadRepo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(DanoRepo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(MantenimientoRepo)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(InspeccionRepo)).toHaveBeenCalledTimes(1);
    expect(dbsRecibidas).toEqual(Array(8).fill(dbFalso));

    // El orden de las fases es el del spec: materializar < recovery < render.
    const materializar = bitacora.indexOf("orden:materializeOrder");
    const recovery = bitacora.indexOf("orden:getOrderByFechaOperativa");
    expect(materializar).toBeLessThan(recovery);
    expect(recovery).toBeLessThan(bitacora.indexOf("render"));

    // Lo que se entrega a App: repositorios y estado YA resuelto (nunca promesa).
    const app = elemento.props.children as ReactElement;
    expect(app.type).toBe(AppDelArranque); // sí montó App, no la pantalla de error
    const props = app.props as Record<string, unknown>;
    expect(props.estadoInicial).toBeDefined();
    expect(typeof (props.estadoInicial as Promise<unknown>).then).toBe("undefined");
    const estado = props.estadoInicial as RecoveryState;
    expect(estado.jornada).toBeDefined();
    expect(estado.orden?.id).toBe("ord-101");
    expect(estado.orden?.estado).toBe("available");
    expect(estado.lecturas).toEqual([]);
    // Los OCHO dominios operativos llegan desde su contrato, vacíos hoy.
    expect(estado.paradas).toEqual([]);
    expect(estado.actividades).toEqual([]);
    expect(estado.danos).toEqual([]);
    expect(estado.mantenimientos).toEqual([]);
    expect(estado.inspecciones).toEqual([]);
    // Los repositorios entregados son los construidos en el arranque: los cinco
    // dominios operativos YA no viven en memoria (G1), vienen del SQLite fake.
    expect(props.repository).toBe(fakes.orderRepository);
    expect(props.jornadaRepository).toBe(fakes.jornadaRepository);
    expect(props.lecturaRepository).toBe(fakes.lecturaRepository);
    expect(props.paradaRepository).toBe(fakes.paradaRepository);
    expect(props.actividadRepository).toBe(fakes.actividadRepository);
    expect(props.danoRepository).toBe(fakes.danoRepository);
    expect(props.inspeccionRepository).toBe(fakes.inspeccionRepository);
    expect(props.mantenimientoRepository).toBe(fakes.mantenimientoRepository);
    // Toda la fuente externa llegó materializada, en orden y por `id`.
    expect(fakes.orderRepository.materializeOrder).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(fakes.orderRepository.materializeOrder)
        .mock.calls.map(([orden]) => orden.id),
    ).toEqual(["ord-101", "ord-102"]);
  });

  it("H: sin orden en la fuente (día vacío) la app arranca igual con orden undefined", async () => {
    // El fixture tiene órdenes solo hasta FECHA_CON_ORDEN: al día siguiente el
    // arranque resuelve jornada y cero órdenes.
    vi.setSystemTime(new Date("2026-09-12T12:00:00.000Z"));

    const { elemento, AppDelArranque } = await arrancarMain();
    const app = elemento.props.children as ReactElement;
    expect(app.type).toBe(AppDelArranque);
    const estado = (app.props as Record<string, unknown>).estadoInicial as RecoveryState;
    expect(estado.orden).toBeUndefined();
    expect(estado.lecturas).toEqual([]);
    // Sin orden no hay lecturas NI inspecciones; los dominios de máquina igual
    // se recuperan (historial completo de la máquina, vacío en día vacío).
    expect(estado.paradas).toEqual([]);
    expect(estado.actividades).toEqual([]);
    expect(estado.danos).toEqual([]);
    expect(estado.mantenimientos).toEqual([]);
    expect(estado.inspecciones).toEqual([]);
  });

  it("I: materializeOrder que lanza -> el arranque aborta y se muestra la pantalla de error (App NO monta)", async () => {
    const { bitacora, elemento, AppDelArranque, renderSpy } = await arrancarMain({
      fallaMaterializacion: true,
    });

    // Se intentó la materialización y el error cortó el arranque.
    expect(bitacora).toContain("orden:materializeOrder:error");
    // Recovery y App NO se ejecutaron: no hay estado parcial.
    expect(bitacora).not.toContain("orden:getOrderByFechaOperativa");
    expect(renderSpy).toHaveBeenCalledTimes(1);

    // Lo renderizado es la pantalla explícita de inicialización fallida.
    const app = elemento.props.children as ReactElement | undefined;
    expect(elemento.props.message).toContain("no se pudo materializar");
    expect(app).toBeUndefined();
    expect(elemento.type).not.toBe(AppDelArranque);
  });

  it("I: recovery que lanza -> el arranque aborta con la pantalla de error y App NO monta", async () => {
    const { bitacora, elemento, AppDelArranque, renderSpy } = await arrancarMain({
      fallaRecovery: true,
    });

    // La materialización sí ocurrió; el fallo llegó en el recovery.
    expect(bitacora).toContain("orden:materializeOrder");
    expect(bitacora).toContain("orden:getOrderByFechaOperativa:error");
    expect(renderSpy).toHaveBeenCalledTimes(1);

    const app = elemento.props.children as ReactElement | undefined;
    expect(elemento.props.message).toContain("SQLite no disponible");
    expect(app).toBeUndefined();
    expect(elemento.type).not.toBe(AppDelArranque);
  });

  it("I: un fallo en un dominio operativo (paradas) aborta el arranque y App NO monta", async () => {
    const { bitacora, elemento, AppDelArranque, renderSpy } = await arrancarMain({
      fallaRecoveryOperativo: true,
    });

    // La materialización y la lectura de paradas ocurrieron; el fallo cortó la
    // secuencia D2e ANTES de los dominios siguientes (mantenimiento/inspecciones).
    expect(bitacora).toContain("orden:materializeOrder");
    expect(bitacora).toContain("parada:listarPorMaquina:error");
    expect(bitacora).not.toContain("mantenimiento:listarPorMaquina");
    expect(renderSpy).toHaveBeenCalledTimes(1);

    const app = elemento.props.children as ReactElement | undefined;
    expect(elemento.props.message).toContain(
      "no se pudo recuperar las paradas de la máquina M1",
    );
    expect(app).toBeUndefined();
    expect(elemento.type).not.toBe(AppDelArranque);
  });
});
