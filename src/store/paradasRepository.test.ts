/**
 * Pruebas de repositorio — ticket 02 (paradas en memoria).
 * Cubre: guardar/recuperar, listar por máquina, listar por orden,
 * recuperar parada abierta, distinción ordenId:null vs orden concreta,
 * rechazo de duplicados de id, y no contaminación por referencias mutables.
 */
import { describe, expect, it } from "vitest";
import { InMemoryParadaRepository } from "./inMemoryParadasRepository";
import {
  P1,
  P4_ABIERTA,
  P5_ABIERTA_SIN_ORDEN,
  crearFixtureParadas,
} from "./paradasFixtures";
import type { Parada } from "../domain/types";

const M1 = "M1";

describe("InMemoryParadaRepository — guardar y recuperar", () => {
  it("inserta una parada nueva y la recupera por id", () => {
    const repo = new InMemoryParadaRepository([]);
    const nueva: Parada = {
      id: "par-nueva",
      maquinaId: M1,
      ordenId: "ord-101",
      operatorName: "Carlos Gómez",
      causaId: "falta_color",
      camposEspecificos: { color: "VERDE" },
      inicio: "2026-09-16T08:00:00.000Z",
      fin: null,
    };
    repo.insertParada(nueva);
    expect(repo.obtenerPorId("par-nueva")).toEqual(nueva);
  });

  it("actualiza una parada existente (cierre) y reemplaza el estado", () => {
    const repo = new InMemoryParadaRepository([P4_ABIERTA]);
    const cerrada: Parada = { ...P4_ABIERTA, fin: "2026-09-11T14:15:00.000Z" };
    repo.updateParada(cerrada);
    const recuperada = repo.obtenerPorId("par-004");
    expect(recuperada?.fin).toBe("2026-09-11T14:15:00.000Z");
    // ya no es una parada abierta
    expect(repo.getParadaAbierta(M1, "ord-101")).toBeNull();
  });
});

describe("InMemoryParadaRepository — listar por máquina y por orden", () => {
  it("lista todas las paradas de la máquina en orden cronológico", () => {
    const repo = new InMemoryParadaRepository(crearFixtureParadas());
    const todas = repo.listarPorMaquina(M1);
    expect(todas).toHaveLength(5);
    // ordenado por inicio: 11/09 (09:30, 11:00, 14:00, 17:30) y 15/09 (10:00)
    expect(todas.map((p) => p.id)).toEqual([
      "par-001",
      "par-002",
      "par-004",
      "par-005",
      "par-003",
    ]);
  });

  it("lista por orden solo las paradas de esa orden (sin paradas null)", () => {
    const repo = new InMemoryParadaRepository(crearFixtureParadas());
    const de101 = repo.listarPorOrden("ord-101");
    expect(de101.map((p) => p.id)).toEqual(["par-001", "par-002", "par-004"]);
    const de102 = repo.listarPorOrden("ord-102");
    expect(de102.map((p) => p.id)).toEqual(["par-003"]);
    // una orden sin paradas
    expect(repo.listarPorOrden("ord-999")).toEqual([]);
  });

  it("listarPorOrden nunca mezcla paradas sin orden", () => {
    const repo = new InMemoryParadaRepository([P5_ABIERTA_SIN_ORDEN]);
    expect(repo.listarPorOrden("ord-101")).toEqual([]);
    expect(repo.listarPorMaquina(M1)).toHaveLength(1);
  });
});

describe("InMemoryParadaRepository — parada abierta", () => {
  it("recupera la parada abierta de una orden concreta", () => {
    const repo = new InMemoryParadaRepository(crearFixtureParadas());
    const abierta = repo.getParadaAbierta(M1, "ord-101");
    expect(abierta?.id).toBe("par-004");
    expect(abierta?.fin).toBeNull();
  });

  it("no confunde la parada abierta sin orden con la de una orden", () => {
    const repo = new InMemoryParadaRepository(crearFixtureParadas());
    // para la orden concreta hay par-004
    expect(repo.getParadaAbierta(M1, "ord-101")?.id).toBe("par-004");
    // sin orden (null) hay par-005, NO la par-004
    expect(repo.getParadaAbierta(M1, null)?.id).toBe("par-005");
  });

  it("devuelve null cuando no hay parada abierta para máquina+orden", () => {
    const repo = new InMemoryParadaRepository(crearFixtureParadas());
    expect(repo.getParadaAbierta(M1, "ord-102")).toBeNull();
  });

  it("devuelve null cuando la única parada abierta es de otro orden", () => {
    const repo = new InMemoryParadaRepository([P4_ABIERTA]);
    expect(repo.getParadaAbierta(M1, "ord-999")).toBeNull();
  });
});

describe("InMemoryParadaRepository — duplicados y referencias", () => {
  it("rechaza insertar una parada con id existente", () => {
    const repo = new InMemoryParadaRepository(crearFixtureParadas());
    const duplicada: Parada = {
      ...P1,
      camposEspecificos: { color: "OTRO" },
      inicio: "2026-09-11T23:00:00.000Z",
    };
    expect(() => repo.insertParada(duplicada)).toThrow("ya existe una parada");
    // no se reemplazó la original
    expect(repo.obtenerPorId("par-001")?.camposEspecificos).toEqual({ color: "AZUL" });
  });

  it("rechaza actualizar una parada inexistente", () => {
    const repo = new InMemoryParadaRepository([]);
    const fantasma: Parada = {
      id: "par-inexistente",
      maquinaId: M1,
      ordenId: null,
      operatorName: "Luis Fernández",
      causaId: "atasco_tela",
      camposEspecificos: {},
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
    };
    expect(() => repo.updateParada(fantasma)).toThrow("no existe una parada");
  });

  it("mutar el resultado devuelto no contamina el repositorio", () => {
    const repo = new InMemoryParadaRepository(crearFixtureParadas());
    const copia = repo.obtenerPorId("par-001")!;
    copia.fin = "2050-01-01T00:00:00.000Z";
    copia.camposEspecificos.color = "MUTADO";
    expect(repo.obtenerPorId("par-001")?.fin).toBe("2026-09-11T09:45:00.000Z");
    expect(repo.obtenerPorId("par-001")?.camposEspecificos).toEqual({ color: "AZUL" });
  });

  it("mutar el resultado de listarPorOrden no contamina el repositorio", () => {
    const repo = new InMemoryParadaRepository(crearFixtureParadas());
    const lista = repo.listarPorOrden("ord-101");
    lista[0].causaId = "otro";
    expect(repo.obtenerPorId("par-001")?.causaId).toBe("falta_color");
  });

  it("mutar un array pasado al constructor no contamina el repositorio", () => {
    const input = crearFixtureParadas();
    const repo = new InMemoryParadaRepository(input);
    input[0].fin = "2050-01-01T00:00:00.000Z";
    expect(repo.obtenerPorId("par-001")?.fin).toBe("2026-09-11T09:45:00.000Z");
  });
});