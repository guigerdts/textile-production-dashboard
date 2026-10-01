/**
 * Pruebas de repositorio — ticket 05 (daños en memoria).
 * Cubre: guardar/recuperar, actualizar (cierre), listar por máquina,
 * listar por orden, distinción ordenId:null vs orden concreta, daño abierto,
 * rechazo de duplicados de id, no contaminación por referencias mutables,
 * y la separación de responsabilidades: el repositorio NO valida la
 * existencia/coherencia de paradas (eso vive en el dominio con la
 * dependencia ObtenerParadaPorId inyectada).
 */
import { describe, expect, it } from "vitest";
import { InMemoryDanoRepository } from "./inMemoryDanosRepository";
import {
  DANO_1_CERRADO_CON_PARADA,
  DANO_2_CERRADO_SIN_PARADA,
  DANO_3_ABIERTO,
  DANO_4_SIN_ORDEN_CERRADO,
  crearFixtureDanos,
} from "./danosFixtures";
import type { Dano } from "../domain/types";

const M1 = "M1";

describe("InMemoryDanoRepository — guardar y recuperar", () => {
  it("inserta un daño nuevo y lo recupera por id", async () => {
    const repo = new InMemoryDanoRepository([]);
    const nuevo: Dano = {
      id: "dan-nuevo",
      maquinaId: M1,
      ordenId: "ord-101",
      operatorName: "Carlos Gómez",
      tipo: "electrico",
      componente: "sensor de temperatura",
      fechaOperativa: "2026-09-16",
      inicio: "2026-09-16T08:00:00.000Z",
      fin: null,
      causoParada: false,
      paradaId: null,
      posibleSegunda: true,
      unidadesSospechadas: 0,
    };
    await repo.insertDano(nuevo);
    expect(await repo.obtenerPorId("dan-nuevo")).toEqual(nuevo);
  });

  it("actualiza un daño existente (cierre) y reemplaza el estado", async () => {
    const repo = new InMemoryDanoRepository([DANO_3_ABIERTO]);
    const cerrado: Dano = {
      ...DANO_3_ABIERTO,
      fin: "2026-09-15T12:10:00.000Z",
      solucionAplicada: "Reemplazo de tablero",
    };
    await repo.updateDano(cerrado);
    const recuperado = await repo.obtenerPorId("dan-003");
    expect(recuperado?.fin).toBe("2026-09-15T12:10:00.000Z");
    expect(recuperado?.solucionAplicada).toBe("Reemplazo de tablero");
    // ya no es un daño abierto
    expect(await repo.getDanoAbierto(M1)).toBeNull();
  });
});

describe("InMemoryDanoRepository — listar por máquina y por orden", () => {
  it("lista todos los daños de la máquina en orden cronológico", async () => {
    const repo = new InMemoryDanoRepository(crearFixtureDanos());
    const todos = await repo.listarPorMaquina(M1);
    expect(todos).toHaveLength(4);
    // ordenado por inicio: 11/09 (10:55, 13:00, 17:45) y 15/09 (09:00)
    expect(todos.map((d) => d.id)).toEqual([
      "dan-001",
      "dan-002",
      "dan-004",
      "dan-003",
    ]);
  });

  it("lista por orden solo los daños de esa orden (sin daños null)", async () => {
    const repo = new InMemoryDanoRepository(crearFixtureDanos());
    const de101 = await repo.listarPorOrden("ord-101");
    expect(de101.map((d) => d.id)).toEqual(["dan-001", "dan-002"]);
    const de102 = await repo.listarPorOrden("ord-102");
    expect(de102.map((d) => d.id)).toEqual(["dan-003"]);
    // una orden sin daños
    expect(await repo.listarPorOrden("ord-999")).toEqual([]);
  });

  it("listarPorOrden nunca mezcla daños sin orden", async () => {
    const repo = new InMemoryDanoRepository([DANO_4_SIN_ORDEN_CERRADO]);
    expect(await repo.listarPorOrden("ord-101")).toEqual([]);
    expect(await repo.listarPorMaquina(M1)).toHaveLength(1);
  });
});

describe("InMemoryDanoRepository — daño abierto", () => {
  it("recupera el daño abierto de la máquina", async () => {
    const repo = new InMemoryDanoRepository(crearFixtureDanos());
    const abierto = await repo.getDanoAbierto(M1);
    expect(abierto?.id).toBe("dan-003");
    expect(abierto?.fin).toBeNull();
  });

  it("devuelve null cuando no hay daño abierto", async () => {
    const repo = new InMemoryDanoRepository([
      DANO_1_CERRADO_CON_PARADA,
      DANO_2_CERRADO_SIN_PARADA,
      DANO_4_SIN_ORDEN_CERRADO,
    ]);
    expect(await repo.getDanoAbierto(M1)).toBeNull();
  });
});

describe("InMemoryDanoRepository — duplicados y referencias", () => {
  it("rechaza insertar un daño con id existente", async () => {
    const repo = new InMemoryDanoRepository(crearFixtureDanos());
    const duplicado: Dano = {
      ...DANO_1_CERRADO_CON_PARADA,
      componente: "otro componente",
    };
    await expect(repo.insertDano(duplicado)).rejects.toThrow("ya existe un daño");
    // no se reemplazó el original
    expect((await repo.obtenerPorId("dan-001"))?.componente).toBe("eje trasero");
  });

  it("rechaza actualizar un daño inexistente", async () => {
    const repo = new InMemoryDanoRepository([]);
    const fantasma: Dano = {
      id: "dan-inexistente",
      maquinaId: M1,
      ordenId: null,
      operatorName: "Luis Fernández",
      tipo: "mecanico",
      componente: "horno",
      fechaOperativa: "2026-09-11",
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
      causoParada: false,
      paradaId: null,
      posibleSegunda: false,
    };
    await expect(repo.updateDano(fantasma)).rejects.toThrow("no existe un daño");
  });

  it("NO valida la parada vinculada (regla de negocio que vive en el dominio)", async () => {
    // El repositorio persiste tal cual: la existencia/coherencia de la parada
    // la valida registrarDano con la dependencia ObtenerParadaPorId inyectada,
    // nunca este adaptador de persistencia.
    const repo = new InMemoryDanoRepository([]);
    const conParadaFantasma: Dano = {
      ...DANO_1_CERRADO_CON_PARADA,
      id: "dan-fantasma-parada",
      paradaId: "par-inexistente",
    };
    // La versión async de "no lanza": la promesa resuelve (no rechaza).
    await expect(repo.insertDano(conParadaFantasma)).resolves.toBeUndefined();
    expect((await repo.obtenerPorId("dan-fantasma-parada"))?.paradaId).toBe("par-inexistente");
  });

  it("mutar el resultado devuelto no contamina el repositorio", async () => {
    const repo = new InMemoryDanoRepository(crearFixtureDanos());
    const copia = (await repo.obtenerPorId("dan-001"))!;
    copia.fin = "2050-01-01T00:00:00.000Z";
    copia.componente = "MUTADO";
    copia.unidadesSospechadas = 99;
    expect((await repo.obtenerPorId("dan-001"))?.fin).toBe("2026-09-11T11:20:00.000Z");
    expect((await repo.obtenerPorId("dan-001"))?.componente).toBe("eje trasero");
    expect((await repo.obtenerPorId("dan-001"))?.unidadesSospechadas).toBe(3);
  });

  it("mutar el resultado de listarPorOrden no contamina el repositorio", async () => {
    const repo = new InMemoryDanoRepository(crearFixtureDanos());
    const lista = await repo.listarPorOrden("ord-101");
    lista[0].tipo = "electrico";
    expect((await repo.obtenerPorId("dan-001"))?.tipo).toBe("mecanico");
  });

  it("mutar un array pasado al constructor no contamina el repositorio", async () => {
    const input = crearFixtureDanos();
    const repo = new InMemoryDanoRepository(input);
    input[0].fin = "2050-01-01T00:00:00.000Z";
    expect((await repo.obtenerPorId("dan-001"))?.fin).toBe("2026-09-11T11:20:00.000Z");
  });
});
