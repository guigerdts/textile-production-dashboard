/**
 * Pruebas del repositorio en memoria — ticket 07, Ciclo 2.
 *
 * Cubre las condiciones del ciclo:
 * - inserción, consulta y actualización (insert/update EXPLÍCITOS sin upsert)
 * - validación de identificadores (ids vacíos rechazados)
 * - listado por orden con múltiples inspecciones
 * - aislamiento entre órdenes (listarPorOrden nunca mezcla)
 * - orden cronológico estable por timestamp
 * - copias defensivas (structuredClone) en entradas y salidas
 * - ausencia de mutación: mutar lo devuelto o lo sembrado no contamina el repo
 * - sin lógica de negocio: el repo no valida checklist/resoluciones; las
 *   resoluciones llegan ya resueltas por el dominio y solo se persisten
 */
import { describe, expect, it } from "vitest";
import { InMemoryInspeccionRepository } from "./inMemoryInspeccionRepository";
import type {
  InspeccionTela,
  ItemChecklistEstado,
  Orden,
} from "../domain/types";
import {
  registrarAutorizacionGerencia,
  registrarDevolucion,
  registrarInspeccion,
} from "../domain/inspeccionTela";

// ---------------------------------------------------------------------------
// Fixtures (locales de prueba; sin fixtures de UI)
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

function orden(id = "ord-07"): Orden {
  return {
    id,
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
  };
}

/** Genera una inspección válida a través del DOMINIO (no se fabrica a mano). */
function inspeccion(
  ordenId: string,
  timestamp: string,
  lote?: string,
  items: ItemChecklistEstado[] = CHECKLIST_CONFORME,
): InspeccionTela {
  const res = registrarInspeccion(
    orden(ordenId),
    {
      operatorName: "Carlos Gómez",
      lote,
      items,
      timestamp,
    },
  );
  if (res.errores.length > 0 || !res.inspeccion) {
    throw new Error(`fixture inválido: ${res.errores.join(", ")}`);
  }
  return res.inspeccion;
}

// ---------------------------------------------------------------------------
// Insert / obtenerPorId
// ---------------------------------------------------------------------------

describe("InMemoryInspeccionRepository — insert y consulta", () => {
  it("inserta y recupera una inspección por id", async () => {
    const repo = new InMemoryInspeccionRepository();
    const i = inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101");
    await repo.insertInspeccion(i);

    const obtenida = await repo.obtenerPorId(i.id);
    expect(obtenida).toBeDefined();
    expect(obtenida!.id).toBe(i.id);
    expect(obtenida!.ordenId).toBe("ord-07");
    expect(obtenida!.lote).toBe("L-101");
    expect(obtenida!.resolucion).toBeNull();
  });

  it("devuelve undefined para un id inexistente", async () => {
    const repo = new InMemoryInspeccionRepository();
    expect(await repo.obtenerPorId("no-existe")).toBeUndefined();
  });

  it("rechaza INSERT duplicado (mismo id)", async () => {
    const repo = new InMemoryInspeccionRepository();
    const i = inspeccion("ord-07", "2026-09-13T07:30:00.000Z");
    await repo.insertInspeccion(i);
    await expect(repo.insertInspeccion(i)).rejects.toThrow(/ya existe una inspección/);
  });

  it("rechaza identificadores vacíos en insert y update", async () => {
    const repo = new InMemoryInspeccionRepository();
    const i = inspeccion("ord-07", "2026-09-13T07:30:00.000Z");
    const sinId = { ...i, id: "" };
    await expect(repo.insertInspeccion(sinId)).rejects.toThrow(/id no puede estar vacío/);

    const conEspacios = { ...i, id: "   " };
    await expect(repo.insertInspeccion(conEspacios)).rejects.toThrow(/id no puede estar vacío/);

    await repo.insertInspeccion(i);
    await expect(repo.updateInspeccion(sinId)).rejects.toThrow(/id no puede estar vacío/);
  });

  it("rechaza UPDATE de un id inexistente", async () => {
    const repo = new InMemoryInspeccionRepository();
    const i = inspeccion("ord-07", "2026-09-13T07:30:00.000Z");
    await expect(repo.updateInspeccion(i)).rejects.toThrow(/no existe una inspección/);
  });
});

// ---------------------------------------------------------------------------
// Update explícito (resoluciones del dominio)
// ---------------------------------------------------------------------------

describe("InMemoryInspeccionRepository — update (resolución exclusive)", () => {
  it("persiste la inspección RESUELTA devuelta por el dominio (mismo id)", async () => {
    const repo = new InMemoryInspeccionRepository();
    const original = inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101", CHECKLIST_CON_MANCHAS);
    await repo.insertInspeccion(original);

    // El dominio devuelve una copia NUEVA con resolución (inmutabilidad)
    const res = registrarDevolucion(orden(), original, {
      motivo: "tela con manchas",
      registradaPor: "Carlos Gómez",
      timestamp: "2026-09-13T07:45:00.000Z",
    });
    expect(res.errores).toEqual([]);
    await repo.updateInspeccion(res.inspeccion!);

    const persistida = await repo.obtenerPorId(original.id);
    expect(persistida!.resolucion).toMatchObject({
      tipo: "devolucion",
      motivo: "tela con manchas",
    });
  });

  it("persiste también la autorización de gerencia como resolución", async () => {
    const repo = new InMemoryInspeccionRepository();
    const original = inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101", CHECKLIST_CON_MANCHAS);
    await repo.insertInspeccion(original);

    const res = registrarAutorizacionGerencia(original, {
      autorizadoPor: "Gerencia",
      timestamp: "2026-09-13T07:50:00.000Z",
    });
    await repo.updateInspeccion(res.inspeccion!);

    const persistida = await repo.obtenerPorId(original.id);
    expect(persistida!.resolucion).toMatchObject({
      tipo: "autorizacion_gerencia",
      autorizadoPor: "Gerencia",
    });
  });

  it("update NO crea ni elimina otras inspecciones", async () => {
    const repo = new InMemoryInspeccionRepository();
    const a = inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101");
    const b = inspeccion("ord-07", "2026-09-13T09:00:00.000Z", "L-102", CHECKLIST_CON_MANCHAS);
    await repo.insertInspeccion(a);
    await repo.insertInspeccion(b);

    const res = registrarAutorizacionGerencia(b, {
      autorizadoPor: "Gerencia",
      timestamp: "2026-09-13T09:15:00.000Z",
    });
    await repo.updateInspeccion(res.inspeccion!);

    expect(await repo.listarPorOrden("ord-07")).toHaveLength(2);
    expect((await repo.obtenerPorId(a.id))!.resolucion).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listarPorOrden: múltiples, aislamiento y orden cronológico
// ---------------------------------------------------------------------------

describe("InMemoryInspeccionRepository — listarPorOrden", () => {
  it("lista múltiples inspecciones de una orden", async () => {
    const repo = new InMemoryInspeccionRepository();
    await repo.insertInspeccion(inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101"));
    await repo.insertInspeccion(inspeccion("ord-07", "2026-09-13T10:00:00.000Z", "L-102"));
    await repo.insertInspeccion(inspeccion("ord-07", "2026-09-13T12:30:00.000Z", "L-103"));

    const lista = await repo.listarPorOrden("ord-07");
    expect(lista).toHaveLength(3);
    expect(lista.map((i) => i.lote)).toEqual(["L-101", "L-102", "L-103"]);
  });

  it("NO mezcla inspecciones de otras órdenes (aislamiento por ordenId)", async () => {
    const repo = new InMemoryInspeccionRepository();
    await repo.insertInspeccion(inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101"));
    await repo.insertInspeccion(inspeccion("ord-08", "2026-09-13T07:35:00.000Z", "L-201"));
    await repo.insertInspeccion(inspeccion("ord-07", "2026-09-13T10:00:00.000Z", "L-102"));

    expect((await repo.listarPorOrden("ord-07")).map((i) => i.lote)).toEqual(["L-101", "L-102"]);
    expect((await repo.listarPorOrden("ord-08")).map((i) => i.lote)).toEqual(["L-201"]);
  });

  it("devuelve lista vacía para una orden sin inspecciones", async () => {
    const repo = new InMemoryInspeccionRepository();
    await repo.insertInspeccion(inspeccion("ord-07", "2026-09-13T07:30:00.000Z"));
    expect(await repo.listarPorOrden("ord-sin-inspecciones")).toEqual([]);
  });

  it("ordena cronológicamente por timestamp aunque el seed llegue desordenado", async () => {
    const repo = new InMemoryInspeccionRepository([
      inspeccion("ord-07", "2026-09-13T12:30:00.000Z", "L-103"),
      inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101"),
      inspeccion("ord-07", "2026-09-13T10:00:00.000Z", "L-102"),
    ]);

    const lista = await repo.listarPorOrden("ord-07");
    expect(lista.map((i) => i.lote)).toEqual(["L-101", "L-102", "L-103"]);
    const timestamps = lista.map((i) => i.timestamp);
    expect([...timestamps].sort()).toEqual(timestamps);
  });
});

// ---------------------------------------------------------------------------
// Copias defensivas y ausencia de mutación
// ---------------------------------------------------------------------------

describe("InMemoryInspeccionRepository — copias defensivas", () => {
  it("mutar el objeto devuelto por obtenerPorId NO contamina el repositorio", async () => {
    const repo = new InMemoryInspeccionRepository();
    const i = inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101");
    await repo.insertInspeccion(i);

    const primera = (await repo.obtenerPorId(i.id))!;
    primera.resolucion = {
      tipo: "devolucion",
      motivo: "mutación externa",
      registradaPor: "Hacker",
      timestamp: "2026-09-13T23:00:00.000Z",
    };
    primera.ordenId = "ord-otra";

    const segunda = (await repo.obtenerPorId(i.id))!;
    expect(segunda.resolucion).toBeNull();
    expect(segunda.ordenId).toBe("ord-07");
  });

  it("mutar el resultado de listarPorOrden NO contamina el repositorio", async () => {
    const repo = new InMemoryInspeccionRepository();
    await repo.insertInspeccion(inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101"));

    const lista = await repo.listarPorOrden("ord-07");
    lista[0].timestamp = "2099-01-01T00:00:00.000Z";

    const again = await repo.listarPorOrden("ord-07");
    expect(again[0].timestamp).toBe("2026-09-13T07:30:00.000Z");
  });

  it("mutar el input del INSERT NO contamina el repositorio", async () => {
    const repo = new InMemoryInspeccionRepository();
    const i = inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101");
    await repo.insertInspeccion(i);

    i.ordenId = "ord-hackeada";
    i.items[0] = { id: "absorcion", estado: "anomalia" };

    const persistida = (await repo.obtenerPorId(i.id))!;
    expect(persistida.ordenId).toBe("ord-07");
    expect(persistida.items[0].estado).toBe("conforme");
  });

  it("mutar el seed del constructor NO contamina el repositorio", async () => {
    const sembradas = [inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101")];
    const repo = new InMemoryInspeccionRepository(sembradas);

    sembradas[0].operatorName = "Otro operario";

    const persistida = (await repo.obtenerPorId(sembradas[0].id))!;
    expect(persistida.operatorName).toBe("Carlos Gómez");
  });

  it("las copias son objetos NUEVOS (no la misma referencia)", async () => {
    const repo = new InMemoryInspeccionRepository();
    const i = inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101");
    await repo.insertInspeccion(i);

    const a = (await repo.obtenerPorId(i.id))!;
    const b = (await repo.obtenerPorId(i.id))!;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Sin lógica de negocio en el repositorio
// ---------------------------------------------------------------------------

describe("InMemoryInspeccionRepository — delega el negocio al dominio", () => {
  it("persiste tal cual lo que el dominio ya validó (sin re-validar)", async () => {
    const repo = new InMemoryInspeccionRepository();
    // Solo material alcanzable a través del dominio (fixtures con errores = throw)
    const i = inspeccion("ord-07", "2026-09-13T07:30:00.000Z", "L-101");
    await repo.insertInspeccion(i);
    expect(await repo.obtenerPorId(i.id)).toBeDefined();
  });

  it("no expone ninguna API de paradas, tiempo, producción ni estado de orden", () => {
    const repo = new InMemoryInspeccionRepository();
    const keys = Object.getOwnPropertyNames(
      Object.getPrototypeOf(repo),
    ).sort();
    expect(keys).toEqual([
      "constructor",
      "insertInspeccion",
      "listarPorOrden",
      "obtenerPorId",
      "updateInspeccion",
    ]);
  });
});