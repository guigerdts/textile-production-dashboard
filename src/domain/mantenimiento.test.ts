/**
 * Tests de dominio — ticket 08 (mantenimiento reactivo y preventivo).
 * Funciones puras de mantenimiento.ts.
 */
import { describe, expect, it } from "vitest";
import {
  cerrarMantenimiento,
  getTipoMantenimientoPorId,
  getTiposMantenimiento,
  mantenimientoAbierto,
  registrarMantenimiento,
} from "./mantenimiento";
import type { Dano, Mantenimiento, MantenimientoAbierto } from "./types";
import type { RegistrarMantenimientoInput } from "./mantenimiento";

/** Verifica que ALGÚN mensaje de error contenga el fragmento buscado. */
function contiene(errores: string[], fragmento: string): boolean {
  return errores.some((e) => e.includes(fragmento));
}

// ---------------------------------------------------------------------------
// Fixtures locales
// ---------------------------------------------------------------------------

const M1: "M1" = "M1";

const DANO_1: Dano = {
  id: "dano-1",
  maquinaId: M1,
  ordenId: "ord-100",
  operatorName: "Carlos Gómez",
  tipo: "mecanico",
  componente: "eje trasero",
  fechaOperativa: "2026-09-11",
  inicio: "2026-09-11T09:00:00.000Z",
  fin: "2026-09-11T10:00:00.000Z",
  causoParada: false,
  paradaId: null,
  posibleSegunda: false,
};

const inputBaseReactivo: RegistrarMantenimientoInput = {
  maquinaId: M1,
  tipo: "reactivo",
  operatorName: "Carlos Gómez",
  motivo: "Reparación de eje trasero",
  inicio: "2026-09-11T11:00:00.000Z",
  fechaOperativa: "2026-09-11",
  danoId: "dano-1",
};

const inputBasePreventivo: RegistrarMantenimientoInput = {
  maquinaId: M1,
  tipo: "preventivo",
  operatorName: "Carlos Gómez",
  motivo: "Limpieza programada",
  inicio: "2026-09-11T11:00:00.000Z",
  fechaOperativa: "2026-09-11",
  danoId: null,
};

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

describe("ticket 08: catálogo de tipos de mantenimiento", () => {
  it("tiene exactamente 2 tipos predefinidos", () => {
    expect(getTiposMantenimiento()).toHaveLength(2);
  });

  it("cada tipo tiene id y nombre", () => {
    for (const tipo of getTiposMantenimiento()) {
      expect(tipo.id).toBeTruthy();
      expect(tipo.nombre).toBeTruthy();
    }
  });

  it("incluye los dos tipos del contexto (reactivo, preventivo)", () => {
    const ids = getTiposMantenimiento().map((t) => t.id);
    expect(ids).toEqual(["reactivo", "preventivo"]);
  });

  it("busca un tipo por id", () => {
    expect(getTipoMantenimientoPorId("reactivo")?.nombre).toBe(
      "Mantenimiento reactivo",
    );
    expect(getTipoMantenimientoPorId("preventivo")?.nombre).toBe(
      "Mantenimiento preventivo",
    );
  });

  it("devuelve undefined para un tipo desconocido", () => {
    expect(getTipoMantenimientoPorId("inexistente" as never)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// registrarMantenimiento — happy paths (apertura en progreso)
// ---------------------------------------------------------------------------

describe("ticket 08: registrarMantenimiento abre mantenimiento en progreso", () => {
  it("abre un mantenimiento reactivo en progreso (fin = null)", () => {
    const { mantenimiento, errores } = registrarMantenimiento(
      [],
      inputBaseReactivo,
      (id) => (id === "dano-1" ? DANO_1 : undefined),
    );
    expect(errores).toEqual([]);
    expect(mantenimiento).toBeDefined();
    expect(mantenimiento!.fin).toBeNull();
    expect(mantenimiento!.tipo).toBe("reactivo");
    expect(mantenimiento!.danoId).toBe("dano-1");
  });

  it("abre un mantenimiento preventivo en progreso sin danoId", () => {
    const { mantenimiento, errores } = registrarMantenimiento(
      [],
      inputBasePreventivo,
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(mantenimiento!.fin).toBeNull();
    expect(mantenimiento!.tipo).toBe("preventivo");
    expect(mantenimiento!.danoId).toBeNull();
  });

  it("abre un reactivo sin danoId (vínculo opcional)", () => {
    const { mantenimiento, errores } = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, danoId: null },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(mantenimiento!.danoId).toBeNull();
  });

  it("asigna un id único", () => {
    const a = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, danoId: null },
      () => undefined,
    );
    const b = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, danoId: null, motivo: "Otro motivo" },
      () => undefined,
    );
    expect(a.mantenimiento!.id).not.toBe(b.mantenimiento!.id);
  });
});

// ---------------------------------------------------------------------------
// registrarMantenimiento — happy paths (registro completo en un paso)
// ---------------------------------------------------------------------------

describe("ticket 08: registrarMantenimiento registra completo en un paso", () => {
  it("registra un mantenimiento completo con fin y queSeRevisoReparo", () => {
    const { mantenimiento, errores } = registrarMantenimiento(
      [],
      {
        ...inputBaseReactivo,
        fin: "2026-09-11T12:00:00.000Z",
        queSeRevisoReparo: "Se reemplazó el eje y se lubricó",
      },
      (id) => (id === "dano-1" ? DANO_1 : undefined),
    );
    expect(errores).toEqual([]);
    expect(mantenimiento!.fin).toBe("2026-09-11T12:00:00.000Z");
    expect(mantenimiento!.queSeRevisoReparo).toBe(
      "Se reemplazó el eje y se lubricó",
    );
  });

  it("permite fin igual al inicio", () => {
    const { mantenimiento, errores } = registrarMantenimiento(
      [],
      {
        ...inputBasePreventivo,
        fin: "2026-09-11T11:00:00.000Z",
        queSeRevisoReparo: "Limpieza general",
      },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(mantenimiento!.fin).toBe("2026-09-11T11:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// registrarMantenimiento — fin >= inicio
// ---------------------------------------------------------------------------

describe("ticket 08: registrarMantenimiento valida fin >= inicio", () => {
  it("rechaza fin anterior al inicio", () => {
    const { errores } = registrarMantenimiento(
      [],
      {
        ...inputBaseReactivo,
        fin: "2026-09-11T10:59:00.000Z",
        queSeRevisoReparo: "Reparación",
      },
      () => undefined,
    );
    expect(
      contiene(errores, "el timestamp de fin no puede ser anterior al de inicio"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registrarMantenimiento — normalización y validación de campos
// ---------------------------------------------------------------------------

describe("ticket 08: registrarMantenimiento valida y normaliza campos", () => {
  it("rechaza operatorName vacío", () => {
    const { errores } = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, operatorName: "" },
      () => undefined,
    );
    expect(contiene(errores, "operatorName es obligatorio")).toBe(true);
  });

  it("rechaza operatorName con solo espacios", () => {
    const { errores } = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, operatorName: "   " },
      () => undefined,
    );
    expect(contiene(errores, "operatorName es obligatorio")).toBe(true);
  });

  it("rechaza motivo vacío", () => {
    const { errores } = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, motivo: "" },
      () => undefined,
    );
    expect(contiene(errores, "el motivo es obligatorio")).toBe(true);
  });

  it("rechaza motivo con solo espacios", () => {
    const { errores } = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, motivo: "   " },
      () => undefined,
    );
    expect(contiene(errores, "el motivo es obligatorio")).toBe(true);
  });

  it("rechaza inicio vacío", () => {
    const { errores } = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, inicio: "" },
      () => undefined,
    );
    expect(contiene(errores, "debe indicar el timestamp de inicio")).toBe(true);
  });

  it("rechaza inicio inválido", () => {
    const { errores } = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, inicio: "no es fecha" },
      () => undefined,
    );
    expect(
      contiene(errores, "el timestamp de inicio no es una fecha válida"),
    ).toBe(true);
  });

  it("rechaza tipo desconocido", () => {
    const { errores } = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, tipo: "inexistente" as never },
      () => undefined,
    );
    expect(contiene(errores, "tipo de mantenimiento desconocido")).toBe(true);
  });

  it("recorta operatorName y motivo", () => {
    const { mantenimiento, errores } = registrarMantenimiento(
      [],
      {
        ...inputBasePreventivo,
        operatorName: "  Carlos Gómez  ",
        motivo: "  Reparación de eje  ",
      },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(mantenimiento!.operatorName).toBe("Carlos Gómez");
    expect(mantenimiento!.motivo).toBe("Reparación de eje");
  });

  it("normaliza observaciones vacías a undefined", () => {
    const { mantenimiento, errores } = registrarMantenimiento(
      [],
      { ...inputBasePreventivo, observaciones: "   " },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(mantenimiento!.observaciones).toBeUndefined();
  });

  it("recorta observaciones no vacías", () => {
    const { mantenimiento, errores } = registrarMantenimiento(
      [],
      { ...inputBasePreventivo, observaciones: "  algo  " },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(mantenimiento!.observaciones).toBe("algo");
  });
});

// ---------------------------------------------------------------------------
// registrarMantenimiento — queSeRevisoReparo
// ---------------------------------------------------------------------------

describe("ticket 08: registrarMantenimiento valida queSeRevisoReparo", () => {
  it("permite queSeRevisoReparo vacío cuando fin es null (en progreso)", () => {
    const { errores } = registrarMantenimiento(
      [],
      { ...inputBasePreventivo, queSeRevisoReparo: "" },
      () => undefined,
    );
    expect(errores).toEqual([]);
  });

  it("rechaza queSeRevisoReparo vacío cuando fin está presente (completo en un paso)", () => {
    const { errores } = registrarMantenimiento(
      [],
      {
        ...inputBaseReactivo,
        fin: "2026-09-11T12:00:00.000Z",
        queSeRevisoReparo: "",
      },
      () => undefined,
    );
    expect(
      contiene(
        errores,
        "queSeRevisoReparo es obligatorio al cerrar o en registro completo",
      ),
    ).toBe(true);
  });

  it("rechaza queSeRevisoReparo con solo espacios cuando fin está presente", () => {
    const { errores } = registrarMantenimiento(
      [],
      {
        ...inputBaseReactivo,
        fin: "2026-09-11T12:00:00.000Z",
        queSeRevisoReparo: "   ",
      },
      () => undefined,
    );
    expect(
      contiene(
        errores,
        "queSeRevisoReparo es obligatorio al cerrar o en registro completo",
      ),
    ).toBe(true);
  });

  it("recorta queSeRevisoReparo", () => {
    const { mantenimiento, errores } = registrarMantenimiento(
      [],
      {
        ...inputBasePreventivo,
        fin: "2026-09-11T12:00:00.000Z",
        queSeRevisoReparo: "  Revisión completa  ",
      },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(mantenimiento!.queSeRevisoReparo).toBe("Revisión completa");
  });
});

// ---------------------------------------------------------------------------
// registrarMantenimiento — relación reactivo/preventivo con daño
// ---------------------------------------------------------------------------

describe("ticket 08: relación declarativa mantenimiento ↔ daño", () => {
  it("rechaza preventivo con danoId no nulo", () => {
    const { errores } = registrarMantenimiento(
      [],
      { ...inputBasePreventivo, danoId: "dano-1" },
      () => undefined,
    );
    expect(
      contiene(errores, "el mantenimiento preventivo no puede tener danoId"),
    ).toBe(true);
  });

  it("rechaza reactivo con danoId inexistente", () => {
    const { errores } = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, danoId: "dano-999" },
      (id) => (id === "dano-1" ? DANO_1 : undefined),
    );
    expect(contiene(errores, "el daño vinculado no existe: dano-999")).toBe(
      true,
    );
  });

  it("permite reactivo sin danoId", () => {
    const { mantenimiento, errores } = registrarMantenimiento(
      [],
      { ...inputBaseReactivo, danoId: null },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(mantenimiento!.danoId).toBeNull();
  });

  it("preventivo siempre tiene danoId null independientemente del input", () => {
    const { mantenimiento, errores } = registrarMantenimiento(
      [],
      { ...inputBasePreventivo, danoId: null },
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(mantenimiento!.danoId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// registrarMantenimiento — restricción operativa: un solo abierto por máquina
// ---------------------------------------------------------------------------

describe("ticket 08: un solo mantenimiento abierto por máquina", () => {
  function abiertoM1(id: string): MantenimientoAbierto {
    return {
      id,
      maquinaId: M1,
      tipo: "reactivo",
      operatorName: "Carlos Gómez",
      motivo: "Reparación previa",
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T08:00:00.000Z",
      fin: null,
      danoId: null,
    };
  }

  it("rechaza registrar un segundo mantenimiento mientras existe uno abierto en M1", () => {
    const { errores } = registrarMantenimiento(
      [abiertoM1("m1")],
      inputBaseReactivo,
      () => undefined,
    );
    expect(
      contiene(
        errores,
        "ya hay un mantenimiento abierto para la máquina. Cierre el actual antes de registrar otro",
      ),
    ).toBe(true);
  });

  it("un mantenimiento CERRADO no bloquea registrar uno nuevo", () => {
    const cerrado: Mantenimiento = {
      ...abiertoM1("m1"),
      fin: "2026-09-11T09:00:00.000Z",
      queSeRevisoReparo: "Reparado",
    };
    const { mantenimiento, errores } = registrarMantenimiento(
      [cerrado],
      inputBasePreventivo,
      () => undefined,
    );
    expect(errores).toEqual([]);
    expect(mantenimiento!.id).not.toBe("m1");
  });
});

// ---------------------------------------------------------------------------
// cerrarMantenimiento
// ---------------------------------------------------------------------------

describe("ticket 08: cerrarMantenimiento", () => {
  const abierto: MantenimientoAbierto = {
    id: "m1",
    maquinaId: M1,
    tipo: "reactivo",
    operatorName: "Carlos Gómez",
    motivo: "Reparación de eje",
    fechaOperativa: "2026-09-11",
    inicio: "2026-09-11T11:00:00.000Z",
    fin: null,
    danoId: "dano-1",
  };

  it("cierra un mantenimiento devolviendo un NUEVO registro (inmutabilidad)", () => {
    const { mantenimiento: cerrado, errores } = cerrarMantenimiento(
      abierto,
      "2026-09-11T12:00:00.000Z",
      "Se reemplazó el eje",
    );
    expect(errores).toEqual([]);
    expect(cerrado).toBeDefined();
    expect(cerrado).not.toBe(abierto); // referencia distinta
    expect(cerrado!.fin).toBe("2026-09-11T12:00:00.000Z");
    expect(cerrado!.queSeRevisoReparo).toBe("Se reemplazó el eje");
    expect(cerrado!.id).toBe(abierto.id);
    expect(cerrado!.tipo).toBe(abierto.tipo);
    expect(cerrado!.motivo).toBe(abierto.motivo);
    expect(cerrado!.operatorName).toBe(abierto.operatorName);
    expect(cerrado!.inicio).toBe(abierto.inicio);
    expect(cerrado!.danoId).toBe(abierto.danoId);
    // El original NO fue mutado
    expect(abierto.fin).toBeNull();
    expect(abierto.queSeRevisoReparo).toBeUndefined();
  });

  it("rechaza fin vacío", () => {
    const { errores } = cerrarMantenimiento(abierto, "", "reparación");
    expect(contiene(errores, "debe indicar el timestamp de fin")).toBe(true);
  });

  it("rechaza fin inválido", () => {
    const { errores } = cerrarMantenimiento(
      abierto,
      "no es fecha",
      "reparación",
    );
    expect(
      contiene(errores, "el timestamp de fin no es una fecha válida"),
    ).toBe(true);
  });

  it("rechaza fin anterior al inicio", () => {
    const { errores } = cerrarMantenimiento(
      abierto,
      "2026-09-11T10:59:00.000Z",
      "reparación",
    );
    expect(
      contiene(errores, "el timestamp de fin no puede ser anterior al de inicio"),
    ).toBe(true);
  });

  it("permite fin igual al inicio", () => {
    const { errores } = cerrarMantenimiento(
      abierto,
      "2026-09-11T11:00:00.000Z",
      "reparación",
    );
    expect(errores).toEqual([]);
  });

  it("EXIGE queSeRevisoReparo al cerrar", () => {
    const { errores } = cerrarMantenimiento(
      abierto,
      "2026-09-11T12:00:00.000Z",
      "   ",
    );
    expect(
      contiene(errores, "queSeRevisoReparo es obligatorio al cerrar"),
    ).toBe(true);
  });

  it("recorta queSeRevisoReparo", () => {
    const { mantenimiento: cerrado } = cerrarMantenimiento(
      abierto,
      "2026-09-11T12:00:00.000Z",
      "  Revisión completa  ",
    );
    expect(cerrado!.queSeRevisoReparo).toBe("Revisión completa");
  });

  it("preserva observaciones del mantenimiento abierto", () => {
    const conObs: MantenimientoAbierto = {
      ...abierto,
      observaciones: "algo",
    };
    const { mantenimiento: cerrado } = cerrarMantenimiento(
      conObs,
      "2026-09-11T12:00:00.000Z",
      "reparación",
    );
    expect(cerrado!.observaciones).toBe("algo");
  });
});

// ---------------------------------------------------------------------------
// mantenimientoAbierto (consulta)
// ---------------------------------------------------------------------------

describe("ticket 08: mantenimientoAbierto", () => {
  const abierto: MantenimientoAbierto = {
    id: "m1",
    maquinaId: M1,
    tipo: "reactivo",
    operatorName: "Carlos Gómez",
    motivo: "Reparación",
    fechaOperativa: "2026-09-11",
    inicio: "2026-09-11T11:00:00.000Z",
    fin: null,
    danoId: null,
  };

  it("encuentra el mantenimiento abierto de la máquina", () => {
    expect(mantenimientoAbierto([abierto], M1)?.id).toBe("m1");
  });

  it("devuelve null si no hay mantenimientos", () => {
    expect(mantenimientoAbierto([], M1)).toBeNull();
  });

  it("devuelve null si el único mantenimiento está cerrado", () => {
    const cerrado: Mantenimiento = {
      ...abierto,
      fin: "2026-09-11T12:00:00.000Z",
      queSeRevisoReparo: "Reparado",
    };
    expect(mantenimientoAbierto([cerrado], M1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// registrarMantenimiento — acumulación de errores
// ---------------------------------------------------------------------------

describe("ticket 08: registrarMantenimiento acumula errores", () => {
  it("reporta todos los errores de una sola vez", () => {
    const { errores } = registrarMantenimiento(
      [],
      {
        maquinaId: M1,
        tipo: "" as never,
        operatorName: "",
        motivo: "",
        inicio: "",
        fechaOperativa: "2026-09-11",
        danoId: null,
      },
      () => undefined,
    );
    expect(errores.length).toBeGreaterThanOrEqual(4);
  });
});
