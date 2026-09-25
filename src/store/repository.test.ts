import { describe, expect, it } from "vitest";
import { InMemoryOrderRepository } from "./inMemoryRepository";
import {
  FECHA_CON_ORDEN,
  FECHA_SIN_ORDEN,
} from "./fixtures";
import {
  finalizarProduccion,
  iniciarProduccion,
  registrarLectura,
  golpesProducidosDesdeLecturas,
} from "../domain/calculations";

const TS = "2026-09-11T07:00:00.000Z";

describe("InMemoryOrderRepository", () => {
  it("devuelve la orden para un día con orden asignada", async () => {
    const repo = new InMemoryOrderRepository();
    const orden = await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN);
    expect(orden?.numeroOrden).toBe("OP-101");
    expect(orden?.estado).toBe("available");
    expect(orden?.machineId).toBe("M1");
  });

  it("devuelve undefined para un día sin orden asignada (día vacío)", async () => {
    const repo = new InMemoryOrderRepository();
    expect(await repo.getOrderByFechaOperativa(FECHA_SIN_ORDEN)).toBeUndefined();
  });

  it("no mezcla la orden de otro día", async () => {
    const repo = new InMemoryOrderRepository();
    const delQuince = await repo.getOrderByFechaOperativa("2026-09-15");
    expect(delQuince?.numeroOrden).toBe("OP-102");
  });

  it("persiste el progreso de una orden existente (iniciar -> lectura -> finalizar)", async () => {
    const repo = new InMemoryOrderRepository();
    const delDia = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;

    const iniciada = iniciarProduccion(delDia, {
      operatorName: "Laura",
      lecturaInicial: 100,
      timestamp: TS,
    });
    expect(iniciada.errores).toEqual([]);
    await repo.saveOrder(iniciada.orden!);

    const conLecturas = registrarLectura(iniciada.orden!, {
      valor: 106,
      timestamp: TS,
    });
    expect(conLecturas.errores).toEqual([]);
    await repo.saveOrder(conLecturas.orden!);

    const finalizada = finalizarProduccion(conLecturas.orden!, TS);
    expect(finalizada.errores).toEqual([]);
    await repo.saveOrder(finalizada.orden!);

    const paraHoy = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    expect(paraHoy.estado).toBe("finished");
    expect(paraHoy.operatorName).toBe("Laura");
    expect(paraHoy.finalizadaEn).toBe(TS);
    expect(golpesProducidosDesdeLecturas(paraHoy.lecturas)).toBe(6);
  });

  it("propaga el progreso guardado a consultas posteriores", async () => {
    const repo = new InMemoryOrderRepository();
    const delDia = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    const iniciada = iniciarProduccion(delDia, {
      operatorName: "Laura",
      lecturaInicial: 100,
      timestamp: TS,
    }).orden!;
    await repo.saveOrder(iniciada);
    expect((await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))?.estado).toBe("in_production");
  });

  it("no crea una orden inexistente en saveOrder", async () => {
    const repo = new InMemoryOrderRepository();
    const fantasma = { ...(await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!, id: "nueva-id" };
    await expect(repo.saveOrder(fantasma)).rejects.toThrow("orden inexistente");
  });

  it("devuelve copias: mutar el resultado no contamina el repositorio", async () => {
    const repo = new InMemoryOrderRepository();
    const delDia = (await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))!;
    delDia.estado = "finished"; // intento de mutación desde afuera
    expect((await repo.getOrderByFechaOperativa(FECHA_CON_ORDEN))?.estado).toBe("available");
  });
});
