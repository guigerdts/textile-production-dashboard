/**
 * Pruebas de repositorio — ticket 04 (jornada del turno en memoria).
 * Cubre: default por fecha, guardar/recuperar, aislamiento por fecha,
 * validación de jornada (fin > inicio) y de fecha operativa (YYYY-MM-DD),
 * y copia defensiva (sin contaminación por referencias mutables).
 *
 * Contrato async (ticket 10.2) y validación de fecha en obtenerParaFecha
 * (ticket 10.3: el repo en memoria alinea su comportamiento con el SQLite).
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
  it("devuelve la jornada default (07:00–17:00) cuando no hay registro", async () => {
    const repo = new InMemoryJornadaRepository();
    expect(await repo.obtenerParaFecha(FECHA)).toEqual(jornadaDefault(FECHA));
  });

  it("devuelve la jornada guardada para la fecha", async () => {
    const repo = new InMemoryJornadaRepository();
    await repo.guardarJornada(FECHA, JORNADA_OVERTIME);
    expect(await repo.obtenerParaFecha(FECHA)).toEqual(JORNADA_OVERTIME);
  });

  it("respeta el default para una fecha sin guardar aunque otra fecha tenga registro", async () => {
    const repo = new InMemoryJornadaRepository([
      { fechaOperativa: FECHA, jornada: JORNADA_OVERTIME },
    ]);
    expect(await repo.obtenerParaFecha("2026-09-15")).toEqual(jornadaDefault("2026-09-15"));
  });

  it("un día guardado no contamina otro día (clave por fecha operativa)", async () => {
    const repo = new InMemoryJornadaRepository();
    await repo.guardarJornada(FECHA, JORNADA_OVERTIME);
    const otro = await repo.obtenerParaFecha("2026-09-15");
    expect(otro.fin).toBe("2026-09-15T17:00:00.000Z");
    expect((await repo.obtenerParaFecha(FECHA)).fin).toBe("2026-09-11T19:00:00.000Z");
  });

  it("rechaza una fecha operativa que no sea YYYY-MM-DD", async () => {
    const repo = new InMemoryJornadaRepository();
    for (const invalida of ["11-09-2026", "2026/09/11", "20260911", ""]) {
      await expect(repo.obtenerParaFecha(invalida)).rejects.toThrow(
        "fecha operativa inválida",
      );
    }
  });
});

describe("InMemoryJornadaRepository — guardarJornada", () => {
  it("guarda y luego sobrescribe la jornada del turno", async () => {
    const repo = new InMemoryJornadaRepository();
    await repo.guardarJornada(FECHA, JORNADA_OVERTIME);
    const extendida: JornadaTurno = {
      inicio: "2026-09-11T07:00:00.000Z",
      fin: "2026-09-11T20:00:00.000Z",
    };
    await repo.guardarJornada(FECHA, extendida);
    expect((await repo.obtenerParaFecha(FECHA)).fin).toBe("2026-09-11T20:00:00.000Z");
  });

  it("rechaza una jornada con fin anterior al inicio (delega validarJornada)", async () => {
    const repo = new InMemoryJornadaRepository();
    const invalida: JornadaTurno = {
      inicio: "2026-09-11T17:00:00.000Z",
      fin: "2026-09-11T07:00:00.000Z",
    };
    await expect(repo.guardarJornada(FECHA, invalida)).rejects.toThrow(
      "el fin de la jornada debe ser posterior al inicio",
    );
  });

  it("rechaza una jornada con fin igual al inicio", async () => {
    const repo = new InMemoryJornadaRepository();
    const invalida: JornadaTurno = {
      inicio: "2026-09-11T07:00:00.000Z",
      fin: "2026-09-11T07:00:00.000Z",
    };
    await expect(repo.guardarJornada(FECHA, invalida)).rejects.toThrow(
      "el fin de la jornada debe ser posterior al inicio",
    );
  });

  it("rechaza una jornada sin fin", async () => {
    const repo = new InMemoryJornadaRepository();
    const invalida: JornadaTurno = {
      inicio: "2026-09-11T07:00:00.000Z",
      fin: "",
    };
    await expect(repo.guardarJornada(FECHA, invalida)).rejects.toThrow(
      "debe indicar el fin de la jornada",
    );
  });

  it("rechaza una fecha operativa que no sea YYYY-MM-DD", async () => {
    const repo = new InMemoryJornadaRepository();
    for (const invalida of ["11-09-2026", "2026/09/11", "20260911", ""]) {
      await expect(repo.guardarJornada(invalida, JORNADA_OVERTIME)).rejects.toThrow(
        "fecha operativa inválida",
      );
    }
  });

  it("no persiste una jornada inválida (rechazada)", async () => {
    const repo = new InMemoryJornadaRepository();
    const invalida: JornadaTurno = {
      inicio: "2026-09-11T17:00:00.000Z",
      fin: "2026-09-11T07:00:00.000Z",
    };
    await expect(repo.guardarJornada(FECHA, invalida)).rejects.toThrow();
    expect(await repo.obtenerParaFecha(FECHA)).toEqual(jornadaDefault(FECHA));
  });
});

describe("InMemoryJornadaRepository — copia defensiva", () => {
  it("mutar el resultado devuelto no contamina el repositorio", async () => {
    const repo = new InMemoryJornadaRepository();
    await repo.guardarJornada(FECHA, JORNADA_OVERTIME);
    const copia = await repo.obtenerParaFecha(FECHA);
    copia.fin = "2050-01-01T00:00:00.000Z";
    expect((await repo.obtenerParaFecha(FECHA)).fin).toBe("2026-09-11T19:00:00.000Z");
  });

  it("cada llamada a obtenerParaFecha devuelve una copia independiente", async () => {
    const repo = new InMemoryJornadaRepository();
    await repo.guardarJornada(FECHA, JORNADA_OVERTIME);
    const a = await repo.obtenerParaFecha(FECHA);
    const b = await repo.obtenerParaFecha(FECHA);
    a.fin = "2050-01-01T00:00:00.000Z";
    expect(b.fin).toBe("2026-09-11T19:00:00.000Z");
  });

  it("mutar la jornada pasada a guardarJornada no contamina el repositorio", async () => {
    const repo = new InMemoryJornadaRepository();
    const jornada = { ...JORNADA_OVERTIME };
    await repo.guardarJornada(FECHA, jornada);
    jornada.fin = "2050-01-01T00:00:00.000Z";
    expect((await repo.obtenerParaFecha(FECHA)).fin).toBe("2026-09-11T19:00:00.000Z");
  });

  it("mutar el seed del constructor no contamina el repositorio", async () => {
    const seed = [{ fechaOperativa: FECHA, jornada: { ...JORNADA_OVERTIME } }];
    const repo = new InMemoryJornadaRepository(seed);
    seed[0].jornada.fin = "2050-01-01T00:00:00.000Z";
    expect((await repo.obtenerParaFecha(FECHA)).fin).toBe("2026-09-11T19:00:00.000Z");
  });

  it("el repositorio vacío no expone cálculos derivados (solo guarda/obtiene)", async () => {
    const repo = new InMemoryJornadaRepository();
    expect(typeof repo.obtenerParaFecha).toBe("function");
    expect(typeof repo.guardarJornada).toBe("function");
    // Solo el par guardar/obtener: sin métodos de cálculo de tiempos.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(repo))).toEqual(
      ["constructor", "obtenerParaFecha", "guardarJornada"],
    );
  });
});