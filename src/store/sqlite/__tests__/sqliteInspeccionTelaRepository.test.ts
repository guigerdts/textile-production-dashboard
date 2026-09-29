/**
 * Ticket 10 (Phase 2) — Unit E2 — `sqliteInspeccionTelaRepository` suite
 *
 * WHAT THIS SUITE IS: the contract test of the `inspección de tela` SQLite
 * adapter, over the shared D2b double from Unit S
 * (`src/store/sqlite/__tests__/fakeSqliteStore.ts`). It pins the same things the
 * D2 suite pins — the mapper round trip with no `Database` in scope, insert-then-
 * read, the duplicate rejection leaving the stored record UNCHANGED, the
 * unknown-id rejection creating NOTHING, chronological ordering owned by the
 * adapter, descriptive error propagation with `cause`, and the update-in-place
 * case adding no second row — plus the six things that are E2's own: the flat
 * five-column checklist rebuilt from a LITERAL tuple, that tuple pinned to the
 * domain catalogue, the whole `ResolucionInspeccion` union written branch-
 * exclusively and rebuilt from its own columns, the corrupt-row mapping errors
 * that carry a `cause`, the recomputation of `conAnomalia` / `estadoInspeccion`
 * instead of a column read, and the absence of `lote` / `otra_anomalia` /
 * `observaciones` being invented as `""`.
 *
 * WHAT THIS SUITE IS NOT: a re-test of the double (that is
 * `fakeSqliteStore.test.ts`, once, for all five suites) and not a domain test.
 * The domain rules this port deliberately does NOT enforce — checklist complete,
 * `devolución` pre-impresión, `motivo` required, mutually exclusive resolutions,
 * an inspection without anomaly having no resolution, multiple inspections per
 * order — live in `src/domain/inspeccionTela.ts`, are unchanged, and are out of
 * scope here. Where a test builds a record BY HAND instead of through the domain,
 * that is deliberate: the port is a storage boundary and the white-box cases need
 * inputs the domain would refuse to produce.
 *
 * HONESTY NOTE (D2d): this suite does **not** execute the real Rust migration.
 * The double MODELS SQLite — it applies no DDL, opens no connection and simulates
 * no `PRAGMA foreign_keys`. Everything asserted below is a fact about the exact
 * SQL the adapter emits and about the double's modelling of it, never about a
 * real sqlite engine — a fact that still needs `getForeignKeys()` on the real
 * Tauri binary (R5). The adapter writes the columns 004 declares; whether the
 * real Tauri connection enforces FK semantics stays unverified (R5/R6), and
 * `src/store/sqlite/database.ts` is untouched.
 *
 * The FK tests below (A1/A1b) are the honest version of that note: they prove
 * the adapter **lets an unresolvable link fail loudly instead of swallowing it**,
 * which is a claim about this adapter, not about the real engine.
 *
 * Anti-vacuity note: the double THROWS on any statement outside the vocabulary
 * of design.md §Statement shapes, so an adapter that drifts from its declared
 * SQL fails loudly here instead of silently no-op'ing.
 */

import { describe, expect, it } from "vitest";
import type Database from "@tauri-apps/plugin-sql";
import {
  conAnomalia,
  estadoInspeccion,
  getItemsChecklist,
  registrarAutorizacionGerencia,
  registrarDevolucion,
  registrarInspeccion,
} from "../../../domain/inspeccionTela";
import type {
  InspeccionTela,
  ItemChecklistEstado,
  ItemChecklistId,
  Orden,
} from "../../../domain/types";
import {
  COLUMNAS_ITEMS_CHECKLIST,
  mapInspeccionRow,
  mapInspeccionToSql,
  SqliteInspeccionTelaRepository,
  type InspeccionTelaRow,
} from "../sqliteInspeccionTelaRepository";
import {
  createFakeSqliteStore,
  type FakeSqliteRow,
  type FakeSqliteStore,
} from "./fakeSqliteStore";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Los 5 ítems del catálogo, todos conformes: el caso SIN anomalía. */
const ITEMS_CONFORME: ItemChecklistEstado[] = [
  { id: "absorcion", estado: "conforme" },
  { id: "tundido", estado: "conforme" },
  { id: "manchas", estado: "conforme" },
  { id: "dimensiones", estado: "conforme" },
  { id: "estado_general", estado: "conforme" },
];

/** El mismo checklist con `id` en anomalía — el resto intacto y explícito. */
function itemsConAnomalia(anomalia: ItemChecklistEstado["id"]): ItemChecklistEstado[] {
  return ITEMS_CONFORME.map((item) =>
    item.id === anomalia ? { ...item, estado: "anomalia" as const } : item
  );
}

/**
 * Orden de producción completa y explícita; nada se hereda de otra fixture. La
 * lectura base tiene `deltaGolpes: 0`, así que la producción derivada es 0 y una
 * `devolución` es legal (pre-impresión).
 */
function orden(id = "orden-1"): Orden {
  return {
    id,
    numeroOrden: "OP-77",
    diseno: "Jessie",
    telaReferencia: "TOALLA-30x30",
    unidadesSolicitadas: 1500,
    aplicaSegunda: true,
    porcentaje2da: 0.05,
    tipoPintura: "reactiva",
    machineId: "M1",
    fechaOperativa: "2026-09-14",
    estado: "in_production",
    creadaExternamenteEn: "2026-09-13T18:00:00.000Z",
    contadorBase: 1000,
    lecturas: [{ valor: 1000, timestamp: "2026-09-14T07:10:00.000Z", deltaGolpes: 0 }],
  };
}

/**
 * Una inspección construida A MANO, sin pasar por el dominio: el puerto es una
 * frontera de almacenamiento puro y los casos de caja blanca (filas corruptas,
 * rama con columna NULL) necesitan entradas que `registrarInspeccion` no
 * produciría. Por defecto: checklist completamente conforme y SIN resolución.
 */
function inspeccion(overrides: Partial<InspeccionTela> = {}): InspeccionTela {
  return {
    id: "insp-1",
    ordenId: "orden-1",
    operatorName: "Laura",
    items: ITEMS_CONFORME.map((item) => ({ ...item })),
    timestamp: "2026-09-14T07:20:00.000Z",
    resolucion: null,
    ...overrides,
  };
}

/** Una inspección SÍ válida según el dominio, con `tundido` en anomalía. */
function inspeccionDelDominio(overrides: Partial<InspeccionTela> = {}): InspeccionTela {
  const resultado = registrarInspeccion(orden(overrides.ordenId ?? "orden-1"), {
    operatorName: "Laura",
    lote: "L-77",
    items: itemsConAnomalia("tundido"),
    otraAnomalia: "tundido disparejo",
    timestamp: "2026-09-14T07:20:00.000Z",
    observaciones: "control de humedad bajo",
  });
  if (resultado.errores.length > 0 || !resultado.inspeccion) {
    throw new Error(`fixture inválido: ${resultado.errores.join(", ")}`);
  }
  return { ...resultado.inspeccion, ...overrides };
}

function repoSobre(store: FakeSqliteStore): SqliteInspeccionTelaRepository {
  return new SqliteInspeccionTelaRepository(store);
}

/**
 * Siembra la fila destino de la FK `inspeccion_tela.orden_id → orden(id)`, para
 * que el enlace sea resoluble. El doble sólo exige que exista una fila con ese
 * `id`; no aplica el DDL de `orden`.
 */
function sembrarOrden(store: FakeSqliteStore, ...ids: string[]): void {
  for (const id of ids) store.orden.push({ id });
}

/**
 * Envuelve el doble para que `execute` SIEMPRE rechace, mientras `select` sigue
 * respondiendo desde el mismo store. Permite ejercitar la envoltura de error sin
 * tocar el doble compartido (que no modela fallos de I/O).
 */
function dbQueFallaAlEscribir(store: FakeSqliteStore, causa: Error): Database {
  return {
    path: store.path,
    select: (query: string, binds?: unknown[]) => store.select(query, binds),
    execute: async () => {
      throw causa;
    },
    close: async () => true,
  } as unknown as Database;
}

/** Igual, pero además registra cada sentencia y sus binds, para fijarlos por texto. */
function repoQueRegistra(store: FakeSqliteStore): {
  repo: SqliteInspeccionTelaRepository;
  consultas: string[];
  enlaces: Array<{ query: string; binds: unknown[] }>;
} {
  const consultas: string[] = [];
  const enlaces: Array<{ query: string; binds: unknown[] }> = [];
  const db = {
    path: store.path,
    select: async (query: string, binds?: unknown[]) => {
      consultas.push(query);
      enlaces.push({ query, binds: binds ?? [] });
      return store.select(query, binds);
    },
    execute: async (query: string, binds?: unknown[]) => {
      consultas.push(query);
      enlaces.push({ query, binds: binds ?? [] });
      return store.execute(query, binds);
    },
    close: async () => true,
  } as unknown as Database;
  return { repo: new SqliteInspeccionTelaRepository(db), consultas, enlaces };
}

/**
 * El valor ligado a `columna` en un INSERT, deducido del propio texto emitido:
 * se localiza la columna en la lista, se toma su placeholder y se lee el bind.
 * Así la aserción no depende de conocer el orden de memoria.
 */
function valorLigado(
  enlace: { query: string; binds: unknown[] },
  columna: string
): unknown {
  const columnas = enlace.query
    .slice(enlace.query.indexOf("(") + 1, enlace.query.indexOf(") VALUES"))
    .split(",")
    .map((c) => c.trim());
  const placeholders = enlace.query
    .slice(enlace.query.indexOf("VALUES (") + "VALUES (".length, enlace.query.lastIndexOf(")"))
    .split(",")
    .map((p) => p.trim());
  const indice = columnas.indexOf(columna);
  if (indice < 0) throw new Error(`el INSERT no declara la columna ${columna}`);
  const placeholder = /^\$(\d+)$/.exec(placeholders[indice]);
  if (!placeholder) throw new Error(`la columna ${columna} no tiene placeholder`);
  return enlace.binds[Number(placeholder[1]) - 1];
}

/** Lo mismo para el `SET` de un UPDATE, deducido también del texto emitido. */
function valorAsignado(
  enlace: { query: string; binds: unknown[] },
  columna: string
): unknown {
  const set = enlace.query.slice(
    enlace.query.indexOf("SET ") + 4,
    enlace.query.indexOf(" WHERE ")
  );
  const asignacion = set
    .split(",")
    .map((a) => a.trim())
    .find((a) => a.startsWith(`${columna} = `));
  if (!asignacion) throw new Error(`el UPDATE no asigna la columna ${columna}`);
  const placeholder = /= \$(\d+)$/.exec(asignacion);
  if (!placeholder) throw new Error(`la asignación de ${columna} no tiene placeholder`);
  return enlace.binds[Number(placeholder[1]) - 1];
}

/** Una fila 004 CRUDA en la tabla del doble, para simular una fila dañada. */
function filaDe(inspeccion: InspeccionTela, sobrescrituras: Record<string, unknown>) {
  return {
    ...(mapInspeccionToSql(inspeccion) as unknown as FakeSqliteRow),
    ...sobrescrituras,
  };
}

const DEVUELTA: InspeccionTela["resolucion"] = {
  tipo: "devolucion",
  motivo: "tundido disparejo, no apto para estampado",
  registradaPor: "Laura",
  timestamp: "2026-09-14T08:00:00.000Z",
};

const AUTORIZADA: InspeccionTela["resolucion"] = {
  tipo: "autorizacion_gerencia",
  autorizadoPor: "Marta (gerencia)",
  timestamp: "2026-09-14T09:00:00.000Z",
  observaciones: "autorizado para el turno de tarde",
};

// ── 1. Los mappers son puros: ida y vuelta sin conexión ──────────────────────

describe("sqliteInspeccionTelaRepository — mappers puros", () => {
  it("la ida y vuelta del mapper no necesita ninguna Database en scope", () => {
    // Sin `createFakeSqliteStore()` en este test: los mappers son funciones
    // puras y el round trip se demuestra sin conexión alguna.
    const original = inspeccionDelDominio({ id: "insp-pura" });

    const fila = mapInspeccionToSql(original) as unknown as InspeccionTelaRow;
    const recuperada = mapInspeccionRow(fila);

    expect(recuperada).toEqual(original);
    // D1, en los dos sentidos: el vocabulario cambia en el mapper y sólo ahí.
    expect(fila.operario).toBe("Laura");
    expect(fila.orden_id).toBe("orden-1");
    expect(recuperada.operatorName).toBe("Laura");
    expect(recuperada.ordenId).toBe("orden-1");
    // Una fila nueva y un array de ítems nuevo, no referencias compartidas.
    expect(recuperada).not.toBe(original);
    expect(recuperada.items).not.toBe(original.items);
  });

  it("traduce exactamente las 18 columnas que 004 declara, ni una más ni una menos", () => {
    const fila = mapInspeccionToSql(inspeccion());

    expect(Object.keys(fila).sort()).toEqual([
      "absorcion",
      "autorizacion_observaciones",
      "autorizado_por",
      "dimensiones",
      "estado_general",
      "id",
      "lote",
      "manchas",
      "motivo_devolucion",
      "observaciones",
      "operario",
      "orden_id",
      "otra_anomalia",
      "registrada_por",
      "resolucion",
      "resolucion_timestamp",
      "timestamp",
      "tundido",
    ]);

    // La lectura produce SIEMPRE los 9 campos del dominio, con forma estable: los
    // tres opcionales aparecen con valor `undefined` en vez de omitirse. `toEqual`
    // los trataría como ausentes, así que se comparan las claves.
    const leido = mapInspeccionRow(fila as unknown as InspeccionTelaRow);
    expect(Object.keys(leido).sort()).toEqual([
      "id",
      "items",
      "lote",
      "observaciones",
      "operatorName",
      "ordenId",
      "otraAnomalia",
      "resolucion",
      "timestamp",
    ]);
    expect(leido).toHaveProperty("lote", undefined);
    expect(leido).toHaveProperty("otraAnomalia", undefined);
    expect(leido).toHaveProperty("observaciones", undefined);
  });

  it("escribe los opcionales ausentes como null y los lee como undefined", () => {
    const fila = mapInspeccionToSql(inspeccion({ lote: undefined }));

    // NUNCA `""` ni `undefined`: la columna es NULL y punto.
    expect(fila.lote).toBeNull();
    expect(fila.otra_anomalia).toBeNull();
    expect(fila.observaciones).toBeNull();

    const recuperada = mapInspeccionRow(fila as unknown as InspeccionTelaRow);
    expect(recuperada.lote).toBeUndefined();
    expect(recuperada.otraAnomalia).toBeUndefined();
    expect(recuperada.observaciones).toBeUndefined();
    // Un texto vacío NUNCA se convierte en ausencia: "" es un texto presente.
    const conTextoVacio = mapInspeccionToSql(
      inspeccion({ lote: "", otraAnomalia: "", observaciones: "" })
    );
    expect(conTextoVacio.lote).toBe("");
    expect(mapInspeccionRow(conTextoVacio as unknown as InspeccionTelaRow).lote).toBe("");
  });

  it("`orden_id` y `operario` son NOT NULL: copia directa, nunca `?? \"\"`", () => {
    const fila = mapInspeccionToSql(inspeccion());

    // La columna no puede contener NULL: un `?? null` o un `?? ""` aquí
    // fabricaría un valor que el DDL prohíbe.
    expect(fila.orden_id).toBe("orden-1");
    expect(fila.operario).toBe("Laura");
    expect(typeof fila.orden_id).toBe("string");
    expect(typeof fila.operario).toBe("string");

    // Y al leer tampoco hay conversión: no existe `ordenId: string | null` en este
    // dominio porque `registrarInspeccion` exige orden.
    const recuperada = mapInspeccionRow(fila as unknown as InspeccionTelaRow);
    expect(recuperada.ordenId).toBe("orden-1");
    expect(recuperada.ordenId).not.toBeNull();
    expect(recuperada.operatorName).toBe("Laura");
  });
});

// ── 2. La tupla literal y la reconstrucción de los 5 ítems ───────────────────

describe("sqliteInspeccionTelaRepository — checklist rebuilt desde la tupla literal", () => {
  it("la tupla de columnas está FIJADA contra el catálogo del dominio", () => {
    // Ésta es la aserción que convierte "deriva de un hecho de almacenamiento"
    // en algo que falla si el catálogo del dominio se reordena o crece: el
    // mapper NO puede cambiar para seguirle el paso (eso lo haría silencioso),
    // así que es el catálogo el que debe coincidir con la tabla ya escrita.
    expect([...COLUMNAS_ITEMS_CHECKLIST]).toEqual(getItemsChecklist().map((i) => i.id));
    expect(COLUMNAS_ITEMS_CHECKLIST).toHaveLength(5);
  });

  it("reconstruye exactamente 5 ítems, uno por id del catálogo, en orden de catálogo", () => {
    const original = inspeccionDelDominio({ id: "insp-checklist" });

    const leido = mapInspeccionRow(mapInspeccionToSql(original) as unknown as InspeccionTelaRow);

    expect(leido.items).toHaveLength(5);
    expect(leido.items.map((i) => i.id)).toEqual(getItemsChecklist().map((i) => i.id));
    // `tundido` venía en `anomalia` y sale en `anomalia`; el resto, `conforme`.
    expect(leido.items.map((i) => i.estado)).toEqual([
      "conforme",
      "anomalia",
      "conforme",
      "conforme",
      "conforme",
    ]);
    expect(leido.items.find((i) => i.id === "tundido")?.estado).toBe("anomalia");
  });

  it("busca cada estado POR ID, nunca por posición: un checklist desordenado se mapea igual", () => {
    // `validarChecklist` valida con un conjunto, así que el dominio acepta los 5
    // ítems en CUALQUIER orden. Un zip posicional (el `--items[0]`--`--items[4]--`)
    // escribiría el estado de `absorcion` en la columna `tundido`.
    const desordenado = inspeccion({
      id: "insp-desorden",
      items: [
        { id: "estado_general", estado: "conforme" },
        { id: "tundido", estado: "anomalia" },
        { id: "manchas", estado: "anomalia" },
        { id: "absorcion", estado: "conforme" },
        { id: "dimensiones", estado: "conforme" },
      ],
    });

    const fila = mapInspeccionToSql(desordenado);
    // Cada columna lleva el estado de SU ítem, no el del índice equivalente.
    expect(fila.absorcion).toBe("conforme");
    expect(fila.tundido).toBe("anomalia");
    expect(fila.manchas).toBe("anomalia");
    expect(fila.dimensiones).toBe("conforme");
    expect(fila.estado_general).toBe("conforme");

    // Y la lectura reconstruye el catálogo, no el orden de entrada.
    const leido = mapInspeccionRow(fila as unknown as InspeccionTelaRow);
    expect(leido.items.map((i) => i.id)).toEqual(getItemsChecklist().map((i) => i.id));
    expect(leido.items.map((i) => i.estado)).toEqual([
      "conforme",
      "anomalia",
      "anomalia",
      "conforme",
      "conforme",
    ]);
  });

  it("las cinco combinaciones de un solo ítem en anomalía sobreviven al round trip", () => {
    for (const anomalia of COLUMNAS_ITEMS_CHECKLIST) {
      const original = inspeccion({ items: itemsConAnomalia(anomalia) });
      const leido = mapInspeccionRow(mapInspeccionToSql(original) as unknown as InspeccionTelaRow);
      expect(leido.items.map((i) => i.estado)).toEqual(
        getItemsChecklist().map((i) => (i.id === anomalia ? "anomalia" : "conforme"))
      );
    }
  });

  it("no deriva `otra_anomalia` del checklist ni al revés", () => {
    // Ítem en anomalía SIN texto libre: se persiste tal cual, no se inventa ni se
    // borra la `otraAnomalia`.
    const soloItem = inspeccion({ items: itemsConAnomalia("manchas"), otraAnomalia: undefined });
    expect(mapInspeccionToSql(soloItem).otra_anomalia).toBeNull();

    // Texto libre SIN ítem en anomalía: también se persiste tal cual. Que el
    // dominio llame a esto una anomalía es su regla, no la del almacenamiento.
    const soloTexto = inspeccion({
      items: ITEMS_CONFORME.map((i) => ({ ...i })),
      otraAnomalia: "olor raro",
    });
    const fila = mapInspeccionToSql(soloTexto);
    expect(fila.otra_anomalia).toBe("olor raro");
    expect(fila.absorcion).toBe("conforme");
    expect(mapInspeccionRow(fila as unknown as InspeccionTelaRow).otraAnomalia).toBe("olor raro");
  });
});

// ── 3. El estado derivado se RECALCULA, no se lee ────────────────────────────

describe("sqliteInspeccionTelaRepository — estado derivado, sin columna", () => {
  it("no existe columna ni lectura para `conAnomalia` o `estadoInspeccion`", () => {
    const fila = mapInspeccionToSql(inspeccionDelDominio());

    // Ni en la fila que se escribe...
    expect(Object.keys(fila)).not.toContain("con_anomalia");
    expect(Object.keys(fila)).not.toContain("estado_inspeccion");
    // ...ni en lo que se devuelve: el adaptador no los calcula ni los cachea.
    const leido = mapInspeccionRow(fila as unknown as InspeccionTelaRow);
    expect(leido).not.toHaveProperty("conAnomalia");
    expect(leido).not.toHaveProperty("estadoInspeccion");

    // Y el SQL emitido no los menciona: no hay lectura de un valor derivado.
    const consulta = "SELECT * FROM inspeccion_tela WHERE id = $1";
    expect(consulta).not.toMatch(/con_anomalia|estado_inspeccion/i);
  });

  it("una inspección con anomalía y sin resolución deriva `no_usable` tras leer", () => {
    const original = inspeccionDelDominio({ id: "insp-no-usable" });
    expect(original.resolucion).toBeNull();

    const leido = mapInspeccionRow(mapInspeccionToSql(original) as unknown as InspeccionTelaRow);

    // `conAnomalia` es `true` como resultado DERIVADO del registro reconstruido.
    expect(conAnomalia(leido)).toBe(true);
    expect(estadoInspeccion(leido)).toBe("no_usable");
  });

  it("una inspección enteramente conforme deriva `conforme` tras leer", () => {
    const original = inspeccion({ id: "insp-conforme", otraAnomalia: undefined });
    // Sin anomalía y sin `otra_anomalia`: el único camino a `conforme`.
    expect(conAnomalia(original)).toBe(false);

    const leido = mapInspeccionRow(mapInspeccionToSql(original) as unknown as InspeccionTelaRow);

    expect(conAnomalia(leido)).toBe(false);
    expect(estadoInspeccion(leido)).toBe("conforme");
    // Y con `otra_anomalia` presente el estado cambia SÓLO por el derivado: el
    // adaptador no guarda ningún sello del veredicto.
    const conTexto = mapInspeccionRow(
      mapInspeccionToSql(inspeccion({ id: "insp-conforme-2", otraAnomalia: "olor raro" })) as unknown as InspeccionTelaRow
    );
    expect(estadoInspeccion(conTexto)).toBe("no_usable");
  });

  it("cambiar el checklist de la fila cambia el estado derivado sin tocar el SQL", () => {
    // La misma fila, un estado distinto: si el adaptador cacheara el veredicto,
    // el estado derivado no podría seguir a los datos.
    const fila = mapInspeccionToSql(inspeccion()) as unknown as InspeccionTelaRow;
    expect(estadoInspeccion(mapInspeccionRow(fila))).toBe("conforme");

    fila.tundido = "anomalia";
    expect(estadoInspeccion(mapInspeccionRow(fila))).toBe("no_usable");

    // Misma fila, otra resolución: el veredicto derivado sigue a los DATOS leídos.
    // La anomalía se mantiene porque el dominio ordena primero por `conAnomalia`:
    // una fila sin anomalía es `conforme` aunque traiga resolución.
    fila.resolucion = "devolucion";
    fila.motivo_devolucion = "tela mojada";
    fila.registrada_por = "Laura";
    fila.resolucion_timestamp = "2026-09-14T08:00:00.000Z";
    expect(estadoInspeccion(mapInspeccionRow(fila))).toBe("devuelta");

    // Y la otra rama del mismo discriminador, sin tocar una sola columna del SQL.
    fila.resolucion = "autorizacion_gerencia";
    fila.motivo_devolucion = null;
    fila.autorizado_por = "Marta (gerencia)";
    fila.registrada_por = null;
    expect(estadoInspeccion(mapInspeccionRow(fila))).toBe("uso_autorizado");
  });
});

// ── 4. La escritura de la resolución es EXCLUSIVA por rama ───────────────────

describe("sqliteInspeccionTelaRepository — escritura de la resolución", () => {
  it("`resolucion: null` deja las seis columnas de resolución en NULL", () => {
    const fila = mapInspeccionToSql(inspeccionDelDominio());

    expect(fila.resolucion).toBeNull();
    expect(fila.motivo_devolucion).toBeNull();
    expect(fila.autorizado_por).toBeNull();
    expect(fila.registrada_por).toBeNull();
    expect(fila.resolucion_timestamp).toBeNull();
    expect(fila.autorizacion_observaciones).toBeNull();

    // Ninguna se reconstruye como `""`: la ausencia es NULL, punto.
    for (const columna of [
      "motivo_devolucion",
      "autorizado_por",
      "registrada_por",
      "resolucion_timestamp",
      "autorizacion_observaciones",
    ] as const) {
      expect(fila[columna]).not.toBe("");
    }
  });

  it("`devolucion` escribe SUS columnas y nulls las de gerencia", () => {
    const fila = mapInspeccionToSql(
      inspeccionDelDominio({ id: "insp-devuelta", resolucion: DEVUELTA })
    );

    expect(fila.resolucion).toBe("devolucion");
    expect(fila.motivo_devolucion).toBe("tundido disparejo, no apto para estampado");
    expect(fila.registrada_por).toBe("Laura");
    expect(fila.resolucion_timestamp).toBe("2026-09-14T08:00:00.000Z");
    // La rama INACTIVA, explícitamente a NULL, no "sin tocar" ni "".
    expect(fila.autorizado_por).toBeNull();
    expect(fila.autorizacion_observaciones).toBeNull();

    // Y el round trip devuelve la rama íntegra: nada presente se pierde.
    const leido = mapInspeccionRow(fila as unknown as InspeccionTelaRow);
    expect(leido.resolucion).toEqual(DEVUELTA);
    expect(estadoInspeccion(leido)).toBe("devuelta");
  });

  it("`autorizacion_gerencia` escribe SUS columnas y nulls las de devolución", () => {
    const fila = mapInspeccionToSql(
      inspeccionDelDominio({ id: "insp-autorizada", resolucion: AUTORIZADA })
    );

    expect(fila.resolucion).toBe("autorizacion_gerencia");
    expect(fila.autorizado_por).toBe("Marta (gerencia)");
    expect(fila.resolucion_timestamp).toBe("2026-09-14T09:00:00.000Z");
    expect(fila.autorizacion_observaciones).toBe("autorizado para el turno de tarde");
    // Ídem: la rama inactiva, a NULL explícito.
    expect(fila.motivo_devolucion).toBeNull();
    expect(fila.registrada_por).toBeNull();

    const leido = mapInspeccionRow(fila as unknown as InspeccionTelaRow);
    expect(leido.resolucion).toEqual(AUTORIZADA);
    expect(estadoInspeccion(leido)).toBe("uso_autorizado");
  });

  it("una autorización SIN observaciones deja `autorizacion_observaciones` en NULL", () => {
    // El registro documental de gerencia es válido sin observaciones: esa
    // opcionalidad es del dominio y la columna tiene que poder reproducirla.
    const fila = mapInspeccionToSql(
      inspeccionDelDominio({
        id: "insp-autorizada-sin-notas",
        resolucion: {
          tipo: "autorizacion_gerencia",
          autorizadoPor: "Marta (gerencia)",
          timestamp: "2026-09-14T09:00:00.000Z",
        },
      })
    );
    expect(fila.autorizacion_observaciones).toBeNull();

    const leido = mapInspeccionRow(fila as unknown as InspeccionTelaRow);
    expect(leido.resolucion).toHaveProperty("observaciones", undefined);
    expect(estadoInspeccion(leido)).toBe("uso_autorizado");
  });

  it("no guarda la resolución como un blob serializado", () => {
    const fila = mapInspeccionToSql(
      inspeccionDelDominio({ resolucion: DEVUELTA })
    );

    // El discriminador es el `tipo` plano y los datos viajan en SUS columnas: ni
    // un JSON, ni una concatenación, ni una columna que Guarde todo junto.
    expect(typeof fila.resolucion).toBe("string");
    expect(fila.resolucion).not.toMatch(/[{[]/);
    expect(typeof fila.motivo_devolucion).toBe("string");
    expect(typeof fila.registrada_por).toBe("string");
    expect(typeof fila.resolucion_timestamp).toBe("string");
  });

  it("ninguna columna de la rama contraria se escribe, por texto emitido", () => {
    // Caja blanca: los binds se deducen del SQL emitido, no de memoria.
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const { repo, enlaces } = repoQueRegistra(store);

    return repo
      .insertInspeccion(inspeccionDelDominio({ id: "insp-w1", resolucion: DEVUELTA }))
      .then(() => repo.updateInspeccion(inspeccionDelDominio({ id: "insp-w1", resolucion: AUTORIZADA })))
      .then(() => {
        const insercion = enlaces[1];
        const actualizacion = enlaces[enlaces.length - 1];

        // INSERT de `devolucion`: los datos de la rama, la gerencia a NULL.
        expect(valorLigado(insercion, "resolucion")).toBe("devolucion");
        expect(valorLigado(insercion, "autorizado_por")).toBeNull();
        expect(valorLigado(insercion, "autorizacion_observaciones")).toBeNull();
        // UPDATE a `autorizacion_gerencia`: el motivo y la registrada_por a NULL,
        // porque un `SET` incompleto dejaría el valor viejo pegado.
        expect(valorAsignado(actualizacion, "resolucion")).toBe("autorizacion_gerencia");
        expect(valorAsignado(actualizacion, "motivo_devolucion")).toBeNull();
        expect(valorAsignado(actualizacion, "registrada_por")).toBeNull();
        expect(valorAsignado(actualizacion, "autorizado_por")).toBe("Marta (gerencia)");
      });
  });
});

// ── 5. La resolución se reconstruye desde SUS columnas ───────────────────────

describe("sqliteInspeccionTelaRepository — lectura de la resolución", () => {
  it("la rama `devolucion` se reconstruye con motivo, registradaPor y timestamp", () => {
    const original = inspeccionDelDominio({ id: "insp-r1", resolucion: DEVUELTA });

    const leido = mapInspeccionRow(mapInspeccionToSql(original) as unknown as InspeccionTelaRow);

    // Exactamente la rama del dominio, sin campos inventados ni renombrados.
    expect(leido.resolucion).toEqual({
      tipo: "devolucion",
      motivo: "tundido disparejo, no apto para estampado",
      registradaPor: "Laura",
      timestamp: "2026-09-14T08:00:00.000Z",
    });
    expect(Object.keys(leido.resolucion!)).toHaveLength(4);
  });

  it("la rama `autorizacion_gerencia` se reconstruye con sus tres columnas", () => {
    const original = inspeccionDelDominio({ id: "insp-r2", resolucion: AUTORIZADA });

    const leido = mapInspeccionRow(mapInspeccionToSql(original) as unknown as InspeccionTelaRow);

    expect(leido.resolucion).toEqual({
      tipo: "autorizacion_gerencia",
      autorizadoPor: "Marta (gerencia)",
      timestamp: "2026-09-14T09:00:00.000Z",
      observaciones: "autorizado para el turno de tarde",
    });
    expect(estadoInspeccion(leido)).toBe("uso_autorizado");
  });

  it("sin resolución, la lectura devuelve `null` y no un objeto vacío", () => {
    const leido = mapInspeccionRow(
      mapInspeccionToSql(inspeccionDelDominio()) as unknown as InspeccionTelaRow
    );
    expect(leido.resolucion).toBeNull();
    expect(leido.resolucion).not.toEqual({});
  });

  it("las dos ramas son excluyentes también al leer: una fila de gerencia no trae `motivo`", () => {
    const fila = mapInspeccionToSql(
      inspeccionDelDominio({ resolucion: AUTORIZADA })
    ) as unknown as InspeccionTelaRow;

    const leido = mapInspeccionRow(fila);

    expect(leido.resolucion).not.toHaveProperty("motivo");
    expect(leido.resolucion).not.toHaveProperty("registradaPor");
    expect(leido.resolucion).toHaveProperty("autorizadoPor", "Marta (gerencia)");
  });
});

// ── 6. Las filas dañadas fallan en voz alta, con `cause` ─────────────────────

describe("sqliteInspeccionTelaRepository — filas corruptas", () => {
  it("discriminador no nulo con una columna de datos en NULL: error de mapeo con `cause`", () => {
    const casos: Array<[string, Record<string, unknown>]> = [
      ["motivo_devolucion", { resolucion: "devolucion", motivo_devolucion: null }],
      ["registrada_por", { resolucion: "devolucion", registrada_por: null }],
      ["resolucion_timestamp", { resolucion: "devolucion", resolucion_timestamp: null }],
      ["autorizado_por", { resolucion: "autorizacion_gerencia", autorizado_por: null }],
      [
        "resolucion_timestamp",
        { resolucion: "autorizacion_gerencia", resolucion_timestamp: null },
      ],
    ];

    for (const [columna, sobrescritura] of casos) {
      const fila = mapInspeccionToSql(
        inspeccionDelDominio({ id: "insp-corrupta", resolucion: DEVUELTA })
      ) as unknown as InspeccionTelaRow;
      fila.id = "insp-corrupta";

      // Control: ANTES de corromper, la fila sana SÍ se reconstruye. Se comprueba
      // sobre una copia para que el `Object.assign` de abajo no la alcance.
      expect(mapInspeccionRow({ ...fila }).resolucion).not.toBeNull();

      Object.assign(fila, sobrescritura);

      let capturado: unknown = null;
      try {
        mapInspeccionRow({ ...fila, [columna]: null } as InspeccionTelaRow);
      } catch (error) {
        capturado = error;
      }

      // Falla en voz alta, con la fila y la columna nombradas...
      expect(capturado).toBeInstanceOf(Error);
      const error = capturado as Error;
      expect(error.message).toContain('no se pudo mapear la inspección "insp-corrupta"');
      expect(error.message).toContain(`"${columna}"`);
      // ...y con el defecto concreto como `cause`, no envuelto ni diluido.
      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toContain(columna);
      // NUNCA un `""` fabricated y NUNCA un `null` silencioso.
      expect(error.message).not.toContain('""');
    }
  });

  it("discriminador no reconocido: error de mapeo con `cause`, no un `null` silencioso", () => {
    const fila = mapInspeccionToSql(
      inspeccionDelDominio({ id: "insp-desconocida", resolucion: DEVUELTA })
    ) as unknown as InspeccionTelaRow;
    fila.resolucion = "autorizado";

    expect(() => mapInspeccionRow(fila)).toThrowError(/no se pudo mapear la inspección/);

    let capturado: unknown = null;
    try {
      mapInspeccionRow(fila);
    } catch (error) {
      capturado = error;
    }
    const error = capturado as Error;
    expect(error.message).toContain('no se pudo mapear la inspección "insp-desconocida"');
    expect(error.message).toContain("autorizado");
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toContain('"autorizado"');
  });

  it("una fila dañada rompe la LECTURA, no se degrada a `sin resolución`", async () => {
    // Éste es el daño que importa: leída como `null`, una `devolución` real
    // aparecería como `no_usable` y el operario creería que la tela sigue
    // sin resolver.
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const repo = repoSobre(store);
    store.inspeccion_tela.push(
      filaDe(
        inspeccionDelDominio({ id: "insp-rota", resolucion: DEVUELTA }),
        { motivo_devolucion: null }
      ) as FakeSqliteRow
    );

    const porId = await obtenerPorIdConError(repo, "insp-rota");
    expect(porId).toContain('no se pudo mapear la inspección "insp-rota"');
    expect(porId).toContain('"motivo_devolucion"');

    // Y el listado tampoco la silencia: revienta con el mismo error descriptivo.
    const porOrden = await listarPorOrdenConError(repo, "orden-1");
    expect(porOrden).toContain('no se pudo mapear la inspección "insp-rota"');

    // El resto de filas sanas de la misma orden tampoco se devuelven: una fila
    // dañada no se filtra en silencio (eso sería inventar un historial).
    expect(porOrden).toContain("no se pudo mapear");
  });

  it("`\"CONFORME\"`, `\"\"` y un valor no reconocido: los tres son errores de mapeo con `cause`", () => {
    // El checklist es `TEXT`, no un enum: la columna puede contener CUALQUIER cosa.
    // Un `as EstadoItemChecklist` la dejaría llegar al dominio vestida de estado.
    const casos: Array<[ItemChecklistId, string]> = [
      ["absorcion", "CONFORME"],
      ["manchas", ""],
      ["estado_general", "tal vez"],
    ];

    for (const [columna, valor] of casos) {
      const fila = filaDe(inspeccionDelDominio({ id: "insp-estado-corrupto" }), {
        [columna]: valor,
      }) as unknown as InspeccionTelaRow;

      let capturado: unknown = null;
      try {
        mapInspeccionRow(fila);
      } catch (error) {
        capturado = error;
      }

      // Falla en voz alta nombrando el id de la inspección y el defecto...
      expect(capturado).toBeInstanceOf(Error);
      const error = capturado as Error;
      expect(error.message).toContain('no se pudo mapear la inspección "insp-estado-corrupto"');
      expect(error.message).toContain(`"${columna}"`);
      expect(error.message).toContain(`"${valor}"`);
      // ...y el vocabulario que sí habría sido válido, para que el mensaje sea accionable.
      expect(error.message).toContain('"conforme" | "anomalia"');
      // La causa nombra la columna y lleva el valor infractor SIN transformar.
      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toBe(
        `valor inesperado en la columna "${columna}": "${valor}"`
      );
    }
  });

  it("las CINCO columnas rechazan su valor corrupto: el chequeo no es un caso único", () => {
    // Una columna validada y cuatro no: el mapper pasaría cuatro veces el valor
    // podrido al dominio y el test del caso único no lo detectaría.
    const valores: Record<ItemChecklistId, string> = {
      absorcion: "CONFORME",
      tundido: "",
      manchas: "tal vez",
      dimensiones: "Anomalia",
      estado_general: " conforme",
    };

    for (const columna of COLUMNAS_ITEMS_CHECKLIST) {
      const valor = valores[columna];
      const fila = filaDe(inspeccionDelDominio({ id: "insp-checklist-corrupto" }), {
        [columna]: valor,
      }) as unknown as InspeccionTelaRow;

      let capturado: unknown = null;
      try {
        mapInspeccionRow(fila);
      } catch (error) {
        capturado = error;
      }

      expect(capturado).toBeInstanceOf(Error);
      const error = capturado as Error;
      expect(error.message).toContain('no se pudo mapear la inspección "insp-checklist-corrupto"');
      expect(error.message).toContain(`"${columna}"`);
      expect((error.cause as Error).message).toBe(
        `valor inesperado en la columna "${columna}": "${valor}"`
      );
    }
  });

  it("control: los dos estados válidos siguen saliendo — el chequeo no rechaza todo", () => {
    // Sin este control, una validación que rechazara cualquier valor pasaría igual
    // los cinco tests anteriores.
    for (const valor of ["conforme", "anomalia"] as const) {
      const fila = filaDe(inspeccionDelDominio({ id: "insp-valido" }), {
        tundido: valor,
      }) as unknown as InspeccionTelaRow;

      const leido = mapInspeccionRow(fila);

      expect(leido.items).toHaveLength(5);
      expect(leido.items.find((i) => i.id === "tundido")?.estado).toBe(valor);
      // Y los otros cuatro siguen intactos: el fallo no se propaga a la fila.
      expect(leido.items.filter((i) => i.id !== "tundido").map((i) => i.estado)).toEqual([
        "conforme",
        "conforme",
        "conforme",
        "conforme",
      ]);
    }
  });

  it("el chequeo NO es validación de negocio: una `devolucion` sin anomalía se reconstruye igual", () => {
    // `registrarDevolucion` exige una anomalía; el puerto NO. Esto fija la frontera:
    // el adapter prueba la FORMA de cinco columnas `TEXT`, no la regla del dominio.
    const fila = mapInspeccionToSql(
      inspeccion({ id: "insp-devolucion-sin-anomalia", resolucion: DEVUELTA })
    ) as unknown as InspeccionTelaRow;

    const leido = mapInspeccionRow(fila);

    expect(leido.items.every((i) => i.estado === "conforme")).toBe(true);
    expect(leido.resolucion).toEqual(DEVUELTA);
  });

  it("un estado de checklist dañado rompe la LECTURA, no degrada la tela a `conforme`", async () => {
    // Éste es el daño que importa: leído como un estado cualquiera, un `""` o un
    // `CONFORME` mal escrito se convertirían en una tela "conforme" que nadie
    // revisó — el peor resultado posible para la operaria.
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const repo = repoSobre(store);
    store.inspeccion_tela.push(
      filaDe(inspeccionDelDominio({ id: "insp-checklist-roto" }), { tundido: "" }) as FakeSqliteRow
    );

    const porId = await obtenerPorIdConError(repo, "insp-checklist-roto");
    expect(porId).toContain('no se pudo mapear la inspección "insp-checklist-roto"');
    expect(porId).toContain('"tundido"');

    // Y el listado tampoco lo silencia: revienta con el mismo error descriptivo.
    const porOrden = await listarPorOrdenConError(repo, "orden-1");
    expect(porOrden).toContain('no se pudo mapear la inspección "insp-checklist-roto"');
    expect(porOrden).toContain('"tundido"');
  });
});

/** Ejecuta `obtenerPorId` y devuelve el mensaje de error, o `null` si resuelve. */
async function obtenerPorIdConError(
  repo: SqliteInspeccionTelaRepository,
  id: string
): Promise<string | null> {
  return repo.obtenerPorId(id).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error))
  );
}

/** Ejecuta `listarPorOrden` y devuelve el mensaje de error, o `null` si resuelve. */
async function listarPorOrdenConError(
  repo: SqliteInspeccionTelaRepository,
  ordenId: string
): Promise<string | null> {
  return repo.listarPorOrden(ordenId).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error))
  );
}

// ── 7. Insertar y leer de vuelta ─────────────────────────────────────────────

describe("sqliteInspeccionTelaRepository — insertar y leer", () => {
  it("insertInspeccion resuelve y obtenerPorId devuelve el registro", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const repo = repoSobre(store);
    const nueva = inspeccionDelDominio({ id: "insp-sql-1" });

    await expect(repo.insertInspeccion(nueva)).resolves.toBeUndefined();
    await expect(repo.obtenerPorId("insp-sql-1")).resolves.toEqual(nueva);

    // La fila quedó en la tabla con el vocabulario de 004 y la checklist plana.
    expect(store.inspeccion_tela).toHaveLength(1);
    const fila = store.inspeccion_tela[0];
    expect(fila).toMatchObject({
      id: "insp-sql-1",
      orden_id: "orden-1",
      operario: "Laura",
      lote: "L-77",
      absorcion: "conforme",
      tundido: "anomalia",
      manchas: "conforme",
      dimensiones: "conforme",
      estado_general: "conforme",
      otra_anomalia: "tundido disparejo",
      resolucion: null,
    });
  });

  it("obtenerPorId resuelve undefined — nunca null — para un id ausente", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);

    const ausente = await repo.obtenerPorId("insp-nope");

    expect(ausente).toBeUndefined();
    expect(ausente).not.toBeNull();
  });

  it("inserta una inspección sin opcionales sin inventar valores", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const repo = repoSobre(store);

    await repo.insertInspeccion(inspeccion({ id: "insp-sin-opcionales" }));

    const fila = store.inspeccion_tela[0];
    expect(fila.lote).toBeNull();
    expect(fila.otra_anomalia).toBeNull();
    expect(fila.observaciones).toBeNull();
    await expect(repo.obtenerPorId("insp-sin-opcionales")).resolves.toMatchObject({
      lote: undefined,
      otraAnomalia: undefined,
      observaciones: undefined,
      resolucion: null,
    });
  });
});

// ── 8. Duplicado: rechazo con el registro intacto ────────────────────────────

describe("sqliteInspeccionTelaRepository — rechazo por duplicado", () => {
  it("insertInspeccion rechaza el id repetido y la fila conserva los valores originales", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1", "orden-2");
    const repo = repoSobre(store);
    const original = inspeccionDelDominio({ id: "insp-dup" });
    await repo.insertInspeccion(original);

    // Mismo id, valores DISTINTOS: si el adaptador sobrescribiera, se vería aquí.
    const intruder = inspeccionDelDominio({
      id: "insp-dup",
      ordenId: "orden-2",
      lote: "L-999",
      resolucion: DEVUELTA,
    });

    const err = await repo
      .insertInspeccion(intruder)
      .then(() => null, (e: unknown) => e as Error);

    // Mensaje del adaptador en memoria, VERBATIM — y sin envolver: el rechazo
    // ocurre en el pre-chequeo, antes de cualquier escritura.
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe("ya existe una inspección con el id insp-dup");
    expect(err!.cause).toBeUndefined();

    // La fila almacenada sigue siendo la original, campo por campo.
    expect(store.inspeccion_tela).toHaveLength(1);
    const fila = store.inspeccion_tela[0];
    expect(fila.orden_id).toBe("orden-1");
    expect(fila.lote).toBe("L-77");
    expect(fila.resolucion).toBeNull();
    expect(fila.motivo_devolucion).toBeNull();

    // Y la lectura lo confirma por la vía pública del puerto.
    await expect(repo.obtenerPorId("insp-dup")).resolves.toEqual(original);
  });
});

// ── 9. Id desconocido: rechazo sin crear nada ────────────────────────────────

describe("sqliteInspeccionTelaRepository — rechazo por id desconocido", () => {
  it("updateInspeccion rechaza un id ausente y no crea ninguna fila", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const repo = repoSobre(store);
    await repo.insertInspeccion(inspeccionDelDominio({ id: "insp-existente" }));

    const err = await repo
      .updateInspeccion(inspeccionDelDominio({ id: "insp-fantasma", resolucion: DEVUELTA }))
      .then(() => null, (e: unknown) => e as Error);

    // Verbatim del adaptador en memoria, y sin envolver (pre-chequeo).
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe("no existe una inspección con el id insp-fantasma");
    expect(err!.cause).toBeUndefined();

    // NADA se creó: ni la fila fantasma ni una segunda copia de la existente.
    expect(store.inspeccion_tela).toHaveLength(1);
    expect(store.inspeccion_tela.map((f) => f.id)).toEqual(["insp-existente"]);
    await expect(repo.obtenerPorId("insp-fantasma")).resolves.toBeUndefined();
  });
});

// ── 10. El orden cronológico lo posee el adaptador ───────────────────────────

describe("sqliteInspeccionTelaRepository — listarPorOrden y orden cronológico", () => {
  it("devuelve las TRES inspecciones de la orden, ordenadas por `timestamp`", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1", "orden-2");
    const repo = repoSobre(store);

    // Insertadas deliberadamente fuera de orden cronológico, cada una con su lote.
    await repo.insertInspeccion(
      inspeccionDelDominio({ id: "insp-3", lote: "L-3", timestamp: "2026-09-14T12:00:00.000Z" })
    );
    await repo.insertInspeccion(
      inspeccionDelDominio({ id: "insp-1", lote: "L-1", timestamp: "2026-09-14T07:20:00.000Z" })
    );
    await repo.insertInspeccion(
      inspeccionDelDominio({ id: "insp-2", lote: "L-2", timestamp: "2026-09-14T09:00:00.000Z" })
    );

    const listado = await repo.listarPorOrden("orden-1");

    // Las TRES, no sólo la última: el modelo del ticket 07 no tiene "una
    // inspección por orden".
    expect(listado.map((i) => i.id)).toEqual(["insp-1", "insp-2", "insp-3"]);
    expect(listado.map((i) => i.lote)).toEqual(["L-1", "L-2", "L-3"]);

    // El almacenamiento conserva el orden de inserción: el orden lo aporta la
    // consulta (`ORDER BY timestamp ASC`), no el doble ni el llamador.
    expect(store.inspeccion_tela.map((f) => f.id)).toEqual(["insp-3", "insp-1", "insp-2"]);
  });

  it("no mezcla inspecciones de otras órdenes", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1", "orden-2");
    const repo = repoSobre(store);

    await repo.insertInspeccion(inspeccionDelDominio({ id: "insp-o1", ordenId: "orden-1" }));
    await repo.insertInspeccion(
      inspeccionDelDominio({
        id: "insp-o2",
        ordenId: "orden-2",
        lote: "L-otra",
        timestamp: "2026-09-14T07:10:00.000Z",
      })
    );
    await repo.insertInspeccion(
      inspeccionDelDominio({
        id: "insp-o1b",
        ordenId: "orden-1",
        timestamp: "2026-09-14T07:30:00.000Z",
      })
    );

    const listado = await repo.listarPorOrden("orden-1");

    expect(listado.map((i) => i.id)).toEqual(["insp-o1", "insp-o1b"]);
    // Y la otra orden ve sólo lo suyo.
    expect((await repo.listarPorOrden("orden-2")).map((i) => i.id)).toEqual(["insp-o2"]);
    expect((await repo.listarPorOrden("orden-3")).map((i) => i.id)).toEqual([]);
  });

  it("resuelve lista vacía para una orden sin inspecciones", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const repo = repoSobre(store);
    await expect(repo.listarPorOrden("orden-1")).resolves.toEqual([]);
  });
});

// ── 11. Resolver REEMPLAZA la fila, sin mutar el historial ────────────────────

describe("sqliteInspeccionTelaRepository — la resolución reemplaza la fila", () => {
  it("resolver actualiza la MISMA fila y no añade ninguna otra", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const repo = repoSobre(store);
    await repo.insertInspeccion(inspeccionDelDominio({ id: "insp-cierre" }));
    expect(store.inspeccion_tela).toHaveLength(1);

    // El flujo real: se registra la inspección, se lee, el dominio devuelve una
    // COPIA resuelta (mismo id) y se persiste con la misma actualización.
    const leida = (await repo.obtenerPorId("insp-cierre"))!;
    expect(estadoInspeccion(leida)).toBe("no_usable");
    const { errores, inspeccion: devuelta } = registrarDevolucion(orden("orden-1"), leida, {
      motivo: "tundido disparejo, no apto para estampado",
      registradaPor: "Laura",
      timestamp: "2026-09-14T08:00:00.000Z",
    });
    expect(errores).toEqual([]);
    // El dominio devuelve una copia nueva: el registro ya persistido no se muta.
    expect(devuelta).not.toBe(leida);
    expect(leida.resolucion).toBeNull();

    await repo.updateInspeccion(devuelta!);

    // Ni una fila de más: la resolución es un `UPDATE`, no un insert disfrazado.
    expect(store.inspeccion_tela).toHaveLength(1);
    const fila = store.inspeccion_tela[0];
    expect(fila.id).toBe("insp-cierre");
    expect(fila.resolucion).toBe("devolucion");
    expect(fila.motivo_devolucion).toBe("tundido disparejo, no apto para estampado");
    // El estado sin resolver NO queda retenido como segundo registro, ni como
    // columnas de la rama anterior pegadas.
    expect(fila.autorizado_por).toBeNull();
    expect((await repo.listarPorOrden("orden-1")).map((i) => i.id)).toEqual(["insp-cierre"]);

    await expect(repo.obtenerPorId("insp-cierre")).resolves.toMatchObject({
      id: "insp-cierre",
      resolucion: DEVUELTA,
    });
    expect(estadoInspeccion((await repo.obtenerPorId("insp-cierre"))!)).toBe("devuelta");
  });

  it("autorizar tras una devolución también reemplaza la fila, no la acumula", async () => {
    // El dominio NO permite dos resoluciones, pero el almacenamiento tampoco
    // acumula: si un registro con las dos llegara al puerto, el `SET` completo
    // deja la fila en la rama que la dice, sin columnas de la anterior.
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const repo = repoSobre(store);
    await repo.insertInspeccion(inspeccionDelDominio({ id: "insp-reaut" }));

    const leida = (await repo.obtenerPorId("insp-reaut"))!;
    const { errores, inspeccion: autorizada } = registrarAutorizacionGerencia(leida, {
      autorizadoPor: "Marta (gerencia)",
      timestamp: "2026-09-14T09:00:00.000Z",
      observaciones: "autorizado para el turno de tarde",
    });
    expect(errores).toEqual([]);
    await repo.updateInspeccion(autorizada!);

    expect(store.inspeccion_tela).toHaveLength(1);
    const fila = store.inspeccion_tela[0];
    expect(fila.resolucion).toBe("autorizacion_gerencia");
    expect(fila.autorizado_por).toBe("Marta (gerencia)");
    expect(fila.autorizacion_observaciones).toBe("autorizado para el turno de tarde");
    // La checklist y el resto sobreviven intactos al update.
    expect(fila.tundido).toBe("anomalia");
    expect(fila.lote).toBe("L-77");
    expect(fila.orden_id).toBe("orden-1");
    expect(estadoInspeccion((await repo.obtenerPorId("insp-reaut"))!)).toBe("uso_autorizado");
  });

  it("el texto emitido es la forma prescrita: 18 placeholders y `id` sólo en el WHERE", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const { repo, consultas } = repoQueRegistra(store);
    await repo.insertInspeccion(inspeccionDelDominio({ id: "insp-sql" }));
    await repo.updateInspeccion(inspeccionDelDominio({ id: "insp-sql", resolucion: DEVUELTA }));

    const insert = consultas.find((q) => q.startsWith("INSERT INTO inspeccion_tela"))!;
    const update = consultas.find((q) => q.startsWith("UPDATE inspeccion_tela"))!;

    // INSERT: una sola sentencia con las 18 columnas y sus 18 placeholders.
    expect(insert).not.toBeUndefined();
    expect(insert.match(/\$\d+/g)).toHaveLength(18);
    // Sin upsert, sin OR REPLACE, sin transacción.
    expect(insert).not.toMatch(/OR REPLACE|ON CONFLICT|BEGIN|COMMIT/i);

    // UPDATE: 17 asignaciones no-PK, y `id` NO aparece en la lista SET.
    const set = update.slice(update.indexOf("SET ") + 4, update.indexOf(" WHERE "));
    expect(set.split(",")).toHaveLength(17);
    expect(set).not.toMatch(/(^|,\s*)id = /);
    expect(update).toContain("WHERE id = $1");
    // Y el listado ordena por `timestamp`, el campo temporal de esta tabla.
    await repo.listarPorOrden("orden-1");
    expect(consultas[consultas.length - 1]).toBe(
      "SELECT * FROM inspeccion_tela WHERE orden_id = $1 ORDER BY timestamp ASC"
    );
  });
});

// ── 12. El puerto no expone consulta por máquina ─────────────────────────────

describe("sqliteInspeccionTelaRepository — el puerto no tiene listarPorMaquina", () => {
  it("el adaptador expone exactamente los 4 métodos del puerto aprobado", () => {
    const metodos = Object.getOwnPropertyNames(SqliteInspeccionTelaRepository.prototype).filter(
      (nombre) => nombre !== "constructor"
    );
    expect(metodos.sort()).toEqual([
      "insertInspeccion",
      "listarPorOrden",
      "obtenerPorId",
      "updateInspeccion",
    ]);

    // Y no existe ninguna forma de consultar por máquina: la tabla no tiene
    // `machine_id` porque la inspección es SIEMPRE un evento de la orden.
    const puerto = repoSobre(createFakeSqliteStore()) as unknown as {
      listarPorMaquina?: unknown;
    };
    expect(puerto.listarPorMaquina).toBeUndefined();
  });

  it("ninguna sentencia emitida menciona `machine_id`", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const { repo, consultas } = repoQueRegistra(store);
    await repo.insertInspeccion(inspeccionDelDominio({ id: "insp-w2" }));
    await repo.listarPorOrden("orden-1");
    await repo.obtenerPorId("insp-w2");

    for (const consulta of consultas) {
      expect(consulta).not.toMatch(/machine_id/i);
    }
  });
});

// ── 13. D2b: enlace colgante, verbatim y sin lookup propio ───────────────────

describe("sqliteInspeccionTelaRepository — D2b: enlace colgante, verbatim y sin lookup", () => {
  it("el INSERT liga el `ordenId` tal cual y el adaptador no consulta la tabla `orden`", async () => {
    const store = createFakeSqliteStore();
    // `orden-1` NO está sembrada: el enlace no resuelve.
    const { repo, consultas, enlaces } = repoQueRegistra(store);

    // Inspección construida a mano, SIN pasar por `registrarInspeccion`: el
    // dominio jamás dejaría llegar un `ordenId` colgante, y por eso este es el
    // control blanco — el puerto es una frontera de almacenamiento puro.
    await expect(repo.insertInspeccion(inspeccion({ id: "insp-d2b", ordenId: "orden-fantasma" }))).rejects.toThrow();

    // 1. Exactamente DOS sentencias: el pre-chequeo y el INSERT. Ni una más.
    expect(consultas).toHaveLength(2);
    expect(consultas[0]).toBe("SELECT id FROM inspeccion_tela WHERE id = $1");
    expect(consultas[1]).toMatch(/^INSERT INTO inspeccion_tela \(/);

    // 2. El adaptador NO hace lookup de su cuenta: ninguna sentencia lee otra
    //    tabla, y `orden` sólo aparece como columna destino de la FK.
    for (const consulta of consultas) {
      expect(consulta).not.toMatch(/FROM\s+orden/i);
      expect(consulta).not.toMatch(/JOIN/i);
    }

    // 3. El `orden_id` viaja VERBATIM, deducido del texto emitido y no de memoria.
    expect(valorLigado(enlaces[1], "orden_id")).toBe("orden-fantasma");
  });

  it("un `ordenId` inexistente hace fallar el INSERT en vez de persistir el enlace", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);

    const err = await repo
      .insertInspeccion(inspeccion({ id: "insp-a1", ordenId: "orden-inexistente" }))
      .then(() => null, (e: unknown) => e as Error);

    // El adaptador envuelve la falla de la sentencia, conservando la causa.
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe('no se pudo persistir la inspección "insp-a1"');
    expect((err!.cause as Error).message).toBe("FOREIGN KEY constraint failed");
    // NADA se persistió: un enlace roto no deja una fila a medias.
    expect(store.inspeccion_tela).toHaveLength(0);
  });

  it("A1b — con la orden sembrada, la misma inspección SÍ persiste (el doble no rechaza todo)", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    const repo = repoSobre(store);
    const valida = inspeccion({ id: "insp-a1b" });

    await expect(repo.insertInspeccion(valida)).resolves.toBeUndefined();

    // La diferencia entre A1 y A1b es SÓLO la resolubilidad del enlace: prueba
    // de que el rechazo anterior no era un "rechaza todo" disfrazado.
    await expect(repo.obtenerPorId("insp-a1b")).resolves.toEqual(valida);
    expect(store.inspeccion_tela).toHaveLength(1);
  });
});

// ── 14. Envoltura de error con `cause` ───────────────────────────────────────

describe("sqliteInspeccionTelaRepository — propagación de errores", () => {
  it("un fallo del INSERT se propaga con la causa original y nunca como éxito", async () => {
    const store = createFakeSqliteStore();
    const fallo = new Error("no such table: inspeccion_tela");
    const repo = new SqliteInspeccionTelaRepository(dbQueFallaAlEscribir(store, fallo));

    const err = await repo
      .insertInspeccion(inspeccion({ id: "insp-falla" }))
      .then(() => null, (e: unknown) => e as Error);

    // Descriptivo, nombrando la entidad y el id (patrón 10.3/10.4).
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe('no se pudo persistir la inspección "insp-falla"');
    // La causa original se conserva: no se traga ni se convierte en éxito.
    expect(err!.cause).toBe(fallo);
    expect(store.inspeccion_tela).toHaveLength(0);
  });

  it("un fallo del UPDATE se propaga con la causa original y deja la fila intacta", async () => {
    const store = createFakeSqliteStore();
    sembrarOrden(store, "orden-1");
    // Primero, sembrar por la vía buena para que el pre-chequeo del UPDATE pase.
    await repoSobre(store).insertInspeccion(inspeccionDelDominio({ id: "insp-actualizable" }));
    const fallo = new Error("disk I/O error");
    const repo = new SqliteInspeccionTelaRepository(dbQueFallaAlEscribir(store, fallo));

    const err = await repo
      .updateInspeccion(
        inspeccionDelDominio({ id: "insp-actualizable", resolucion: DEVUELTA })
      )
      .then(() => null, (e: unknown) => e as Error);

    expect(err!.message).toBe('no se pudo persistir la inspección "insp-actualizable"');
    expect(err!.cause).toBe(fallo);
    // La escritura no se aplicó a medias: sigue sin resolver.
    expect(store.inspeccion_tela[0].resolucion).toBeNull();
  });

  it("un fallo de LECTURA propaga sin convertirse en \"no encontrado\"", async () => {
    const store = createFakeSqliteStore();
    const fallo = new Error("database is locked");
    const db = {
      path: store.path,
      select: async () => {
        throw fallo;
      },
      execute: (query: string, binds?: unknown[]) => store.execute(query, binds),
      close: async () => true,
    } as unknown as Database;
    const repo = new SqliteInspeccionTelaRepository(db);

    const err = await repo.obtenerPorId("insp-whatever").then(() => null, (e: unknown) => e as Error);

    // Una lectura fallida NO es un `undefined`: el llamador tiene que enterarse.
    expect(err!.message).toBe("database is locked");
    await expect(repo.obtenerPorId("insp-whatever")).rejects.toThrow("database is locked");
  });
});
