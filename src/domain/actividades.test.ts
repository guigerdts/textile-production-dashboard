/**
 * Pruebas de dominio — ticket 03 (actividades planificadas).
 * Funciones puras de actividades.ts.
 */
import { describe, expect, it } from "vitest";
import {
  actividadAbierta,
  comenzarActividad,
  duracionActividad,
  finalizarActividad,
  getTipoActividadPorId,
  getTiposActividad,
} from "./actividades";
import type { ActividadAbierta, ActividadPlanificada } from "./types";

/** Verifica que ALGÚN mensaje de error contenga el fragmento buscado. */
function contiene(errores: string[], fragmento: string): boolean {
  return errores.some((e) => e.includes(fragmento));
}

describe("ticket 03: catálogo de tipos de actividad", () => {
  it("tiene exactamente 4 tipos predefinidos (incluye almuerzo y pausa)", () => {
    expect(getTiposActividad()).toHaveLength(4);
  });

  it("cada tipo tiene id y nombre", () => {
    for (const tipo of getTiposActividad()) {
      expect(tipo.id).toBeTruthy();
      expect(tipo.nombre).toBeTruthy();
    }
  });

  it("incluye cambio de diseño, limpieza, almuerzo y pausa", () => {
    const ids = getTiposActividad().map((t) => t.id);
    expect(ids).toContain("cambio_diseno");
    expect(ids).toContain("limpieza");
    expect(ids).toContain("almuerzo");
    expect(ids).toContain("pausa");
  });

  it("busca un tipo por id", () => {
    expect(getTipoActividadPorId("limpieza")?.nombre).toBe("Limpieza");
    expect(getTipoActividadPorId("almuerzo")?.nombre).toBe("Almuerzo");
    expect(getTipoActividadPorId("pausa")?.nombre).toBe("Pausa");
    expect(getTipoActividadPorId("no_existe" as never)).toBeUndefined();
  });
});

describe("ticket 03: comenzarActividad", () => {
  const inputBase = {
    maquinaId: "M1" as const,
    tipo: "cambio_diseno" as const,
    inicio: "2026-09-11T09:00:00.000Z",
    operatorName: "Carlos Gómez",
    fechaOperativa: "2026-09-11",
  };

  it("registra una actividad abierta válida (cambio de diseño)", () => {
    const { actividad, errores } = comenzarActividad([], inputBase);
    expect(errores).toEqual([]);
    expect(actividad).toBeDefined();
    expect(actividad!.fin).toBeNull();
    expect(actividad!.tipo).toBe("cambio_diseno");
    expect(actividad!.maquinaId).toBe("M1");
  });

  it("no incluye ordenId en el modelo (actividad independiente de la orden)", () => {
    const { actividad } = comenzarActividad([], inputBase);
    expect(actividad!).not.toHaveProperty("ordenId");
  });

  it("asigna un id único", () => {
    const a = comenzarActividad([], inputBase);
    const b = comenzarActividad([], {
      ...inputBase,
      inicio: "2026-09-11T10:00:00.000Z",
    });
    expect(a.actividad!.id).not.toBe(b.actividad!.id);
  });

  it("rechaza sin tipo", () => {
    const { errores } = comenzarActividad([], { ...inputBase, tipo: "" as never });
    expect(contiene(errores, "debe seleccionar un tipo de actividad")).toBe(true);
  });

  it("rechaza tipo desconocido", () => {
    const { errores } = comenzarActividad([], { ...inputBase, tipo: "inexistente" as never });
    expect(contiene(errores, "tipo de actividad desconocido")).toBe(true);
  });

  it("rechaza sin timestamp de inicio", () => {
    const { errores } = comenzarActividad([], { ...inputBase, inicio: "" });
    expect(contiene(errores, "debe indicar el timestamp de inicio")).toBe(true);
  });

  it("rechaza sin operario", () => {
    const { errores } = comenzarActividad([], { ...inputBase, operatorName: "" });
    expect(contiene(errores, "operatorName es obligatorio")).toBe(true);
  });

  it("guarda el nombre del operario en el registro", () => {
    const { actividad } = comenzarActividad([], inputBase);
    expect(actividad!.operatorName).toBe("Carlos Gómez");
  });

  it("limpieza requiere qué se limpió", () => {
    const { errores } = comenzarActividad([], { ...inputBase, tipo: "limpieza" });
    expect(contiene(errores, "debe indicar qué se limpió")).toBe(true);
  });

  it("limpieza válida con qué se limpió", () => {
    const { actividad, errores } = comenzarActividad([], {
      ...inputBase,
      tipo: "limpieza",
      queSeLimpio: "mesa de estampado",
    });
    expect(errores).toEqual([]);
    expect(actividad!.queSeLimpio).toBe("mesa de estampado");
  });

  it("cambio de diseño no requiere qué se limpió", () => {
    const { actividad, errores } = comenzarActividad([], inputBase);
    expect(errores).toEqual([]);
    expect(actividad!.queSeLimpio).toBeUndefined();
  });

  it("almuerzo no requiere qué se limpió", () => {
    const { actividad, errores } = comenzarActividad([], {
      ...inputBase,
      tipo: "almuerzo",
    });
    expect(errores).toEqual([]);
    expect(actividad!.tipo).toBe("almuerzo");
    expect(actividad!.queSeLimpio).toBeUndefined();
  });

  it("pausa no requiere qué se limpió", () => {
    const { actividad, errores } = comenzarActividad([], {
      ...inputBase,
      tipo: "pausa",
    });
    expect(errores).toEqual([]);
    expect(actividad!.tipo).toBe("pausa");
    expect(actividad!.queSeLimpio).toBeUndefined();
  });

  it("queSeLimpio exclusivo de limpieza: no se guarda en almuerzo incluso si se envía", () => {
    const { actividad, errores } = comenzarActividad([], {
      ...inputBase,
      tipo: "almuerzo",
      queSeLimpio: "mesa",
    });
    expect(errores).toEqual([]);
    expect(actividad!.queSeLimpio).toBeUndefined();
  });

  it("permite una limpieza abierta y un almuerzo abierto simultáneos", () => {
    const almuerzo = comenzarActividad([], {
      ...inputBase,
      tipo: "almuerzo",
    }).actividad!;
    const { actividad, errores } = comenzarActividad([almuerzo], {
      ...inputBase,
      tipo: "limpieza",
      queSeLimpio: "mesa",
    });
    expect(errores).toEqual([]);
    expect(actividad!.tipo).toBe("limpieza");
  });

  it("rechaza una segunda actividad abierta del mismo tipo (almuerzo)", () => {
    const primero = comenzarActividad([], {
      ...inputBase,
      tipo: "almuerzo",
    }).actividad!;
    const { errores } = comenzarActividad([primero], {
      ...inputBase,
      tipo: "almuerzo",
    });
    expect(contiene(errores, "ya hay una actividad abierta")).toBe(true);
  });

  it("observaciones es opcional en ambos tipos", () => {
    // Cambio de diseño sin observaciones
    const sinObs = comenzarActividad([], inputBase);
    expect(sinObs.errores).toEqual([]);
    expect(sinObs.actividad!.observaciones).toBeUndefined();
    // Cambio de diseño con observaciones
    const conObs = comenzarActividad([], { ...inputBase, observaciones: "cambio de cuadro" });
    expect(conObs.errores).toEqual([]);
    expect(conObs.actividad!.observaciones).toBe("cambio de cuadro");
    // Limpieza con observaciones
    const limpia = comenzarActividad([], {
      ...inputBase,
      tipo: "limpieza",
      queSeLimpio: "cuadros",
      observaciones: "limpieza autorizada por gerencia",
    });
    expect(limpia.errores).toEqual([]);
    expect(limpia.actividad!.observaciones).toBe("limpieza autorizada por gerencia");
  });

  it("recorta espacios en operatorName, queSeLimpio y observaciones", () => {
    const { actividad } = comenzarActividad([], {
      ...inputBase,
      operatorName: "  Carlos Gómez  ",
      tipo: "limpieza",
      queSeLimpio: "  mesa  ",
      observaciones: "  con autorización  ",
    });
    expect(actividad!.operatorName).toBe("Carlos Gómez");
    expect(actividad!.queSeLimpio).toBe("mesa");
    expect(actividad!.observaciones).toBe("con autorización");
  });

  it("rechaza una segunda actividad abierta del mismo tipo para la máquina", () => {
    const primera = comenzarActividad([], inputBase);
    const { errores } = comenzarActividad([primera.actividad!], inputBase);
    expect(contiene(errores, "ya hay una actividad abierta")).toBe(true);
  });

  it("permite una limpieza abierta y un cambio de diseño abierto simultáneos", () => {
    const cambio = comenzarActividad([], inputBase).actividad!;
    const { actividad, errores } = comenzarActividad([cambio], {
      ...inputBase,
      tipo: "limpieza",
      queSeLimpio: "mesa",
    });
    expect(errores).toEqual([]);
    expect(actividad!.tipo).toBe("limpieza");
  });

  it("una actividad cerrada no bloquea registrar otra del mismo tipo", () => {
    const abierta = comenzarActividad([], inputBase).actividad!;
    const cerrada = finalizarActividad(abierta, "2026-09-11T09:10:00.000Z").actividad!;
    const segunda = comenzarActividad([cerrada], inputBase);
    expect(segunda.errores).toEqual([]);
  });

  it("no muta las actividades existentes", () => {
    const existentes: ActividadPlanificada[] = [];
    const { actividad } = comenzarActividad(existentes, inputBase);
    expect(actividad).toBeDefined();
    expect(existentes).toHaveLength(0);
  });
});

describe("ticket 03: finalizarActividad", () => {
  const abierta: ActividadAbierta = {
    id: "a1",
    maquinaId: "M1",
    tipo: "cambio_diseno",
    fechaOperativa: "2026-09-11",
    inicio: "2026-09-11T09:00:00.000Z",
    fin: null,
    operatorName: "Carlos Gómez",
  };

  it("cierra una actividad abierta con timestamp de fin", () => {
    const { actividad, errores } = finalizarActividad(abierta, "2026-09-11T09:15:00.000Z");
    expect(errores).toEqual([]);
    expect(actividad!.fin).toBe("2026-09-11T09:15:00.000Z");
    expect(actividad!.tipo).toBe("cambio_diseno");
  });

  it("rechaza fin vacío", () => {
    const { errores } = finalizarActividad(abierta, "");
    expect(contiene(errores, "debe indicar el timestamp de fin")).toBe(true);
  });

  it("rechaza fin anterior al inicio", () => {
    const { errores } = finalizarActividad(abierta, "2026-09-11T08:59:00.000Z");
    expect(contiene(errores, "el timestamp de fin no puede ser anterior al de inicio")).toBe(true);
  });

  it("no muta la actividad original", () => {
    const { actividad } = finalizarActividad(abierta, "2026-09-11T09:15:00.000Z");
    expect(abierta.fin).toBeNull();
    expect(actividad!.fin).toBe("2026-09-11T09:15:00.000Z");
  });
});

describe("ticket 03: duración de actividad", () => {
  it("devuelve null para actividad abierta", () => {
    const abierta: ActividadPlanificada = {
      id: "a1",
      maquinaId: "M1",
      tipo: "cambio_diseno",
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
      operatorName: "Carlos Gómez",
    };
    expect(duracionActividad(abierta)).toBeNull();
  });

  it("calcula segundos entre inicio y fin", () => {
    const cerrada: ActividadPlanificada = {
      id: "a1",
      maquinaId: "M1",
      tipo: "limpieza",
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T07:00:00.000Z",
      fin: "2026-09-11T08:00:00.000Z",
      queSeLimpio: "mesa",
      operatorName: "Carlos Gómez",
    };
    expect(duracionActividad(cerrada)).toBe(3600);
  });
});

describe("ticket 03: actividadAbierta", () => {
  const cambioAbierto: ActividadPlanificada = {
    id: "a1",
    maquinaId: "M1",
    tipo: "cambio_diseno",
    fechaOperativa: "2026-09-11",
    inicio: "2026-09-11T09:00:00.000Z",
    fin: null,
    operatorName: "Carlos Gómez",
  };

  const limpiezaCerrada: ActividadPlanificada = {
    id: "a2",
    maquinaId: "M1",
    tipo: "limpieza",
    fechaOperativa: "2026-09-11",
    inicio: "2026-09-11T07:00:00.000Z",
    fin: "2026-09-11T08:00:00.000Z",
    queSeLimpio: "mesa",
    operatorName: "Carlos Gómez",
  };

  it("encuentra la actividad abierta por máquina y tipo", () => {
    expect(actividadAbierta([cambioAbierto, limpiezaCerrada], "M1", "cambio_diseno")).not.toBeNull();
    expect(actividadAbierta([cambioAbierto, limpiezaCerrada], "M1", "limpieza")).toBeNull();
  });

  it("no confunde tipos ni máquinas", () => {
    expect(actividadAbierta([cambioAbierto], "M2", "cambio_diseno")).toBeNull();
    expect(actividadAbierta([], "M1", "cambio_diseno")).toBeNull();
  });
});