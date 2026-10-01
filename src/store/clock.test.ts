import { describe, it, expect } from "vitest";
import { fechaOperativaDe, relojDelSistema } from "./clock";

/**
 * Fija el reloj: un instante UTC concreto se convierte a un instante local
 * equivalente, de modo que la fecha operativa observada depende de la zona
 * horaria real del runner (no de una TZ forzada).
 */
function relojEn(instanteIso: string): () => Date {
  return () => new Date(instanteIso);
}

describe("fechaOperativaDe", () => {
  it("devuelve YYYY-MM-DD", () => {
    expect(fechaOperativaDe(relojEn("2026-09-11T12:00:00.000Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("el día medio de la jornada coincide con la fecha del instante en UTC", () => {
    // Mediodía UTC: en cualquier zona con offset dentro de (-12, +12) el día
    // local es el mismo día del calendario UTC salvo en los bordes extremos,
    // así que fijamos el instante UTC al mediodía para que la comparación sea
    // estable en runners con offset habitual.
    expect(fechaOperativaDe(relojEn("2026-09-11T12:00:00.000Z"))).toBe("2026-09-11");
  });

  it("NO usa la fecha UTC: un instante UTC nocturno puede caer en el día local siguiente", () => {
    // 02:00 UTC. En cualquier zona al oeste de UTC (offset negativo) la hora
    // local es del día ANTERIOR; en zona este (offset positivo), del mismo día.
    // El comportamiento clave: la fecha operativa nunca se deriva del calendario
    // UTC de forma fija, depende del calendario local.
    const instanteUtc = "2026-09-11T02:00:00.000Z";
    const utcSlice = instanteUtc.slice(0, 10); // "2026-09-11" — el bug histórico
    const local = fechaOperativaDe(relojEn(instanteUtc));

    const offsetMin = -new Date(instanteUtc).getTimezoneOffset();
    const esperado =
      offsetMin < 0 ? "2026-09-10" : "2026-09-11"; // oeste de UTC vs este/nivel

    expect(local).toBe(esperado);
    // Si la implementación volviera a toISOString().slice(0,10), fallaría en
    // cualquier runner al oeste de UTC.
    if (offsetMin < 0) {
      expect(local).not.toBe(utcSlice);
    }
  });

  it("un instante UTC de medianoche exacto puede pertenecer al día local anterior", () => {
    // 00:00:00Z del 2026-09-11: en zona al oeste de UTC es 2026-09-10 local.
    const instanteUtc = "2026-09-11T00:00:00.000Z";
    const offsetMin = -new Date(instanteUtc).getTimezoneOffset();
    const esperado = offsetMin < 0 ? "2026-09-10" : "2026-09-11";
    expect(fechaOperativaDe(relojEn(instanteUtc))).toBe(esperado);
  });

  it("relojDelSistema devuelve un Date utilizable por la función por defecto", () => {
    // La función sin argumento debe funcionar con el reloj real del sistema.
    const porDefecto = fechaOperativaDe();
    expect(porDefecto).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Y debe ser la fecha local de ahora mismo, no la UTC.
    const ahora = new Date();
    const esperado = ahora.toLocaleDateString("en-CA");
    expect(porDefecto).toBe(esperado);
  });

  it("relojDelSistema es una función que retorna el instante actual", () => {
    const t1 = relojDelSistema().getTime();
    const t2 = relojDelSistema().getTime();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
});