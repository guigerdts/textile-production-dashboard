/**
 * Ticket 10 (Phase 2) — Unit D2 — `sqliteDanoRepository` suite
 *
 * WHAT THIS SUITE IS: the contract test of the daño SQLite adapter, over the
 * shared D2b double from Unit S (`src/store/sqlite/__tests__/fakeSqliteStore.ts`).
 * It pins the same eight things the C2 suite pins — the mapper round trip with
 * no `Database` in scope, insert-then-read, the duplicate rejection leaving the
 * stored record UNCHANGED, the unknown-id rejection creating NOTHING,
 * chronological ordering owned by the adapter, the open-record query resolving
 * the `DanoAbierto` alias without a cast at the call site, descriptive error
 * propagation with `cause`, and the update-in-place case adding no second row —
 * plus the three things that are D2's own: the two **independent** flags, the
 * two **nullable foreign keys**, and `listarPorOrden` excluding the NULL links.
 *
 * WHAT THIS SUITE IS NOT: a re-test of the double (that is
 * `fakeSqliteStore.test.ts`, once, for all five suites) and not a domain test.
 * The domain rules this port deliberately does NOT enforce — `causoParada`
 * implying a `paradaId`, `posibleSegunda` implying `unidadesSospechadas`, `fin`
 * not before `inicio`, at most one open daño per machine — live in
 * `src/domain/danos.ts`, are unchanged, and are out of scope here.
 *
 * HONESTY NOTE (D2d): this suite does **not** execute the real Rust migration.
 * The double MODELS SQLite — it applies no DDL, opens no connection and simulates
 * no `PRAGMA foreign_keys`. Everything asserted below is a fact about the exact
 * SQL the adapter emits and about the double's modelling of it, never about a
 * real sqlite engine — a fact that still needs `getForeignKeys()` on the real
 * Tauri binary (R5). The adapter writes the columns 004 declares; whether the
 * real Tauri connection enforces FK semantics stays unverified (R5/R6), and
 * `src/store/sqlite/database.ts` is untouched.
 *
 * The FK tests below (A1/A1b) are the honest version of that note: they prove
 * the adapter **lets an unresolvable link fail loudly instead of swallowing it**,
 * which is a claim about this adapter, not about the real engine.
 *
 * Anti-vacuity note: the double THROWS on any statement outside the vocabulary
 * of design.md §Statement shapes, so an adapter that drifts from its declared
 * SQL fails loudly here instead of silently no-op'ing.
 */

import { describe, expect, it } from "vitest";
import type Database from "@tauri-apps/plugin-sql";
import { cerrarDano } from "../../../domain/danos";
import type { Dano, DanoAbierto } from "../../../domain/types";
import {
  mapDanoRow,
  mapDanoToSql,
  SqliteDanoRepository,
  type DanoRow,
} from "../sqliteDanoRepository";
import { createFakeSqliteStore, type FakeSqliteStore } from "./fakeSqliteStore";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Un daño completo y explícito; nada se hereda de otra fixture. Por defecto es
 * el caso SIN enlaces ni opcionales: `ordenId`/`paradaId` en `null` (valores de
 * dominio legítimos) y los dos flags apagados.
 */
function dano(overrides: Partial<Dano> = {}): Dano {
  return {
    id: "dano-1",
    maquinaId: "M1",
    ordenId: null,
    operatorName: "Laura",
    tipo: "mecanico",
    componente: "eje trasero",
    inicio: "2026-09-14T07:00:00.000Z",
    fin: "2026-09-14T08:00:00.000Z",
    causoParada: false,
    paradaId: null,
    posibleSegunda: false,
    ...overrides,
  };
}

/** Un daño abierto: `fin: null` es lo que la marca como tal. */
function abierto(overrides: Partial<Dano> = {}): Dano {
  return dano({ fin: null, ...overrides });
}

function repoSobre(store: FakeSqliteStore): SqliteDanoRepository {
  return new SqliteDanoRepository(store);
}

/**
 * Siembra las filas destino de las dos FK de `dano`, para que un enlace sea
 * resoluble. El doble sólo exige que exista una fila con ese `id` en la tabla
 * destino; no aplica el DDL de `orden` ni de `parada`.
 */
function sembrarEnlaces(store: FakeSqliteStore): void {
  store.orden.push({ id: "orden-1" });
  store.parada.push({ id: "parada-1" });
}

/**
 * Envuelve el doble para que `execute` SIEMPRE rechace, mientras `select` sigue
 * respondiendo desde el mismo store. Permite ejercitar la envoltura de error
 * sin tocar el doble compartido (que no modela fallos de I/O).
 */
function dbQueFallaAlEscribir(store: FakeSqliteStore, causa: Error): Database {
  return {
    path: store.path,
    select: (query: string, binds?: unknown[]) => store.select(query, binds),
    execute: async () => {
      throw causa;
    },
    close: async () => true,
  } as unknown as Database;
}

/** Igual, pero además registra cada sentencia y sus binds, para fijarlos por texto. */
function repoQueRegistra(store: FakeSqliteStore): {
  repo: SqliteDanoRepository;
  consultas: string[];
  enlaces: Array<{ query: string; binds: unknown[] }>;
} {
  const consultas: string[] = [];
  const enlaces: Array<{ query: string; binds: unknown[] }> = [];
  const db = {
    path: store.path,
    select: async (query: string, binds?: unknown[]) => {
      consultas.push(query);
      enlaces.push({ query, binds: binds ?? [] });
      return store.select(query, binds);
    },
    execute: async (query: string, binds?: unknown[]) => {
      consultas.push(query);
      enlaces.push({ query, binds: binds ?? [] });
      return store.execute(query, binds);
    },
    close: async () => true,
  } as unknown as Database;
  return { repo: new SqliteDanoRepository(db), consultas, enlaces };
}

/**
 * El valor ligado a `columna` en un INSERT, deducido del propio texto emitido:
 * se localiza la columna en la lista, se toma su placeholder y se lee el bind.
 * Así la aserción no depende de conocer el orden de memoria.
 */
function valorLigado(
  enlace: { query: string; binds: unknown[] },
  columna: string
): unknown {
  const columnas = enlace.query
    .slice(enlace.query.indexOf("(") + 1, enlace.query.indexOf(") VALUES"))
    .split(",")
    .map((c) => c.trim());
  const placeholders = enlace.query
    .slice(enlace.query.indexOf("VALUES (") + "VALUES (".length, enlace.query.lastIndexOf(")"))
    .split(",")
    .map((p) => p.trim());
  const indice = columnas.indexOf(columna);
  if (indice < 0) throw new Error(`el INSERT no declara la columna ${columna}`);
  const placeholder = /^\$(\d+)$/.exec(placeholders[indice]);
  if (!placeholder) throw new Error(`la columna ${columna} no tiene placeholder`);
  return enlace.binds[Number(placeholder[1]) - 1];
}

// ── 1. Los mappers son puros: ida y vuelta sin conexión ──────────────────────

describe("sqliteDanoRepository — mappers puros", () => {
  it("la ida y vuelta del mapper no necesita ninguna Database en scope", () => {
    // Sin `createFakeSqliteStore()` en este test: los mappers son funciones
    // puras y el round trip se demuestra sin conexión alguna.
    const original = dano({
      solucionAplicada: "se ajustó el alineamiento",
      posibleSegunda: true,
      unidadesSospechadas: 12,
      observaciones: "revisar de nuevo",
    });

    const fila = mapDanoToSql(original) as unknown as DanoRow;
    const recuperada = mapDanoRow(fila);

    expect(recuperada).toEqual(original);
    // D1, en los dos sentidos: el vocabulario cambia en el mapper y sólo ahí.
    expect(fila.machine_id).toBe("M1");
    expect(fila.operario).toBe("Laura");
    expect(recuperada.maquinaId).toBe("M1");
    expect(recuperada.operatorName).toBe("Laura");
    // Una fila nueva, no una referencia compartida con la entrada.
    expect(recuperada).not.toBe(original);
  });

  it("traduce exactamente las 14 columnas que 004 declara, ni una más ni una menos", () => {
    const fila = mapDanoToSql(dano());

    expect(Object.keys(fila).sort()).toEqual([
      "causo_parada",
      "componente",
      "fin",
      "id",
      "inicio",
      "machine_id",
      "observaciones",
      "operario",
      "orden_id",
      "parada_id",
      "posible_segunda",
      "solucion_aplicada",
      "tipo",
      "unidades_sospechadas",
    ]);
    // La lectura produce SIEMPRE los 14 campos del dominio, con forma estable:
    // los tres opcionales aparecen con valor `undefined` en vez de omitirse.
    // `toEqual` los trataría como ausentes, así que se comparan las claves.
    expect(Object.keys(mapDanoRow(fila)).sort()).toEqual([
      "causoParada",
      "componente",
      "fin",
      "id",
      "inicio",
      "maquinaId",
      "observaciones",
      "operatorName",
      "ordenId",
      "paradaId",
      "posibleSegunda",
      "solucionAplicada",
      "tipo",
      "unidadesSospechadas",
    ]);
    const leido = mapDanoRow(fila);
    expect(leido).toHaveProperty("solucionAplicada", undefined);
    expect(leido).toHaveProperty("unidadesSospechadas", undefined);
    expect(leido).toHaveProperty("observaciones", undefined);
  });

  it("escribe los opcionales ausentes como null y los lee como undefined", () => {
    const sinOpcionales = abierto({ id: "dano-sin", tipo: "electrico" });

    const fila = mapDanoToSql(sinOpcionales);
    // NUNCA `""` ni `undefined`: la columna es NULL y punto.
    expect(fila.solucion_aplicada).toBeNull();
    expect(fila.unidades_sospechadas).toBeNull();
    expect(fila.observaciones).toBeNull();
    expect(fila.fin).toBeNull();

    const recuperada = mapDanoRow(fila);
    expect(recuperada.solucionAplicada).toBeUndefined();
    expect(recuperada.unidadesSospechadas).toBeUndefined();
    expect(recuperada.observaciones).toBeUndefined();
    // `fin` se conserva como `null`: es lo que significa "abierta".
    expect(recuperada.fin).toBeNull();
  });

  it("conserva `ordenId`/`paradaId` nulos como valores, sin convertirlos en undefined", () => {
    const fila = mapDanoToSql(dano());
    expect(fila.orden_id).toBeNull();
    expect(fila.parada_id).toBeNull();

    const recuperada = mapDanoRow(fila);
    // A diferencia de los opcionales, aquí `null` es un valor de dominio: un
    // daño sin orden y que no paró la máquina. Nunca `undefined`.
    expect(recuperada.ordenId).toBeNull();
    expect(recuperada.paradaId).toBeNull();
  });
});

// ── 2. Los dos flags son independientes ─────────────────────────────────────

describe("sqliteDanoRepository — flags independientes", () => {
  it("las cuatro combinaciones de los dos flags sobreviven al round trip", () => {
    const combinaciones: Array<[boolean, boolean]> = [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ];

    for (const [causoParada, posibleSegunda] of combinaciones) {
      const original = dano({ causoParada, posibleSegunda });
      const recuperada = mapDanoRow(mapDanoToSql(original));
      expect(recuperada.causoParada).toBe(causoParada);
      expect(recuperada.posibleSegunda).toBe(posibleSegunda);
    }
  });

  it("guarda los flags como 0/1 enteros, nunca como booleanos", () => {
    const fila = mapDanoToSql(dano({ causoParada: true, posibleSegunda: false }));
    // La convención de `sqliteOrderRepository` para `aplica_segunda`.
    expect(fila.causo_parada).toBe(1);
    expect(fila.posible_segunda).toBe(0);
    expect(typeof fila.causo_parada).toBe("number");
    expect(typeof fila.posible_segunda).toBe("number");
  });

  it("no deriva `unidades_sospechadas` de `posibleSegunda` en ningún sentido", () => {
    // Flag apagado con unidades puestas: el mapper NO limpia el valor...
    const conValor = mapDanoToSql(dano({ posibleSegunda: false, unidadesSospechadas: 5 }));
    expect(conValor.unidades_sospechadas).toBe(5);
    expect(conValor.posible_segunda).toBe(0);
    expect(mapDanoRow(conValor).unidadesSospechadas).toBe(5);

    // ...ni lo inventa cuando el flag está apagado y no hay unidades.
    const sinValor = mapDanoToSql(dano({ posibleSegunda: false }));
    expect(sinValor.unidades_sospechadas).toBeNull();
  });

  it("no deriva un flag del otro: un daño con parada puede no ser segunda", () => {
    const soloParada = mapDanoToSql(dano({ causoParada: true, paradaId: "parada-1" }));
    expect(soloParada.causo_parada).toBe(1);
    expect(soloParada.posible_segunda).toBe(0);
  });

  it("un 0 REAL sobrevive: `?? undefined` no debe volver indistinguible el cero de la ausencia", () => {
    // "sospechadas 0 unidades" y "sin dato" son cosas distintas, y la columna
    // las distingue: 0 frente a NULL. `??` sólo captura null/undefined, así que
    // el cero tiene que pasar intacto y no volverse `undefined`.
    const cero = dano({ posibleSegunda: true, unidadesSospechadas: 0 });
    const fila = mapDanoToSql(cero);
    expect(fila.unidades_sospechadas).toBe(0);
    expect(fila.unidades_sospechadas).not.toBeNull();

    const leido = mapDanoRow(fila);
    expect(leido.unidadesSospechadas).toBe(0);
    expect(leido).not.toHaveProperty("unidadesSospechadas", undefined);
  });
});

// ── 3. Insertar y leer de vuelta ─────────────────────────────────────────────

describe("sqliteDanoRepository — insertar y leer", () => {
  it("insertDano resuelve y obtenerPorId devuelve el registro", async () => {
    const store = createFakeSqliteStore();
    sembrarEnlaces(store);
    const repo = repoSobre(store);
    const nuevo = dano({
      id: "dano-sql-1",
      ordenId: "orden-1",
      causoParada: true,
      paradaId: "parada-1",
      posibleSegunda: true,
      unidadesSospechadas: 7,
    });

    await expect(repo.insertDano(nuevo)).resolves.toBeUndefined();
    await expect(repo.obtenerPorId("dano-sql-1")).resolves.toEqual(nuevo);

    // La fila quedó en la tabla con el vocabulario de 004, no con el del dominio.
    expect(store.dano).toHaveLength(1);
    expect(store.dano[0]).toMatchObject({
      id: "dano-sql-1",
      machine_id: "M1",
      operario: "Laura",
      tipo: "mecanico",
      orden_id: "orden-1",
      causo_parada: 1,
      parada_id: "parada-1",
      posible_segunda: 1,
      unidades_sospechadas: 7,
    });
  });

  it("obtenerPorId resuelve undefined — nunca null — para un id ausente", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);

    const ausente = await repo.obtenerPorId("dano-nope");

    expect(ausente).toBeUndefined();
    expect(ausente).not.toBeNull();
  });

  it("inserta un daño sin orden ni parada sin inventar valores", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);

    await repo.insertDano(abierto({ id: "dano-sin-orden" }));

    const fila = store.dano[0];
    expect(fila.orden_id).toBeNull();
    expect(fila.parada_id).toBeNull();
    expect(fila.fin).toBeNull();
    await expect(repo.obtenerPorId("dano-sin-orden")).resolves.toMatchObject({
      ordenId: null,
      paradaId: null,
      fin: null,
    });
  });
});

// ── 4. Duplicado: rechazo con el registro intacto ────────────────────────────

describe("sqliteDanoRepository — rechazo por duplicado", () => {
  it("insertDano rechaza el id repetido y la fila conserva los valores originales", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const original = dano({ id: "dano-dup", inicio: "2026-09-14T07:00:00.000Z" });
    await repo.insertDano(original);

    // Mismo id, valores DISTINTOS: si el adaptador sobrescribiera, se vería aquí.
    const intruder = dano({
      id: "dano-dup",
      inicio: "2026-09-20T10:00:00.000Z",
      componente: "carro 3",
      operatorName: "Intruso",
      observaciones: "no debe aparecer",
    });

    const err = await repo.insertDano(intruder).then(() => null, (e: unknown) => e as Error);

    // Mensaje del adaptador en memoria, VERBATIM — y sin envolver: el rechazo
    // ocurre en el pre-chequeo, antes de cualquier escritura.
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe("ya existe un daño con el id dano-dup");
    expect(err!.cause).toBeUndefined();

    // La fila almacenada sigue siendo la original, campo por campo.
    expect(store.dano).toHaveLength(1);
    const fila = store.dano[0];
    expect(fila.inicio).toBe("2026-09-14T07:00:00.000Z");
    expect(fila.componente).toBe("eje trasero");
    expect(fila.operario).toBe("Laura");
    expect(fila.observaciones).toBeNull();

    // Y la lectura lo confirma por la vía pública del puerto.
    await expect(repo.obtenerPorId("dano-dup")).resolves.toEqual(original);
  });
});

// ── 5. Id desconocido: rechazo sin crear nada ────────────────────────────────

describe("sqliteDanoRepository — rechazo por id desconocido", () => {
  it("updateDano rechaza un id ausente y no crea ninguna fila", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertDano(dano({ id: "dano-existente" }));

    const err = await repo
      .updateDano(dano({ id: "dano-fantasma" }))
      .then(() => null, (e: unknown) => e as Error);

    // Verbatim del adaptador en memoria, y sin envolver (pre-chequeo).
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe("no existe un daño con el id dano-fantasma");
    expect(err!.cause).toBeUndefined();

    // NADA se creó: ni la fila fantasma ni una segunda copia de la existente.
    expect(store.dano).toHaveLength(1);
    expect(store.dano.map((f) => f.id)).toEqual(["dano-existente"]);
    await expect(repo.obtenerPorId("dano-fantasma")).resolves.toBeUndefined();
  });
});

// ── 6. El orden cronológico lo posee el adaptador ────────────────────────────

describe("sqliteDanoRepository — orden cronológico", () => {
  it("listarPorMaquina ordena por inicio aunque se inserten desordenadas", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);

    // Insertadas deliberadamente fuera de orden cronológico.
    await repo.insertDano(dano({ id: "dano-tarde", inicio: "2026-09-14T12:00:00.000Z" }));
    await repo.insertDano(dano({ id: "dano-temprano", inicio: "2026-09-14T08:00:00.000Z" }));
    await repo.insertDano(dano({ id: "dano-medio", inicio: "2026-09-14T10:00:00.000Z" }));

    const listado = await repo.listarPorMaquina("M1");

    expect(listado.map((d) => d.id)).toEqual([
      "dano-temprano",
      "dano-medio",
      "dano-tarde",
    ]);

    // El almacenamiento conserva el orden de inserción: el orden lo aporta la
    // consulta (`ORDER BY inicio ASC`), no el doble ni el llamador.
    expect(store.dano.map((f) => f.id)).toEqual([
      "dano-tarde",
      "dano-temprano",
      "dano-medio",
    ]);
  });

  it("listarPorMaquina incluye los daños sin orden y no mezcla máquinas", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertDano(dano({ id: "dano-sin-orden", ordenId: null }));
    await repo.insertDano(dano({ id: "dano-con-orden", ordenId: null }));
    // La tabla es de una sola máquina (ADR 0003), pero la consulta filtra igual.
    store.dano.push({ id: "dano-otra", machine_id: "M2" });

    const listado = await repo.listarPorMaquina("M1");

    expect(listado.map((d) => d.id)).toEqual(["dano-sin-orden", "dano-con-orden"]);
  });
});

// ── 7. listarPorOrden excluye los enlaces nulos ──────────────────────────────

describe("sqliteDanoRepository — listarPorOrden", () => {
  it("devuelve sólo los daños de esa orden, en orden cronológico", async () => {
    const store = createFakeSqliteStore();
    sembrarEnlaces(store);
    const repo = repoSobre(store);

    await repo.insertDano(
      dano({ id: "dano-o1", ordenId: "orden-1", inicio: "2026-09-14T11:00:00.000Z" })
    );
    await repo.insertDano(
      dano({ id: "dano-o2", ordenId: "orden-1", inicio: "2026-09-14T09:00:00.000Z" })
    );

    const listado = await repo.listarPorOrden("orden-1");

    expect(listado.map((d) => d.id)).toEqual(["dano-o2", "dano-o1"]);
  });

  it("excluye los daños sin orden: `null` no enlaza con ninguna igualdad", async () => {
    const store = createFakeSqliteStore();
    sembrarEnlaces(store);
    const repo = repoSobre(store);

    await repo.insertDano(dano({ id: "dano-con-orden", ordenId: "orden-1" }));
    await repo.insertDano(dano({ id: "dano-sin-orden", ordenId: null }));

    const listado = await repo.listarPorOrden("orden-1");

    // El daño en máquina ociosa es un registro legítimo y `listarPorMaquina` lo
    // ve; `listarPorOrden` NO lo mezcla con los de la orden.
    expect(listado.map((d) => d.id)).toEqual(["dano-con-orden"]);
    expect((await repo.listarPorMaquina("M1")).map((d) => d.id)).toEqual([
      "dano-con-orden",
      "dano-sin-orden",
    ]);
  });

  it("resuelve lista vacía para una orden sin daños", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await expect(repo.listarPorOrden("orden-1")).resolves.toEqual([]);
  });
});

// ── 8. La consulta de abierta ────────────────────────────────────────────────

describe("sqliteDanoRepository — getDanoAbierto", () => {
  it("resuelve el alias DanoAbierto, utilizable por cerrarDano sin cast", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    // Un daño CERRADO (no debe aparecer) y dos abiertos.
    await repo.insertDano(dano({ id: "dano-cerrado", fin: "2026-09-14T08:00:00.000Z" }));
    await repo.insertDano(abierto({ id: "dano-abierto-1", inicio: "2026-09-14T07:00:00.000Z" }));
    await repo.insertDano(abierto({ id: "dano-abierto-2", inicio: "2026-09-14T09:00:00.000Z" }));

    // La llamada ya recibe `DanoAbierto` del tipo de retorno del puerto: no hay
    // cast en el sitio de llamada.
    const abiertoLeido: DanoAbierto | null = await repo.getDanoAbierto("M1");

    expect(abiertoLeido).not.toBeNull();
    expect(abiertoLeido!.id).toBe("dano-abierto-1");
    expect(abiertoLeido!.fin).toBeNull();

    // La prueba real de "sin cast": el dominio la consume tal cual.
    const { errores, dano: cerrado } = cerrarDano(
      abiertoLeido!,
      "2026-09-14T10:30:00.000Z",
      "se cambió el rodamiento"
    );
    expect(errores).toEqual([]);
    expect(cerrado?.fin).toBe("2026-09-14T10:30:00.000Z");
    expect(cerrado?.solucionAplicada).toBe("se cambió el rodamiento");
  });

  it("resuelve null cuando no hay ningún daño abierto", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertDano(dano({ id: "dano-cerrado", fin: "2026-09-14T08:00:00.000Z" }));

    const inexistente: DanoAbierto | null = await repo.getDanoAbierto("M1");
    expect(inexistente).toBeNull();
  });

  it("es determinista ante varios abiertos: gana el más antiguo, no el primero insertado", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    // Insertados en orden INVERSO al cronológico: sin `ORDER BY ... LIMIT 1` el
    // doble devolvería el último insertado, que NO es el más antiguo.
    await repo.insertDano(abierto({ id: "dano-nuevo", inicio: "2026-09-14T12:00:00.000Z" }));
    await repo.insertDano(abierto({ id: "dano-viejo", inicio: "2026-09-14T06:00:00.000Z" }));

    const encontrado = await repo.getDanoAbierto("M1");

    expect(encontrado!.id).toBe("dano-viejo");
  });
});

// ── 9. Un enlace colgante se liga verbatim, sin lookup propio (D2b) ──────────

describe("sqliteDanoRepository — D2b: enlace colgante, verbatim y sin lookup", () => {
  it("el INSERT liga el `paradaId` tal cual y el adaptador no consulta la tabla `parada`", async () => {
    const store = createFakeSqliteStore();
    const { repo, consultas, enlaces } = repoQueRegistra(store);
    // Daño construido a mano, SIN pasar por `registrarDano`: el dominio jamás
    // dejaría llegar un `paradaId` colgante, y por eso este es el control
    // blanco — el puerto es una frontera de almacenamiento puro.
    const colgante = dano({
      id: "dano-d2b",
      causoParada: true,
      paradaId: "parada-que-no-existe",
    });

    // El doble modela la FK y rechaza; eso se afirma aparte, más abajo. Lo que
    // importa aquí es QUÉ se intentó escribir y qué NO se hizo antes de intentarlo.
    await expect(repo.insertDano(colgante)).rejects.toThrow();

    // 1. Exactamente DOS sentencias: el pre-chequeo y el INSERT. Ni una más.
    expect(consultas).toHaveLength(2);
    expect(consultas[0]).toBe("SELECT id FROM dano WHERE id = $1");
    expect(consultas[1]).toMatch(/^INSERT INTO dano \(/);

    // 2. El adaptador NO hace lookup de su cuenta: ninguna sentencia lee otra
    //    tabla, y `parada` sólo aparece como COLUMNA, nunca como FROM.
    for (const consulta of consultas) {
      expect(consulta).not.toMatch(/FROM\s+parada/i);
      expect(consulta).not.toMatch(/FROM\s+orden/i);
    }

    // 3. El `parada_id` viaja VERBATIM, deducido del texto emitido y no de memoria.
    const insercion = enlaces[1];
    expect(valorLigado(insercion, "parada_id")).toBe("parada-que-no-existe");
    // Y el flag que lo acompaña también, sin que el uno se derive del otro.
    expect(valorLigado(insercion, "causo_parada")).toBe(1);
    expect(valorLigado(insercion, "posible_segunda")).toBe(0);
  });
});

// ── 10. Las claves foráneas fallan en voz alta ───────────────────────────────

describe("sqliteDanoRepository — enlaces no resolubles", () => {
  it("un `paradaId` inexistente hace fallar el INSERT en vez de persistir el enlace", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    // `parada-1` NO está sembrada: el enlace no resuelve.
    const roto = dano({ id: "dano-a1", causoParada: true, paradaId: "parada-inexistente" });

    const err = await repo.insertDano(roto).then(() => null, (e: unknown) => e as Error);

    // El adaptador envuelve la falla de la sentencia, conservando la causa.
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe('no se pudo persistir el daño "dano-a1"');
    expect((err!.cause as Error).message).toBe("FOREIGN KEY constraint failed");
    // NADA se persistió: un enlace roto no deja una fila a medias.
    expect(store.dano).toHaveLength(0);
  });

  it("un `ordenId` inexistente también falla: ninguna FK se relaja", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const roto = dano({ id: "dano-a1-orden", ordenId: "orden-inexistente" });

    const err = await repo.insertDano(roto).then(() => null, (e: unknown) => e as Error);

    expect(err!.message).toBe('no se pudo persistir el daño "dano-a1-orden"');
    expect((err!.cause as Error).message).toBe("FOREIGN KEY constraint failed");
    expect(store.dano).toHaveLength(0);
  });

  it("A1b — con la parada sembrada, el mismo daño SÍ persiste (el doble no rechaza todo)", async () => {
    const store = createFakeSqliteStore();
    sembrarEnlaces(store);
    const repo = repoSobre(store);
    const valido = dano({ id: "dano-a1b", causoParada: true, paradaId: "parada-1" });

    await expect(repo.insertDano(valido)).resolves.toBeUndefined();

    // La diferencia entre A1 y A1b es SÓLO la resolubilidad del enlace: prueba
    // de que el rechazo anterior no era un "rechaza todo" disfrazado.
    await expect(repo.obtenerPorId("dano-a1b")).resolves.toEqual(valido);
    expect(store.dano).toHaveLength(1);
  });
});

// ── 11. Envoltura de error con `cause` ───────────────────────────────────────

describe("sqliteDanoRepository — propagación de errores", () => {
  it("un fallo del INSERT se propaga con la causa original y nunca como éxito", async () => {
    const store = createFakeSqliteStore();
    const fallo = new Error("no such table: dano");
    const repo = new SqliteDanoRepository(dbQueFallaAlEscribir(store, fallo));

    const err = await repo.insertDano(dano({ id: "dano-falla" })).then(() => null, (e: unknown) => e as Error);

    // Descriptivo, nombrando la entidad y el id (patrón 10.3/10.4).
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe('no se pudo persistir el daño "dano-falla"');
    // La causa original se conserva: no se traga ni se convierte en éxito.
    expect(err!.cause).toBe(fallo);
    expect(store.dano).toHaveLength(0);
  });

  it("un fallo del UPDATE se propaga con la causa original y deja la fila intacta", async () => {
    const store = createFakeSqliteStore();
    // Primero, sembrar por la vía buena para que el pre-chequeo del UPDATE pase.
    await repoSobre(store).insertDano(abierto({ id: "dano-actualizable" }));
    const fallo = new Error("disk I/O error");
    const repo = new SqliteDanoRepository(dbQueFallaAlEscribir(store, fallo));

    const err = await repo
      .updateDano(dano({ id: "dano-actualizable" }))
      .then(() => null, (e: unknown) => e as Error);

    expect(err!.message).toBe('no se pudo persistir el daño "dano-actualizable"');
    expect(err!.cause).toBe(fallo);
    // La escritura no se aplicó a medias: sigue abierta y sin tocar.
    expect(store.dano[0].fin).toBeNull();
  });
});

// ── 12. Update en el mismo lugar ─────────────────────────────────────────────

describe("sqliteDanoRepository — update en el mismo lugar", () => {
  it("cerrar un daño actualiza la MISMA fila y no añade ninguna otra", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const abiertoInicial = abierto({ id: "dano-cierre" });
    await repo.insertDano(abiertoInicial);
    expect(store.dano).toHaveLength(1);

    // El flujo real de cierre: el dominio devuelve una copia con `fin`, y se
    // persiste con la misma actualización.
    const abiertoLeido = (await repo.getDanoAbierto("M1"))!;
    const { errores, dano: cerrado } = cerrarDano(
      abiertoLeido,
      "2026-09-14T10:30:00.000Z",
      "se cambió el rodamiento del eje trasero"
    );
    expect(errores).toEqual([]);
    await repo.updateDano(cerrado!);

    // Ni una fila de más: el update es in situ, no un insert disfrazado.
    expect(store.dano).toHaveLength(1);
    const fila = store.dano[0];
    expect(fila.id).toBe("dano-cierre");
    expect(fila.fin).toBe("2026-09-14T10:30:00.000Z");
    expect(fila.solucion_aplicada).toBe("se cambió el rodamiento del eje trasero");
    // La identidad y lo que no se tocó sobreviven intactos.
    expect(fila.machine_id).toBe(abiertoInicial.maquinaId);
    expect(fila.operario).toBe(abiertoInicial.operatorName);
    expect(fila.inicio).toBe(abiertoInicial.inicio);

    // Y una vez cerrado ya no aparece como abierto: el `fin IS NULL` de la
    // consulta de abiertas responde con la verdad almacenada.
    expect(await repo.getDanoAbierto("M1")).toBeNull();
    await expect(repo.obtenerPorId("dano-cierre")).resolves.toMatchObject({
      id: "dano-cierre",
      fin: "2026-09-14T10:30:00.000Z",
      solucionAplicada: "se cambió el rodamiento del eje trasero",
    });
  });

  it("updateDano escribe las 13 columnas no-PK y nunca `id` en un SET", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertDano(dano({ id: "dano-completo", tipo: "electrico" }));

    // `observaciones` se añade, `solucionAplicada` se retira y `fin` se limpia
    // en la misma llamada: un SET incompleto dejaría el valor viejo pegado.
    await repo.updateDano(
      abierto({
        id: "dano-completo",
        tipo: "electrico",
        solucionAplicada: undefined,
        observaciones: "cambio de cuadro Jessie",
      })
    );

    const fila = store.dano[0];
    expect(fila.fin).toBeNull();
    expect(fila.solucion_aplicada).toBeNull();
    expect(fila.observaciones).toBe("cambio de cuadro Jessie");
    // El id sigue siendo el mismo: la identidad no se reescribe.
    expect(fila.id).toBe("dano-completo");
  });

  it("el texto emitido es la forma prescrita: 14 placeholders y `id` sólo en el WHERE", async () => {
    const store = createFakeSqliteStore();
    const { repo, consultas } = repoQueRegistra(store);
    await repo.insertDano(dano({ id: "dano-sql" }));
    await repo.updateDano(dano({ id: "dano-sql", observaciones: "ok" }));

    const insert = consultas.find((q) => q.startsWith("INSERT INTO dano"))!;
    const update = consultas.find((q) => q.startsWith("UPDATE dano"))!;

    // INSERT: una sola sentencia con las 14 columnas y sus 14 placeholders.
    expect(insert).not.toBeUndefined();
    expect(insert.match(/\$\d+/g)).toHaveLength(14);
    // Sin upsert, sin OR REPLACE, sin transacción.
    expect(insert).not.toMatch(/OR REPLACE|ON CONFLICT|BEGIN|COMMIT/i);

    // UPDATE: 13 asignaciones no-PK, y `id` NO aparece en la lista SET.
    const set = update.slice(update.indexOf("SET ") + 4, update.indexOf(" WHERE "));
    expect(set.split(",")).toHaveLength(13);
    expect(set).not.toMatch(/(^|,\s*)id = /);
    expect(update).toContain("WHERE id = $1");
  });
});
