/**
 * Pruebas de repositorio — ticket 08 (mantenimiento en memoria).
 * Cubre: guardar/recuperar, actualizar (cierre), listar por máquina,
 * mantenimiento abierto, rechazo de duplicados de id, no contaminación
 * por referencias mutables, y la separación de responsabilidades: el
 * repositorio NO valida la existencia/coherencia de daños vinculados
 * (eso vive en el dominio).
 */
import { describe, expect, it } from "vitest";
import { InMemoryMantenimientoRepository } from "./inMemoryMantenimientoRepository";
import {
  MANT_1_REACTIVO_CON_DANO_CERRADO,
  MANT_2_REACTIVO_SIN_DANO_CERRADO,
  MANT_3_PREVENTIVO_CERRADO,
  MANT_4_ABIERTO,
  crearFixtureMantenimientos,
} from "./mantenimientoFixtures";
import type { Mantenimiento } from "../domain/types";

const M1 = "M1";

describe("InMemoryMantenimientoRepository — guardar y recuperar", () => {
  it("inserta un mantenimiento nuevo y lo recupera por id", () => {
    const repo = new InMemoryMantenimientoRepository([]);
    const nuevo: Mantenimiento = {
      id: "mnt-nuevo",
      maquinaId: M1,
      tipo: "reactivo",
      operatorName: "Carlos Gómez",
      motivo: "Falla eléctrica",
      inicio: "2026-09-16T08:00:00.000Z",
      fin: null,
      danoId: null,
    };
    repo.insertMantenimiento(nuevo);
    expect(repo.obtenerPorId("mnt-nuevo")).toEqual(nuevo);
  });

  it("actualiza un mantenimiento existente (cierre) y reemplaza el estado", () => {
    const repo = new InMemoryMantenimientoRepository([MANT_4_ABIERTO]);
    const cerrado: Mantenimiento = {
      ...MANT_4_ABIERTO,
      fin: "2026-09-15T12:10:00.000Z",
      queSeRevisoReparo: "Reemplazo de fusible",
    };
    repo.updateMantenimiento(cerrado);
    const recuperado = repo.obtenerPorId("mnt-004");
    expect(recuperado?.fin).toBe("2026-09-15T12:10:00.000Z");
    expect(recuperado?.queSeRevisoReparo).toBe("Reemplazo de fusible");
    // ya no es un mantenimiento abierto
    expect(repo.getMantenimientoAbierto(M1)).toBeNull();
  });
});

describe("InMemoryMantenimientoRepository — listar por máquina", () => {
  it("lista todos los mantenimientos de la máquina en orden cronológico", () => {
    const repo = new InMemoryMantenimientoRepository(crearFixtureMantenimientos());
    const todos = repo.listarPorMaquina(M1);
    expect(todos).toHaveLength(4);
    // ordenado por inicio: 11/09 (10:55, 13:00), 12/09 (07:30), 15/09 (09:00)
    expect(todos.map((m) => m.id)).toEqual([
      "mnt-001",
      "mnt-002",
      "mnt-003",
      "mnt-004",
    ]);
  });

  it("devuelve array vacío para máquina sin mantenimientos", () => {
    const repo = new InMemoryMantenimientoRepository([]);
    expect(repo.listarPorMaquina(M1)).toEqual([]);
  });
});

describe("InMemoryMantenimientoRepository — mantenimiento abierto", () => {
  it("recupera el mantenimiento abierto de la máquina", () => {
    const repo = new InMemoryMantenimientoRepository(crearFixtureMantenimientos());
    const abierto = repo.getMantenimientoAbierto(M1);
    expect(abierto?.id).toBe("mnt-004");
    expect(abierto?.fin).toBeNull();
  });

  it("devuelve null cuando no hay mantenimiento abierto", () => {
    const repo = new InMemoryMantenimientoRepository([
      MANT_1_REACTIVO_CON_DANO_CERRADO,
      MANT_2_REACTIVO_SIN_DANO_CERRADO,
      MANT_3_PREVENTIVO_CERRADO,
    ]);
    expect(repo.getMantenimientoAbierto(M1)).toBeNull();
  });
});

describe("InMemoryMantenimientoRepository — duplicados y referencias", () => {
  it("rechaza insertar un mantenimiento con id existente", () => {
    const repo = new InMemoryMantenimientoRepository(crearFixtureMantenimientos());
    const duplicado: Mantenimiento = {
      ...MANT_1_REACTIVO_CON_DANO_CERRADO,
      motivo: "otro motivo",
    };
    expect(() => repo.insertMantenimiento(duplicado)).toThrow("ya existe un mantenimiento");
    // no se reemplazó el original
    expect(repo.obtenerPorId("mnt-001")?.motivo).toBe("Falla en carro 3");
  });

  it("rechaza actualizar un mantenimiento inexistente", () => {
    const repo = new InMemoryMantenimientoRepository([]);
    const fantasma: Mantenimiento = {
      id: "mnt-inexistente",
      maquinaId: M1,
      tipo: "reactivo",
      operatorName: "Luis Fernández",
      motivo: "Fantasma",
      inicio: "2026-09-11T09:00:00.000Z",
      fin: null,
      danoId: null,
    };
    expect(() => repo.updateMantenimiento(fantasma)).toThrow("no existe un mantenimiento");
  });

  it("NO valida el daño vinculado (regla de negocio que vive en el dominio)", () => {
    // El repositorio persiste tal cual: la existencia/coherencia del daño
    // la valida registrarMantenimiento con la dependencia ObtenerDanoPorId
    // inyectada, nunca este adaptador de persistencia.
    const repo = new InMemoryMantenimientoRepository([]);
    const conDanoFantasma: Mantenimiento = {
      ...MANT_1_REACTIVO_CON_DANO_CERRADO,
      id: "mnt-fantasma-dano",
      danoId: "dan-inexistente",
    };
    expect(() => repo.insertMantenimiento(conDanoFantasma)).not.toThrow();
    expect(repo.obtenerPorId("mnt-fantasma-dano")?.danoId).toBe("dan-inexistente");
  });

  it("mutar el resultado devuelto no contamina el repositorio", () => {
    const repo = new InMemoryMantenimientoRepository(crearFixtureMantenimientos());
    const copia = repo.obtenerPorId("mnt-001")!;
    copia.fin = "2050-01-01T00:00:00.000Z";
    copia.motivo = "MUTADO";
    copia.queSeRevisoReparo = "mutado";
    expect(repo.obtenerPorId("mnt-001")?.fin).toBe("2026-09-11T11:20:00.000Z");
    expect(repo.obtenerPorId("mnt-001")?.motivo).toBe("Falla en carro 3");
    expect(repo.obtenerPorId("mnt-001")?.queSeRevisoReparo).toBe("Cambio de rodamiento");
  });

  it("mutar el resultado de listarPorMaquina no contamina el repositorio", () => {
    const repo = new InMemoryMantenimientoRepository(crearFixtureMantenimientos());
    const lista = repo.listarPorMaquina(M1);
    lista[0].tipo = "preventivo";
    expect(repo.obtenerPorId("mnt-001")?.tipo).toBe("reactivo");
  });

  it("mutar un array pasado al constructor no contamina el repositorio", () => {
    const input = crearFixtureMantenimientos();
    const repo = new InMemoryMantenimientoRepository(input);
    input[0].fin = "2050-01-01T00:00:00.000Z";
    expect(repo.obtenerPorId("mnt-001")?.fin).toBe("2026-09-11T11:20:00.000Z");
  });

  it("NO re-normaliza: guarda exactamente lo que el dominio validó", () => {
    // El repositorio es un almacén pasivo; no toca campos, no calcula
    // duración, no inferiere tipo a partir del danoId. Guarda y devuelve
    // exactamente lo que recibe.
    const repo = new InMemoryMantenimientoRepository([]);
    const conObservaciones: Mantenimiento = {
      id: "mnt-custom",
      maquinaId: M1,
      tipo: "preventivo",
      operatorName: "Ana López",
      motivo: "Preventivo programado",
      inicio: "2026-09-20T07:00:00.000Z",
      fin: "2026-09-20T07:30:00.000Z",
      queSeRevisoReparo: "Limpieza general",
      danoId: null,
      observaciones: "Sin observaciones especiales",
    };
    repo.insertMantenimiento(conObservaciones);
    const resultado = repo.obtenerPorId("mnt-custom")!;
    // El repositorio no agrega campos derivados como duración
    expect(resultado).not.toHaveProperty("duracion");
    // Los campos opcionales se guardan tal cual
    expect(resultado.observaciones).toBe("Sin observaciones especiales");
    expect(resultado.queSeRevisoReparo).toBe("Limpieza general");
  });
});
