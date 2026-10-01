/**
 * Pruebas de dominio — ticket 05 (daño / eventos y sospecha de 2da).
 * Funciones puras de danos.ts.
 */
import { describe, expect, it } from "vitest";
import {
  cerrarDano,
  danoAbierto,
  getTipoDanoPorId,
  getTiposDano,
  registrarDano,
} from "./danos";
import type { Dano, DanoAbierto, Parada } from "./types";
import type { RegistrarDanoInput } from "./danos";

/** Verifica que ALGÚN mensaje de error contenga el fragmento buscado. */
function contiene(errores: string[], fragmento: string): boolean {
  return errores.some((e) => e.includes(fragmento));
}

// ---------------------------------------------------------------------------
// Fixtures locales de parada (dominio puro; no depende del store)
// ---------------------------------------------------------------------------

const M1: "M1" = "M1";
const ORDEN_100 = "ord-100";
const ORDEN_200 = "ord-200";

/** Parada cerrada de la orden 100 por daño mecánico (inicio 09:05). */
export const PARADA_M1_ORDEN_100: Parada = {
  id: "par-100",
  maquinaId: M1,
  ordenId: ORDEN_100,
  operatorName: "Carlos Gómez",
  causaId: "danio_mecanico",
  camposEspecificos: { carro: 3, componente: "eje trasero" },
  fechaOperativa: "2026-09-11",
  inicio: "2026-09-11T09:05:00.000Z",
  fin: "2026-09-11T09:30:00.000Z",
};

/** Parada abierta SIN orden (máquina ociosa). */
export const PARADA_M1_SIN_ORDEN: Parada = {
  id: "par-200",
  maquinaId: M1,
  ordenId: null,
  operatorName: "Luis Fernández",
  causaId: "problema_horno",
  camposEspecificos: {},
  fechaOperativa: "2026-09-11",
  inicio: "2026-09-11T09:05:00.000Z",
  fin: null,
};

/** Parada de Otra máquina (M2) — solo para probar coherencia de máquina. */
export const PARADA_M2_ORDEN_100: Parada = {
  ...PARADA_M1_ORDEN_100,
  id: "par-300",
  maquinaId: "M2" as never,
};

/** Parada de la orden 100 que comienza ANTES que un daño a las 09:00. */
export const PARADA_M1_ANTES: Parada = {
  ...PARADA_M1_ORDEN_100,
  id: "par-400",
  inicio: "2026-09-11T08:00:00.000Z",
  fin: "2026-09-11T08:30:00.000Z",
};

// ---------------------------------------------------------------------------
// Input base
// ---------------------------------------------------------------------------

const inputBase: RegistrarDanoInput = {
  maquinaId: M1,
  ordenId: ORDEN_100,
  operatorName: "Carlos Gómez",
  tipo: "mecanico" as const,
  componente: "eje trasero",
  inicio: "2026-09-11T09:00:00.000Z",
  fechaOperativa: "2026-09-11",
  causoParada: false,
  paradaId: null,
  posibleSegunda: false,
};

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

describe("ticket 05: catálogo de tipos de daño", () => {
  it("tiene exactamente 3 tipos predefinidos", () => {
    expect(getTiposDano()).toHaveLength(3);
  });

  it("cada tipo tiene id y nombre", () => {
    for (const tipo of getTiposDano()) {
      expect(tipo.id).toBeTruthy();
      expect(tipo.nombre).toBeTruthy();
    }
  });

  it("incluye los tres tipos del contexto (eléctrico, mecánico, operacional)", () => {
    const ids = getTiposDano().map((t) => t.id);
    expect(ids).toEqual(["electrico", "mecanico", "operacional"]);
  });

  it("busca un tipo por id", () => {
    expect(getTipoDanoPorId("electrico")?.nombre).toBe("Daño eléctrico");
    expect(getTipoDanoPorId("mecanico")?.nombre).toBe("Daño mecánico");
    expect(getTipoDanoPorId("operacional")?.nombre).toBe("Daño operacional");
    expect(getTipoDanoPorId("no_existe" as never)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// registrarDano — happy paths
// ---------------------------------------------------------------------------

describe("ticket 05: registrarDano registra daños abiertos válidos", () => {
  it("registra un daño abierto simple sin parada ni sospecha", () => {
    const { dano, errores } = registrarDano([], inputBase, () => undefined);
    expect(errores).toEqual([]);
    expect(dano).toBeDefined();
    expect(dano!.fin).toBeNull();
    expect(dano!.tipo).toBe("mecanico");
    expect(dano!.componente).toBe("eje trasero");
    expect(dano!.causoParada).toBe(false);
    expect(dano!.paradaId).toBeNull();
    expect(dano!.posibleSegunda).toBe(false);
    expect(dano!.unidadesSospechadas).toBeUndefined();
  });

  it("asigna un id único", () => {
    const a = registrarDano([], inputBase, () => undefined);
    const b = registrarDano([], { ...inputBase, componente: "horno" }, () => undefined);
    expect(a.dano!.id).not.toBe(b.dano!.id);
  });

  it("vincula un daño que causó parada (misma máquina, misma orden, temporalmente coherente)", () => {
    const { dano, errores } = registrarDano(
      [],
      { ...inputBase, causoParada: true, paradaId: "par-100" },
      (id) => (id === "par-100" ? PARADA_M1_ORDEN_100 : undefined),
    );
    expect(errores).toEqual([]);
    expect(dano!.causoParada).toBe(true);
    expect(dano!.paradaId).toBe("par-100");
  });

  it("registra sospecha de segunda cualitativa (sin unidades)", () => {
    const { dano, errores } = registrarDano([], { ...inputBase, posibleSegunda: true }, () => undefined);
    expect(errores).toEqual([]);
    expect(dano!.posibleSegunda).toBe(true);
    expect(dano!.unidadesSospechadas).toBeUndefined();
  });

  it("registra sospecha de segunda con unidades sospechadas", () => {
    const { dano, errores } = registrarDano(
      [],
      { ...inputBase, posibleSegunda: true, unidadesSospechadas: 4 },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(dano!.posibleSegunda).toBe(true);
    expect(dano!.unidadesSospechadas).toBe(4);
  });

  it("permite un daño sin orden (ordenId null, máquina ociosa)", () => {
    const { dano, errores } = registrarDano([], { ...inputBase, ordenId: null }, () => undefined);
    expect(errores).toEqual([]);
    expect(dano!.ordenId).toBeNull();
  });

  it("permite ambos flags a la vez: causó parada Y pudo producir segunda", () => {
    const { dano, errores } = registrarDano(
      [],
      {
        ...inputBase,
        causoParada: true,
        paradaId: "par-100",
        posibleSegunda: true,
        unidadesSospechadas: 2,
      },
      (id) => (id === "par-100" ? PARADA_M1_ORDEN_100 : undefined),
    );
    expect(errores).toEqual([]);
    expect(dano!.causoParada).toBe(true);
    expect(dano!.posibleSegunda).toBe(true);
  });

  it("guarda observaciones y recorta textos", () => {
    const { dano, errores } = registrarDano(
      [],
      {
        ...inputBase,
        operatorName: "  Carlos Gómez  ",
        componente: "  eje trasero  ",
        observaciones: "  vibra al golpear  ",
      },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(dano!.operatorName).toBe("Carlos Gómez");
    expect(dano!.componente).toBe("eje trasero");
    expect(dano!.observaciones).toBe("vibra al golpear");
  });
});

// ---------------------------------------------------------------------------
// registrarDano — validaciones de campos base
// ---------------------------------------------------------------------------

describe("ticket 05: registrarDano valida campos base", () => {
  it("rechaza sin operario", () => {
    const { errores } = registrarDano([], { ...inputBase, operatorName: "" }, () => undefined);
    expect(contiene(errores, "operatorName es obligatorio")).toBe(true);
  });

  it("rechaza sin tipo de daño", () => {
    const { errores } = registrarDano([], { ...inputBase, tipo: "" }, () => undefined);
    expect(contiene(errores, "debe seleccionar un tipo de daño")).toBe(true);
  });

  it("rechaza tipo de daño desconocido", () => {
    // @ts-expect-error probando con valor inválido
    const { errores } = registrarDano([], { ...inputBase, tipo: "hidraulico" }, () => undefined);
    expect(contiene(errores, "tipo de daño desconocido: hidraulico")).toBe(true);
  });

  it("rechaza sin componente afectado", () => {
    const { errores } = registrarDano([], { ...inputBase, componente: "" }, () => undefined);
    expect(contiene(errores, "el componente afectado es obligatorio")).toBe(true);
  });

  it("rechaza sin timestamp de inicio", () => {
    const { errores } = registrarDano([], { ...inputBase, inicio: "" }, () => undefined);
    expect(contiene(errores, "debe indicar el timestamp de inicio")).toBe(true);
  });

  it("rechaza timestamp de inicio inválido", () => {
    const { errores } = registrarDano([], { ...inputBase, inicio: "ayer" }, () => undefined);
    expect(contiene(errores, "el timestamp de inicio no es una fecha válida")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registrarDano — relación declarativa con parada
// ---------------------------------------------------------------------------

describe("ticket 05: relación declarativa daño ↔ parada", () => {
  const lookup = (id: string): Parada | undefined => {
    if (id === "par-100") return PARADA_M1_ORDEN_100;
    if (id === "par-200") return PARADA_M1_SIN_ORDEN;
    if (id === "par-300") return PARADA_M2_ORDEN_100;
    if (id === "par-400") return PARADA_M1_ANTES;
    return undefined;
  };

  it("causoParada true EXIGE parada vinculada", () => {
    const { errores } = registrarDano([], { ...inputBase, causoParada: true, paradaId: null }, lookup);
    expect(contiene(errores, "si el daño causó una parada, debe indicar la parada vinculada")).toBe(true);
  });

  it("rechaza parada vinculada inexistente", () => {
    const { errores } = registrarDano(
      [],
      { ...inputBase, causoParada: true, paradaId: "par-999" },
      lookup,
    );
    expect(contiene(errores, "la parada vinculada no existe: par-999")).toBe(true);
  });

  it("rechaza parada vinculada de otra máquina", () => {
    const { errores } = registrarDano(
      [],
      { ...inputBase, causoParada: true, paradaId: "par-300" },
      lookup,
    );
    expect(contiene(errores, "la parada vinculada pertenece a otra máquina")).toBe(true);
  });

  it("rechaza parada vinculada de otra orden", () => {
    const { errores } = registrarDano(
      [],
      { ...inputBase, ordenId: ORDEN_200, causoParada: true, paradaId: "par-100" },
      lookup,
    );
    expect(contiene(errores, "la parada vinculada no corresponde a la misma orden")).toBe(true);
  });

  it("rechaza parada sin orden cuando el daño tiene orden", () => {
    const { errores } = registrarDano(
      [],
      { ...inputBase, causoParada: true, paradaId: "par-200" },
      lookup,
    );
    expect(contiene(errores, "la parada vinculada no corresponde a la misma orden")).toBe(true);
  });

  it("permite parada sin orden cuando el daño también es sin orden", () => {
    const { dano, errores } = registrarDano(
      [],
      { ...inputBase, ordenId: null, causoParada: true, paradaId: "par-200" },
      lookup,
    );
    expect(errores).toEqual([]);
    expect(dano!.ordenId).toBeNull();
    expect(dano!.paradaId).toBe("par-200");
  });

  it("rechaza parada que comenzó antes que el daño", () => {
    const { errores } = registrarDano(
      [],
      { ...inputBase, causoParada: true, paradaId: "par-400" },
      lookup,
    );
    expect(contiene(errores, "la parada vinculada no puede comenzar antes que el daño")).toBe(true);
  });

  it("causoParada false NO admite parada vinculada", () => {
    const { errores } = registrarDano(
      [],
      { ...inputBase, causoParada: false, paradaId: "par-100" },
      lookup,
    );
    expect(contiene(errores, "si el daño no causó parada, no debe indicar parada vinculada")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registrarDano — sospecha de 2da (registro, nunca clasificación)
// ---------------------------------------------------------------------------

describe("ticket 05: unidad de sospecha de segunda", () => {
  it("posibleSegunda false NO admite unidadesSospechadas", () => {
    const { errores } = registrarDano(
      [],
      { ...inputBase, posibleSegunda: false, unidadesSospechadas: 3 },
      () => undefined,
    );
    expect(
      contiene(errores, "si el daño no produjo sospecha de segunda, unidadesSospechadas debe ser undefined"),
    ).toBe(true);
  });

  it("rechaza unidadesSospechadas negativas", () => {
    const { errores } = registrarDano(
      [],
      { ...inputBase, posibleSegunda: true, unidadesSospechadas: -1 },
      () => undefined,
    );
    expect(contiene(errores, "unidadesSospechadas debe ser un entero mayor o igual a 0")).toBe(true);
  });

  it("rechaza unidadesSospechadas no enteras", () => {
    const { errores } = registrarDano(
      [],
      { ...inputBase, posibleSegunda: true, unidadesSospechadas: 1.5 },
      () => undefined,
    );
    expect(contiene(errores, "unidadesSospechadas debe ser un entero mayor o igual a 0")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registrarDano — restricción operativa: un solo daño abierto por máquina
// ---------------------------------------------------------------------------

describe("ticket 05: un solo daño abierto por máquina (restricción operativa)", () => {
  /** Daño abierto previo en M1 (helper local para construir Dano). */
  function abiertoM1(id: string, ordenId: string | null): DanoAbierto {
    return {
      id,
      maquinaId: M1,
      ordenId,
      operatorName: "Carlos Gómez",
      tipo: "mecanico",
      componente: "eje trasero",
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
      causoParada: false,
      paradaId: null,
      posibleSegunda: false,
    };
  }

  it("rechaza registrar un segundo daño mientras existe uno abierto en M1", () => {
    const { errores } = registrarDano([abiertoM1("d1", ORDEN_100)], inputBase, () => undefined);
    expect(
      contiene(errores, "ya hay un daño abierto para la máquina. Cierre el daño actual antes de registrar otro"),
    ).toBe(true);
  });

  it("un daño CERRADO no bloquea registrar un daño nuevo", () => {
    const cerrado: Dano = { ...abiertoM1("d1", ORDEN_100), fin: "2026-09-11T09:30:00.000Z" };
    const { dano, errores } = registrarDano([cerrado], inputBase, () => undefined);
    expect(errores).toEqual([]);
    expect(dano!.id).not.toBe("d1");
  });
});

// ---------------------------------------------------------------------------
// registrarDano — acumulación de errores
// ---------------------------------------------------------------------------

describe("ticket 05: registrarDano acumula errores", () => {
  it("reporta todos los errores de una sola vez", () => {
    const { errores } = registrarDano(
      [],
      {
        ...inputBase,
        operatorName: "",
        tipo: "",
        componente: "",
        inicio: "",
        causoParada: true,
        paradaId: null,
      },
      () => undefined,
    );
    expect(contiene(errores, "operatorName es obligatorio")).toBe(true);
    expect(contiene(errores, "debe seleccionar un tipo de daño")).toBe(true);
    expect(contiene(errores, "el componente afectado es obligatorio")).toBe(true);
    expect(contiene(errores, "debe indicar el timestamp de inicio")).toBe(true);
    expect(contiene(errores, "si el daño causó una parada, debe indicar la parada vinculada")).toBe(true);
    expect(errores.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// cerrarDano
// ---------------------------------------------------------------------------

describe("ticket 05: cerrarDano", () => {
  const abierta: DanoAbierto = {
    id: "d1",
    maquinaId: M1,
    ordenId: ORDEN_100,
    operatorName: "Carlos Gómez",
    tipo: "mecanico",
    componente: "eje trasero",
    fechaOperativa: "2026-09-11",
    inicio: "2026-09-11T09:00:00.000Z",
    fin: null,
    causoParada: false,
    paradaId: null,
    posibleSegunda: true,
    unidadesSospechadas: 3,
  };

  it("cierra un daño con fin y solución aplicada, preservando el resto", () => {
    const { dano, errores } = cerrarDano(abierta, "2026-09-11T10:10:00.000Z", "Cambio de eje y lubricación");
    expect(errores).toEqual([]);
    expect(dano!.fin).toBe("2026-09-11T10:10:00.000Z");
    expect(dano!.solucionAplicada).toBe("Cambio de eje y lubricación");
    expect(dano!.tipo).toBe("mecanico");
    expect(dano!.paradaId).toBeNull();
    expect(dano!.posibleSegunda).toBe(true);
    expect(dano!.unidadesSospechadas).toBe(3);
  });

  it("rechaza fin vacío", () => {
    const { errores } = cerrarDano(abierta, "", "solución");
    expect(contiene(errores, "debe indicar el timestamp de fin")).toBe(true);
  });

  it("rechaza fin inválido", () => {
    const { errores } = cerrarDano(abierta, "no es fecha", "solución");
    expect(contiene(errores, "el timestamp de fin no es una fecha válida")).toBe(true);
  });

  it("rechaza fin anterior al inicio", () => {
    const { errores } = cerrarDano(abierta, "2026-09-11T08:59:00.000Z", "solución");
    expect(contiene(errores, "el timestamp de fin no puede ser anterior al de inicio")).toBe(true);
  });

  it("permite fin igual al inicio", () => {
    const { errores } = cerrarDano(abierta, "2026-09-11T09:00:00.000Z", "solución");
    expect(errores).toEqual([]);
  });

  it("EXIGE solución aplicada al cerrar", () => {
    const { errores } = cerrarDano(abierta, "2026-09-11T10:10:00.000Z", "   ");
    expect(contiene(errores, "debe indicar la solución aplicada")).toBe(true);
  });

  it("recorta la solución aplicada", () => {
    const { dano } = cerrarDano(abierta, "2026-09-11T10:10:00.000Z", "  Cambio de eje  ");
    expect(dano!.solucionAplicada).toBe("Cambio de eje");
  });
});

// ---------------------------------------------------------------------------
// danoAbierto (consulta)
// ---------------------------------------------------------------------------

describe("ticket 05: danoAbierto", () => {
  const abierta: DanoAbierto = {
    id: "d1",
    maquinaId: M1,
    ordenId: ORDEN_100,
    operatorName: "Carlos Gómez",
    tipo: "mecanico",
    componente: "eje trasero",
    fechaOperativa: "2026-09-11",
    inicio: "2026-09-11T09:00:00.000Z",
    fin: null,
    causoParada: false,
    paradaId: null,
    posibleSegunda: false,
  };

  it("encuentra el daño abierto de la máquina", () => {
    expect(danoAbierto([abierta], M1)?.id).toBe("d1");
  });

  it("devuelve null si no hay daño abierto", () => {
    expect(danoAbierto([], M1)).toBeNull();
  });

  it("devuelve null si el único daño está cerrado", () => {
    const cerrado: Dano = { ...abierta, fin: "2026-09-11T09:30:00.000Z" };
    expect(danoAbierto([cerrado], M1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fechaOperativa — atribución exclusiva del día (operational-event-operative-date)
// ---------------------------------------------------------------------------

describe("ticket 05: fecha operativa — atribución exclusiva del día", () => {
  it("acepta un daño con inicio el mismo día y devuelve la fecha operativa", () => {
    const { dano, errores } = registrarDano(
      [],
      { ...inputBase, inicio: "2026-09-11T23:30:00.000Z" },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(dano!.fechaOperativa).toBe("2026-09-11");
  });

  it("acepta un daño registrado el 11 cuyo inicio ocurre después de medianoche", () => {
    const { dano, errores } = registrarDano(
      [],
      { ...inputBase, inicio: "2026-09-12T01:30:00.000Z", fechaOperativa: "2026-09-11" },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(dano!.fechaOperativa).toBe("2026-09-11");
  });

  it("al cerrar preserva la fecha operativa aunque el fin caiga en un día posterior", () => {
    const { dano: abierto } = registrarDano([], inputBase, () => undefined);
    const { dano: cerrado, errores } = cerrarDano(
      abierto!,
      "2026-09-12T01:30:00.000Z",
      "Ajuste de eje",
    );
    expect(errores).toEqual([]);
    expect(cerrado!.fin).toBe("2026-09-12T01:30:00.000Z");
    expect(cerrado!.fechaOperativa).toBe("2026-09-11");
  });

  it("rechaza la fecha operativa vacía (mismo camino que un valor ausente)", () => {
    const { errores } = registrarDano([], { ...inputBase, fechaOperativa: "" }, () => undefined);
    expect(contiene(errores, "debe indicar la fecha operativa")).toBe(true);
  });

  it("rechaza una fecha operativa con formato distinto a YYYY-MM-DD", () => {
    const dmy = registrarDano(
      [],
      { ...inputBase, fechaOperativa: "11-09-2026" },
      () => undefined,
    );
    expect(contiene(dmy.errores, "la fecha operativa debe tener el formato YYYY-MM-DD")).toBe(true);
    expect(dmy.dano).toBeUndefined();

    const conSlash = registrarDano(
      [],
      { ...inputBase, fechaOperativa: "2026/09/11" },
      () => undefined,
    );
    expect(contiene(conSlash.errores, "la fecha operativa debe tener el formato YYYY-MM-DD")).toBe(true);
    expect(conSlash.dano).toBeUndefined();
  });
});