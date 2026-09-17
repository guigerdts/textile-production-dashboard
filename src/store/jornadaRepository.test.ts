/**
 * Pruebas de repositorio — ticket 04 (jornada del turno en memoria).
 * Cubre: default por fecha, guardar/recuperar, aislamiento por fecha,
 * validación de jornada (fin > inicio) y de fecha operativa (YYYY-MM-DD),
 * y copia defensiva (sin contaminación por referencias mutables).
 */
import { describe, expect, it } from "vitest";
import { InMemoryJornadaRepository } from "./inMemoryJornadaRepository";
import { jornadaDefault } from "../domain/tiempo";
import type { JornadaTurno } from "../domain/types";

/** Fecha operativa de referencia del turno de producción. */
const FECHA = "2026-09-11";

/** Jornada con overtime: fin real extendido a 19:00. */
const JORNADA_OVERTIME: JornadaTurno = {
  inicio: "2026-09-11T07:00:00.000Z",
  fin: "2026-09-11T19:00:00.000Z",
};

describe("InMemoryJornadaRepository — obtenerParaFecha", () => {
  it("devuelve la jornada default (07:00–17:00) cuando no hay registro", () => {
    const repo = new InMemoryJornadaRepository();
    expect(repo.obtenerParaFecha(FECHA)).toEqual(jornadaDefault(FECHA));
  });

  it("devuelve la jornada guardada para la fecha", () => {
    const repo = new InMemoryJornadaRepository();
    repo.guardarJornada(FECHA, JORNADA_OVERTIME);
    expect(repo.obtenerParaFecha(FECHA)).toEqual(JORNADA_OVERTIME);
  });

  it("respeta el default para una fecha sin guardar aunque otra fecha tenga registro", () => {
    const repo = new InMemoryJornadaRepository([
      { fechaOperativa: FECHA, jornada: JORNADA_OVERTIME },
    ]);
    expect(repo.obtenerParaFecha("2026-09-15")).toEqual(jornadaDefault("2026-09-15"));
  });

  it("un día guardado no contamina otro día (clave por fecha operativa)", () => {
    const repo = new InMemoryJornadaRepository();
    repo.guardarJornada(FECHA, JORNADA_OVERTIME);
    const otro = repo.obtenerParaFecha("2026-09-15");
    expect(otro.fin).toBe("2026-09-15T17:00:00.000Z");
    expect(repo.obtenerParaFecha(FECHA).fin).toBe("2026-09-11T19:00:00.000Z");
  });
});

describe("InMemoryJornadaRepository — guardarJornada", () => {
  it("guarda y luego sobrescribe la jornada del turno", () => {
    const repo = new InMemoryJornadaRepository();
    repo.guardarJornada(FECHA, JORNADA_OVERTIME);
    const extendida: JornadaTurno = {
      inicio: "2026-09-11T07:00:00.000Z",
      fin: "2026-09-11T20:00:00.000Z",
    };
    repo.guardarJornada(FECHA, extendida);
    expect(repo.obtenerParaFecha(FECHA).fin).toBe("2026-09-11T20:00:00.000Z");
  });

  it("rechaza una jornada con fin anterior al inicio (delega validarJornada)", () => {
    const repo = new InMemoryJornadaRepository();
    const invalida: JornadaTurno = {
      inicio: "2026-09-11T17:00:00.000Z",
      fin: "2026-09-11T07:00:00.000Z",
    };
    expect(() => repo.guardarJornada(FECHA, invalida)).toThrow(
      "el fin de la jornada debe ser posterior al inicio",
    );
  });

  it("rechaza una jornada con fin igual al inicio", () => {
    const repo = new InMemoryJornadaRepository();
    const invalida: JornadaTurno = {
      inicio: "2026-09-11T07:00:00.000Z",
      fin: "2026-09-11T07:00:00.000Z",
    };
    expect(() => repo.guardarJornada(FECHA, invalida)).toThrow(
      "el fin de la jornada debe ser posterior al inicio",
    );
  });

  it("rechaza una jornada sin fin", () => {
    const repo = new InMemoryJornadaRepository();
    const invalida: JornadaTurno = {
      inicio: "2026-09-11T07:00:00.000Z",
      fin: "",
    };
    expect(() => repo.guardarJornada(FECHA, invalida)).toThrow(
      "debe indicar el fin de la jornada",
    );
  });

  it("rechaza una fecha operativa que no sea YYYY-MM-DD", () => {
    const repo = new InMemoryJornadaRepository();
    for (const invalida of ["11-09-2026", "2026/09/11", "20260911", ""]) {
      expect(() => repo.guardarJornada(invalida, JORNADA_OVERTIME)).toThrow(
        "fecha operativa inválida",
      );
    }
  });

  it("no persiste una jornada inválida (rechazada)", () => {
    const repo = new InMemoryJornadaRepository();
    const invalida: JornadaTurno = {
      inicio: "2026-09-11T17:00:00.000Z",
      fin: "2026-09-11T07:00:00.000Z",
    };
    expect(() => repo.guardarJornada(FECHA, invalida)).toThrow();
    expect(repo.obtenerParaFecha(FECHA)).toEqual(jornadaDefault(FECHA));
  });
});

describe("InMemoryJornadaRepository — copia defensiva", () => {
  it("mutar el resultado devuelto no contamina el repositorio", () => {
    const repo = new InMemoryJornadaRepository();
    repo.guardarJornada(FECHA, JORNADA_OVERTIME);
    const copia = repo.obtenerParaFecha(FECHA);
    copia.fin = "2050-01-01T00:00:00.000Z";
    expect(repo.obtenerParaFecha(FECHA).fin).toBe("2026-09-11T19:00:00.000Z");
  });

  it("cada llamada a obtenerParaFecha devuelve una copia independiente", () => {
    const repo = new InMemoryJornadaRepository();
    repo.guardarJornada(FECHA, JORNADA_OVERTIME);
    const a = repo.obtenerParaFecha(FECHA);
    const b = repo.obtenerParaFecha(FECHA);
    a.fin = "2050-01-01T00:00:00.000Z";
    expect(b.fin).toBe("2026-09-11T19:00:00.000Z");
  });

  it("mutar la jornada pasada a guardarJornada no contamina el repositorio", () => {
    const repo = new InMemoryJornadaRepository();
    const jornada = { ...JORNADA_OVERTIME };
    repo.guardarJornada(FECHA, jornada);
    jornada.fin = "2050-01-01T00:00:00.000Z";
    expect(repo.obtenerParaFecha(FECHA).fin).toBe("2026-09-11T19:00:00.000Z");
  });

  it("mutar el seed del constructor no contamina el repositorio", () => {
    const seed = [{ fechaOperativa: FECHA, jornada: { ...JORNADA_OVERTIME } }];
    const repo = new InMemoryJornadaRepository(seed);
    seed[0].jornada.fin = "2050-01-01T00:00:00.000Z";
    expect(repo.obtenerParaFecha(FECHA).fin).toBe("2026-09-11T19:00:00.000Z");
  });

  it("el repositorio vacío no expone cálculos derivados (solo guarda/obtiene)", () => {
    const repo = new InMemoryJornadaRepository();
    expect(typeof repo.obtenerParaFecha).toBe("function");
    expect(typeof repo.guardarJornada).toBe("function");
    // Solo el par guardar/obtener: sin métodos de cálculo de tiempos.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(repo))).toEqual(
      ["constructor", "obtenerParaFecha", "guardarJornada"],
    );
  });
});