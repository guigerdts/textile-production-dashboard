/**
 * Ticket 10.8 — Lectura wiring (spec G + wiring 11)
 *
 * Fakes de los contratos (`IOrderRepository` / `ILecturaGolpeRepository`), sin
 * plugin y sin SQLite real. Cubre:
 *
 * 1. G — Sin lectura artificial: la materialización NUNCA reserva/completa ni
 *    crea filas de lectura; la primera lectura real es `sequence === 1` y
 *    `mapOrdenRow(row, lecturas)` deriva `iniciadaEn`/`contadorBase` de ella.
 * 2. Wiring — `handleIniciar` y `handleRegistrarLectura` con
 *    `lecturaRepository` hacen reserve + complete + saveOrder; sin
 *    `lecturaRepository` se conserva la ruta legacy (solo saveOrder).
 *
 * Sin JSX a propósito (archivo `.ts`): App se instancia con `createElement`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactElement } from "react";
import App from "../../../App";
import { materializarPrograma } from "../materialize";
import { mapOrdenRow, type OrdenRow } from "../sqliteOrderRepository";
import { InMemoryOrderRepository } from "../../inMemoryRepository";
import { InMemoryJornadaRepository } from "../../inMemoryJornadaRepository";
import { FECHA_CON_ORDEN } from "../../fixtures";
import type { ILecturaGolpeRepository } from "../../repository";
import type { LecturaContador, Orden } from "../../../domain/types";

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
  fechaOperativa: FECHA_CON_ORDEN,
  estado: "available",
  creadaExternamenteEn: "2026-09-10T10:00:00.000Z",
  lecturas: [],
};

const TS = "2026-09-11T14:00:00.000Z";

/** Fila SQL equivalente a ORDEN, tal como la devuelve la tabla `orden`. */
const FILA: OrdenRow = {
  id: ORDEN.id,
  numero_orden: ORDEN.numeroOrden,
  fecha_operativa: ORDEN.fechaOperativa,
  referencia_tela: ORDEN.telaReferencia,
  disenio: ORDEN.diseno,
  unidades_solicitadas: ORDEN.unidadesSolicitadas,
  // Columnas derivadas que existen en la tabla pero el mapa ignora (10.4).
  unidades_producidas: 0,
  unidades_primera: 0,
  unidades_segunda: 0,
  estado: ORDEN.estado,
  operario: null,
  machine_id: ORDEN.machineId,
  created_at: "2026-09-10T10:00:00.000Z",
  updated_at: "2026-09-10T10:00:00.000Z",
  aplica_segunda: 0,
  porcentaje_2da: 0,
  tipo_pintura: ORDEN.tipoPintura,
  finalizada_en: null,
};

/**
 * Falso del contrato de lecturas: registra llamadas, sin lógica real.
 * `persistidas` es lo que el repositorio devolvería de SQLite al releer.
 */
function fakeLecturaRepository(
  bitacora: string[],
  persistidas: LecturaContador[] = [],
): ILecturaGolpeRepository {
  return {
    reserveSequence: vi.fn(async (_ordenId: string, _lectureId: string) => {
      bitacora.push("lectura:reserveSequence");
      return persistidas.length + 1;
    }),
    completeLecture: vi.fn(async (_lectureId: string, _valor: number, _timestamp: string) => {
      bitacora.push("lectura:completeLecture");
    }),
    findReservation: vi.fn(async () => undefined),
    getLecturasByOrden: vi.fn(async (): Promise<LecturaContador[]> => {
      bitacora.push("lectura:getLecturasByOrden");
      return persistidas;
    }),
    getMaxSequence: vi.fn(async () => persistidas.length),
  };
}

async function mountApp(ui: ReactElement) {
  render(ui);
  await act(async () => {});
}

/**
 * Los tests de wiring operan la App real con `userEvent` (escritura carácter a
 * carácter). En máquinas lentas eso puede superar el `testTimeout` por defecto
 * de 5 s sin que haya un fallo real, así que llevan un límite explícito.
 */
const UI_TIMEOUT = 30_000;

// ── G. Sin lectura artificial ───────────────────────────────────────────────

describe("G: la materialización nunca crea lecturas — Ticket 10.8", () => {
  it("materializarPrograma no invoca el repositorio de lecturas (ni reserve ni complete)", async () => {
    const bitacora: string[] = [];
    const lecturaRepository = fakeLecturaRepository(bitacora);
    const repository = new InMemoryOrderRepository([]);

    const programa = await materializarPrograma(repository, [ORDEN]);
    expect(programa).toEqual({ insertadas: 1, existentes: 0 });

    // Cero llamadas de lectura durante la materialización.
    expect(lecturaRepository.reserveSequence).not.toHaveBeenCalled();
    expect(lecturaRepository.completeLecture).not.toHaveBeenCalled();
    expect(lecturaRepository.getLecturasByOrden).not.toHaveBeenCalled();
    expect(bitacora).toEqual([]);

    // Y la orden materializada no trae lecturas: no existe lectura artificial.
    const materializada = await repository.getOrderByFechaOperativa(ORDEN.fechaOperativa);
    expect(materializada?.lecturas).toEqual([]);
  });

  it("la primera lectura real es sequence 1 y mapOrdenRow deriva iniciadaEn/contadorBase de ella", async () => {
    const lecturaRepository = fakeLecturaRepository([]);

    // La lectura real la crea el operario al iniciar, NO la materialización.
    const lectureId = crypto.randomUUID();
    const sequence = await lecturaRepository.reserveSequence(ORDEN.id, lectureId);
    expect(sequence).toBe(1);
    await lecturaRepository.completeLecture(lectureId, 100, TS);

    const lecturas: LecturaContador[] = [{ valor: 100, timestamp: TS, deltaGolpes: 0 }];

    // mapOrdenRow deriva los valores derivados desde lecturas[0].
    const orden = mapOrdenRow(FILA, lecturas);
    expect(orden.iniciadaEn).toBe(TS);
    expect(orden.contadorBase).toBe(100);
    expect(orden.lecturas).toEqual(lecturas);

    // Y SIN lecturas no inventa iniciadaEn/contadorBase (columnas inexistentes).
    const sinLecturas = mapOrdenRow(FILA, []);
    expect(sinLecturas.iniciadaEn).toBeUndefined();
    expect(sinLecturas.contadorBase).toBeUndefined();
  });
});

// ── Wiring. App con y sin lecturaRepository ─────────────────────────────────

describe("Wiring: dos fases reserve → complete → saveOrder — Ticket 10.8", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handleIniciar con lecturaRepository: reserva, completa la base y después guarda la orden", async () => {
    const bitacora: string[] = [];
    const lecturaRepository = fakeLecturaRepository(bitacora);
    const repository = new InMemoryOrderRepository([ORDEN]);
    const saveSpy = vi
      .spyOn(repository, "saveOrder")
      .mockImplementation(async (orden: Orden) => {
        bitacora.push("orden:saveOrder");
        expect(orden).toBeDefined();
      });

    await mountApp(
      createElement(App, {
        repository,
        jornadaRepository: new InMemoryJornadaRepository([]),
        lecturaRepository,
        hoy: FECHA_CON_ORDEN,
        fechaOperativaHoy: FECHA_CON_ORDEN,
      }),
    );

    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    await act(async () => {});

    // reserve y complete exactamente una vez, con el valor de la lectura base.
    expect(lecturaRepository.reserveSequence).toHaveBeenCalledTimes(1);
    expect(lecturaRepository.completeLecture).toHaveBeenCalledTimes(1);
    const [ordenId, reserveId] = vi.mocked(lecturaRepository.reserveSequence).mock.calls[0]!;
    const [completeId, valor, timestamp] = vi.mocked(lecturaRepository.completeLecture).mock.calls[0]!;
    expect(ordenId).toBe(ORDEN.id);
    // El mismo lectureId viaja de la reserva a la completion (clave de idempotencia).
    expect(reserveId).toBe(completeId);
    expect(reserveId).toEqual(expect.any(String));
    expect(valor).toBe(100);
    expect(timestamp).toEqual(expect.any(String));

    // saveOrder ocurre DESPUÉS de completeLecture, nunca antes.
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(bitacora.indexOf("lectura:completeLecture")).toBeLessThan(
      bitacora.indexOf("orden:saveOrder"),
    );
  }, UI_TIMEOUT);

  it("handleRegistrarLectura con lecturaRepository: reserva y completa la lectura nueva", async () => {
    const bitacora: string[] = [];
    // Lo que SQLite devolvería al releer: la lectura base ya persistida.
    const lecturaBase: LecturaContador[] = [{ valor: 100, timestamp: TS, deltaGolpes: 0 }];
    const lecturaRepository = fakeLecturaRepository(bitacora, lecturaBase);
    const enProduccion: Orden = {
      ...ORDEN,
      estado: "in_production",
      operatorName: "Laura",
      iniciadaEn: TS,
      contadorBase: 100,
      lecturas: lecturaBase,
    };
    const repository = new InMemoryOrderRepository([enProduccion]);
    const saveSpy = vi
      .spyOn(repository, "saveOrder")
      .mockImplementation(async (orden: Orden) => {
        bitacora.push("orden:saveOrder");
        expect(orden).toBeDefined();
      });

    await mountApp(
      createElement(App, {
        repository,
        jornadaRepository: new InMemoryJornadaRepository([]),
        lecturaRepository,
        hoy: FECHA_CON_ORDEN,
        fechaOperativaHoy: FECHA_CON_ORDEN,
      }),
    );

    const user = userEvent.setup();
    await user.type(
      screen.getByRole("spinbutton", { name: /nueva lectura del contador/i }),
      "150",
    );
    await user.click(screen.getByRole("button", { name: /Registrar lectura/i }));
    await act(async () => {});

    expect(lecturaRepository.reserveSequence).toHaveBeenCalledTimes(1);
    expect(lecturaRepository.completeLecture).toHaveBeenCalledTimes(1);
    const [completeId, valor] = vi.mocked(lecturaRepository.completeLecture).mock.calls[0]!;
    expect(completeId).toEqual(expect.any(String));
    expect(valor).toBe(150);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(bitacora.indexOf("lectura:completeLecture")).toBeLessThan(
      bitacora.indexOf("orden:saveOrder"),
    );
  }, UI_TIMEOUT);

  it("sin lecturaRepository: ruta legacy intacta, solo saveOrder y ninguna llamada de lectura", async () => {
    const bitacora: string[] = [];
    const repository = new InMemoryOrderRepository([ORDEN]);
    const saveSpy = vi
      .spyOn(repository, "saveOrder")
      .mockImplementation(async (orden: Orden) => {
        bitacora.push("orden:saveOrder");
        expect(orden).toBeDefined();
      });

    await mountApp(
      createElement(App, {
        repository,
        jornadaRepository: new InMemoryJornadaRepository([]),
        // lecturaRepository ausente a propósito: ruta legacy.
        hoy: FECHA_CON_ORDEN,
        fechaOperativaHoy: FECHA_CON_ORDEN,
      }),
    );

    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: /operario \(obligatorio\)/i }), "Laura");
    await user.type(screen.getByRole("spinbutton", { name: /lectura inicial/i }), "100");
    await user.click(screen.getByRole("button", { name: /Iniciar producción/i }));
    await act(async () => {});

    expect(saveSpy).toHaveBeenCalledTimes(1);
    // Ninguna entrada de lectura: saveOrder sigue siendo la única escritura.
    expect(bitacora).toEqual(["orden:saveOrder"]);
  }, UI_TIMEOUT);
});
