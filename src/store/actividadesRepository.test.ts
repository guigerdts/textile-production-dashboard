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
  it("inserta una actividad nueva y la recupera por id", async () => {
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
    await repo.insertActividad(nueva);
    expect(await repo.obtenerPorId("act-nueva")).toEqual(nueva);
  });

  it("actualiza una actividad existente (cierre) y reemplaza el estado", async () => {
    const repo = new InMemoryActividadPlanificadaRepository([A3_LIMPIEZA_ABIERTA]);
    const cerrada: ActividadPlanificada = {
      ...A3_LIMPIEZA_ABIERTA,
      fin: "2026-09-15T07:30:00.000Z",
    };
    await repo.updateActividad(cerrada);
    const recuperada = await repo.obtenerPorId("act-003");
    expect(recuperada?.fin).toBe("2026-09-15T07:30:00.000Z");
    // ya no es una actividad abierta
    expect(await repo.getActividadAbierta(M1, "limpieza")).toBeNull();
  });
});

describe("InMemoryActividadPlanificadaRepository — listar por máquina", () => {
  it("lista todas las actividades de la máquina en orden cronológico", async () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    const todas = await repo.listarPorMaquina(M1);
    expect(todas).toHaveLength(4);
    // ordenado por inicio: 11/09 (07:00, 08:15) y 15/09 (07:00, 08:00)
    expect(todas.map((a) => a.id)).toEqual([
      "act-001",
      "act-002",
      "act-003",
      "act-004",
    ]);
  });

  it("no lista actividades de otra máquina", async () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    expect(await repo.listarPorMaquina("M2")).toEqual([]);
  });

  it("lista vacía si el repositorio está vacío", async () => {
    const repo = new InMemoryActividadPlanificadaRepository([]);
    expect(await repo.listarPorMaquina(M1)).toEqual([]);
  });
});

describe("InMemoryActividadPlanificadaRepository — actividad abierta", () => {
  it("recupera la limpieza abierta y el cambio abierto de forma independiente", async () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    const limpieza = await repo.getActividadAbierta(M1, "limpieza");
    const cambio = await repo.getActividadAbierta(M1, "cambio_diseno");
    expect(limpieza?.id).toBe("act-003");
    expect(limpieza?.fin).toBeNull();
    expect(cambio?.id).toBe("act-004");
    expect(cambio?.fin).toBeNull();
  });

  it("permite la coexistencia de limpieza abierta y cambio abierto (invariante)", async () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    expect(await repo.getActividadAbierta(M1, "limpieza")).not.toBeNull();
    expect(await repo.getActividadAbierta(M1, "cambio_diseno")).not.toBeNull();
  });

  it("devuelve null cuando no hay actividad abierta para máquina+tipo", async () => {
    const repo = new InMemoryActividadPlanificadaRepository([A1_LIMPIEZA_CERRADA]);
    expect(await repo.getActividadAbierta(M1, "limpieza")).toBeNull();
    expect(await repo.getActividadAbierta(M1, "cambio_diseno")).toBeNull();
  });
});

describe("InMemoryActividadPlanificadaRepository — duplicados y referencias", () => {
  it("rechaza insertar una actividad con id existente", async () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    const duplicada: ActividadPlanificada = {
      ...A1_LIMPIEZA_CERRADA,
      queSeLimpio: "OTRO",
      inicio: "2026-09-11T23:00:00.000Z",
    };
    await expect(repo.insertActividad(duplicada)).rejects.toThrow("ya existe una actividad");
    // no se reemplazó la original
    expect((await repo.obtenerPorId("act-001"))?.queSeLimpio).toBe("mesa de estampado");
  });

  it("rechaza actualizar una actividad inexistente", async () => {
    const repo = new InMemoryActividadPlanificadaRepository([]);
    const fantasma: ActividadPlanificada = {
      id: "act-inexistente",
      maquinaId: M1,
      tipo: "cambio_diseno",
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
      operatorName: "Luis Fernández",
    };
    await expect(repo.updateActividad(fantasma)).rejects.toThrow("no existe una actividad");
  });

  it("mutar el resultado devuelto no contamina el repositorio", async () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    const copia = (await repo.obtenerPorId("act-001"))!;
    copia.fin = "2050-01-01T00:00:00.000Z";
    copia.queSeLimpio = "MUTADO";
    expect((await repo.obtenerPorId("act-001"))?.fin).toBe("2026-09-11T08:00:00.000Z");
    expect((await repo.obtenerPorId("act-001"))?.queSeLimpio).toBe("mesa de estampado");
  });

  it("mutar el resultado de listarPorMaquina no contamina el repositorio", async () => {
    const repo = new InMemoryActividadPlanificadaRepository(crearFixtureActividades());
    const lista = await repo.listarPorMaquina(M1);
    lista[0].tipo = "cambio_diseno";
    lista[0].observaciones = "MUTADO";
    expect((await repo.obtenerPorId("act-001"))?.tipo).toBe("limpieza");
    expect((await repo.obtenerPorId("act-001"))?.observaciones).toBeUndefined();
  });

  it("mutar un array pasado al constructor no contamina el repositorio", async () => {
    const input = crearFixtureActividades();
    const repo = new InMemoryActividadPlanificadaRepository(input);
    input[0].fin = "2050-01-01T00:00:00.000Z";
    input[0].queSeLimpio = "MUTADO";
    expect((await repo.obtenerPorId("act-001"))?.fin).toBe("2026-09-11T08:00:00.000Z");
    expect((await repo.obtenerPorId("act-001"))?.queSeLimpio).toBe("mesa de estampado");
  });
});
