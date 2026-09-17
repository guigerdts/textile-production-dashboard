/**
 * Pruebas de repositorio — ticket 03 (actividades planificadas en memoria).
 * Cubre: guardar/recuperar, listar por máquina, recuperar actividad abierta
 * por tipo, coexistencia limpieza/cambio, rechazo de duplicados de id,
 * y no contaminación por referencias mutables.
 */
import { describe, expect, it } from "vitest";
import { InMemoryActividadPlanificadaRepository } from "./inMemoryActividadesRepository";
import {
  A1_LIMPIEZA_CERRADA,
  A3_LIMPIEZA_ABIERTA,
  crearFixtureActividades,
} from "./actividadesFixtures";
import type { ActividadPlanificada } from "../domain/types";

const M1 = "M1";

describe("InMemoryActividadPlanificadaRepository — guardar y recuperar", () => {
  it("inserta una actividad nueva y la recupera por id", () => {
    const repo = new InMemoryActividadPlanificadaRepository([]);
    const nueva: ActividadPlanificada = {
      id: "act-nueva",
      maquinaId: M1,
      tipo: "limpieza",
      inicio: "2026-09-16T07:00:00.000Z",
      fin: null,
      queSeLimpio: "mesa",
      observaciones: "autorizada por gerencia",
      operatorName: "Luis Fernández",
    };
    repo.insertActividad(nueva);
    expect(repo.obtenerPorId("act-nueva")).toEqual(nueva);
  });

  it("actualiza una actividad existente (cierre) y reemplaza el estado", () => {
    const repo = new InMemoryActividadPlanificadaRepository([A3_LIMPIEZA_ABIERTA]);
    const cerrada: ActividadPlanificada = {
      ...A3_LIMPIEZA_ABIERTA,
      fin: "2026-09-15T07:30:00.000Z",
    };
    repo.updateActividad(cerrada);
    const recuperada = repo.obtenerPorId("act-003");
    expect(recuperada?.fin).toBe("2026-09-15T07:30:00.000Z");
    // ya no es una actividad abierta
    expect(repo.getActividadAbierta(M1, "limpieza")).toBeNull();
  });
});

describe("InMemoryActividadPlanificadaRepository — listar por máquina", () => {
  it("lista todas las actividades de la máquina en orden cronológico", () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    const todas = repo.listarPorMaquina(M1);
    expect(todas).toHaveLength(4);
    // ordenado por inicio: 11/09 (07:00, 08:15) y 15/09 (07:00, 08:00)
    expect(todas.map((a) => a.id)).toEqual([
      "act-001",
      "act-002",
      "act-003",
      "act-004",
    ]);
  });

  it("no lista actividades de otra máquina", () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    expect(repo.listarPorMaquina("M2")).toEqual([]);
  });

  it("lista vacía si el repositorio está vacío", () => {
    const repo = new InMemoryActividadPlanificadaRepository([]);
    expect(repo.listarPorMaquina(M1)).toEqual([]);
  });
});

describe("InMemoryActividadPlanificadaRepository — actividad abierta", () => {
  it("recupera la limpieza abierta y el cambio abierto de forma independiente", () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    const limpieza = repo.getActividadAbierta(M1, "limpieza");
    const cambio = repo.getActividadAbierta(M1, "cambio_diseno");
    expect(limpieza?.id).toBe("act-003");
    expect(limpieza?.fin).toBeNull();
    expect(cambio?.id).toBe("act-004");
    expect(cambio?.fin).toBeNull();
  });

  it("permite la coexistencia de limpieza abierta y cambio abierto (invariante)", () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    expect(repo.getActividadAbierta(M1, "limpieza")).not.toBeNull();
    expect(repo.getActividadAbierta(M1, "cambio_diseno")).not.toBeNull();
  });

  it("devuelve null cuando no hay actividad abierta para máquina+tipo", () => {
    const repo = new InMemoryActividadPlanificadaRepository([A1_LIMPIEZA_CERRADA]);
    expect(repo.getActividadAbierta(M1, "limpieza")).toBeNull();
    expect(repo.getActividadAbierta(M1, "cambio_diseno")).toBeNull();
  });
});

describe("InMemoryActividadPlanificadaRepository — duplicados y referencias", () => {
  it("rechaza insertar una actividad con id existente", () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    const duplicada: ActividadPlanificada = {
      ...A1_LIMPIEZA_CERRADA,
      queSeLimpio: "OTRO",
      inicio: "2026-09-11T23:00:00.000Z",
    };
    expect(() => repo.insertActividad(duplicada)).toThrow("ya existe una actividad");
    // no se reemplazó la original
    expect(repo.obtenerPorId("act-001")?.queSeLimpio).toBe("mesa de estampado");
  });

  it("rechaza actualizar una actividad inexistente", () => {
    const repo = new InMemoryActividadPlanificadaRepository([]);
    const fantasma: ActividadPlanificada = {
      id: "act-inexistente",
      maquinaId: M1,
      tipo: "cambio_diseno",
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
      operatorName: "Luis Fernández",
    };
    expect(() => repo.updateActividad(fantasma)).toThrow("no existe una actividad");
  });

  it("mutar el resultado devuelto no contamina el repositorio", () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    const copia = repo.obtenerPorId("act-001")!;
    copia.fin = "2050-01-01T00:00:00.000Z";
    copia.queSeLimpio = "MUTADO";
    expect(repo.obtenerPorId("act-001")?.fin).toBe("2026-09-11T08:00:00.000Z");
    expect(repo.obtenerPorId("act-001")?.queSeLimpio).toBe("mesa de estampado");
  });

  it("mutar el resultado de listarPorMaquina no contamina el repositorio", () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    const lista = repo.listarPorMaquina(M1);
    lista[0].tipo = "cambio_diseno";
    lista[0].observaciones = "MUTADO";
    expect(repo.obtenerPorId("act-001")?.tipo).toBe("limpieza");
    expect(repo.obtenerPorId("act-001")?.observaciones).toBeUndefined();
  });

  it("mutar un array pasado al constructor no contamina el repositorio", () => {
    const input = crearFixtureActividades();
    const repo = new InMemoryActividadPlanificadaRepository(input);
    input[0].fin = "2050-01-01T00:00:00.000Z";
    input[0].queSeLimpio = "MUTADO";
    expect(repo.obtenerPorId("act-001")?.fin).toBe("2026-09-11T08:00:00.000Z");
    expect(repo.obtenerPorId("act-001")?.queSeLimpio).toBe("mesa de estampado");
  });
});