/**
 * CHANGE 2 (historical-day-navigation) — one day-scoped listing contract, two
 * adapter families (WU4, spec D8)
 *
 * WHAT THIS IS: a single factory that runs **every** day-scoped listing case
 * against whichever family the caller builds. Both families execute the *same*
 * cases, so a day predicate that passes in one and fails in the other cannot
 * hide: the SQLite family runs over a real `node:sqlite` engine, the in-memory
 * family over the production adapters. Neither family gets a case the other
 * does not run (DD10).
 *
 * WHAT THIS IS NOT: it is not a second specification. The spec enumerates the
 * behaviours; this file only decides how to *observe* them, and it observes them
 * through the public port methods a real caller would use. It never reaches into
 * adapter internals, never imports a mapper, and never asserts on SQL text —
 * SQL text is the parity suite's job, against the real engine.
 *
 * WHY THE SIX SHAPES (DD8). "Return records whose day is D" has a handful of
 * ways to be subtly wrong that a happy-path test cannot catch: deriving the day
 * from a timestamp, treating an open record as belonging to "now", widening the
 * match to a window, dropping order-less records because another listing drops
 * them, and returning records of a neighbouring day whose timestamps happen to
 * touch. Each shape below is one of those failures, named.
 *
 * The factory is generic over the record type because the four event types
 * disagree about almost everything except the contract under test: a `Parada`
 * needs a `causaId`, a `Dano` needs a `componente`. So the factory works in
 * **recipes** (`RecetaDia`: id, ordenId, fechaOperativa, inicio, fin) and each
 * family materialises them into domain-valid records and seeds them. The factory
 * never learns what a parada is.
 */

import { describe, expect, it } from "vitest";

/** Días usados por los casos. Simples y consecutivos: el filtro es igualdad. */
export const D1 = "2026-09-11";
export const D2 = "2026-09-12";

/**
 * Un registro descrito sólo por lo que el contrato de día decide: qué día
 * pertenece, si tiene orden, y cuándo empieza/termina. La familia traduce esto
 * a su propio tipo de dominio.
 */
export interface RecetaDia {
  id: string;
  ordenId: string | null;
  fechaOperativa: string;
  inicio: string;
  fin: string | null;
}

/** Los dos aserciones que toda familia debe poder hacer sobre su listado. */
export interface CasoDia<T> {
  /** El método bajo prueba: el listado acotado a un día. */
  listarPorDia(maquinaId: string, fechaOperativa: string): Promise<T[]>;
  /** El listado sin día, que debe seguir devolviendo la historia completa (DD2). */
  listarSinDia(maquinaId: string): Promise<T[]>;
}

/**
 * Los cuatro tipos de evento declaran `id: string`, así que la aserción puede
 * leerlo sin que la factory conozca ningún dominio. El cast está aislado aquí
 * a propósito: es el único punto donde el genérico se abre.
 */
function idDe(registro: unknown): string {
  return (registro as { id: string }).id;
}

async function ids(registros: unknown[]): Promise<string[]> {
  return registros.map(idDe);
}

/**
 * Construye el caso: materializa las recetas, las siembra y expone los dos
 * listados. Puede devolver una promesa — la familia SQLite abre una base real y
 * siembra por `await` — y la factory espera el resultado en cada caso, así que
 * ninguna de las dos familias obtiene un atajo que la otra no tenga.
 */
export type CrearCasoPorDia<T> = (registros: RecetaDia[]) => CasoDia<T> | Promise<CasoDia<T>>;

/** Una receta cerrada en `fin` el día que dice su `fechaOperativa`. */
function cerrada(id: string, fechaOperativa: string, hora: string, ordenId: string | null = null): RecetaDia {
  return {
    id,
    ordenId,
    fechaOperativa,
    inicio: `${fechaOperativa}T${hora}:00.000Z`,
    fin: `${fechaOperativa}T23:59:00.000Z`,
  };
}

export function describeDayScopedListingContract<T>(
  familia: string,
  crearCaso: CrearCasoPorDia<T>
): void {
  const M1 = "M1";

  describe(`listado por día — familia "${familia}"`, () => {
    it("forma 1 · un registro con orden pertenece a su día, no a todos", async () => {
      const caso = await crearCaso([
        cerrada("r-d1", D1, "09:00", "ord-1"),
        cerrada("r-d2", D2, "08:00", "ord-2"),
      ]);

      expect(await ids(await caso.listarPorDia(M1, D1))).toEqual(["r-d1"]);
      expect(await ids(await caso.listarPorDia(M1, D2))).toEqual(["r-d2"]);
      // DD2: el listado sin día conserva la historia completa
      expect(await ids(await caso.listarSinDia(M1))).toEqual(["r-d1", "r-d2"]);
    });

    it("forma 2 · un registro SIN orden sigue siendo visible en su día", async () => {
      // La forma que importa: `listarPorOrden` excluye los `ordenId: null`, así
      // que un copiador de esa lógica perdería estos registros. El listado por
      // día no distingue órdenes.
      const caso = await crearCaso([
        cerrada("r-sin-orden", D1, "07:00", null),
        cerrada("r-con-orden", D1, "09:00", "ord-1"),
      ]);

      expect(await ids(await caso.listarPorDia(M1, D1))).toEqual(["r-sin-orden", "r-con-orden"]);
      expect(await ids(await caso.listarSinDia(M1))).toEqual(["r-sin-orden", "r-con-orden"]);
    });

    it("forma 3 · un registro que CRUZA la medianoche queda en el día que empezó", async () => {
      // La forma que separa `fechaOperativa` de una comparación de timestamps:
      // empezó el día 1 a las 23:50 y terminó el día 2 a las 00:10. Un filtro por
      // rango de `inicio`..`fin` lo devolvería en los dos días.
      const caso = await crearCaso([
        {
          id: "r-cruce",
          ordenId: "ord-1",
          fechaOperativa: D1,
          inicio: `${D1}T23:50:00.000Z`,
          fin: `${D2}T00:10:00.000Z`,
        },
      ]);

      expect(await ids(await caso.listarPorDia(M1, D1))).toEqual(["r-cruce"]);
      expect(await ids(await caso.listarPorDia(M1, D2))).toEqual([]);
      expect(await ids(await caso.listarSinDia(M1))).toEqual(["r-cruce"]);
    });

    it("forma 4 · un registro ABIERTO que cruza la medianoche queda en su día de apertura", async () => {
      // `fin: null` es justo el caso en que derivar el día de `fin` no funciona:
      // no hay `fin` del que derivarlo, y un predicado tipo "sigue abierta" lo
      // movería al día en que se consulta.
      const caso = await crearCaso([
        {
          id: "r-abierta",
          ordenId: null,
          fechaOperativa: D1,
          inicio: `${D1}T23:50:00.000Z`,
          fin: null,
        },
      ]);

      expect(await ids(await caso.listarPorDia(M1, D1))).toEqual(["r-abierta"]);
      expect(await ids(await caso.listarPorDia(M1, D2))).toEqual([]);
      expect(await ids(await caso.listarSinDia(M1))).toEqual(["r-abierta"]);
    });

    it("forma 5 · dos registros con inicio IDÉNTICO y días distintos: cada día devuelve el suyo", async () => {
      // Separa la igualdad de día de cualquier otra cosa: si el filtro comparase
      // `inicio` en lugar de `fechaOperativa`, los dos registros serían
      // indistinguibles y ambos días devolverían ambos.
      const inicioCompartido = `${D1}T12:00:00.000Z`;
      const caso = await crearCaso([
        { id: "r-a", ordenId: "ord-1", fechaOperativa: D1, inicio: inicioCompartido, fin: null },
        { id: "r-b", ordenId: "ord-2", fechaOperativa: D2, inicio: inicioCompartido, fin: null },
      ]);

      expect(await ids(await caso.listarPorDia(M1, D1))).toEqual(["r-a"]);
      expect(await ids(await caso.listarPorDia(M1, D2))).toEqual(["r-b"]);
      // sin día, los dos vuelven a ser distinguibles sólo por su orden de inicio,
      // que aquí es un empate deliberado: no se afirma un orden entre empates.
      expect((await ids(await caso.listarSinDia(M1))).slice().sort()).toEqual(["r-a", "r-b"]);
    });

    it("forma 6 · un día sin registros devuelve [] y no un error", async () => {
      // Un día vacío es un resultado legítimo: el operario miró un día sin
      // producción. Un `throw` aquí convertiría la navegación en un fallo.
      const caso = await crearCaso([cerrada("r-d1", D1, "09:00", "ord-1")]);

      await expect(caso.listarPorDia(M1, D2)).resolves.toEqual([]);
      // DD2 también en esta forma: un día vacío es un filtro, no una pérdida de
      // historia. Sin esta aserción, un listado por día que devolviera `[]`
      // siempre — trunque la historia entera y nadie lo vería.
      expect(await ids(await caso.listarSinDia(M1))).toEqual(["r-d1"]);
    });

    it("igualdad exacta: un registro con inicio y fin en D-1 pero fechaOperativa D no aparece en D-1", async () => {
      // El reverso de la forma 3, y el que importa si alguien "corrige" el filtro
      // para que un registro que empieza en D-1 salga en D-1: la respuesta es no.
      // `fechaOperativa` es la única fuente del día.
      const caso = await crearCaso([
        {
          id: "r-reasignado",
          ordenId: "ord-2",
          fechaOperativa: D2,
          inicio: `${D1}T10:00:00.000Z`,
          fin: `${D1}T11:00:00.000Z`,
        },
      ]);

      expect(await ids(await caso.listarPorDia(M1, D1))).toEqual([]);
      expect(await ids(await caso.listarPorDia(M1, D2))).toEqual(["r-reasignado"]);
      expect(await ids(await caso.listarSinDia(M1))).toEqual(["r-reasignado"]);
    });

    it("preserva el orden cronológico dentro del día, y ningún día ordena entre días", async () => {
      const caso = await crearCaso([
        cerrada("r-tarde", D1, "17:00", "ord-1"),
        cerrada("r-temprano", D1, "07:00", "ord-1"),
        cerrada("r-mediodia", D1, "12:00", "ord-1"),
        cerrada("r-otro-dia", D2, "09:00", "ord-2"),
      ]);

      // dentro del día, por `inicio`
      expect(await ids(await caso.listarPorDia(M1, D1))).toEqual(["r-temprano", "r-mediodia", "r-tarde"]);
      // el día 2 no se mezcla con el día 1 por posición temporal
      expect(await ids(await caso.listarPorDia(M1, D2))).toEqual(["r-otro-dia"]);
      expect(await ids(await caso.listarSinDia(M1))).toEqual([
        "r-temprano",
        "r-mediodia",
        "r-tarde",
        "r-otro-dia",
      ]);
    });
  });
}