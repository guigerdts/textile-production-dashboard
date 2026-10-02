/**
 * Ticket 10.7 / G1 — Recovery Tests (`recoverPersistedState`)
 *
 * Unit tests for `recoverPersistedState` over the EIGHT repository contracts
 * (the three Phase 1 contracts 10.3 / 10.4 / 10.6 plus the five operational
 * ports). Recovery receives repository instances, never a raw Database, so
 * this suite fakes the interfaces directly and needs no plugin mock at all.
 *
 * Test classification (10.7, extended by G1 / D2e):
 * - Contract tests: drive recovery through its public function against fake
 *   repositories and assert orchestration (exact args per repository), source
 *   reconstruction (the 8 fields) and no-loss invariants.
 * - White-box tests: recovery never calls a write method, only composes the
 *   eight documented read methods in the fixed D2e order, routes lecturas and
 *   inspecciones through their orden guard, and routes the four machine-event
 *   lists through `listarPorMaquina(maquinaId)` with NO date predicate.
 * - Derivation tests: recovery returns SOURCES only — `state.lecturas` keeps
 *   the repository's read projection (deltaGolpes 0 placeholder). The
 *   COMPOSITION seam (`componerOrdenConLecturas`, G2 / CORRECTION 11)
 *   recomputes deltaGolpes from the absolute values with `derivarDeltaGolpes`;
 *   the other derivations (progreso, iniciadaEn / contadorBase, durations,
 *   projected 2da, alerts, inspection estado) belong to the existing domain
 *   layer, invoked here only to demonstrate the composition works on
 *   recovered sources.
 *
 * HONESTY NOTE (10.7): these are unit tests against faked repository
 * contracts. They prove recovery's composition logic. They do NOT execute the
 * real SQLite repositories; real-runtime validation requires the migrations to
 * exist and a Tauri environment, which is PENDING.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { recoverPersistedState, componerOrdenConLecturas } from "../recovery";
import type { IJornadaRepository } from "../../jornadaRepository";
import type { IOrderRepository, ILecturaGolpeRepository } from "../../repository";
import type { IParadaRepository } from "../../paradasRepository";
import type { IActividadPlanificadaRepository } from "../../actividadesRepository";
import type { IDanoRepository } from "../../danosRepository";
import type { IMantenimientoRepository } from "../../mantenimientoRepository";
import type { IInspeccionRepository } from "../../inspeccionRepository";
import type {
  ActividadPlanificada,
  Dano,
  InspeccionTela,
  JornadaTurno,
  LecturaContador,
  Mantenimiento,
  Orden,
  Parada,
} from "../../../domain/types";
import { jornadaDefault } from "../../../domain/tiempo";
import { calcularProgreso, golpesProducidosDesdeLecturas } from "../../../domain/calculations";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FECHA = "2026-09-11";
const MAQUINA = "M1"; // ADR 0003: máquina única, pasada como parámetro (D2f)
const TS = "2026-09-11T07:00:00.000Z";
const TS2 = "2026-09-11T08:00:00.000Z";
const TS3 = "2026-09-11T09:00:00.000Z";
const CREATED_AT = "2026-09-10T10:00:00.000Z";
const RESERVED_TS = "1970-01-01T00:00:00.000Z";

function createOrden(overrides: Partial<Orden> = {}): Orden {
  return {
    id: "ord-101",
    numeroOrden: "OP-101",
    diseno: "Jessie",
    telaReferencia: "T-100",
    unidadesSolicitadas: 2400,
    aplicaSegunda: true,
    porcentaje2da: 0.05,
    tipoPintura: "pigmento",
    machineId: "M1",
    fechaOperativa: FECHA,
    estado: "available",
    creadaExternamenteEn: CREATED_AT,
    lecturas: [],
    ...overrides,
  };
}

function createLectura(
  valor: number,
  timestamp: string
): LecturaContador {
  return { valor, timestamp, deltaGolpes: 0 };
}

// Fixtures de los cuatro eventos de máquina + la inspección (fuentes del G1).
// Objetos válidos y mínimos: recovery solo los ensambla, nunca los deriva.

function createParada(overrides: Partial<Parada> = {}): Parada {
  return {
    id: "par-1",
    maquinaId: MAQUINA,
    ordenId: "ord-101",
    operatorName: "Laura",
    causaId: "falta_color",
    camposEspecificos: { color: "AZUL" },
    fechaOperativa: FECHA,
    inicio: TS,
    fin: null,
    ...overrides,
  };
}

function createActividad(
  overrides: Partial<ActividadPlanificada> = {}
): ActividadPlanificada {
  return {
    id: "act-1",
    maquinaId: MAQUINA,
    tipo: "limpieza",
    fechaOperativa: FECHA,
    inicio: TS,
    fin: null,
    operatorName: "Laura",
    ...overrides,
  };
}

function createDano(overrides: Partial<Dano> = {}): Dano {
  return {
    id: "dan-1",
    maquinaId: MAQUINA,
    ordenId: "ord-101",
    operatorName: "Laura",
    tipo: "mecanico",
    componente: "carro 3",
    fechaOperativa: FECHA,
    inicio: TS,
    fin: null,
    causoParada: false,
    paradaId: null,
    posibleSegunda: false,
    ...overrides,
  };
}

function createMantenimiento(overrides: Partial<Mantenimiento> = {}): Mantenimiento {
  return {
    id: "man-1",
    maquinaId: MAQUINA,
    tipo: "preventivo",
    operatorName: "Laura",
    motivo: "revisión semanal",
    fechaOperativa: FECHA,
    inicio: TS,
    fin: null,
    danoId: null,
    ...overrides,
  };
}

function createInspeccion(overrides: Partial<InspeccionTela> = {}): InspeccionTela {
  return {
    id: "ins-1",
    ordenId: "ord-101",
    operatorName: "Laura",
    items: [
      { id: "absorcion", estado: "conforme" },
      { id: "tundido", estado: "conforme" },
      { id: "manchas", estado: "conforme" },
      { id: "dimensiones", estado: "conforme" },
      { id: "estado_general", estado: "conforme" },
    ],
    timestamp: TS,
    resolucion: null,
    ...overrides,
  };
}

// ── Fakes de contratos ───────────────────────────────────────────────────────

interface FakesOptions {
  jornada?: JornadaTurno;
  orden?: Orden;
  lecturas?: LecturaContador[];
  paradas?: Parada[];
  actividades?: ActividadPlanificada[];
  danos?: Dano[];
  mantenimientos?: Mantenimiento[];
  inspecciones?: InspeccionTela[];
  /** Si se indica, `IDanoRepository.listarPorMaquina` rechaza con este mensaje. */
  fallaLecturaDano?: string;
}

function createFakes(options: FakesOptions = {}) {
  const jornadaRepository = {
    obtenerParaFecha: vi.fn(async () => options.jornada ?? jornadaDefault(FECHA)),
    guardarJornada: vi.fn(async () => undefined),
  } satisfies IJornadaRepository;

  const orderRepository = {
    getOrderByFechaOperativa: vi.fn(async () => options.orden),
    saveOrder: vi.fn(async () => undefined),
    // 10.8: materialización es una operación SEPARADA de saveOrder; recovery
    // nunca la usa, pero el fake cumple el contrato completo.
    materializeOrder: vi.fn(async () => true),
  } satisfies IOrderRepository;

  const lecturaRepository = {
    reserveSequence: vi.fn(async () => 0),
    completeLecture: vi.fn(async () => undefined),
    findReservation: vi.fn(async () => undefined),
    getLecturasByOrden: vi.fn(async () => options.lecturas ?? []),
    getMaxSequence: vi.fn(async () => 0),
  } satisfies ILecturaGolpeRepository;

  const paradaRepository = {
    insertParada: vi.fn(async () => undefined),
    updateParada: vi.fn(async () => undefined),
    obtenerPorId: vi.fn(async () => undefined),
    listarPorMaquina: vi.fn(async () => options.paradas ?? []),
    listarPorOrden: vi.fn(async () => []),
    getParadaAbierta: vi.fn(async () => null),
    getParadaAbiertaDeMaquina: vi.fn(async () => null),
  } satisfies IParadaRepository;

  const actividadRepository = {
    insertActividad: vi.fn(async () => undefined),
    updateActividad: vi.fn(async () => undefined),
    obtenerPorId: vi.fn(async () => undefined),
    listarPorMaquina: vi.fn(async () => options.actividades ?? []),
    getActividadAbierta: vi.fn(async () => null),
  } satisfies IActividadPlanificadaRepository;

  const danoRepository = {
    insertDano: vi.fn(async () => undefined),
    updateDano: vi.fn(async () => undefined),
    obtenerPorId: vi.fn(async () => undefined),
    listarPorMaquina: vi.fn(async () => {
      if (options.fallaLecturaDano) throw new Error(options.fallaLecturaDano);
      return options.danos ?? [];
    }),
    listarPorOrden: vi.fn(async () => []),
    getDanoAbierto: vi.fn(async () => null),
  } satisfies IDanoRepository;

  const mantenimientoRepository = {
    insertMantenimiento: vi.fn(async () => undefined),
    updateMantenimiento: vi.fn(async () => undefined),
    obtenerPorId: vi.fn(async () => undefined),
    listarPorMaquina: vi.fn(async () => options.mantenimientos ?? []),
    getMantenimientoAbierto: vi.fn(async () => null),
  } satisfies IMantenimientoRepository;

  const inspeccionRepository = {
    insertInspeccion: vi.fn(async () => undefined),
    updateInspeccion: vi.fn(async () => undefined),
    obtenerPorId: vi.fn(async () => undefined),
    listarPorOrden: vi.fn(async () => options.inspecciones ?? []),
  } satisfies IInspeccionRepository;

  return {
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

/** Ejecuta recovery con los fakes dados para la fecha operativa del fixture. */
function recover(fakes: ReturnType<typeof createFakes>) {
  return recoverPersistedState(
    fakes.jornadaRepository,
    fakes.orderRepository,
    fakes.lecturaRepository,
    fakes.paradaRepository,
    fakes.actividadRepository,
    fakes.danoRepository,
    fakes.mantenimientoRepository,
    fakes.inspeccionRepository,
    FECHA,
    MAQUINA
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("recoverPersistedState — recovery de fuentes (G1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── A. Fuentes vacías ────────────────────────────────────────────────────

  it("A1: jornada ausente -> default 07:00-17:00 devuelto y NO persistido", async () => {
    const fakes = createFakes(); // sin jornada persistida
    const state = await recover(fakes);

    expect(state.jornada).toEqual(jornadaDefault(FECHA));
    expect(state.jornada.inicio).toContain("T07:00");
    expect(state.jornada.fin).toContain("T17:00");
    // El default NO se auto-persiste (regla del contrato).
    expect(fakes.jornadaRepository.guardarJornada).not.toHaveBeenCalled();
    expect(fakes.jornadaRepository.obtenerParaFecha).toHaveBeenCalledWith(FECHA);
  });

  it("A2: orden ausente -> undefined", async () => {
    const fakes = createFakes(); // sin orden
    const state = await recover(fakes);

    expect(state.orden).toBeUndefined();
    expect(fakes.orderRepository.getOrderByFechaOperativa).toHaveBeenCalledWith(
      FECHA
    );
  });

  it("A3: sin orden -> lecturas vacías y getLecturasByOrden NO consultado", async () => {
    const fakes = createFakes(); // sin orden
    const state = await recover(fakes);

    expect(state.lecturas).toEqual([]);
    // Sin orden no hay lecturas que consultar (orquestación minimal).
    expect(fakes.lecturaRepository.getLecturasByOrden).not.toHaveBeenCalled();
  });

  // ── B. Orden existente ──────────────────────────────────────────────────

  it("B: orden existente recuperada tal cual; recovery nunca la sobrescribe", async () => {
    const orden = createOrden({ estado: "in_production", operatorName: "Laura" });
    const fakes = createFakes({ orden, lecturas: [] });
    const state = await recover(fakes);

    expect(state.orden).toEqual(orden);
    expect(state.orden!.estado).toBe("in_production");
    expect(state.orden!.operatorName).toBe("Laura");
    // La fuente persistida manda; recovery no escribe (ni materializa fixture).
    expect(fakes.orderRepository.saveOrder).not.toHaveBeenCalled();
  });

  // ── C. in_production con lecturas persistidas ───────────────────────────

  it("C1: lecturas persistidas recuperadas ordenadas por sequence ASC (gaps preservados)", async () => {
    const orden = createOrden({ estado: "in_production" });
    // Secuencias 1, 3, 4 (gap en 2): el repositorio devuelve la proyección
    // ordenada; los gaps se preservan (no se re-secuencian).
    const lecturas = [
      createLectura(100, TS),
      createLectura(106, TS2),
      createLectura(112, TS3),
    ];
    const fakes = createFakes({ orden, lecturas });
    const state = await recover(fakes);

    expect(state.lecturas).toEqual(lecturas);
    expect(state.lecturas.map((l) => l.valor)).toEqual([100, 106, 112]);
    expect(fakes.lecturaRepository.getLecturasByOrden).toHaveBeenCalledWith(
      orden.id
    );
  });

  it("C2: primera lectura persistida disponible para derivar iniciadaEn/contadorBase downstream", async () => {
    const orden = createOrden({ estado: "in_production" });
    const lecturas = [createLectura(100, TS), createLectura(106, TS2)];
    const fakes = createFakes({ orden, lecturas });
    const state = await recover(fakes);

    // Recovery expone la primera lectura persistida con valor y timestamp;
    // la derivación vive en la composición downstream (`mapOrdenRow(row,
    // lecturas)` / `componerOrdenConLecturas`, la misma `derivarDeltaGolpes`
    // — probada en la suite del repositorio 10.4 y en G).
    expect(state.lecturas[0]).toEqual(createLectura(100, TS));
    expect(state.lecturas[0].timestamp).toBe(TS);
    expect(state.lecturas[0].valor).toBe(100);
    // Recovery NO inventa los campos derivados.
    expect(state.orden!.iniciadaEn).toBeUndefined();
    expect(state.orden!.contadorBase).toBeUndefined();
  });

  // ── D. finished con cero lecturas ───────────────────────────────────────

  it("D: estado finished recuperado con finalizadaEn preservado; válido con cero lecturas", async () => {
    const orden = createOrden({ estado: "finished", finalizadaEn: TS });
    const fakes = createFakes({ orden, lecturas: [] });
    const state = await recover(fakes);

    expect(state.orden!.estado).toBe("finished");
    expect(state.orden!.finalizadaEn).toBe(TS);
    // El estado NO se infiere de golpes: finished con cero lecturas es válido.
    expect(state.lecturas).toEqual([]);
    expect(fakes.lecturaRepository.getLecturasByOrden).toHaveBeenCalledWith(
      orden.id
    );
  });

  // ── E. Reservadas excluidas ─────────────────────────────────────────────

  it("E: lecturas reservadas nunca aparecen como lecturas productivas recuperadas", async () => {
    const orden = createOrden({ estado: "in_production" });
    // Almacén con una reserva abortada + dos persistidas; el contrato
    // getLecturasByOrden filtra status='persisted' (comportamiento SQL real,
    // probado en 10.5/10.6). Recovery compone ese contrato, nunca lo bypasea.
    const store = [
      { valor: 100, timestamp: TS, status: "persisted" },
      { valor: 0, timestamp: RESERVED_TS, status: "reserved" },
      { valor: 106, timestamp: TS2, status: "persisted" },
    ];
    const lecturasPersistidas = store
      .filter((r) => r.status === "persisted")
      .map((r) => createLectura(r.valor, r.timestamp));

    const fakes = createFakes({ orden, lecturas: lecturasPersistidas });
    const state = await recover(fakes);

    expect(state.lecturas.map((l) => l.valor)).toEqual([100, 106]);
    expect(state.lecturas.some((l) => l.timestamp === RESERVED_TS)).toBe(false);
    expect(fakes.lecturaRepository.getLecturasByOrden).toHaveBeenCalledWith(
      orden.id
    );
  });

  // ── F. Sin lecturas ─────────────────────────────────────────────────────

  it("F: iniciadaEn/contadorBase no se inventan sin lecturas", async () => {
    const orden = createOrden({ estado: "in_production" });
    const fakes = createFakes({ orden, lecturas: [] });
    const state = await recover(fakes);

    expect(state.lecturas).toEqual([]);
    expect(state.orden!.iniciadaEn).toBeUndefined();
    expect(state.orden!.contadorBase).toBeUndefined();
  });

  // ── G. Derivación fuera de recovery ─────────────────────────────────────

  it("G: recovery devuelve solo fuentes; la composición reconstruye deltaGolpes desde los valores absolutos", async () => {
    const orden = createOrden({ estado: "in_production" });
    const lecturas = [createLectura(100, TS), createLectura(106, TS2)];
    const fakes = createFakes({ orden, lecturas });
    const state = await recover(fakes);

    // Shape: solo las ocho fuentes (G1); ningún campo derivado.
    expect(Object.keys(state).sort()).toEqual([
      "actividades",
      "danos",
      "inspecciones",
      "jornada",
      "lecturas",
      "mantenimientos",
      "orden",
      "paradas",
    ]);

    // Fuente: las lecturas recuperadas conservan sus valores ABSOLUTOS; el
    // campo deltaGolpes sigue siendo el placeholder 0 de la proyección de
    // lectura (10.8) — recovery no deriva.
    expect(state.lecturas.map((l) => l.valor)).toEqual([100, 106]);
    expect(state.lecturas[1].deltaGolpes).toBe(0);

    // G2: la composición 10.8 (App mount/loader) reconstruye deltaGolpes con
    // las reglas del dominio: primera (base) 0, posterior mayor 106-100=6.
    const compuesta = componerOrdenConLecturas(state.orden!, state.lecturas);
    expect(compuesta.lecturas.map((l) => l.deltaGolpes)).toEqual([0, 6]);
    expect(compuesta.lecturas.map((l) => l.valor)).toEqual([100, 106]);
    expect(compuesta.iniciadaEn).toBe(TS);
    expect(compuesta.contadorBase).toBe(100);

    // La producción real se deriva de los deltas, NO del último valor absoluto.
    expect(golpesProducidosDesdeLecturas(compuesta.lecturas)).toBe(6);
    const progreso = calcularProgreso(6, state.orden!.unidadesSolicitadas);
    expect(progreso.golpesProducidos).toBe(6);
    expect(progreso.unidadesProducidas).toBe(18); // 6 golpes x 3 toallas

    // La recomposición NO muta la persistencia ni la fuente recuperada.
    expect(state.lecturas.map((l) => l.valor)).toEqual([100, 106]);
    expect(state.lecturas[1].deltaGolpes).toBe(0); // el source sigue intacto
    expect(fakes.orderRepository.saveOrder).not.toHaveBeenCalled();
    expect(fakes.jornadaRepository.guardarJornada).not.toHaveBeenCalled();
    expect(fakes.lecturaRepository.completeLecture).not.toHaveBeenCalled();
    expect(fakes.lecturaRepository.reserveSequence).not.toHaveBeenCalled();

    // Secuencia determinista: componer dos veces da exactamente lo mismo.
    expect(componerOrdenConLecturas(state.orden!, state.lecturas)).toEqual(
      compuesta
    );
  });

  // ── Integración ─────────────────────────────────────────────────────────

  it("H1: recovery completo produce el estado correcto (jornada + orden + lecturas + operativos)", async () => {
    // Jornada persistida con overtime (07:00-19:00), orden in_production,
    // lecturas con gap, y los cinco dominios del G1 con contenido.
    const jornada: JornadaTurno = {
      inicio: "2026-09-11T07:00:00.000Z",
      fin: "2026-09-11T19:00:00.000Z",
    };
    const orden = createOrden({ estado: "in_production", operatorName: "Laura" });
    const lecturas = [
      createLectura(100, TS),
      createLectura(106, TS2),
      createLectura(118, TS3),
    ];
    const paradas = [createParada({ id: "par-1" }), createParada({ id: "par-2" })];
    const fakes = createFakes({ jornada, orden, lecturas, paradas });
    const state = await recover(fakes);

    expect(state.jornada).toEqual(jornada);
    expect(state.orden!.estado).toBe("in_production");
    expect(state.orden!.operatorName).toBe("Laura");
    expect(state.lecturas).toEqual(lecturas);
    expect(state.paradas).toEqual(paradas);

    // Orquestación exacta (white-box): las OCHO consultas de lectura.
    expect(fakes.jornadaRepository.obtenerParaFecha).toHaveBeenCalledWith(FECHA);
    expect(fakes.orderRepository.getOrderByFechaOperativa).toHaveBeenCalledWith(
      FECHA
    );
    expect(fakes.lecturaRepository.getLecturasByOrden).toHaveBeenCalledWith(
      orden.id
    );
    expect(fakes.paradaRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.actividadRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.danoRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.mantenimientoRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.inspeccionRepository.listarPorOrden).toHaveBeenCalledWith(orden.id);
  });

  it("H2: recovery tras un crash recupera el estado persistido sin pérdida", async () => {
    // Punto de crash: 2 lecturas persistidas, 1 reserva abortada (el complete
    // nunca ocurrió) y la orden in_production ya persistida.
    const orden = createOrden({ estado: "in_production" });
    const store = [
      { valor: 100, timestamp: TS, status: "persisted" },
      { valor: 0, timestamp: RESERVED_TS, status: "reserved" },
      { valor: 106, timestamp: TS2, status: "persisted" },
    ];
    const lecturasPersistidas = store
      .filter((r) => r.status === "persisted")
      .map((r) => createLectura(r.valor, r.timestamp));

    const fakes = createFakes({ orden, lecturas: lecturasPersistidas });
    const state = await recover(fakes);

    // Estado persistido intacto; la reserva abortada NO es estado productivo.
    expect(state.orden!.estado).toBe("in_production");
    expect(state.orden!.id).toBe("ord-101");
    expect(state.lecturas.map((l) => l.valor)).toEqual([100, 106]);
    expect(state.lecturas.some((l) => l.timestamp === RESERVED_TS)).toBe(false);

    // Recovery es solo lectura: nada se escribe ni se completa durante el recover.
    expect(fakes.orderRepository.saveOrder).not.toHaveBeenCalled();
    expect(fakes.jornadaRepository.guardarJornada).not.toHaveBeenCalled();
    expect(fakes.lecturaRepository.completeLecture).not.toHaveBeenCalled();
    expect(fakes.lecturaRepository.reserveSequence).not.toHaveBeenCalled();
  });

  // ── I. Composición operativa (G1: 8 fuentes, D2e / D2f) ─────────────────

  it("I1: recovery devuelve las 8 fuentes, cada una desde su contrato", async () => {
    const orden = createOrden({ estado: "in_production" });
    const paradas = [createParada()];
    const actividades = [createActividad()];
    const danos = [createDano()];
    const mantenimientos = [createMantenimiento()];
    const inspecciones = [createInspeccion()];
    const fakes = createFakes({
      orden,
      lecturas: [],
      paradas,
      actividades,
      danos,
      mantenimientos,
      inspecciones,
    });
    const state = await recover(fakes);

    expect(Object.keys(state).sort()).toEqual([
      "actividades",
      "danos",
      "inspecciones",
      "jornada",
      "lecturas",
      "mantenimientos",
      "orden",
      "paradas",
    ]);
    expect(state.paradas).toEqual(paradas);
    expect(state.actividades).toEqual(actividades);
    expect(state.danos).toEqual(danos);
    expect(state.mantenimientos).toEqual(mantenimientos);
    expect(state.inspecciones).toEqual(inspecciones);

    // Cada lista sale de su método documentado, con la máquina explícita (D2f).
    expect(fakes.paradaRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.actividadRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.danoRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.mantenimientoRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.inspeccionRepository.listarPorOrden).toHaveBeenCalledWith(orden.id);
  });

  it("I2: orden de lectura secuencial y fijo (D2e): jornada → orden → lecturas → paradas → actividades → daños → mantenimientos → inspecciones", async () => {
    const orden = createOrden({ estado: "in_production" });
    const fakes = createFakes({
      orden,
      lecturas: [createLectura(100, TS)],
      paradas: [createParada()],
      actividades: [createActividad()],
      danos: [createDano()],
      mantenimientos: [createMantenimiento()],
      inspecciones: [createInspeccion()],
    });
    await recover(fakes);

    const momentos = [
      fakes.jornadaRepository.obtenerParaFecha,
      fakes.orderRepository.getOrderByFechaOperativa,
      fakes.lecturaRepository.getLecturasByOrden,
      fakes.paradaRepository.listarPorMaquina,
      fakes.actividadRepository.listarPorMaquina,
      fakes.danoRepository.listarPorMaquina,
      fakes.mantenimientoRepository.listarPorMaquina,
      fakes.inspeccionRepository.listarPorOrden,
    ].map((mock) => mock.mock.invocationCallOrder[0]);

    // Cada lectura ocurre DESPUÉS de la anterior: secuencial, un await cada
    // una, sin fan-out (un Promise.all violaría este orden estricto).
    for (let i = 1; i < momentos.length; i++) {
      expect(momentos[i - 1]).toBeLessThan(momentos[i]);
    }
    // La única dependencia declarada: la orden se lee ANTES que las inspecciones.
    expect(momentos[1]).toBeLessThan(momentos[7]);
  });

  it("I3: sin orden -> inspecciones = [] mientras los cuatro dominios de máquina SÍ recuperan", async () => {
    const paradas = [createParada({ ordenId: null })];
    const actividades = [createActividad()];
    const danos = [createDano({ ordenId: null })];
    const mantenimientos = [createMantenimiento()];
    const fakes = createFakes({ paradas, actividades, danos, mantenimientos });
    const state = await recover(fakes);

    // Guards de orden: lecturas (preexistente) e inspecciones (D2e).
    expect(state.orden).toBeUndefined();
    expect(state.lecturas).toEqual([]);
    expect(state.inspecciones).toEqual([]);
    expect(fakes.lecturaRepository.getLecturasByOrden).not.toHaveBeenCalled();
    expect(fakes.inspeccionRepository.listarPorOrden).not.toHaveBeenCalled();

    // El resto de dominios NO depende de la orden: sí recuperan su fuente.
    expect(state.jornada).toEqual(jornadaDefault(FECHA));
    expect(state.paradas).toEqual(paradas);
    expect(state.actividades).toEqual(actividades);
    expect(state.danos).toEqual(danos);
    expect(state.mantenimientos).toEqual(mantenimientos);
  });

  it("I4: los cuatro listados de máquina traen el historial COMPLETO, sin predicado de fecha (D2e)", async () => {
    const orden = createOrden({ estado: "in_production" });
    // Filas de meses distintos a la fecha operativa (2026-09-11): el recovery
    // no filtra por fecha, solo delega en listarPorMaquina(maquinaId).
    const paradas = [
      createParada({ id: "par-old", inicio: "2026-01-05T08:00:00.000Z", fin: "2026-01-05T09:00:00.000Z" }),
      createParada({ id: "par-new", inicio: "2026-12-31T08:00:00.000Z", fin: null }),
    ];
    const actividades = [
      createActividad({ id: "act-old", inicio: "2026-02-01T12:00:00.000Z", fin: "2026-02-01T13:00:00.000Z" }),
    ];
    const danos = [
      createDano({ id: "dan-old", inicio: "2026-03-01T08:00:00.000Z", fin: "2026-03-02T08:00:00.000Z" }),
    ];
    const mantenimientos = [
      createMantenimiento({ id: "man-new", inicio: "2026-12-30T08:00:00.000Z", fin: null }),
    ];
    const fakes = createFakes({ orden, paradas, actividades, danos, mantenimientos });
    const state = await recover(fakes);

    // Devuelto completo, tal cual lo devolvió el repositorio.
    expect(state.paradas).toEqual(paradas);
    expect(state.actividades).toEqual(actividades);
    expect(state.danos).toEqual(danos);
    expect(state.mantenimientos).toEqual(mantenimientos);

    // Y la llamada lleva SOLO la máquina: `toHaveBeenCalledWith(MAQUINA)` falla
    // si recovery añadiera un argumento de fecha a cualquiera de los cuatro.
    expect(fakes.paradaRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.paradaRepository.listarPorMaquina).toHaveBeenCalledTimes(1);
    expect(fakes.actividadRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.actividadRepository.listarPorMaquina).toHaveBeenCalledTimes(1);
    expect(fakes.danoRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.mantenimientoRepository.listarPorMaquina).toHaveBeenCalledWith(MAQUINA);
    expect(fakes.mantenimientoRepository.listarPorMaquina).toHaveBeenCalledTimes(1);
  });

  it("I5: recovery devuelve SOLO fuentes — ningún valor derivado en las 8 fuentes", async () => {
    const orden = createOrden({ estado: "in_production" });
    const fakes = createFakes({
      orden,
      lecturas: [createLectura(100, TS)],
      paradas: [createParada()],
      actividades: [createActividad()],
      danos: [createDano()],
      mantenimientos: [createMantenimiento()],
      inspecciones: [createInspeccion()],
    });
    const state = await recover(fakes);

    // Ningún campo derivado a nivel de estado (ADR 0004 / ADR 0007).
    const derivados = [
      "tiempoProductivo",
      "tiempoNoProductivoPlanificado",
      "duracion",
      "duracionSegundos",
      "porcentaje2daProyectado",
      "proyeccion2da",
      "alerta2da",
      "buenaRacha",
      "estadoMaquina",
      "progreso",
      "deltaGolpes",
    ];
    for (const campo of derivados) {
      expect(state).not.toHaveProperty(campo);
    }

    // El estado derivado de la tela tampoco se materializa en la inspección
    // (el `estado_inspeccion` no existe como columna, A2/2.2) y la duración
    // del mantenimiento se deriva de inicio/fin, nunca se recupera.
    expect(state.inspecciones[0]).not.toHaveProperty("estado");
    expect(state.inspecciones[0]).not.toHaveProperty("estadoInspeccion");
    expect(state.inspecciones[0]).not.toHaveProperty("conAnomalia");
    expect(state.mantenimientos[0]).not.toHaveProperty("duracion");
    expect(state.mantenimientos[0]).not.toHaveProperty("duracionSegundos");
  });

  it("I6: un fallo de lectura PROPAGA (nunca se degrada a []) y corta la secuencia en el dominio con nombre", async () => {
    const fakes = createFakes({
      orden: createOrden({ estado: "in_production" }),
      fallaLecturaDano: "SQLite: tabla dano no disponible",
    });

    // Si el fallo se degradara a lista vacía, recover RESOLVERÍA en vez de
    // rechazar: el rejects es la prueba de que el error se propaga.
    await expect(recover(fakes)).rejects.toThrow(
      "SQLite: tabla dano no disponible"
    );

    // El fallo corta la secuencia en el dominio con nombre (daños): los
    // dominios anteriores se leyeron, los posteriores NUNCA se consultan.
    expect(fakes.paradaRepository.listarPorMaquina).toHaveBeenCalledTimes(1);
    expect(fakes.actividadRepository.listarPorMaquina).toHaveBeenCalledTimes(1);
    expect(fakes.mantenimientoRepository.listarPorMaquina).not.toHaveBeenCalled();
    expect(fakes.inspeccionRepository.listarPorOrden).not.toHaveBeenCalled();
  });
});