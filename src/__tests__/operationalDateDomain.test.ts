// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cerrarParada, registrarParada } from "../domain/paradas";
import { cerrarMantenimiento } from "../domain/mantenimiento";
import type { MantenimientoAbierto } from "../domain/types";

/**
 * Why these two cases live outside `src/domain`.
 *
 * `src/__tests__/noDomainDiff.test.ts` freezes `src/domain` at `851172c`, the
 * declared precondition of the historical-day-navigation change, and asserts a
 * zero diff against it — committed, staged or unstaged. Adding a test inside
 * `src/domain` fails that guard, so the coverage is held here instead.
 *
 * The alternative — weakening or re-basing the guard — is not available: it
 * protects an invariant another change depends on. Domain tests being
 * co-located is the norm (22 suites outside `src/domain` already import domain
 * code), but co-location is a convention; the guard is a constraint.
 *
 * Nothing here changes domain behaviour. The implementation already satisfies
 * both cases; this file only carries the evidence that it does.
 */

/** Un evento de parada cuyo inicio cae tarde pero cuyo día atribuido es anterior. */
const inputVigilia = {
  maquinaId: "M1" as const,
  ordenId: "orden-1",
  operatorName: "Carlos Gómez",
  causaId: "falta_color" as const,
  camposEspecificos: { color: "ROJO" },
  inicio: "2026-09-11T23:30:00.000Z",
  fechaOperativa: "2026-09-11",
};

const mantenimientoAbierto: MantenimientoAbierto = {
  id: "m1",
  maquinaId: "M1",
  tipo: "reactivo",
  operatorName: "Carlos Gómez",
  motivo: "Reparación de eje",
  fechaOperativa: "2026-09-11",
  inicio: "2026-09-11T11:00:00.000Z",
  fin: null,
  danoId: "dano-1",
};

describe("operational-event-operative-date: el día es dato persistido", () => {
  // Tarea 1.6 — cerrar un evento no recalcula el día a partir del `fin`.
  it("al cerrar un mantenimiento preserva la fecha operativa aunque el fin caiga en un día posterior", () => {
    expect(mantenimientoAbierto.fechaOperativa).toBe("2026-09-11");

    const { mantenimiento: cerrado, errores } = cerrarMantenimiento(
      mantenimientoAbierto,
      "2026-09-12T01:30:00.000Z",
      "Se reemplazó el eje",
    );
    expect(errores).toEqual([]);
    expect(cerrado!.fin).toBe("2026-09-12T01:30:00.000Z");
    expect(cerrado!.fechaOperativa).toBe("2026-09-11");
  });

  // Tarea 1.7 — dos eventos con ventana temporal idéntica siguen siendo
  // registros distintos y cada uno conserva su propio día.
  it("dos eventos con el mismo inicio y fin siguen siendo distintos, cada uno con su día", () => {
    // Misma ventana temporal EXACTA; sólo cambia el día atribuido. El día es un
    // dato persistido, no una función del instante: derivado de `inicio`
    // compartirían día, y deduplicados por ventana sobreviviría uno solo.
    const fin = "2026-09-11T23:45:00.000Z";

    const primero = registrarParada([], inputVigilia);
    expect(primero.errores).toEqual([]);
    const cerrada1 = cerrarParada(primero.parada!, fin);
    expect(cerrada1.errores).toEqual([]);

    // Sin parada abierta para la misma máquina + orden, la segunda registra.
    const segundo = registrarParada([cerrada1.parada!], {
      ...inputVigilia,
      fechaOperativa: "2026-09-12",
    });
    expect(segundo.errores).toEqual([]);
    const cerrada2 = cerrarParada(segundo.parada!, fin);
    expect(cerrada2.errores).toEqual([]);

    // Misma ventana exacta…
    expect(cerrada2.parada!.inicio).toBe(cerrada1.parada!.inicio);
    expect(cerrada2.parada!.fin).toBe(cerrada1.parada!.fin);
    // …pero son registros distintos y cada uno conserva su propio día.
    expect(cerrada2.parada!.id).not.toBe(cerrada1.parada!.id);
    expect(cerrada1.parada!.fechaOperativa).toBe("2026-09-11");
    expect(cerrada2.parada!.fechaOperativa).toBe("2026-09-12");
  });
});