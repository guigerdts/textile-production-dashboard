/**
 * Pruebas de dominio — ticket 04 (modelo de tiempo derivado).
 * Funciones puras de tiempo.ts.
 * Reglas clave: recorte a jornada, abiertas hasta instanteConsulta,
 * unión intra-bucket e inter-bucket (no doble conteo), productivo nunca
 * negativo, no mutación de entradas, validación fin > inicio.
 */
import { describe, expect, it } from "vitest";
import {
  jornadaDefault,
  resumenTiempoTurno,
  validarJornada,
} from "./tiempo";
import type {
  ActividadPlanificada,
  JornadaTurno,
  Parada,
} from "./types";

/** Verifica que ALGÚN mensaje de error contenga el fragmento buscado. */
function contiene(errores: string[], fragmento: string): boolean {
  return errores.some((e) => e.includes(fragmento));
}

// ---------------------------------------------------------------------------
// Fixtures de dominio (coherentes con store/actividadesFixtures y paradasFixtures)
// ---------------------------------------------------------------------------

const M1 = "M1" as const;

/** Jornada default del día de producción: 2026-09-11 (viernes) 07:00–17:00. */
const JORNADA: JornadaTurno = {
  inicio: "2026-09-11T07:00:00.000Z",
  fin: "2026-09-11T17:00:00.000Z",
};

/** Jornada con overtime: fin extendido a 19:00. */
const JORNADA_OVERTIME: JornadaTurno = {
  ...JORNADA,
  fin: "2026-09-11T19:00:00.000Z",
};

function actividad(over: Partial<ActividadPlanificada>): ActividadPlanificada {
  return {
    id: "act-t",
    maquinaId: M1,
    tipo: "cambio_diseno",
    fechaOperativa: "2026-09-11",
    inicio: "2026-09-11T08:00:00.000Z",
    fin: "2026-09-11T09:00:00.000Z",
    operatorName: "Carlos Gómez",
    ...over,
  };
}

function parada(over: Partial<Parada>): Parada {
  return {
    id: "par-t",
    maquinaId: M1,
    ordenId: "ord-101",
    operatorName: "Carlos Gómez",
    causaId: "falta_color",
    camposEspecificos: { color: "AZUL" },
    fechaOperativa: "2026-09-11",
    inicio: "2026-09-11T09:30:00.000Z",
    fin: "2026-09-11T09:45:00.000Z",
    ...over,
  };
}

const INSTANTE = "2026-09-11T17:00:00.000Z";

// ---------------------------------------------------------------------------
// Jornada
// ---------------------------------------------------------------------------

describe("ticket 04: jornadaDefault y validarJornada", () => {
  it("construye la jornada default 07:00–17:00 para la fecha operativa", () => {
    const jornada = jornadaDefault("2026-09-11");
    expect(jornada.inicio).toBe("2026-09-11T07:00:00.000Z");
    expect(jornada.fin).toBe("2026-09-11T17:00:00.000Z");
  });

  it("acepta una jornada válida (fin posterior a inicio)", () => {
    expect(validarJornada(JORNADA)).toEqual([]);
  });

  it("rechaza fin igual al inicio", () => {
    const invalida: JornadaTurno = {
      inicio: "2026-09-11T07:00:00.000Z",
      fin: "2026-09-11T07:00:00.000Z",
    };
    expect(
      contiene(validarJornada(invalida), "el fin de la jornada debe ser posterior al inicio"),
    ).toBe(true);
  });

  it("rechaza fin anterior al inicio", () => {
    const invalida: JornadaTurno = {
      inicio: "2026-09-11T17:00:00.000Z",
      fin: "2026-09-11T07:00:00.000Z",
    };
    expect(
      contiene(validarJornada(invalida), "el fin de la jornada debe ser posterior al inicio"),
    ).toBe(true);
  });

  it("rechaza jornada sin inicio o sin fin", () => {
    expect(contiene(validarJornada({ inicio: "", fin: "2026-09-11T17:00:00.000Z" }), "debe indicar el inicio de la jornada")).toBe(true);
    expect(contiene(validarJornada({ inicio: "2026-09-11T07:00:00.000Z", fin: "" }), "debe indicar el fin de la jornada")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Casos base
// ---------------------------------------------------------------------------

describe("ticket 04: resumenTiempoTurno — casos base", () => {
  it("turno vacío: productivo = total disponible (36000 s)", () => {
    const { resumen, errores } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [],
      paradas: [],
      instanteConsulta: INSTANTE,
    });
    expect(errores).toEqual([]);
    expect(resumen!.totalDisponible).toBe(36000);
    expect(resumen!.planificado).toBe(0);
    expect(resumen!.incidencias).toBe(0);
    expect(resumen!.noProductivoTotal).toBe(0);
    expect(resumen!.productivo).toBe(36000);
  });

  it("overtime extiende el total disponible (fin 19:00 → 43200 s)", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA_OVERTIME,
      actividades: [],
      paradas: [],
      instanteConsulta: "2026-09-11T19:00:00.000Z",
    });
    expect(resumen!.totalDisponible).toBe(43200);
    expect(resumen!.productivo).toBe(43200);
  });

  it("exige instante de consulta", () => {
    const { resumen, errores } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [],
      paradas: [],
      instanteConsulta: "",
    });
    expect(resumen).toBeUndefined();
    expect(contiene(errores, "debe indicar el instante de consulta")).toBe(true);
  });

  it("rechaza jornada inválida (fin anterior al inicio)", () => {
    const { resumen, errores } = resumenTiempoTurno({
      jornada: { inicio: "2026-09-11T17:00:00.000Z", fin: "2026-09-11T07:00:00.000Z" },
      actividades: [],
      paradas: [],
      instanteConsulta: INSTANTE,
    });
    expect(resumen).toBeUndefined();
    expect(contiene(errores, "el fin de la jornada debe ser posterior al inicio")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Buckets individuales y recorte
// ---------------------------------------------------------------------------

describe("ticket 04: buckets y recorte a la jornada", () => {
  it("actividad cerrada dentro de la jornada suma en planificado", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [actividad({})],
      paradas: [],
      instanteConsulta: INSTANTE,
    });
    expect(resumen!.planificado).toBe(3600);
    expect(resumen!.noProductivoTotal).toBe(3600);
    expect(resumen!.productivo).toBe(36000 - 3600);
  });

  it("parada cerrada dentro de la jornada suma en incidencias", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [],
      paradas: [parada({})],
      instanteConsulta: INSTANTE,
    });
    expect(resumen!.incidencias).toBe(900);
    expect(resumen!.noProductivoTotal).toBe(900);
    expect(resumen!.productivo).toBe(36000 - 900);
  });

  it("recorta una actividad que empieza antes del inicio de jornada", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [
        actividad({ inicio: "2026-09-11T04:00:00.000Z", fin: "2026-09-11T07:30:00.000Z" }),
      ],
      paradas: [],
      instanteConsulta: INSTANTE,
    });
    // 07:00–07:30 → 30 min
    expect(resumen!.planificado).toBe(1800);
  });

  it("recorta una actividad que termina después del fin de jornada", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [
        actividad({ inicio: "2026-09-11T16:30:00.000Z", fin: "2026-09-11T18:00:00.000Z" }),
      ],
      paradas: [],
      instanteConsulta: INSTANTE,
    });
    // 16:30–17:00 → 30 min
    expect(resumen!.planificado).toBe(1800);
  });

  it("ignora una actividad completamente fuera de la jornada", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [
        actividad({ inicio: "2026-09-11T04:00:00.000Z", fin: "2026-09-11T06:00:00.000Z" }),
      ],
      paradas: [],
      instanteConsulta: INSTANTE,
    });
    expect(resumen!.planificado).toBe(0);
    expect(resumen!.productivo).toBe(36000);
  });

  it("ignora una parada después del fin de jornada", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [],
      paradas: [
        parada({ inicio: "2026-09-11T17:30:00.000Z", fin: "2026-09-11T17:45:00.000Z" }),
      ],
      instanteConsulta: INSTANTE,
    });
    expect(resumen!.incidencias).toBe(0);
  });

  it("recorta con overtime: actividad que llega hasta las 18:00 cuenta completa con fin 19:00", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA_OVERTIME,
      actividades: [
        actividad({ inicio: "2026-09-11T17:30:00.000Z", fin: "2026-09-11T18:00:00.000Z" }),
      ],
      paradas: [],
      instanteConsulta: "2026-09-11T19:00:00.000Z",
    });
    expect(resumen!.totalDisponible).toBe(43200);
    expect(resumen!.planificado).toBe(1800);
    expect(resumen!.productivo).toBe(43200 - 1800);
  });
});

// ---------------------------------------------------------------------------
// Abiertas hasta instanteConsulta
// ---------------------------------------------------------------------------

describe("ticket 04: abiertas hasta instanteConsulta", () => {
  it("actividad abierta se computa hasta el instante de consulta", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [actividad({ inicio: "2026-09-11T08:00:00.000Z", fin: null })],
      paradas: [],
      instanteConsulta: "2026-09-11T09:00:00.000Z",
    });
    // 08:00–09:00 → 1 h
    expect(resumen!.planificado).toBe(3600);
  });

  it("parada abierta se computa hasta el instante de consulta", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [],
      paradas: [parada({ inicio: "2026-09-11T14:00:00.000Z", fin: null })],
      instanteConsulta: "2026-09-11T14:30:00.000Z",
    });
    // 14:00–14:30 → 30 min
    expect(resumen!.incidencias).toBe(1800);
  });

  it("abierta con instante de consulta anterior al inicio no aporta", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [actividad({ inicio: "2026-09-11T10:00:00.000Z", fin: null })],
      paradas: [],
      instanteConsulta: "2026-09-11T09:00:00.000Z",
    });
    expect(resumen!.planificado).toBe(0);
  });

  it("abierta recortada por el fin de jornada aunque el instante sea posterior", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [actividad({ inicio: "2026-09-11T16:00:00.000Z", fin: null })],
      paradas: [],
      instanteConsulta: "2026-09-11T18:00:00.000Z",
    });
    // recorte: 16:00–17:00 → 1 h (no 2 h)
    expect(resumen!.planificado).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// Unión de intervalos — no doble conteo
// ---------------------------------------------------------------------------

describe("ticket 04: unión de intervalos (no doble conteo)", () => {
  it("actividades superpuestas entre sí suman una sola vez (intra-bucket)", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [
        actividad({ id: "a1", inicio: "2026-09-11T08:00:00.000Z", fin: "2026-09-11T10:00:00.000Z" }),
        actividad({ id: "a2", inicio: "2026-09-11T09:00:00.000Z", fin: "2026-09-11T11:00:00.000Z" }),
      ],
      paradas: [],
      instanteConsulta: INSTANTE,
    });
    // unión = 08:00–11:00 → 3 h (no 4 h)
    expect(resumen!.planificado).toBe(10800);
  });

  it("paradas superpuestas entre sí suman una sola vez (intra-bucket)", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [],
      paradas: [
        parada({ id: "p1", inicio: "2026-09-11T09:00:00.000Z", fin: "2026-09-11T10:00:00.000Z" }),
        parada({ id: "p2", inicio: "2026-09-11T09:30:00.000Z", fin: "2026-09-11T11:00:00.000Z" }),
      ],
      instanteConsulta: INSTANTE,
    });
    // unión = 09:00–11:00 → 2 h (no 2.5 h)
    expect(resumen!.incidencias).toBe(7200);
  });

  it("actividades adyacentes no se suman doble (fin == inicio del siguiente)", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [
        actividad({ id: "a1", inicio: "2026-09-11T08:00:00.000Z", fin: "2026-09-11T09:00:00.000Z" }),
        actividad({ id: "a2", inicio: "2026-09-11T09:00:00.000Z", fin: "2026-09-11T10:00:00.000Z" }),
      ],
      paradas: [],
      instanteConsulta: INSTANTE,
    });
    expect(resumen!.planificado).toBe(7200);
  });

  it("ejemplo canónico: actividad 08:00–09:00 + parada 08:30–10:00 → noProductivoTotal = 2 h", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [actividad({ id: "a1", inicio: "2026-09-11T08:00:00.000Z", fin: "2026-09-11T09:00:00.000Z" })],
      paradas: [parada({ id: "p1", inicio: "2026-09-11T08:30:00.000Z", fin: "2026-09-11T10:00:00.000Z" })],
      instanteConsulta: INSTANTE,
    });
    expect(resumen!.planificado).toBe(3600); // 1 h
    expect(resumen!.incidencias).toBe(5400); // 1 h 30 min
    expect(resumen!.noProductivoTotal).toBe(7200); // unión 08:00–10:00 = 2 h
    expect(resumen!.productivo).toBe(36000 - 7200); // 8 h
  });

  it("actividad y parada idénticas suman una sola vez (inter-bucket)", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [actividad({ id: "a1", inicio: "2026-09-11T09:00:00.000Z", fin: "2026-09-11T10:00:00.000Z" })],
      paradas: [parada({ id: "p1", inicio: "2026-09-11T09:00:00.000Z", fin: "2026-09-11T10:00:00.000Z" })],
      instanteConsulta: INSTANTE,
    });
    expect(resumen!.planificado).toBe(3600);
    expect(resumen!.incidencias).toBe(3600);
    expect(resumen!.noProductivoTotal).toBe(3600); // no 7200
    expect(resumen!.productivo).toBe(36000 - 3600);
  });

  it("no productivo total incluye actividades y paradas en tramos distintos", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [actividad({ id: "a1", inicio: "2026-09-11T08:00:00.000Z", fin: "2026-09-11T09:00:00.000Z" })],
      paradas: [parada({ id: "p1", inicio: "2026-09-11T11:00:00.000Z", fin: "2026-09-11T12:00:00.000Z" })],
      instanteConsulta: INSTANTE,
    });
    expect(resumen!.planificado).toBe(3600);
    expect(resumen!.incidencias).toBe(3600);
    expect(resumen!.noProductivoTotal).toBe(7200);
    expect(resumen!.productivo).toBe(36000 - 7200);
  });
});

// ---------------------------------------------------------------------------
// Productivo nunca negativo + no mutación
// ---------------------------------------------------------------------------

describe("ticket 04: productivo y no mutación", () => {
  it("productivo nunca es negativo cuando el no productivo cubre toda la jornada", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [actividad({ inicio: "2026-09-11T06:00:00.000Z", fin: "2026-09-11T18:00:00.000Z" })],
      paradas: [],
      instanteConsulta: INSTANTE,
    });
    // actividad cubre la jornada completa (recorte 07:00–17:00)
    expect(resumen!.noProductivoTotal).toBe(36000);
    expect(resumen!.productivo).toBe(0);
  });

  it("productivo es 0 (no negativo) aunque se superpongan varios tramos", () => {
    const { resumen } = resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [actividad({ inicio: "2026-09-11T07:00:00.000Z", fin: "2026-09-11T12:00:00.000Z" })],
      paradas: [parada({ inicio: "2026-09-11T10:00:00.000Z", fin: "2026-09-11T17:00:00.000Z" })],
      instanteConsulta: INSTANTE,
    });
    // unión total 07:00–17:00 → productivo 0
    expect(resumen!.noProductivoTotal).toBe(36000);
    expect(resumen!.productivo).toBe(0);
    expect(resumen!.productivo).toBeGreaterThanOrEqual(0);
  });

  it("no muta los registros originales", () => {
    const actividadAbierta = actividad({ inicio: "2026-09-11T08:00:00.000Z", fin: null });
    const paradaAbierta = parada({ inicio: "2026-09-11T14:00:00.000Z", fin: null });
    const actividadesCopia = structuredClone([actividadAbierta]);
    const paradasCopia = structuredClone([paradaAbierta]);

    resumenTiempoTurno({
      jornada: JORNADA,
      actividades: [actividadAbierta],
      paradas: [paradaAbierta],
      instanteConsulta: "2026-09-11T15:00:00.000Z",
    });

    expect(actividadAbierta).toEqual(actividadesCopia[0]);
    expect(paradaAbierta).toEqual(paradasCopia[0]);
    expect(actividadAbierta.fin).toBeNull();
    expect(paradaAbierta.fin).toBeNull();
  });

  it("no muta los arrays de entrada", () => {
    const actividades = [actividad({})];
    const paradas = [parada({})];
    const actividadesLen = actividades.length;
    const paradasLen = paradas.length;

    resumenTiempoTurno({
      jornada: JORNADA,
      actividades,
      paradas,
      instanteConsulta: INSTANTE,
    });

    expect(actividades).toHaveLength(actividadesLen);
    expect(paradas).toHaveLength(paradasLen);
  });
});