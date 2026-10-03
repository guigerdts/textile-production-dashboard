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
import type {
  ActividadPlanificada,
  Dano,
  InspeccionTela,
  LecturaContador,
  Mantenimiento,
  Orden,
  Parada,
} from "../domain/types";
import { InMemoryParadaRepository } from "../store/inMemoryParadasRepository";
import { Raiz, type LosOchosRepositorios } from "../Raiz";

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
 * Semilla de los cinco contratos operativos (WU 12.1). Todos los días comparten
 * la máquina M1 y el mismo `ordenId`, para que lo ÚNICO que separa un registro
 * de otro sea su `fechaOperativa`.
 */
interface SemillaOperativa {
  paradas?: Parada[];
  actividades?: ActividadPlanificada[];
  danos?: Dano[];
  mantenimientos?: Mantenimiento[];
  inspecciones?: InspeccionTela[];
}

/**
 * Los cinco contratos operativos (paradas, actividades, daños,
 * mantenimientos, inspecciones — G1). El recovery solo LOS LEE; los métodos
 * de escritura existen para cumplir el contrato y nunca se llaman aquí.
 *
 * WU 12.1 — los cuatro listados por máquina existen en DOS variantes y las dos
 * son de verdad sobre la semilla:
 *
 *  - `listarPorMaquina` (día libre, DD2) devuelve los registros de TODOS los
 *    días de esa máquina.
 *  - `listarPorMaquinaYFecha` devuelve SOLO los de `fechaOperativa`, con el
 *    predicado APLICADO EN EL FALSO (nunca en el llamador, H:125-130).
 *
 * `bitacora` anota cada lectura diaria como `<dominio>:<fecha>` para poder
 * exigir que el cambio de día relea las mismas ocho fuentes acotadas al día
 * nuevo y nada más.
 */
function crearOperativosFalsos(
  semilla: SemillaOperativa = {},
  bitacora: string[] = [],
): {
  paradaRepository: IParadaRepository;
  actividadRepository: IActividadPlanificadaRepository;
  danoRepository: IDanoRepository;
  mantenimientoRepository: IMantenimientoRepository;
  inspeccionRepository: IInspeccionRepository;
} {
  const noEscrito = () => {
    throw new Error("método de escritura no usado por recovery en este test");
  };
  const paradas = semilla.paradas ?? [];
  const actividades = semilla.actividades ?? [];
  const danos = semilla.danos ?? [];
  const mantenimientos = semilla.mantenimientos ?? [];
  const inspecciones = semilla.inspecciones ?? [];
  return {
    paradaRepository: {
      insertParada: noEscrito,
      updateParada: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorMaquina: async (maquinaId) => paradas.filter((p) => p.maquinaId === maquinaId),
      listarPorMaquinaYFecha: async (maquinaId, fechaOperativa) => {
        bitacora.push(`paradas:${fechaOperativa}`);
        return paradas.filter(
          (p) => p.maquinaId === maquinaId && p.fechaOperativa === fechaOperativa,
        );
      },
      listarPorOrden: async (ordenId) => paradas.filter((p) => p.ordenId === ordenId),
      getParadaAbierta: async () => null,
      getParadaAbiertaDeMaquina: async () => null,
    },
    actividadRepository: {
      insertActividad: noEscrito,
      updateActividad: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorMaquina: async (maquinaId) =>
        actividades.filter((a) => a.maquinaId === maquinaId),
      listarPorMaquinaYFecha: async (maquinaId, fechaOperativa) => {
        bitacora.push(`actividades:${fechaOperativa}`);
        return actividades.filter(
          (a) => a.maquinaId === maquinaId && a.fechaOperativa === fechaOperativa,
        );
      },
      getActividadAbierta: async () => null,
    },
    danoRepository: {
      insertDano: noEscrito,
      updateDano: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorMaquina: async (maquinaId) => danos.filter((d) => d.maquinaId === maquinaId),
      listarPorMaquinaYFecha: async (maquinaId, fechaOperativa) => {
        bitacora.push(`danos:${fechaOperativa}`);
        return danos.filter(
          (d) => d.maquinaId === maquinaId && d.fechaOperativa === fechaOperativa,
        );
      },
      listarPorOrden: async (ordenId) => danos.filter((d) => d.ordenId === ordenId),
      getDanoAbierto: async () => null,
    },
    mantenimientoRepository: {
      insertMantenimiento: noEscrito,
      updateMantenimiento: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorMaquina: async (maquinaId) =>
        mantenimientos.filter((m) => m.maquinaId === maquinaId),
      listarPorMaquinaYFecha: async (maquinaId, fechaOperativa) => {
        bitacora.push(`mantenimientos:${fechaOperativa}`);
        return mantenimientos.filter(
          (m) => m.maquinaId === maquinaId && m.fechaOperativa === fechaOperativa,
        );
      },
      getMantenimientoAbierto: async () => null,
    },
    inspeccionRepository: {
      insertInspeccion: noEscrito,
      updateInspeccion: noEscrito,
      obtenerPorId: async () => undefined,
      listarPorOrden: async (ordenId) => {
        bitacora.push(`inspecciones:${ordenId}`);
        return inspecciones.filter((i) => i.ordenId === ordenId);
      },
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

// ══════════════════════════════════════════════════════════════════════════
// WU 12 — cambio de día sobre el seam REAL de recovery (tareas 12.1–12.3)
//
// Spec: `specs/historical-day-navigation/spec.md:100-124` (un cambio de día
// relée las MISMAS ocho fuentes; la navegación no escribe nada) y `:313-324`
// (un día de solo lectura nunca puede producir una escritura; los controles de
// escritura simplemente no existen en pantalla). Design §9 (`:558`), §10.2
// (`:612`), §5.2 (`:178`).
//
// El seam bajo prueba es `Raiz.seleccionarDia` → `recoverPersistedState`, con
// los OCHO puertos reales (fakes del propio archivo, ya sembrados en 12.1).
// No se mockea ningún módulo de producción en 12.1/12.2/12.3a.
// ══════════════════════════════════════════════════════════════════════════

/** Día A: ord-101 «Jessie» (fixture). Día B: ord-102 «Palm» (fixture). */
const DIA_A = "2026-09-11";
const DIA_B = "2026-09-15";
const ORDEN_A = "ord-101";
const ORDEN_B = "ord-102";
const MAQUINA = "M1";

/**
 * Semilla de los DOS días sobre la misma máquina, más TRES registros «fantasma»
 * cuyo `fechaOperativa` pertenece a DIA_B pero cuyo `inicio` cae dentro de
 * DIA_A.
 *
 * Ese desacople es el que hace falsificable la aserción: si el predicado del
 * puerto se derivara de `inicio` (o se soltara del todo), los fantasmas
 * entrarían en la vista de DIA_A y las negativas de abajo reventarían.
 */
const SEMILLA_DOS_DIAS: SemillaOperativa = {
  paradas: [
    {
      id: "par-a",
      maquinaId: "M1",
      ordenId: ORDEN_A,
      operatorName: "Laura",
      causaId: "falta_color",
      camposEspecificos: { color: "rojo" },
      fechaOperativa: DIA_A,
      inicio: `${DIA_A}T10:00:00.000Z`,
      fin: `${DIA_A}T10:15:00.000Z`,
    },
    {
      id: "par-b",
      maquinaId: "M1",
      ordenId: ORDEN_B,
      operatorName: "Laura",
      causaId: "falta_tela",
      camposEspecificos: {},
      fechaOperativa: DIA_B,
      inicio: `${DIA_B}T10:00:00.000Z`,
      fin: `${DIA_B}T10:15:00.000Z`,
    },
    {
      id: "par-fantasma",
      maquinaId: "M1",
      ordenId: ORDEN_A,
      operatorName: "Laura",
      causaId: "atasco_tela",
      camposEspecificos: {},
      // Pertenece a DIA_B; `inicio` y `fin` caen dentro de DIA_A.
      fechaOperativa: DIA_B,
      inicio: `${DIA_A}T23:50:00.000Z`,
      fin: `${DIA_A}T23:55:00.000Z`,
    },
  ],
  actividades: [
    {
      id: "act-a",
      maquinaId: "M1",
      tipo: "limpieza",
      queSeLimpio: "MESA-DIA-A",
      fechaOperativa: DIA_A,
      inicio: `${DIA_A}T12:00:00.000Z`,
      fin: `${DIA_A}T12:30:00.000Z`,
      operatorName: "Laura",
    },
    {
      id: "act-b",
      maquinaId: "M1",
      tipo: "limpieza",
      queSeLimpio: "MESA-DIA-B",
      fechaOperativa: DIA_B,
      inicio: `${DIA_B}T12:00:00.000Z`,
      fin: `${DIA_B}T12:30:00.000Z`,
      operatorName: "Laura",
    },
    {
      id: "act-fantasma",
      maquinaId: "M1",
      tipo: "limpieza",
      queSeLimpio: "MESA-FANTASMA",
      fechaOperativa: DIA_B,
      inicio: `${DIA_A}T23:40:00.000Z`,
      fin: `${DIA_A}T23:45:00.000Z`,
      operatorName: "Laura",
    },
  ],
  danos: [
    {
      id: "dan-a",
      maquinaId: "M1",
      ordenId: ORDEN_A,
      operatorName: "Laura",
      tipo: "mecanico",
      componente: "COMPONENTE-DIA-A",
      fechaOperativa: DIA_A,
      inicio: `${DIA_A}T13:00:00.000Z`,
      fin: `${DIA_A}T13:45:00.000Z`,
      causoParada: false,
      paradaId: null,
      posibleSegunda: false,
    },
    {
      id: "dan-b",
      maquinaId: "M1",
      ordenId: ORDEN_B,
      operatorName: "Laura",
      tipo: "mecanico",
      componente: "COMPONENTE-DIA-B",
      fechaOperativa: DIA_B,
      inicio: `${DIA_B}T13:00:00.000Z`,
      fin: `${DIA_B}T13:45:00.000Z`,
      causoParada: false,
      paradaId: null,
      posibleSegunda: false,
    },
    {
      id: "dan-fantasma",
      maquinaId: "M1",
      ordenId: ORDEN_A,
      operatorName: "Laura",
      tipo: "electrico",
      componente: "COMPONENTE-FANTASMA",
      fechaOperativa: DIA_B,
      inicio: `${DIA_A}T23:45:00.000Z`,
      fin: `${DIA_A}T23:49:00.000Z`,
      causoParada: false,
      paradaId: null,
      posibleSegunda: false,
    },
  ],
  mantenimientos: [
    {
      id: "man-a",
      maquinaId: "M1",
      tipo: "preventivo",
      motivo: "MOTIVO-DIA-A",
      queSeRevisoReparo: "REVISION-DIA-A",
      fechaOperativa: DIA_A,
      inicio: `${DIA_A}T14:00:00.000Z`,
      fin: `${DIA_A}T14:30:00.000Z`,
      danoId: null,
      operatorName: "Laura",
    },
    {
      id: "man-b",
      maquinaId: "M1",
      tipo: "preventivo",
      motivo: "MOTIVO-DIA-B",
      queSeRevisoReparo: "REVISION-DIA-B",
      fechaOperativa: DIA_B,
      inicio: `${DIA_B}T14:00:00.000Z`,
      fin: `${DIA_B}T14:30:00.000Z`,
      danoId: null,
      operatorName: "Laura",
    },
    {
      id: "man-fantasma",
      maquinaId: "M1",
      tipo: "reactivo",
      motivo: "MOTIVO-FANTASMA",
      queSeRevisoReparo: "REVISION-FANTASMA",
      fechaOperativa: DIA_B,
      inicio: `${DIA_A}T23:55:00.000Z`,
      fin: `${DIA_A}T23:59:00.000Z`,
      danoId: null,
      operatorName: "Laura",
    },
  ],
  inspecciones: [
    {
      id: "ins-a",
      ordenId: ORDEN_A,
      operatorName: "Laura",
      lote: "LOTE-DIA-A",
      items: [
        { id: "absorcion", estado: "conforme" },
        { id: "tundido", estado: "conforme" },
        { id: "manchas", estado: "conforme" },
        { id: "dimensiones", estado: "conforme" },
        { id: "estado_general", estado: "conforme" },
      ],
      timestamp: `${DIA_A}T08:00:00.000Z`,
      resolucion: null,
    },
    {
      id: "ins-b",
      ordenId: ORDEN_B,
      operatorName: "Laura",
      lote: "LOTE-DIA-B",
      items: [
        { id: "absorcion", estado: "conforme" },
        { id: "tundido", estado: "conforme" },
        { id: "manchas", estado: "conforme" },
        { id: "dimensiones", estado: "conforme" },
        { id: "estado_general", estado: "conforme" },
      ],
      timestamp: `${DIA_B}T08:00:00.000Z`,
      resolucion: null,
    },
  ],
};

/**
 * Almacén con las DOS órdenes materializadas y ambas en producción.
 *
 * `in_production` no es decorativo: `ParadasSection` (única sección que pinta
 * `.paradas__historial`) solo existe en `OrderInProduction`, así que sin ese
 * estado la mitad de las aserciones de pantalla serían vacías.
 */
async function programaDeLosDosDias(): Promise<AlmacenFalso> {
  const almacen = crearAlmacen();
  await materializarPrograma(crearOrdenFalsa(almacen), crearFixtureOrdenes());
  for (const orden of almacen.ordenes.values()) orden.estado = "in_production";
  expect(almacen.ordenes.size).toBe(2);
  return almacen;
}

/** Los OCHO puertos sobre el mismo almacén, con la semilla de los dos días. */
function reposDeLosDosDias(almacen: AlmacenFalso, bitacora: string[]): LosOchosRepositorios {
  return {
    repository: crearOrdenFalsa(almacen),
    jornadaRepository: crearJornadaFalsa(),
    lecturaRepository: crearLecturaFalsa(almacen),
    ...crearOperativosFalsos(SEMILLA_DOS_DIAS, bitacora),
  };
}

/** Recovery REAL (el mismo que usa `main.tsx` y `Raiz`). */
function estadoDe(repos: LosOchosRepositorios, fechaOperativa: string): Promise<RecoveryState> {
  return recoverPersistedState(
    repos.jornadaRepository,
    repos.repository,
    repos.lecturaRepository,
    repos.paradaRepository,
    repos.actividadRepository,
    repos.danoRepository,
    repos.mantenimientoRepository,
    repos.inspeccionRepository,
    fechaOperativa,
    MAQUINA,
  );
}

/**
 * Vigila las QUINCE escrituras de los ocho puertos con implementación silenciosa.
 *
 * Por qué con `mockImplementation` y no con `noEscrito`: los diez métodos que
 * `noEscrito` ya protege lanzarían una excepción flotante (un rechazo sin
 * contexto dentro de un `useEffect`), mientras que acá el fallo es una ASERCIÓN
 * NOMBRADA que dice qué método escribió. Los cinco que `noEscrito` NO cubre
 * (`saveOrder`, `materializeOrder`, `reserveSequence`, `completeLecture`,
 * `guardarJornada`) quedan cubiertos por el mismo techo.
 */
function vigilarEscrituras(repos: LosOchosRepositorios) {
  return {
    saveOrder: vi.spyOn(repos.repository, "saveOrder").mockImplementation(async () => {}),
    materializeOrder: vi
      .spyOn(repos.repository, "materializeOrder")
      .mockImplementation(async () => false),
    reserveSequence: vi.spyOn(repos.lecturaRepository, "reserveSequence").mockImplementation(async () => 0),
    completeLecture: vi
      .spyOn(repos.lecturaRepository, "completeLecture")
      .mockImplementation(async () => {}),
    guardarJornada: vi
      .spyOn(repos.jornadaRepository, "guardarJornada")
      .mockImplementation(async () => {}),
    insertParada: vi.spyOn(repos.paradaRepository, "insertParada").mockImplementation(async () => {}),
    updateParada: vi.spyOn(repos.paradaRepository, "updateParada").mockImplementation(async () => {}),
    insertActividad: vi
      .spyOn(repos.actividadRepository, "insertActividad")
      .mockImplementation(async () => {}),
    updateActividad: vi
      .spyOn(repos.actividadRepository, "updateActividad")
      .mockImplementation(async () => {}),
    insertDano: vi.spyOn(repos.danoRepository, "insertDano").mockImplementation(async () => {}),
    updateDano: vi.spyOn(repos.danoRepository, "updateDano").mockImplementation(async () => {}),
    insertMantenimiento: vi
      .spyOn(repos.mantenimientoRepository, "insertMantenimiento")
      .mockImplementation(async () => {}),
    updateMantenimiento: vi
      .spyOn(repos.mantenimientoRepository, "updateMantenimiento")
      .mockImplementation(async () => {}),
    insertInspeccion: vi
      .spyOn(repos.inspeccionRepository, "insertInspeccion")
      .mockImplementation(async () => {}),
    updateInspeccion: vi
      .spyOn(repos.inspeccionRepository, "updateInspeccion")
      .mockImplementation(async () => {}),
  };
}

/** Monta `Raiz` (la raíz REAL del arranque) con el estado de un día dado. */
async function montarRaiz(repos: LosOchosRepositorios, estado: RecoveryState): Promise<void> {
  await mountApp(createElement(Raiz, { repos, estadoInicial: estado, fechaOperativaInicial: DIA_B }));
}

/**
 * Dispara el cambio de día por el seam del navegador (mismo camino que
 * `onSeleccionar`). `fireEvent` dentro de `act`, no `userEvent`: el cambio es
 * un solo evento sintético y `act` drene la promesa de `seleccionarDia`.
 */
async function navegarA(fechaOperativa: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Fecha operativa"), {
      target: { value: fechaOperativa },
    });
  });
  await act(async () => {});
}

function marcasDeLosDosDias(): { propias: string[]; ajenas: string[] } {
  return {
    propias: ["MESA-DIA-A", "COMPONENTE-DIA-A", "MOTIVO-DIA-A", "REVISION-DIA-A", "LOTE-DIA-A"],
    ajenas: [
      "MESA-DIA-B",
      "MESA-FANTASMA",
      "COMPONENTE-DIA-B",
      "COMPONENTE-FANTASMA",
      "MOTIVO-DIA-B",
      "MOTIVO-FANTASMA",
      "REVISION-DIA-B",
      "REVISION-FANTASMA",
      "LOTE-DIA-B",
      "Falta de materia prima (tela)",
      "Atasco o rotura de tela en la máquina",
    ],
  };
}

// ── 12.1 ────────────────────────────────────────────────────────────────────

describe("12.1 — los cuatro listados por máquina existen y filtran por fechaOperativa", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("día libre vs día acotado en los cuatro puertos, con el registro fantasma fuera de su día", async () => {
    const almacen = await programaDeLosDosDias();
    const repos = reposDeLosDosDias(almacen, []);

    // ── Día libre (DD2): los DOS días, incluidos los fantasmas. ──
    expect((await repos.paradaRepository.listarPorMaquina(MAQUINA)).map((p) => p.id).sort()).toEqual([
      "par-a",
      "par-b",
      "par-fantasma",
    ]);
    expect(
      (await repos.actividadRepository.listarPorMaquina(MAQUINA)).map((a) => a.id).sort(),
    ).toEqual(["act-a", "act-b", "act-fantasma"]);
    expect((await repos.danoRepository.listarPorMaquina(MAQUINA)).map((d) => d.id).sort()).toEqual([
      "dan-a",
      "dan-b",
      "dan-fantasma",
    ]);
    expect(
      (await repos.mantenimientoRepository.listarPorMaquina(MAQUINA)).map((m) => m.id).sort(),
    ).toEqual(["man-a", "man-b", "man-fantasma"]);

    // ── Día acotado (DD1/DD3): SOLO ese día, con el predicado en el puerto. ──
    expect((await repos.paradaRepository.listarPorMaquinaYFecha(MAQUINA, DIA_A)).map((p) => p.id)).toEqual([
      "par-a",
    ]);
    expect(
      (await repos.actividadRepository.listarPorMaquinaYFecha(MAQUINA, DIA_A)).map((a) => a.id),
    ).toEqual(["act-a"]);
    expect((await repos.danoRepository.listarPorMaquinaYFecha(MAQUINA, DIA_A)).map((d) => d.id)).toEqual([
      "dan-a",
    ]);
    expect(
      (await repos.mantenimientoRepository.listarPorMaquinaYFecha(MAQUINA, DIA_A)).map((m) => m.id),
    ).toEqual(["man-a"]);

    // En DIA_B SÍ están los fantasmas: su fechaOperativa manda, no su `inicio`.
    expect(
      (await repos.paradaRepository.listarPorMaquinaYFecha(MAQUINA, DIA_B)).map((p) => p.id).sort(),
    ).toEqual(["par-b", "par-fantasma"]);
    expect(
      (await repos.actividadRepository.listarPorMaquinaYFecha(MAQUINA, DIA_B)).map((a) => a.id).sort(),
    ).toEqual(["act-b", "act-fantasma"]);
    expect(
      (await repos.danoRepository.listarPorMaquinaYFecha(MAQUINA, DIA_B)).map((d) => d.id).sort(),
    ).toEqual(["dan-b", "dan-fantasma"]);
    expect(
      (await repos.mantenimientoRepository.listarPorMaquinaYFecha(MAQUINA, DIA_B)).map((m) => m.id).sort(),
    ).toEqual(["man-b", "man-fantasma"]);

    // ── El quinto dominio es por ORDEN (G1: inspecciones viajan con la orden). ──
    expect((await repos.inspeccionRepository.listarPorOrden(ORDEN_A)).map((i) => i.id)).toEqual([
      "ins-a",
    ]);
    expect((await repos.inspeccionRepository.listarPorOrden(ORDEN_B)).map((i) => i.id)).toEqual([
      "ins-b",
    ]);
  });
});

// ── 12.2 ────────────────────────────────────────────────────────────────────

describe("12.2 — el cambio de día relée las ocho fuentes y no escribe nada", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("de DIA_B a DIA_A: misma máquina, mismas ocho fuentes, cero escrituras y pantalla acotada", async () => {
    const almacen = await programaDeLosDosDias();
    const bitacora: string[] = [];
    const repos = reposDeLosDosDias(almacen, bitacora);

    // Las TRES lecturas que no viajan por `bitacora` se espían aparte.
    const lectorJornada = vi.spyOn(repos.jornadaRepository, "obtenerParaFecha");
    const lectorOrden = vi.spyOn(repos.repository, "getOrderByFechaOperativa");
    const lectorLecturas = vi.spyOn(repos.lecturaRepository, "getLecturasByOrden");
    const escrituras = vigilarEscrituras(repos);

    // Cobertura ejecutable: si alguien saca un espía, el test falla acá y no
    // en una aserción que deja de existir.
    expect(Object.keys(escrituras).sort()).toEqual(
      [
        "completeLecture",
        "guardarJornada",
        "insertActividad",
        "insertDano",
        "insertInspeccion",
        "insertMantenimiento",
        "insertParada",
        "materializeOrder",
        "reserveSequence",
        "saveOrder",
        "updateActividad",
        "updateDano",
        "updateInspeccion",
        "updateMantenimiento",
        "updateParada",
      ].sort(),
    );

    await montarRaiz(repos, await estadoDe(repos, DIA_B));

    const { propias, ajenas } = marcasDeLosDosDias();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("MESA-DIA-B");
    });
    expect(document.body.textContent).toContain("Fecha operativa: " + DIA_B);
    expect(document.body.textContent).toContain("OP-102");
    for (const marca of propias) expect(document.body.textContent).not.toContain(marca);

    // ── Instantánea de los dos almacenes ANTES del cambio. ──
    const antes = JSON.stringify({
      ordenes: [...almacen.ordenes.values()],
      lecturas: almacen.lecturas,
    });

    // ── Se limpia todo rastro del montaje inicial y se navega. ──
    bitacora.length = 0;
    lectorJornada.mockClear();
    lectorOrden.mockClear();
    lectorLecturas.mockClear();
    await navegarA(DIA_A);

    // ── Las OCHO fuentes se relén, acotadas al día nuevo. ──
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("MESA-DIA-A");
    });
    expect(bitacora).toEqual(
      expect.arrayContaining([
        `paradas:${DIA_A}`,
        `actividades:${DIA_A}`,
        `danos:${DIA_A}`,
        `mantenimientos:${DIA_A}`,
        `inspecciones:${ORDEN_A}`,
      ]),
    );
    // Ninguna fuente tocó el día anterior ni la orden del día anterior.
    expect(bitacora.filter((entrada) => entrada.includes(DIA_B))).toEqual([]);
    expect(bitacora.filter((entrada) => entrada.includes(ORDEN_B))).toEqual([]);

    expect(lectorJornada).toHaveBeenCalled();
    expect(lectorJornada.mock.calls.every(([fecha]) => fecha === DIA_A)).toBe(true);
    expect(lectorOrden).toHaveBeenCalled();
    expect(lectorOrden.mock.calls.every(([fecha]) => fecha === DIA_A)).toBe(true);
    expect(lectorLecturas).toHaveBeenCalled();
    expect(lectorLecturas.mock.calls.every(([ordenId]) => ordenId === ORDEN_A)).toBe(true);

    // ── Pantalla: el día nuevo y SOLO el día nuevo. ──
    expect(document.body.textContent).toContain("Fecha operativa: " + DIA_A);
    expect(document.body.textContent).toContain("OP-101");
    for (const marca of propias) expect(document.body.textContent).toContain(marca);
    for (const marca of ajenas) expect(document.body.textContent).not.toContain(marca);

    // ── NINGUNA escritura: quince espías en silencio + almacén byte a byte. ──
    for (const [nombre, espia] of Object.entries(escrituras)) {
      expect(espia, `el cambio de día no debe llamar ${nombre}`).not.toHaveBeenCalled();
    }
    expect(JSON.stringify({ ordenes: [...almacen.ordenes.values()], lecturas: almacen.lecturas })).toBe(
      antes,
    );
  }, UI_TIMEOUT);

  it("el navegador habilita el día anterior y lo deshabilita el cambio terminado", async () => {
    const almacen = await programaDeLosDosDias();
    const repos = reposDeLosDosDias(almacen, []);
    await montarRaiz(repos, await estadoDe(repos, DIA_B));

    const campo = () => screen.getByLabelText("Fecha operativa") as HTMLInputElement;
    await vi.waitFor(() => {
      expect(campo().disabled).toBe(false);
    });
    expect(campo().value).toBe(DIA_B);
    expect(
      (screen.getByRole("button", { name: "Día operativo siguiente" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Día operativo anterior" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    await navegarA(DIA_A);
    await vi.waitFor(() => {
      expect(campo().value).toBe(DIA_A);
    });
    expect(campo().disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  }, UI_TIMEOUT);
});

// ── 12.3a ───────────────────────────────────────────────────────────────────

describe("12.3a — si el cambio de día falla, el día anterior queda y el error es visible", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovery rechazado en el cambio: DIA_B sigue en pantalla y role=\"alert\" explica el fallo", async () => {
    const almacen = await programaDeLosDosDias();
    const repos = reposDeLosDosDias(almacen, []);

    // Se inyecta el fallo EN el puerto que recovery va a llamar para DIA_A,
    // dejando el día inicial (DIA_B) intacto.
    const listarDelDia = repos.paradaRepository.listarPorMaquinaYFecha;
    repos.paradaRepository.listarPorMaquinaYFecha = async (maquinaId, fechaOperativa) => {
      if (fechaOperativa === DIA_A) {
        throw new Error("no se pudo recuperar las paradas de la máquina " + MAQUINA);
      }
      return listarDelDia(maquinaId, fechaOperativa);
    };

    await montarRaiz(repos, await estadoDe(repos, DIA_B));
    const { propias } = marcasDeLosDosDias();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("MESA-DIA-B");
    });

    await navegarA(DIA_A);

    // 1) El fallo es VISIBLE (design §5.2): `role="alert"` con el mensaje real.
    await vi.waitFor(() => {
      expect(screen.queryAllByRole("alert").length).toBeGreaterThan(0);
    });
    const mensajes = screen
      .queryAllByRole("alert")
      .map((nodo) => nodo.textContent ?? "")
      .join("\n");
    expect(mensajes).toContain("No se pudo cargar ese día");
    expect(mensajes).toContain("no se pudo recuperar las paradas de la máquina " + MAQUINA);

    // 2) El día ANTERIOR sigue en pantalla, con sus datos y sin los del día fallido.
    expect(document.body.textContent).toContain("Fecha operativa: " + DIA_B);
    expect(document.body.textContent).toContain("OP-102");
    for (const marca of ["MESA-DIA-B", "COMPONENTE-DIA-B", "MOTIVO-DIA-B", "LOTE-DIA-B"]) {
      expect(document.body.textContent).toContain(marca);
    }
    // NADA del día que falló entró: recovery rechazó ANTES de tocar `vista`.
    for (const marca of propias) {
      expect(document.body.textContent).not.toContain(marca);
    }
    expect(document.body.textContent).not.toContain("OP-101");
    expect(document.body.textContent).not.toContain("Jessie");

    // 3) Sigue siendo reintentable: el navegador no quedó inoperativo.
    expect((screen.getByLabelText("Fecha operativa") as HTMLInputElement).disabled).toBe(false);
  }, UI_TIMEOUT);
});

// ── 12.3b ───────────────────────────────────────────────────────────────────

describe("12.3b — si el recovery falla en el ARRANQUE, la pantalla de fallo y jamás el dashboard", () => {
  afterEach(() => {
    vi.doUnmock("../store/sqlite/database");
    document.getElementById("root")?.remove();
  });

  it("main.tsx renderiza InicializacionFallida con el error, y el DOM del App no existe", async () => {
    const contenedor = document.createElement("div");
    contenedor.id = "root";
    document.body.appendChild(contenedor);

    // ÚNICO mock del caso: la frontera SQLite. `../store/sqlite/database` no
    // está importado por ningún otro módulo de esta suite, así que este es su
    // PRIMERA importación y el mock entra sin discutir. Todo lo demás —
    // main.tsx, Raiz, recoverPersistedState, materializarPrograma y los ocho
    // repositorios Sqlite — corre de verdad sobre ese doble de `Database`.
    //
    // El doble responde `[]` a cualquier SELECT y `rowsAffected: 1` a cualquier
    // INSERT (materialización idónea) y RECHAZA el único SELECT que filtra
    // `parada` por `fecha_operativa`: exactamente la lectura día-acotada del
    // cuarto paso del arranque.
    const dbDoble = {
      select: vi.fn(async (sql: string) => {
        if (sql.includes("FROM parada") && sql.includes("fecha_operativa")) {
          throw new Error("no se pudo recuperar las paradas de la máquina " + MAQUINA);
        }
        return [];
      }),
      execute: vi.fn(async () => ({ rowsAffected: 1 })),
    };
    vi.doMock("../store/sqlite/database", () => ({
      initDatabase: async () => dbDoble,
      getDatabase: () => dbDoble,
      closeDatabase: async () => true,
      getJournalMode: async () => "wal",
      getSynchronous: async () => 1,
      getForeignKeys: async () => 1,
    }));

    await import("../main");
    await vi.waitFor(
      () => {
        expect(document.body.textContent).toContain("No se pudo iniciar el dashboard");
      },
      { timeout: 10_000 },
    );

    // La lectura que falló es la del recovery (paso 4), no la base ni la
    // materialización: su mensaje llega íntegro a la pantalla de fallo.
    expect(document.body.textContent).toContain("Error de inicialización");
    expect(document.body.textContent).toContain(
      "no se pudo recuperar las paradas de la máquina " + MAQUINA,
    );

    // `h1.app__titulo` existe en las DOS pantallas: se distingue por el TEXTO,
    // no por el selector.
    const titulos = [...document.querySelectorAll("h1")].map((h) => h.textContent);
    expect(titulos).toContain("No se pudo iniciar el dashboard");
    expect(titulos).not.toContain("Dashboard de Estampado");

    // El dashboard NUNCA montó: sin app real, sin home y sin navegador de día.
    expect(document.body.textContent).not.toContain("Dashboard de Estampado");
    expect(document.querySelector('[data-testid="dashboard-home"]')).toBeNull();
    expect(screen.queryByLabelText("Fecha operativa")).toBeNull();
    expect(document.querySelector(".selector-dia")).toBeNull();
  }, UI_TIMEOUT);
});
