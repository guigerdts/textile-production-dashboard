import { describe, expect, it } from "vitest";
import {
  finalizarProduccion,
  golpesParaUnidades,
  golpesProducidosDesdeLecturas,
  golpesRequeridosOrden,
  iniciarProduccion,
  registrarLectura,
  unidadesObjetivoCon2da,
  unidadesParaGolpes,
  validarPct2da,
  validarProyeccionSegunda,
  validarLecturaValor,
  calcularProgreso,
} from "./calculations";
import type { LecturaContador, Orden } from "./types";

const BASE_TIMESTAMP = "2026-09-11T07:00:00.000Z";

function ordenBase(overrides: Partial<Orden> = {}): Orden {
  return {
    id: "ord-1",
    numeroOrden: "OP-001",
    diseno: "Jessie",
    telaReferencia: "T-100",
    unidadesSolicitadas: 2400,
    aplicaSegunda: false,
    porcentaje2da: 0,
    tipoPintura: "reactiva",
    machineId: "M1",
    fechaOperativa: "2026-09-11",
    estado: "available",
    creadaExternamenteEn: "2026-09-10T10:00:00.000Z",
    lecturas: [],
    ...overrides,
  };
}

describe("golpesParaUnidades", () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 2],
    [5, 2],
    [6, 2],
    [7, 3],
    [9, 3],
    [10, 4],
    [2400, 800],
  ])("%i unidades -> %i golpes", (unidades, esperados) => {
    expect(golpesParaUnidades(unidades)).toBe(esperados);
  });
});

describe("unidadesParaGolpes", () => {
  it.each([
    [0, 0],
    [1, 3],
    [4, 12],
  ])("%i golpes -> %i unidades", (golpes, esperadas) => {
    expect(unidadesParaGolpes(golpes)).toBe(esperadas);
  });
});

describe("unidadesObjetivoCon2da", () => {
  it.each([
    [2400, 0, 2400],
    [2400, 0.05, 2520],
    [100, 0.5, 150],
    [101, 0.05, 107], // ceil(106.05)
  ])("%i solicitadas con 2da %f -> %i objetivo", (solicitadas, pct, esperado) => {
    expect(unidadesObjetivoCon2da(solicitadas, pct)).toBe(esperado);
  });
});

describe("golpesRequeridosOrden", () => {
  it.each([
    [2400, 0, 800],
    [10, 0, 4],
    [2400, 0.05, 840],
  ])("%i solicitadas con 2da %f -> %i golpes requeridos", (solicitadas, pct, esperado) => {
    expect(golpesRequeridosOrden(solicitadas, pct)).toBe(esperado);
  });
});

describe("validarPct2da", () => {
  it("acepta 0 y valores en [0,1)", () => {
    expect(validarPct2da(0)).toEqual([]);
    expect(validarPct2da(0.99)).toEqual([]);
  });
  it("rechaza negativos", () => {
    expect(validarPct2da(-0.1)).not.toEqual([]);
  });
  it("rechaza >= 1 (100%)", () => {
    expect(validarPct2da(1)).not.toEqual([]);
  });
});

describe("validarProyeccionSegunda", () => {
  it("sin segunda: aplicaSegunda = false y porcentaje 0 -> válido", () => {
    expect(validarProyeccionSegunda(false, 0)).toEqual([]);
  });

  it("con segunda: aplicaSegunda = true y 5% (0.05) -> válido", () => {
    expect(validarProyeccionSegunda(true, 0.05)).toEqual([]);
  });

  it("con segunda: aplicaSegunda = true y 0% -> válido (0% explícito permitido)", () => {
    expect(validarProyeccionSegunda(true, 0)).toEqual([]);
  });

  it("aplicaSegunda = false con porcentaje distinto de 0 -> error", () => {
    const errores = validarProyeccionSegunda(false, 0.05);
    expect(errores.length).toBeGreaterThan(0);
  });

  it("porcentaje negativo con segunda aplicada -> error", () => {
    expect(validarProyeccionSegunda(true, -0.1).length).toBeGreaterThan(0);
  });

  it("porcentaje >= 1 con segunda aplicada -> error", () => {
    expect(validarProyeccionSegunda(true, 1).length).toBeGreaterThan(0);
    expect(validarProyeccionSegunda(true, 1.5).length).toBeGreaterThan(0);
  });
});

describe("proyección de segunda en el cálculo (2.400 unidades)", () => {
  it("1. Sin segunda: 2.400 -> objetivo 2.400 -> 800 golpes", () => {
    const objetivo = unidadesObjetivoCon2da(2400, 0);
    const golpes = golpesRequeridosOrden(2400, 0);
    expect(objetivo).toBe(2400);
    expect(golpes).toBe(800);
  });

  it("2. Con segunda al 5%: 2.400 -> objetivo 2.520 -> 840 golpes", () => {
    const objetivo = unidadesObjetivoCon2da(2400, 0.05);
    const golpes = golpesRequeridosOrden(2400, 0.05);
    expect(objetivo).toBe(2520);
    expect(golpes).toBe(840);
  });

  it("3. Con segunda al 3%: 2.400 -> objetivo 2.472 -> 824 golpes", () => {
    const objetivo = unidadesObjetivoCon2da(2400, 0.03);
    const golpes = golpesRequeridosOrden(2400, 0.03);
    expect(objetivo).toBe(2472);
    expect(golpes).toBe(824);
  });
});

describe("validarLecturaValor", () => {
  it("acepta lectura absoluta entera >= 0", () => {
    expect(validarLecturaValor(0)).toEqual([]);
    expect(validarLecturaValor(1250)).toEqual([]);
  });
  it("rechaza negativos", () => {
    expect(validarLecturaValor(-1)).not.toEqual([]);
  });
  it("rechaza valores fraccionarios", () => {
    expect(validarLecturaValor(10.5)).not.toEqual([]);
  });
});

describe("iniciarProduccion", () => {
  it("registra conjuntamente operario, lectura inicial, timestamp y estado", () => {
    const res = iniciarProduccion(ordenBase(), {
      operatorName: "Juan",
      lecturaInicial: 100,
      timestamp: BASE_TIMESTAMP,
    });
    expect(res.errores).toEqual([]);
    expect(res.orden?.estado).toBe("in_production");
    expect(res.orden?.operatorName).toBe("Juan");
    expect(res.orden?.contadorBase).toBe(100);
    expect(res.orden?.iniciadaEn).toBe(BASE_TIMESTAMP);
    expect(res.orden?.lecturas).toEqual([
      { valor: 100, timestamp: BASE_TIMESTAMP, deltaGolpes: 0 },
    ]);
  });

  it("rechaza operario vacío sin mutar la orden", () => {
    const res = iniciarProduccion(ordenBase(), {
      operatorName: "   ",
      lecturaInicial: 100,
      timestamp: BASE_TIMESTAMP,
    });
    expect(res.errores.length).toBeGreaterThan(0);
    expect(res.orden?.estado).toBe("available");
  });

  it("rechaza lectura inicial negativa", () => {
    const res = iniciarProduccion(ordenBase(), {
      operatorName: "Juan",
      lecturaInicial: -5,
      timestamp: BASE_TIMESTAMP,
    });
    expect(res.errores.length).toBeGreaterThan(0);
  });

  it("no permite iniciar una orden ya en producción", () => {
    const iniciada = iniciarProduccion(ordenBase(), {
      operatorName: "Juan",
      lecturaInicial: 100,
      timestamp: BASE_TIMESTAMP,
    }).orden!;
    const res = iniciarProduccion(iniciada, {
      operatorName: "Ana",
      lecturaInicial: 200,
      timestamp: BASE_TIMESTAMP,
    });
    expect(res.errores.length).toBeGreaterThan(0);
  });

  it("no permite iniciar una orden finalizada", () => {
    const finalizada = finalizarProduccion(
      ordenBase({ estado: "in_production", contadorBase: 100, operatorName: "Juan", iniciadaEn: BASE_TIMESTAMP }),
      BASE_TIMESTAMP,
    ).orden!;
    const res = iniciarProduccion(finalizada, {
      operatorName: "Ana",
      lecturaInicial: 300,
      timestamp: BASE_TIMESTAMP,
    });
    expect(res.errores.length).toBeGreaterThan(0);
  });
});

describe("golpesProducidosDesdeLecturas", () => {
  it("suma los deltas entre lecturas, no los valores absolutos", () => {
    const lecturas: LecturaContador[] = [
      { valor: 100, timestamp: BASE_TIMESTAMP, deltaGolpes: 0 },
      { valor: 103, timestamp: BASE_TIMESTAMP, deltaGolpes: 3 },
      { valor: 106, timestamp: BASE_TIMESTAMP, deltaGolpes: 3 },
      { valor: 109, timestamp: BASE_TIMESTAMP, deltaGolpes: 3 },
    ];
    expect(golpesProducidosDesdeLecturas(lecturas)).toBe(9);
  });
});

describe("inmutabilidad del dominio", () => {
  it("iniciarProduccion no muta la orden recibida", () => {
    const original = ordenBase();
    iniciarProduccion(original, {
      operatorName: "Juan",
      lecturaInicial: 100,
      timestamp: BASE_TIMESTAMP,
    });
    expect(original.estado).toBe("available");
    expect(original.operatorName).toBeUndefined();
    expect(original.contadorBase).toBeUndefined();
    expect(original.lecturas).toEqual([]);
  });

  it("registrarLectura no muta la orden recibida", () => {
    const original = iniciarProduccion(ordenBase(), {
      operatorName: "Juan",
      lecturaInicial: 100,
      timestamp: BASE_TIMESTAMP,
    }).orden!;
    const snapshot = JSON.stringify(original);
    registrarLectura(original, { valor: 103, timestamp: BASE_TIMESTAMP });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("finalizarProduccion no muta la orden recibida", () => {
    const original = iniciarProduccion(ordenBase(), {
      operatorName: "Juan",
      lecturaInicial: 100,
      timestamp: BASE_TIMESTAMP,
    }).orden!;
    const snapshot = JSON.stringify(original);
    finalizarProduccion(original, BASE_TIMESTAMP);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("registrarLectura", () => {
  it("rechaza una lectura menor a la última", () => {
    const iniciada = iniciarProduccion(ordenBase(), {
      operatorName: "Juan",
      lecturaInicial: 100,
      timestamp: BASE_TIMESTAMP,
    }).orden!;
    const res = registrarLectura(iniciada, { valor: 99, timestamp: BASE_TIMESTAMP });
    expect(res.errores.length).toBeGreaterThan(0);
    expect(golpesProducidosDesdeLecturas(res.orden?.lecturas ?? [])).toBe(0);
  });

  it("lectura igual -> sinIncremento y delta 0", () => {
    const iniciada = iniciarProduccion(ordenBase(), {
      operatorName: "Juan",
      lecturaInicial: 100,
      timestamp: BASE_TIMESTAMP,
    }).orden!;
    const conAvance = registrarLectura(iniciada, { valor: 103, timestamp: BASE_TIMESTAMP }).orden!;
    const res = registrarLectura(conAvance, { valor: 103, timestamp: BASE_TIMESTAMP });
    expect(res.errores).toEqual([]);
    expect(res.sinIncremento).toBe(true);
    const lecturas = res.orden!.lecturas;
    expect(lecturas).toHaveLength(3);
    // la nueva lectura no modifica la última lectura válida anterior
    expect(lecturas[1].valor).toBe(103);
    expect(lecturas[1].deltaGolpes).toBe(3);
    expect(lecturas[2]).toEqual({ valor: 103, timestamp: BASE_TIMESTAMP, deltaGolpes: 0 });
  });

  it("lectura mayor -> delta respecto de la última lectura válida", () => {
    const iniciada = iniciarProduccion(ordenBase(), {
      operatorName: "Juan",
      lecturaInicial: 100,
      timestamp: BASE_TIMESTAMP,
    }).orden!;
    const tras = registrarLectura(iniciada, { valor: 103, timestamp: BASE_TIMESTAMP }).orden!;
    expect(tras.lecturas.at(-1)?.deltaGolpes).toBe(3);
    expect(golpesProducidosDesdeLecturas(tras.lecturas)).toBe(3);
  });

  it("rechaza lecturas en una orden finalizada", () => {
    const finalizada = finalizarProduccion(
      iniciarProduccion(ordenBase(), {
        operatorName: "Juan",
        lecturaInicial: 100,
        timestamp: BASE_TIMESTAMP,
      }).orden!,
      BASE_TIMESTAMP,
    ).orden!;
    const res = registrarLectura(finalizada, { valor: 110, timestamp: BASE_TIMESTAMP });
    expect(res.errores.length).toBeGreaterThan(0);
  });

  it("rechaza lecturas en una orden que nunca se inició", () => {
    const res = registrarLectura(ordenBase(), { valor: 100, timestamp: BASE_TIMESTAMP });
    expect(res.errores.length).toBeGreaterThan(0);
  });
});

describe("finalizarProduccion", () => {
  it("finaliza con cero golpes y queda registrado", () => {
    const iniciada = iniciarProduccion(ordenBase(), {
      operatorName: "Juan",
      lecturaInicial: 100,
      timestamp: BASE_TIMESTAMP,
    }).orden!;
    const res = finalizarProduccion(iniciada, BASE_TIMESTAMP);
    expect(res.errores).toEqual([]);
    expect(res.orden?.estado).toBe("finished");
    expect(res.orden?.finalizadaEn).toBe(BASE_TIMESTAMP);
    expect(golpesProducidosDesdeLecturas(res.orden?.lecturas ?? [])).toBe(0);
  });

  it("finalizar conserva la producción acumulada", () => {
    const iniciada = iniciarProduccion(ordenBase(), {
      operatorName: "Juan",
      lecturaInicial: 100,
      timestamp: BASE_TIMESTAMP,
    }).orden!;
    const conLectura = registrarLectura(iniciada, {
      valor: 103,
      timestamp: BASE_TIMESTAMP,
    }).orden!;
    const finalizada = finalizarProduccion(conLectura, BASE_TIMESTAMP).orden!;
    expect(finalizada.estado).toBe("finished");
    expect(finalizada.finalizadaEn).toBe(BASE_TIMESTAMP);
    expect(finalizada.lecturas).toHaveLength(2);
    expect(golpesProducidosDesdeLecturas(finalizada.lecturas)).toBe(3);
    expect(unidadesParaGolpes(golpesProducidosDesdeLecturas(finalizada.lecturas))).toBe(9);
  });

  it("no permite finalizar dos veces", () => {
    const finalizada = finalizarProduccion(
      iniciarProduccion(ordenBase(), {
        operatorName: "Juan",
        lecturaInicial: 100,
        timestamp: BASE_TIMESTAMP,
      }).orden!,
      BASE_TIMESTAMP,
    ).orden!;
    const res = finalizarProduccion(finalizada, BASE_TIMESTAMP);
    expect(res.errores.length).toBeGreaterThan(0);
  });

  it("no permite finalizar una orden disponible", () => {
    const res = finalizarProduccion(ordenBase(), BASE_TIMESTAMP);
    expect(res.errores.length).toBeGreaterThan(0);
  });
});

describe("calcularProgreso", () => {
  it("proyecta unidades, restantes y porcentaje sobre el objetivo con 2da", () => {
    const prog = calcularProgreso(9, 2400, 0.05);
    expect(prog.unidadesProducidas).toBe(27);
    expect(prog.unidadesObjetivo).toBe(2520);
    expect(prog.unidadesRestantes).toBe(2493);
    expect(prog.golpesRequeridos).toBe(840);
    expect(prog.golpesRestantes).toBe(831);
    expect(prog.pctCompletado).toBeCloseTo(27 / 2520, 6);
  });
});