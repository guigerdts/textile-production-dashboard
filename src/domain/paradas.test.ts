/**
 * Pruebas de dominio — ticket 02 (paradas / incidencias).
 * Funciones puras de paradas.ts.
 */
import { describe, expect, it } from "vitest";
import {
  cerrarParada,
  duracionAcumulada,
  duracionParada,
  getCausaParadaPorId,
  getCausasParada,
  paradaAbierta,
  registrarParada,
  validarCamposCausa,
  validarFinalizacionConParadas,
  validarLecturaConParadas,
} from "./paradas";
import type { Parada, ParadaAbierta } from "./types";

/** Verifica que ALGÚN mensaje de error contenga el fragmento buscado. */
function contiene(errores: string[], fragmento: string): boolean {
  return errores.some((e) => e.includes(fragmento));
}

describe("ticket 02: catálogo de causas", () => {
  it("tiene exactamente 10 causas predefinidas", () => {
    expect(getCausasParada()).toHaveLength(10);
  });

  it("cada causa tiene id, nombre y camposRequeridos", () => {
    for (const causa of getCausasParada()) {
      expect(causa.id).toBeTruthy();
      expect(causa.nombre).toBeTruthy();
      expect(Array.isArray(causa.camposRequeridos)).toBe(true);
    }
  });

  it("incluye las causas clave del contexto", () => {
    const ids = getCausasParada().map((c) => c.id);
    expect(ids).toContain("falta_color");
    expect(ids).toContain("rotura_cuadro");
    expect(ids).toContain("otro");
  });

  it("busca una causa por id", () => {
    expect(getCausaParadaPorId("falta_color")?.nombre).toBe("Falta de color / tinta");
    expect(getCausaParadaPorId("no_existe" as never)).toBeUndefined();
  });
});

describe("ticket 02: validarCamposCausa", () => {
  it("falta de color requiere el campo color", () => {
    const errores = validarCamposCausa("falta_color", {}, undefined);
    expect(contiene(errores, 'falta el campo "color"')).toBe(true);
  });

  it("rotura de cuadro requiere el campo carro", () => {
    expect(contiene(validarCamposCausa("rotura_cuadro", {}, undefined), "carro")).toBe(true);
  });

  it("carro válido es un entero del 1 al 7", () => {
    expect(validarCamposCausa("rotura_cuadro", { carro: 3 }, undefined)).toEqual([]);
    expect(contiene(validarCamposCausa("rotura_cuadro", { carro: 0 }, undefined), "carro")).toBe(true);
    expect(contiene(validarCamposCausa("rotura_cuadro", { carro: 8 }, undefined), "carro")).toBe(true);
    expect(contiene(validarCamposCausa("rotura_cuadro", { carro: 1.5 }, undefined), "carro")).toBe(true);
  });

  it("daño mecánico requiere carro y componente", () => {
    expect(contiene(validarCamposCausa("danio_mecanico", { carro: 2 }, undefined), "componente")).toBe(true);
    expect(
      validarCamposCausa("danio_mecanico", { carro: 2, componente: "eje" }, undefined),
    ).toEqual([]);
  });

  it("ajuste de registro requiere carrosAfectados no vacío con carros 1-7", () => {
    expect(contiene(validarCamposCausa("ajuste_registro", {}, undefined), "carrosAfectados")).toBe(true);
    expect(contiene(validarCamposCausa("ajuste_registro", { carrosAfectados: [] }, undefined), "carrosAfectados")).toBe(true);
    expect(
      validarCamposCausa("ajuste_registro", { carrosAfectados: [1, 5] }, undefined),
    ).toEqual([]);
    expect(contiene(validarCamposCausa("ajuste_registro", { carrosAfectados: [8] }, undefined), "carrosAfectados")).toBe(true);
  });

  it("causa 'otro' requiere observación", () => {
    expect(contiene(validarCamposCausa("otro", {}, undefined), "debe indicar una observación")).toBe(true);
    expect(contiene(validarCamposCausa("otro", {}, "   "), "debe indicar una observación")).toBe(true);
    expect(validarCamposCausa("otro", {}, "tela arrugada")).toEqual([]);
  });

  it("causas que no requieren campos pasan la validación", () => {
    expect(validarCamposCausa("atasco_tela", {}, undefined)).toEqual([]);
    expect(validarCamposCausa("problema_horno", {}, undefined)).toEqual([]);
  });

  it("causa desconocida produce error", () => {
    // @ts-expect-error probando con valor inválido
    expect(contiene(validarCamposCausa("inexistente", {}, undefined), "causa desconocida")).toBe(true);
  });
});

describe("ticket 02: registrarParada", () => {
  const inputBase = {
    maquinaId: "M1" as const,
    ordenId: "orden-1",
    operatorName: "Carlos Gómez",
    causaId: "falta_color" as const,
    camposEspecificos: { color: "ROJO" },
    inicio: "2026-09-11T09:00:00.000Z",
  };

  it("registra una parada abierta válida", () => {
    const { parada, errores } = registrarParada([], inputBase);
    expect(errores).toEqual([]);
    expect(parada).toBeDefined();
    expect(parada!.fin).toBeNull();
    expect(parada!.causaId).toBe("falta_color");
    expect(parada!.ordenId).toBe("orden-1");
    expect(parada!.camposEspecificos).toEqual({ color: "ROJO" });
  });

  it("asigna un id único", () => {
    const a = registrarParada([], inputBase);
    const b = registrarParada([], { ...inputBase, inicio: "2026-09-11T10:00:00.000Z" });
    expect(a.parada!.id).not.toBe(b.parada!.id);
  });

  it("rechaza sin causa", () => {
    const { errores } = registrarParada([], { ...inputBase, causaId: "" as never });
    expect(contiene(errores, "debe seleccionar una causa")).toBe(true);
  });

  it("rechaza causa desconocida", () => {
    const { errores } = registrarParada([], { ...inputBase, causaId: "inexistente" as never });
    expect(contiene(errores, "causa desconocida")).toBe(true);
  });

  it("rechaza sin timestamp de inicio", () => {
    const { errores } = registrarParada([], { ...inputBase, inicio: "" });
    expect(contiene(errores, "debe indicar el timestamp de inicio")).toBe(true);
  });

  it("rechaza sin operario", () => {
    const { errores } = registrarParada([], { ...inputBase, operatorName: "" });
    expect(contiene(errores, "operatorName es obligatorio")).toBe(true);
  });

  it("guarda el nombre del operario en el registro", () => {
    const { parada } = registrarParada([], inputBase);
    expect(parada!.operatorName).toBe("Carlos Gómez");
  });

  it("rechaza campos específicos faltantes para la causa", () => {
    const { errores } = registrarParada([], { ...inputBase, camposEspecificos: {} });
    expect(contiene(errores, "falta el campo")).toBe(true);
  });

  it("rechaza 'otro' sin observación", () => {
    const { errores } = registrarParada([], {
      ...inputBase,
      causaId: "otro",
      camposEspecificos: {},
    });
    expect(contiene(errores, "debe indicar una observación")).toBe(true);
  });

  it("rechaza una segunda parada abierta para el mismo orden", () => {
    const primera = registrarParada([], inputBase);
    const { errores } = registrarParada([primera.parada!], inputBase);
    expect(contiene(errores, "ya hay una parada abierta")).toBe(true);
  });

  it("permite parada abierta en un orden distinto", () => {
    const primera = registrarParada([], inputBase);
    const { errores } = registrarParada([primera.parada!], {
      ...inputBase,
      ordenId: "orden-2",
    });
    expect(errores).toEqual([]);
  });

  it("permite registrar parada sin orden (ordenId null)", () => {
    const { parada, errores } = registrarParada([], {
      ...inputBase,
      ordenId: null,
    });
    expect(errores).toEqual([]);
    expect(parada!.ordenId).toBeNull();
  });

  it("una parada abierta sin orden no bloquea una parada con orden", () => {
    const sinOrden = registrarParada([], { ...inputBase, ordenId: null });
    const conOrden = registrarParada([sinOrden.parada!], inputBase);
    expect(conOrden.errores).toEqual([]);
  });

  it("una parada cerrada no bloquea registrar otra", () => {
    const abierta = registrarParada([], inputBase).parada!;
    const cerrada = cerrarParada(abierta, "2026-09-11T09:10:00.000Z").parada!;
    const segunda = registrarParada([cerrada], inputBase);
    expect(segunda.errores).toEqual([]);
  });
});

describe("ticket 02: cerrarParada", () => {
  const abierta: ParadaAbierta = {
    id: "p1",
    maquinaId: "M1",
    ordenId: "orden-1",
    operatorName: "Carlos Gómez",
    causaId: "atasco_tela",
    camposEspecificos: {},
    inicio: "2026-09-11T09:00:00.000Z",
    fin: null,
  };

  it("cierra una parada abierta con timestamp de fin", () => {
    const { parada, errores } = cerrarParada(abierta, "2026-09-11T09:15:00.000Z");
    expect(errores).toEqual([]);
    expect(parada!.fin).toBe("2026-09-11T09:15:00.000Z");
  });

  it("rechaza fin vacío", () => {
    const { errores } = cerrarParada(abierta, "");
    expect(contiene(errores, "debe indicar el timestamp de fin")).toBe(true);
  });

  it("rechaza fin anterior al inicio", () => {
    const { errores } = cerrarParada(abierta, "2026-09-11T08:59:00.000Z");
    expect(contiene(errores, "el timestamp de fin no puede ser anterior al de inicio")).toBe(true);
  });
});

describe("ticket 02: duración de parada", () => {
  it("devuelve null para parada abierta", () => {
    const abierta: Parada = {
      id: "p1",
      maquinaId: "M1",
      ordenId: null,
      operatorName: "Carlos Gómez",
      causaId: "atasco_tela",
      camposEspecificos: {},
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
    };
    expect(duracionParada(abierta)).toBeNull();
  });

  it("calcula segundos entre inicio y fin", () => {
    const cerrada: Parada = {
      id: "p1",
      maquinaId: "M1",
      ordenId: null,
      operatorName: "Carlos Gómez",
      causaId: "atasco_tela",
      camposEspecificos: {},
      inicio: "2026-09-11T09:00:00.000Z",
      fin: "2026-09-11T09:15:30.000Z",
    };
    expect(duracionParada(cerrada)).toBe(930);
  });
});

describe("ticket 02: duración acumulada de parada abierta", () => {
  const abierta: Parada = {
    id: "p1",
    maquinaId: "M1",
    ordenId: "orden-1",
    operatorName: "Carlos Gómez",
    causaId: "atasco_tela",
    camposEspecificos: {},
    inicio: "2026-09-11T09:00:00.000Z",
    fin: null,
  };

  it("calcula los segundos transcurridos desde el inicio", () => {
    expect(duracionAcumulada(abierta, "2026-09-11T09:05:30.000Z")).toBe(330);
    expect(duracionAcumulada(abierta, "2026-09-11T10:15:00.000Z")).toBe(4500);
  });

  it("devuelve null para una parada cerrada", () => {
    const cerrada: Parada = { ...abierta, fin: "2026-09-11T09:10:00.000Z" };
    expect(duracionAcumulada(cerrada, "2026-09-11T10:00:00.000Z")).toBeNull();
  });

  it("devuelve null si el instante es anterior al inicio", () => {
    expect(duracionAcumulada(abierta, "2026-09-11T08:59:00.000Z")).toBeNull();
  });

  it("devuelve null si falta el timestamp del instante", () => {
    expect(duracionAcumulada(abierta, "")).toBeNull();
    expect(duracionAcumulada(abierta, "   ")).toBeNull();
  });
});

describe("ticket 02: paradaAbierta y finalización", () => {
  const abiertaOrden1: Parada = {
    id: "p1",
    maquinaId: "M1",
    ordenId: "orden-1",
    operatorName: "Carlos Gómez",
    causaId: "atasco_tela",
    camposEspecificos: {},
    inicio: "2026-09-11T09:00:00.000Z",
    fin: null,
  };

  it("encuentra la parada abierta de una orden", () => {
    expect(paradaAbierta([abiertaOrden1], "M1", "orden-1")).not.toBeNull();
    expect(paradaAbierta([abiertaOrden1], "M1", "orden-2")).toBeNull();
  });

  it("finalización bloqueada si hay parada abierta de la misma orden", () => {
    expect(contiene(validarFinalizacionConParadas([abiertaOrden1], "orden-1"), "parada abierta")).toBe(true);
  });

  it("las paradas sin orden no bloquean la finalización", () => {
    const sinOrden: Parada = { ...abiertaOrden1, id: "p2", ordenId: null };
    expect(validarFinalizacionConParadas([sinOrden], "orden-1")).toEqual([]);
  });

  it("una parada cerrada no bloquea la finalización", () => {
    const cerrada: Parada = { ...abiertaOrden1, fin: "2026-09-11T09:15:00.000Z" };
    expect(validarFinalizacionConParadas([cerrada], "orden-1")).toEqual([]);
  });
});

describe("ticket 02: validarLecturaConParadas", () => {
  const abiertaOrden1: Parada = {
    id: "p1",
    maquinaId: "M1",
    ordenId: "orden-1",
    operatorName: "Carlos Gómez",
    causaId: "atasco_tela",
    camposEspecificos: {},
    inicio: "2026-09-11T09:00:00.000Z",
    fin: null,
  };

  it("bloquea lecturas si hay parada abierta de la misma orden", () => {
    expect(contiene(validarLecturaConParadas([abiertaOrden1], "orden-1"), "parada abierta")).toBe(true);
  });

  it("no bloquea lecturas si la parada abierta es de otra orden", () => {
    expect(validarLecturaConParadas([abiertaOrden1], "orden-2")).toEqual([]);
  });

  it("las paradas sin orden no bloquean las lecturas", () => {
    const sinOrden: Parada = { ...abiertaOrden1, id: "p2", ordenId: null };
    expect(validarLecturaConParadas([sinOrden], "orden-1")).toEqual([]);
  });

  it("una parada cerrada no bloquea las lecturas", () => {
    const cerrada: Parada = { ...abiertaOrden1, fin: "2026-09-11T09:15:00.000Z" };
    expect(validarLecturaConParadas([cerrada], "orden-1")).toEqual([]);
  });
});