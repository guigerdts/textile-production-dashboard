/**
 * Ticket 10.7 — Recovery Tests
 *
 * Unit tests for `recoverPhase1State` over the three repository contracts
 * (10.3 / 10.4 / 10.6). Recovery receives repository instances, never a raw
 * Database, so this suite fakes the interfaces directly and needs no plugin
 * mock at all.
 *
 * Test classification (10.7):
 * - Contract tests: drive recovery through its public function against fake
 *   repositories and assert orchestration (exact args per repository), source
 *   reconstruction (jornada / orden / lecturas) and no-loss invariants.
 * - White-box tests: recovery never calls saveOrder / guardarJornada /
 *   completeLecture, only composes the three documented read methods, and
 *   routes lecturas through `getLecturasByOrden(orden.id)` so reserved ones
 *   never appear.
 * - Derivation tests: recovery returns SOURCES only; deltaGolpes stays the
 *   repository's 0 placeholder and derivations (progreso, iniciadaEn /
 *   contadorBase) belong to the existing domain layer, invoked here only to
 *   demonstrate the composition works on recovered sources.
 *
 * HONESTY NOTE (10.7): these are unit tests against faked repository
 * contracts. They prove recovery's composition logic. They do NOT execute the
 * real SQLite repositories; real-runtime validation requires migration 003 to
 * exist (external ticket) and a Tauri environment, which is PENDING.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { recoverPhase1State } from "../recovery";
import type { IJornadaRepository } from "../../jornadaRepository";
import type { IOrderRepository, ILecturaGolpeRepository } from "../../repository";
import type { JornadaTurno, LecturaContador, Orden } from "../../../domain/types";
import { jornadaDefault } from "../../../domain/tiempo";
import { calcularProgreso } from "../../../domain/calculations";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FECHA = "2026-09-11";
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

// ── Fakes de contratos ───────────────────────────────────────────────────────

interface FakesOptions {
  jornada?: JornadaTurno;
  orden?: Orden;
  lecturas?: LecturaContador[];
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

  return { jornadaRepository, orderRepository, lecturaRepository };
}

/** Ejecuta recovery con los fakes dados para la fecha operativa del fixture. */
function recover(fakes: ReturnType<typeof createFakes>) {
  return recoverPhase1State(
    fakes.jornadaRepository,
    fakes.orderRepository,
    fakes.lecturaRepository,
    FECHA
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("recoverPhase1State — Ticket 10.7", () => {
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
    // la derivación vive en la composición downstream `mapOrdenRow(row, lecturas)`
    // (probada en la suite del repositorio 10.4).
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

  it("G: recovery devuelve solo fuentes; deltaGolpes queda en 0 y progreso vive en el dominio", async () => {
    const orden = createOrden({ estado: "in_production" });
    const lecturas = [createLectura(100, TS), createLectura(106, TS2)];
    const fakes = createFakes({ orden, lecturas });
    const state = await recover(fakes);

    // Shape: solo las tres fuentes.
    expect(Object.keys(state).sort()).toEqual(["jornada", "lecturas", "orden"]);

    // deltaGolpes: placeholder 0 del repositorio; recovery NO calcula 106-100=6.
    expect(state.lecturas[1].deltaGolpes).toBe(0);
    expect(state.lecturas[1].valor).toBe(106);

    // Recovery no persiste nada ni completa nada.
    expect(fakes.orderRepository.saveOrder).not.toHaveBeenCalled();
    expect(fakes.jornadaRepository.guardarJornada).not.toHaveBeenCalled();
    expect(fakes.lecturaRepository.completeLecture).not.toHaveBeenCalled();
    expect(fakes.lecturaRepository.reserveSequence).not.toHaveBeenCalled();

    // La derivación es del dominio EXISTENTE (calculations.ts), que consume
    // los sources devueltos por recovery:
    const progreso = calcularProgreso(
      state.lecturas[state.lecturas.length - 1].valor,
      state.orden!.unidadesSolicitadas
    );
    expect(progreso.golpesProducidos).toBe(106);
    expect(progreso.unidadesProducidas).toBe(318); // 106 golpes x 3 toallas
  });

  // ── Integración ─────────────────────────────────────────────────────────

  it("H1: recovery completo produce el estado correcto (jornada + orden + lecturas)", async () => {
    // Jornada persistida con overtime (07:00-19:00), orden in_production,
    // lecturas con gap.
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
    const fakes = createFakes({ jornada, orden, lecturas });
    const state = await recover(fakes);

    expect(state.jornada).toEqual(jornada);
    expect(state.orden!.estado).toBe("in_production");
    expect(state.orden!.operatorName).toBe("Laura");
    expect(state.lecturas).toEqual(lecturas);

    // Orquestación exacta (white-box): las tres consultas de lectura y nada más.
    expect(fakes.jornadaRepository.obtenerParaFecha).toHaveBeenCalledWith(FECHA);
    expect(fakes.orderRepository.getOrderByFechaOperativa).toHaveBeenCalledWith(
      FECHA
    );
    expect(fakes.lecturaRepository.getLecturasByOrden).toHaveBeenCalledWith(
      orden.id
    );
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
});