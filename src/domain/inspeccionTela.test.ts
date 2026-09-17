/**
 * Pruebas de dominio — ticket 07 (inspección de tela / devolución / uso autorizado).
 * Funciones puras de inspeccionTela.ts. Ciclo 1 — dominio puro.
 *
 * Cubre las condiciones del ciclo:
 * - tipos y estados de inspección (catálogo de 5 ítems SIEMPRE explícitos)
 * - registro con orden obligatoria y múltiples inspecciones por orden
 * - derivación de conAnomalia
 * - devolución y autorización como resoluciones EXCLUSIVAS
 * - devolución únicamente con producción derivada === 0 (pre-impresión real)
 * - motivo obligatorio en devolución; autorizadoPor/fecha-hora en autorización
 * - estado de tela derivado por inspección (sin estado global de orden)
 * - sin creación/modificación de paradas, producción, lecturas, progreso,
 *   estado de orden ni resumen de tiempo
 * - no mutación de inspecciones ni de la orden
 */
import { describe, expect, it } from "vitest";
import {
  conAnomalia,
  estadoInspeccion,
  getItemChecklistPorId,
  getItemsChecklist,
  registrarAutorizacionGerencia,
  registrarDevolucion,
  registrarInspeccion,
  validarChecklist,
} from "./inspeccionTela";
import type {
  InspeccionTela,
  ItemChecklistEstado,
  ItemChecklistId,
  Orden,
} from "./types";
import type { RegistrarInspeccionInput } from "./inspeccionTela";

/** Verifica que ALGÚN mensaje de error contenga el fragmento buscado. */
function contiene(errores: string[], fragmento: string): boolean {
  return errores.some((e) => e.includes(fragmento));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHECKLIST_CONFORME: ItemChecklistEstado[] = [
  { id: "absorcion", estado: "conforme" },
  { id: "tundido", estado: "conforme" },
  { id: "manchas", estado: "conforme" },
  { id: "dimensiones", estado: "conforme" },
  { id: "estado_general", estado: "conforme" },
];

const CHECKLIST_CON_MANCHAS: ItemChecklistEstado[] = CHECKLIST_CONFORME.map(
  (item) => (item.id === "manchas" ? { ...item, estado: "anomalia" as const } : item),
);

/** Orden en producción con SOLO lectura base (producción derivada = 0). */
function ordenSinProduccion(overrides: Partial<Orden> = {}): Orden {
  return {
    id: "ord-07",
    numeroOrden: "OP-07",
    diseno: "Jessie",
    telaReferencia: "TOALLA-30x30",
    unidadesSolicitadas: 1500,
    aplicaSegunda: true,
    porcentaje2da: 0.05,
    tipoPintura: "reactiva",
    machineId: "M1",
    fechaOperativa: "2026-09-13",
    estado: "in_production",
    creadaExternamenteEn: "2026-09-12T18:00:00.000Z",
    contadorBase: 1000,
    lecturas: [{ valor: 1000, timestamp: "2026-09-13T07:10:00.000Z", deltaGolpes: 0 }],
    ...overrides,
  };
}

/** Orden con producción real (lectura posterior con deltas > 0). */
function ordenConProduccion(overrides: Partial<Orden> = {}): Orden {
  return ordenSinProduccion({
    lecturas: [
      { valor: 1000, timestamp: "2026-09-13T07:10:00.000Z", deltaGolpes: 0 },
      { valor: 1003, timestamp: "2026-09-13T07:45:00.000Z", deltaGolpes: 3 },
      { valor: 1012, timestamp: "2026-09-13T08:15:00.000Z", deltaGolpes: 9 },
    ],
    ...overrides,
  });
}

const inputInspeccionBase: RegistrarInspeccionInput = {
  operatorName: "Carlos Gómez",
  items: CHECKLIST_CONFORME,
  timestamp: "2026-09-13T07:30:00.000Z",
};

function inspeccionConManchas(overrides: Partial<InspeccionTela> = {}): InspeccionTela {
  return {
    id: "ins-1",
    ordenId: "ord-07",
    operatorName: "Carlos Gómez",
    items: CHECKLIST_CON_MANCHAS,
    timestamp: "2026-09-13T07:30:00.000Z",
    resolucion: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Catálogo del checklist
// ---------------------------------------------------------------------------

describe("getItemsChecklist / getItemChecklistPorId", () => {
  it("expone los 5 ítems fijos del checklist en orden canónico", () => {
    const items = getItemsChecklist();
    expect(items.map((i) => i.id)).toEqual([
      "absorcion",
      "tundido",
      "manchas",
      "dimensiones",
      "estado_general",
    ]);
    expect(items.every((i) => i.nombre.length > 0)).toBe(true);
  });

  it("encuentra un ítem por id y devuelve undefined para uno desconocido", () => {
    expect(getItemChecklistPorId("absorcion")?.nombre).toBe("Absorción");
    expect(getItemChecklistPorId("otro_campo" as ItemChecklistId)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validarChecklist
// ---------------------------------------------------------------------------

describe("validarChecklist", () => {
  it("acepta los 5 ítems con estado explícito", () => {
    expect(validarChecklist(CHECKLIST_CONFORME)).toEqual([]);
  });

  it("rechaza un checklist vacío o ausente", () => {
    expect(contiene(validarChecklist(undefined), "5 ítems")).toBe(true);
    expect(contiene(validarChecklist([]), "5 ítems")).toBe(true);
  });

  it("rechaza un checklist parcial (falta un ítem del catálogo)", () => {
    const parcial = CHECKLIST_CONFORME.slice(0, 4);
    expect(contiene(validarChecklist(parcial), "falta el ítem")).toBe(true);
  });

  it("rechaza ítems duplicados", () => {
    const duplicado = [...CHECKLIST_CONFORME, { id: "absorcion" as const, estado: "conforme" as const }];
    expect(contiene(validarChecklist(duplicado), "duplicado")).toBe(true);
  });

  it("rechaza un id de ítem desconocido", () => {
    const desconocido = [
      ...CHECKLIST_CONFORME,
      { id: "olor" as ItemChecklistId, estado: "conforme" as const },
    ];
    expect(contiene(validarChecklist(desconocido), "desconocido")).toBe(true);
  });

  it("rechaza un estado de ítem inválido", () => {
    const invalido = CHECKLIST_CONFORME.map((item, i) =>
      i === 0 ? { ...item, estado: "regular" as never } : item,
    );
    expect(contiene(validarChecklist(invalido), "estado inválido")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// conAnomalia (derivado, nunca editable)
// ---------------------------------------------------------------------------

describe("conAnomalia", () => {
  it("es false cuando los 5 ítems son conformes y no hay otraAnomalia", () => {
    expect(conAnomalia({ items: CHECKLIST_CONFORME, otraAnomalia: undefined })).toBe(false);
  });

  it("es true cuando un ítem está en anomalía", () => {
    expect(conAnomalia({ items: CHECKLIST_CON_MANCHAS, otraAnomalia: undefined })).toBe(true);
  });

  it("es true cuando otraAnomalia tiene texto aunque los 5 ítems sean conformes", () => {
    expect(
      conAnomalia({ items: CHECKLIST_CONFORME, otraAnomalia: "olor fuerte" }),
    ).toBe(true);
  });

  it("ignora otraAnomalia de solo espacios (se recorta)", () => {
    expect(
      conAnomalia({ items: CHECKLIST_CONFORME, otraAnomalia: "   " }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// registrarInspeccion — orden obligatoria, múltiples por orden
// ---------------------------------------------------------------------------

describe("registrarInspeccion", () => {
  it("registra una inspección válida asociada a la orden con resolución sin_resolucion", () => {
    const res = registrarInspeccion(ordenSinProduccion(), inputInspeccionBase);
    expect(res.errores).toEqual([]);
    expect(res.inspeccion).toBeDefined();
    expect(res.inspeccion!.ordenId).toBe("ord-07");
    expect(res.inspeccion!.operatorName).toBe("Carlos Gómez");
    expect(res.inspeccion!.resolucion).toBeNull();
    expect(res.inspeccion!.items).toHaveLength(5);
    expect(getItemChecklistPorId("manchas")).toBeDefined();
  });

  it("rechaza una inspección sin orden asociada", () => {
    const res = registrarInspeccion(
      undefined as unknown as Orden,
      inputInspeccionBase,
    );
    expect(contiene(res.errores, "asociada a una orden")).toBe(true);
    expect(res.inspeccion).toBeUndefined();
  });

  it("rechaza operatorName vacío", () => {
    const res = registrarInspeccion(ordenSinProduccion(), {
      ...inputInspeccionBase,
      operatorName: "   ",
    });
    expect(contiene(res.errores, "operatorName es obligatorio")).toBe(true);
  });

  it("rechaza checklist ausente, parcial o inválido", () => {
    const sinChecklist = registrarInspeccion(ordenSinProduccion(), {
      ...inputInspeccionBase,
      items: undefined as unknown as ItemChecklistEstado[],
    });
    expect(contiene(sinChecklist.errores, "5 ítems")).toBe(true);

    const parcial = registrarInspeccion(ordenSinProduccion(), {
      ...inputInspeccionBase,
      items: CHECKLIST_CONFORME.slice(0, 3),
    });
    expect(contiene(parcial.errores, "falta el ítem")).toBe(true);
  });

  it("rechaza timestamp ausente o inválido", () => {
    const sinTimestamp = registrarInspeccion(ordenSinProduccion(), {
      ...inputInspeccionBase,
      timestamp: "",
    });
    expect(contiene(sinTimestamp.errores, "timestamp")).toBe(true);

    const invalido = registrarInspeccion(ordenSinProduccion(), {
      ...inputInspeccionBase,
      timestamp: "ayer a la tarde",
    });
    expect(contiene(invalido.errores, "no es una fecha válida")).toBe(true);
  });

  it("recorta lote, otraAnomalia y observaciones a 'sin dato' cuando son vacíos", () => {
    const res = registrarInspeccion(ordenSinProduccion(), {
      ...inputInspeccionBase,
      lote: "  L-103  ",
      otraAnomalia: "   ",
      observaciones: " ",
    });
    expect(res.inspeccion!.lote).toBe("L-103");
    expect(res.inspeccion!.otraAnomalia).toBeUndefined();
    expect(res.inspeccion!.observaciones).toBeUndefined();
  });

  it("permite MÚLTIPLES inspecciones independientes para la misma orden", () => {
    const orden = ordenSinProduccion();
    const inspecciones: InspeccionTela[] = [];
    for (const lote of ["L-101", "L-102", undefined]) {
      const res = registrarInspeccion(orden, {
        ...inputInspeccionBase,
        lote,
        timestamp: `2026-09-13T0${inspecciones.length + 7}:00:00.000Z`,
      });
      expect(res.errores).toEqual([]);
      inspecciones.push(res.inspeccion!);
    }
    expect(inspecciones).toHaveLength(3);
    // Cada una es un evento independiente: ids distintos y sin estado global
    const ids = new Set(inspecciones.map((i) => i.id));
    expect(ids.size).toBe(3);
    expect(inspecciones.every((i) => i.ordenId === "ord-07")).toBe(true);
    expect(inspecciones.map((i) => i.lote)).toEqual(["L-101", "L-102", undefined]);
  });

  it("deriva conAnomalia en el registro pero la inspección no lo persiste como booleano", () => {
    const res = registrarInspeccion(ordenSinProduccion(), {
      ...inputInspeccionBase,
      items: CHECKLIST_CON_MANCHAS,
    });
    expect(res.errores).toEqual([]);
    // conAnomalia es función derivada; el objeto NO tiene campo booleano editable
    expect("conAnomalia" in res.inspeccion!).toBe(false);
    expect(conAnomalia(res.inspeccion!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// estadoInspeccion — estado de tela derivado POR inspección
// ---------------------------------------------------------------------------

describe("estadoInspeccion", () => {
  it("conforme: sin anomalía y sin resolución", () => {
    const res = registrarInspeccion(ordenSinProduccion(), inputInspeccionBase);
    expect(estadoInspeccion(res.inspeccion!)).toBe("conforme");
  });

  it("no_usable: con anomalía sin resolución", () => {
    expect(estadoInspeccion(inspeccionConManchas())).toBe("no_usable");
  });

  it("devuelta: con anomalía y devolución", () => {
    const res = registrarDevolucion(
      ordenSinProduccion(),
      inspeccionConManchas(),
      {
        motivo: "absorción insuficiente",
        registradaPor: "Carlos Gómez",
        timestamp: "2026-09-13T07:45:00.000Z",
      },
    );
    expect(estadoInspeccion(res.inspeccion!)).toBe("devuelta");
  });

  it("uso_autorizado: con anomalía y autorización de gerencia", () => {
    const res = registrarAutorizacionGerencia(inspeccionConManchas(), {
      autorizadoPor: "Gerencia",
      timestamp: "2026-09-13T07:50:00.000Z",
    });
    expect(estadoInspeccion(res.inspeccion!)).toBe("uso_autorizado");
  });
});

// ---------------------------------------------------------------------------
// registrarDevolucion — solo pre-impresión, resoluciones exclusivas
// ---------------------------------------------------------------------------

describe("registrarDevolucion", () => {
  it("devuelve una inspección con anomalía en orden SIN producción (solo lectura base)", () => {
    // Ticket 01 permite lectura base con cero golpes: la devolución SÍ es válida
    const orden = ordenSinProduccion();
    const res = registrarDevolucion(orden, inspeccionConManchas(), {
      motivo: "tela con manchas de origen",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
    expect(res.errores).toEqual([]);
    expect(res.inspeccion!.resolucion).toEqual({
      tipo: "devolucion",
      motivo: "tela con manchas de origen",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
  });

  it("permite devolución en orden available sin lecturas (pre-impresión)", () => {
    const orden = ordenSinProduccion({ estado: "available" as const, lecturas: [] });
    const res = registrarDevolucion(orden, inspeccionConManchas(), {
      motivo: "tela rechazada en inspección",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
    expect(res.errores).toEqual([]);
  });

  it("rechaza devolución cuando la producción derivada es MAYOR a 0", () => {
    const res = registrarDevolucion(ordenConProduccion(), inspeccionConManchas(), {
      motivo: "tela con manchas",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T08:30:00.000Z",
    });
    expect(contiene(res.errores, "antes de imprimir (producción 0)")).toBe(true);
    expect(res.inspeccion).toBeUndefined();
  });

  it("rechaza devolución de inspección SIN anomalías", () => {
    const res = registrarDevolucion(ordenSinProduccion(), {
      ...inspeccionConManchas(),
      items: CHECKLIST_CONFORME,
    }, {
      motivo: "motivo",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
    expect(contiene(res.errores, "sin anomalías")).toBe(true);
  });

  it("rechaza devolución sobre inspección YA resuelta (sin segunda resolución)", () => {
    const primera = registrarDevolucion(ordenSinProduccion(), inspeccionConManchas(), {
      motivo: "primera devolución",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
    const segunda = registrarDevolucion(
      ordenSinProduccion(),
      primera.inspeccion!,
      {
        motivo: "segunda devolución",
        registradaPor: "Carlos Gómez",
        timestamp: "2026-09-13T07:50:00.000Z",
      },
    );
    expect(contiene(segunda.errores, "ya tiene una resolución")).toBe(true);
  });

  it("exige motivo obligatorio", () => {
    const res = registrarDevolucion(ordenSinProduccion(), inspeccionConManchas(), {
      motivo: "   ",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
    expect(contiene(res.errores, "motivo de la devolución es obligatorio")).toBe(true);
  });

  it("exige quién registra la devolución", () => {
    const res = registrarDevolucion(ordenSinProduccion(), inspeccionConManchas(), {
      motivo: "tela con manchas",
      registradaPor: "",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
    expect(contiene(res.errores, "quién registra la devolución")).toBe(true);
  });

  it("exige cuándo (timestamp válido)", () => {
    const res = registrarDevolucion(ordenSinProduccion(), inspeccionConManchas(), {
      motivo: "tela con manchas",
      registradaPor: "Carlos Gómez",
      timestamp: "mañana",
    });
    expect(contiene(res.errores, "no es una fecha válida")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registrarAutorizacionGerencia — registro documental, sin workflow
// ---------------------------------------------------------------------------

describe("registrarAutorizacionGerencia", () => {
  it("autoriza una inspección con anomalía exigiendo autorizadoPor y cuándo", () => {
    const res = registrarAutorizacionGerencia(inspeccionConManchas(), {
      autorizadoPor: "Gerencia turno mañana",
      timestamp: "2026-09-13T07:50:00.000Z",
    });
    expect(res.errores).toEqual([]);
    expect(res.inspeccion!.resolucion).toEqual({
      tipo: "autorizacion_gerencia",
      autorizadoPor: "Gerencia turno mañana",
      timestamp: "2026-09-13T07:50:00.000Z",
      observaciones: undefined,
    });
  });

  it("acepta observaciones OPCIONALES en la autorización", () => {
    const sinObs = registrarAutorizacionGerencia(inspeccionConManchas(), {
      autorizadoPor: "Gerencia",
      timestamp: "2026-09-13T07:50:00.000Z",
    });
    expect(sinObs.errores).toEqual([]);

    const conObs = registrarAutorizacionGerencia(inspeccionConManchas(), {
      autorizadoPor: "Gerencia",
      timestamp: "2026-09-13T07:50:00.000Z",
      observaciones: "se utiliza el lote completo con reproceso en Acabado",
    });
    expect(conObs.errores).toEqual([]);
    expect(conObs.inspeccion!.resolucion).toMatchObject({
      tipo: "autorizacion_gerencia",
      observaciones: "se utiliza el lote completo con reproceso en Acabado",
    });
  });

  it("no crea estados pendientes ni tareas: la resolución es un dato documental", () => {
    // El único efecto de autorizar es setear la resolución en la inspección devuelta
    const res = registrarAutorizacionGerencia(inspeccionConManchas(), {
      autorizadoPor: "Gerencia",
      timestamp: "2026-09-13T07:50:00.000Z",
    });
    expect(res.inspeccion!.resolucion!.tipo).toBe("autorizacion_gerencia");
    expect(res.inspeccion!.resolucion).not.toHaveProperty("pendiente");
    expect(res.inspeccion!.resolucion).not.toHaveProperty("notificacion");
  });

  it("rechaza autorización de inspección SIN anomalías", () => {
    const res = registrarAutorizacionGerencia({
      ...inspeccionConManchas(),
      items: CHECKLIST_CONFORME,
    }, {
      autorizadoPor: "Gerencia",
      timestamp: "2026-09-13T07:50:00.000Z",
    });
    expect(contiene(res.errores, "sin anomalías")).toBe(true);
  });

  it("rechaza autorización sobre inspección YA resuelta (devolución previa)", () => {
    const devuelta = registrarDevolucion(
      ordenSinProduccion(),
      inspeccionConManchas(),
      {
        motivo: "tela con manchas",
        registradaPor: "Carlos Gómez",
        timestamp: "2026-09-13T07:45:00.000Z",
      },
    );
    const res = registrarAutorizacionGerencia(devuelta.inspeccion!, {
      autorizadoPor: "Gerencia",
      timestamp: "2026-09-13T07:50:00.000Z",
    });
    expect(contiene(res.errores, "ya tiene una resolución")).toBe(true);
  });

  it("exige autorizadoPor obligatorio", () => {
    const res = registrarAutorizacionGerencia(inspeccionConManchas(), {
      autorizadoPor: "  ",
      timestamp: "2026-09-13T07:50:00.000Z",
    });
    expect(contiene(res.errores, "autorizadoPor es obligatorio")).toBe(true);
  });

  it("exige cuándo (timestamp válido) en la autorización", () => {
    const res = registrarAutorizacionGerencia(inspeccionConManchas(), {
      autorizadoPor: "Gerencia",
      timestamp: "",
    });
    expect(contiene(res.errores, "timestamp")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Exclusividad de resoluciones y no mutación
// ---------------------------------------------------------------------------

describe("resoluciones exclusivas y no mutación", () => {
  it("una inspección devuelta NO acepta autorización posterior", () => {
    const devuelta = registrarDevolucion(
      ordenSinProduccion(),
      inspeccionConManchas(),
      {
        motivo: "tela con manchas",
        registradaPor: "Carlos Gómez",
        timestamp: "2026-09-13T07:45:00.000Z",
      },
    ).inspeccion!;
    const res = registrarAutorizacionGerencia(devuelta, {
      autorizadoPor: "Gerencia",
      timestamp: "2026-09-13T07:50:00.000Z",
    });
    expect(contiene(res.errores, "ya tiene una resolución")).toBe(true);
  });

  it("una inspección autorizada NO acepta devolución posterior", () => {
    const autorizada = registrarAutorizacionGerencia(inspeccionConManchas(), {
      autorizadoPor: "Gerencia",
      timestamp: "2026-09-13T07:50:00.000Z",
    }).inspeccion!;
    const res = registrarDevolucion(ordenSinProduccion(), autorizada, {
      motivo: "tela con manchas",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T08:00:00.000Z",
    });
    expect(contiene(res.errores, "ya tiene una resolución")).toBe(true);
  });

  it("devolver NO muta la inspección original (inmutabilidad)", () => {
    const original = inspeccionConManchas();
    registrarDevolucion(ordenSinProduccion(), original, {
      motivo: "tela con manchas",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
    expect(original.resolucion).toBeNull();
    expect(original.items[2].estado).toBe("anomalia");
  });

  it("autorizar NO muta la inspección original (inmutabilidad)", () => {
    const original = inspeccionConManchas();
    registrarAutorizacionGerencia(original, {
      autorizadoPor: "Gerencia",
      timestamp: "2026-09-13T07:50:00.000Z",
    });
    expect(original.resolucion).toBeNull();
  });

  it("devolver NO crea ni modifica estado de la orden", () => {
    const orden = ordenSinProduccion();
    const lecturasAntes = JSON.stringify(orden.lecturas);
    const estadoAntes = orden.estado;
    registrarDevolucion(orden, inspeccionConManchas(), {
      motivo: "tela con manchas",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
    expect(JSON.stringify(orden.lecturas)).toBe(lecturasAntes);
    expect(orden.estado).toBe(estadoAntes);
  });

  it("NO crea paradas: la devolución no toca paradas, lecturas, progreso ni tiempo", () => {
    const orden = ordenSinProduccion();
    const res = registrarDevolucion(orden, inspeccionConManchas(), {
      motivo: "tela con manchas",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
    expect(res.errores).toEqual([]);
    // El dominio no expone ninguna API de paradas ni de tiempo: el único
    // resultado es la inspección devuelta con su resolución.
    expect(Object.keys(res)).toEqual(["inspeccion", "errores"]);
  });
});

// ---------------------------------------------------------------------------
// Límites
// ---------------------------------------------------------------------------

describe("límites del dominio", () => {
  it("recorta espacios en motivo, registradaPor y autorizadoPor", () => {
    const devolucion = registrarDevolucion(
      ordenSinProduccion(),
      inspeccionConManchas(),
      {
        motivo: "  tela con manchas  ",
        registradaPor: "  Carlos Gómez  ",
        timestamp: "2026-09-13T07:45:00.000Z",
      },
    ).inspeccion!.resolucion!;
    expect(devolucion).toMatchObject({
      tipo: "devolucion",
      motivo: "tela con manchas",
      registradaPor: "Carlos Gómez",
    });

    const autorizacion = registrarAutorizacionGerencia(inspeccionConManchas(), {
      autorizadoPor: "  Gerencia  ",
      timestamp: "2026-09-13T07:50:00.000Z",
      observaciones: "  uso con reproceso  ",
    }).inspeccion!.resolucion!;
    expect(autorizacion).toMatchObject({
      tipo: "autorizacion_gerencia",
      autorizadoPor: "Gerencia",
      observaciones: "uso con reproceso",
    });
  });

  it("registrarDevolucion no acepta producción derivada negativa por lecturas corruptas", () => {
    // Deltas negativos => golpesProducidos !== 0 => se rechaza la devolución
    const ordenCorrupta = ordenSinProduccion({
      lecturas: [
        { valor: 1000, timestamp: "2026-09-13T07:10:00.000Z", deltaGolpes: 0 },
        { valor: 990, timestamp: "2026-09-13T07:45:00.000Z", deltaGolpes: -10 },
      ],
    });
    const res = registrarDevolucion(ordenCorrupta, inspeccionConManchas(), {
      motivo: "tela con manchas",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
    expect(contiene(res.errores, "antes de imprimir (producción 0)")).toBe(true);
  });
});