/**
 * Tests del seam de dominio — ticket 06 (proyección de 2da / alerta / buena racha).
 * Casos exigidos: 0 unidades producidas, 3 % exacto, valores superiores al 3 %,
 * cero sospechas y valores decimales.
 */
import { describe, expect, it } from "vitest";
import {
  META_MENSUAL_2DA,
  UMBRAL_ALERTA_2DA,
  proyeccionSegundaDeOrden,
  proyeccionSegundaProducida,
} from "./calidad";
import type { Dano, LecturaContador, Orden } from "./types";
import { InMemoryDanoRepository } from "../store/inMemoryDanosRepository";
import {
  DANO_1_CERRADO_CON_PARADA,
  DANO_2_CERRADO_SIN_PARADA,
  DANO_3_ABIERTO,
  DANO_4_SIN_ORDEN_CERRADO,
} from "../store/danosFixtures";

describe("ticket 06: constantes aprobadas", () => {
  it("UMBRAL_ALERTA_2DA es 3 % (0.03)", () => {
    expect(UMBRAL_ALERTA_2DA).toBe(0.03);
  });

  it("META_MENSUAL_2DA es 5 % (0.05)", () => {
    expect(META_MENSUAL_2DA).toBe(0.05);
  });
});

describe("ticket 06: proyeccionSegundaProducida", () => {
  it("0 unidades producidas -> sin_datos (sin división por cero, sin alerta, sin buena racha)", () => {
    const r = proyeccionSegundaProducida(0, 10);
    expect(r).toEqual({
      pct: null,
      estado: "sin_datos",
      dentroUmbral: null,
    });
  });

  it("0 producidas y 0 sospechas -> sin_datos (no hay producción)", () => {
    const r = proyeccionSegundaProducida(0, 0);
    expect(r.estado).toBe("sin_datos");
    expect(r.pct).toBeNull();
    expect(r.dentroUmbral).toBeNull();
  });

  it("producción sin daños -> proyección 0 % en buena racha", () => {
    const r = proyeccionSegundaProducida(300, 0);
    expect(r.pct).toBe(0);
    expect(r.estado).toBe("buena_racha");
    expect(r.dentroUmbral).toBe(true);
  });

  it("3 % EXACTO -> buena_racha (no genera alerta)", () => {
    // 9 sospechadas de 300 producidas = 0.03 exactamente.
    const r = proyeccionSegundaProducida(300, 9);
    expect(r.pct).toBe(0.03);
    expect(r.estado).toBe("buena_racha");
    expect(r.dentroUmbral).toBe(true);
  });

  it("poco menos de 3 % -> buena_racha", () => {
    const r = proyeccionSegundaProducida(100, 2);
    expect(r.pct).toBe(0.02);
    expect(r.estado).toBe("buena_racha");
    expect(r.dentroUmbral).toBe(true);
  });

  it("estrictamente superior a 3 % -> alerta", () => {
    const r = proyeccionSegundaProducida(100, 4);
    expect(r.pct).toBe(0.04);
    expect(r.estado).toBe("alerta");
    expect(r.dentroUmbral).toBe(false);
  });

  it("valores decimales: 1 sospechada en 33 producidas supera levemente el 3 %", () => {
    const r = proyeccionSegundaProducida(33, 1);
    expect(r.pct).toBeCloseTo(1 / 33, 10);
    expect(r.pct!).toBeGreaterThan(0.03);
    expect(r.estado).toBe("alerta");
    expect(r.dentroUmbral).toBe(false);
  });

  it("valores decimales: 1 sospechada en 40 producidas queda en 2.5 % (buena racha)", () => {
    const r = proyeccionSegundaProducida(40, 1);
    expect(r.pct).toBe(0.025);
    expect(r.estado).toBe("buena_racha");
    expect(r.dentroUmbral).toBe(true);
  });

  it("la proyección no recorta ni redondea pct (precisión exacta)", () => {
    const r = proyeccionSegundaProducida(7, 1);
    expect(r.pct).toBeCloseTo(1 / 7, 12);
  });

  it("producción negativa (invariante roto) cae a sin_datos, no divide por cero", () => {
    const r = proyeccionSegundaProducida(-5, 2);
    expect(r).toEqual({ pct: null, estado: "sin_datos", dentroUmbral: null });
  });
});

// ---------------------------------------------------------------------------
// Ciclo 2 — integración calculada
// ---------------------------------------------------------------------------

/** Orden en producción con lecturas: 100 golpes acumulados -> 300 unidades. */
function ordenEnProduccion300(overrides: Partial<Orden> = {}): Orden {
  const lecturas: LecturaContador[] = [
    { valor: 1000, timestamp: "2026-09-11T07:00:00.000Z", deltaGolpes: 0 },
    { valor: 1100, timestamp: "2026-09-11T09:00:00.000Z", deltaGolpes: 100 },
  ];
  return {
    id: "ord-101",
    numeroOrden: "OP-101",
    diseno: "Jessie",
    telaReferencia: "T-100",
    unidadesSolicitadas: 2400,
    aplicaSegunda: true,
    porcentaje2da: 0.05, // segunda PLANIFICADA; no debe influir en la proyección
    tipoPintura: "reactiva",
    machineId: "M1",
    fechaOperativa: "2026-09-11",
    estado: "in_production",
    creadaExternamenteEn: "2026-09-10T10:00:00.000Z",
    contadorBase: 1000,
    lecturas,
    ...overrides,
  };
}

function danoConSospecha(
  overrides: Partial<Dano> = {},
): Dano {
  return {
    id: "dan-c2-01",
    maquinaId: "M1",
    ordenId: "ord-101",
    operatorName: "Carlos Gómez",
    tipo: "operacional",
    componente: "mesa",
    inicio: "2026-09-11T08:30:00.000Z",
    fin: "2026-09-11T08:45:00.000Z",
    solucionAplicada: "Ajuste",
    causoParada: false,
    paradaId: null,
    posibleSegunda: true,
    unidadesSospechadas: 9,
    observaciones: "sospecha cuantificada",
    ...overrides,
  };
}

describe("ticket 06 ciclo 2: proyeccionSegundaDeOrden (integracion calculada)", () => {
  it("obtiene el progreso actual de la orden con la lógica existente (golpes -> 3 toallas por golpe)", () => {
    const orden = ordenEnProduccion300();
    const r = proyeccionSegundaDeOrden(orden, []);
    expect(r.unidadesProducidas).toBe(300);
    expect(r.proyeccion.pct).toBe(0);
    expect(r.proyeccion.estado).toBe("buena_racha");
  });

  it("considera únicamente daños de la orden actual y con posibleSegunda === true", () => {
    const orden = ordenEnProduccion300();
    const danos: Dano[] = [
      danoConSospecha({ id: "d1", unidadesSospechadas: 9 }), // cuenta
      danoConSospecha({ id: "d2", posibleSegunda: false }), // no cuenta (sin sospecha)
      danoConSospecha({ id: "d3", ordenId: "ord-999" }), // otra orden: no cuenta
      danoConSospecha({ id: "d4", ordenId: null }), // sin orden: no cuenta
    ];
    const r = proyeccionSegundaDeOrden(orden, danos);
    expect(r.unidadesSospechadas).toBe(9);
    expect(r.proyeccion.pct).toBe(0.03);
    expect(r.proyeccion.estado).toBe("buena_racha"); // 3% EXACTO
  });

  it("suma únicamente unidadesSospechadas definidas; la sospecha sin unidades NO aporta número", () => {
    const orden = ordenEnProduccion300();
    const danos: Dano[] = [
      danoConSospecha({ id: "d1", unidadesSospechadas: 6 }),
      // Sospecha cualitativa: posibleSegunda true pero sin unidades definidas.
      danoConSospecha({ id: "d2", unidadesSospechadas: undefined }),
    ];
    const r = proyeccionSegundaDeOrden(orden, danos);
    expect(r.unidadesSospechadas).toBe(6);
    expect(r.danosConSospechaSinUnidades).toBe(1);
    expect(r.proyeccion.pct).toBe(0.02);
    expect(r.proyeccion.estado).toBe("buena_racha");
  });

  it("los daños con sospecha SIN unidades quedan visibles para la UI pero sin aporte numérico", () => {
    const orden = ordenEnProduccion300();
    const danos: Dano[] = [
      danoConSospecha({ id: "d1", unidadesSospechadas: undefined }),
      danoConSospecha({ id: "d2", unidadesSospechadas: undefined }),
    ];
    const r = proyeccionSegundaDeOrden(orden, danos);
    expect(r.danosConSospechaSinUnidades).toBe(2);
    expect(r.unidadesSospechadas).toBe(0);
    expect(r.proyeccion.pct).toBe(0);
  });

  it("no muta los daños de entrada ni la orden", () => {
    const orden = ordenEnProduccion300();
    const danos: Dano[] = [danoConSospecha({ id: "d1", unidadesSospechadas: 9 })];
    const ordenAntes = structuredClone(orden);
    const danosAntes = structuredClone(danos);
    proyeccionSegundaDeOrden(orden, danos);
    expect(orden).toEqual(ordenAntes);
    expect(danos).toEqual(danosAntes);
  });

  it("no modifica porcentaje2da, lecturas ni estado de la orden (segunda planificada separada)", () => {
    const orden = ordenEnProduccion300();
    proyeccionSegundaDeOrden(orden, [danoConSospecha({ id: "d1", unidadesSospechadas: 9 })]);
    expect(orden.porcentaje2da).toBe(0.05); // planificada intacta
    expect(orden.lecturas).toHaveLength(2);
    expect(orden.estado).toBe("in_production");
    expect(orden.unidadesSolicitadas).toBe(2400);
  });

  it("con producción cero (sin lecturas) devuelve sin_datos aunque existan sospechas", () => {
    const orden = ordenEnProduccion300({ lecturas: [] });
    const r = proyeccionSegundaDeOrden(orden, [danoConSospecha({ id: "d1", unidadesSospechadas: 9 })]);
    expect(r.unidadesProducidas).toBe(0);
    expect(r.proyeccion).toEqual({ pct: null, estado: "sin_datos", dentroUmbral: null });
  });

  it("con producción y sin daños cuantificados devuelve 0 % en buena racha", () => {
    const orden = ordenEnProduccion300(); // 300 unidades
    const r = proyeccionSegundaDeOrden(orden, []);
    expect(r.unidadesSospechadas).toBe(0);
    expect(r.proyeccion.pct).toBe(0);
    expect(r.proyeccion.estado).toBe("buena_racha");
    expect(r.proyeccion.dentroUmbral).toBe(true);
  });

  it("delega el umbral estricto al dominio: > 3 % genera alerta", () => {
    const orden = ordenEnProduccion300();
    // 12 sospechadas / 300 = 0.04 > 0.03
    const r = proyeccionSegundaDeOrden(orden, [danoConSospecha({ id: "d1", unidadesSospechadas: 12 })]);
    expect(r.proyeccion.pct).toBe(0.04);
    expect(r.proyeccion.estado).toBe("alerta");
    expect(r.proyeccion.dentroUmbral).toBe(false);
  });

  it("agrega sospechas de múltiples daños cuantificados", () => {
    const orden = ordenEnProduccion300();
    const danos: Dano[] = [
      danoConSospecha({ id: "d1", unidadesSospechadas: 3 }),
      danoConSospecha({ id: "d2", unidadesSospechadas: 6 }),
    ];
    const r = proyeccionSegundaDeOrden(orden, danos);
    expect(r.unidadesSospechadas).toBe(9);
    expect(r.proyeccion.pct).toBe(0.03);
  });

  it("integra la consulta real del repositorio (listarPorOrden) con el seam", () => {
    const repo = new InMemoryDanoRepository([
      DANO_1_CERRADO_CON_PARADA, // ord-101, posibleSegunda true, 3 unidades
      DANO_2_CERRADO_SIN_PARADA, // ord-101, posibleSegunda false
      DANO_3_ABIERTO, // ord-102 → no debe contar para ord-101
      DANO_4_SIN_ORDEN_CERRADO, // sin orden → nunca aparece en listarPorOrden
    ]);
    const orden = ordenEnProduccion300(); // 300 unidades
    const danosDeOrden = repo.listarPorOrden(orden.id);
    expect(danosDeOrden.map((d) => d.id)).toEqual(["dan-001", "dan-002"]);
    const r = proyeccionSegundaDeOrden(orden, danosDeOrden);
    expect(r.danosConSospechaSinUnidades).toBe(0);
    expect(r.unidadesSospechadas).toBe(3);
    expect(r.proyeccion.pct).toBe(0.01);
    expect(r.proyeccion.estado).toBe("buena_racha");
  });

  it("integra daños sin unidades reales del repositorio: visibles, sin aporte numérico", () => {
    const sospechaSinUnidades: Dano = {
      ...DANO_3_ABIERTO, // inicialmente otra orden
      id: "dan-c2-99",
      ordenId: "ord-101", // ahora pertenece a la orden en producción
    };
    const repo = new InMemoryDanoRepository([sospechaSinUnidades]);
    const orden = ordenEnProduccion300();
    const r = proyeccionSegundaDeOrden(orden, repo.listarPorOrden(orden.id));
    expect(r.danosConSospechaSinUnidades).toBe(1);
    expect(r.unidadesSospechadas).toBe(0);
    expect(r.proyeccion.pct).toBe(0);
    expect(r.proyeccion.estado).toBe("buena_racha");
  });
});