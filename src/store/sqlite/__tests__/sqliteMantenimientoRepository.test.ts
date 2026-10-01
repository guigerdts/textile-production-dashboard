/**
 * Ticket 10 (Phase 2) — Unit F2 — `sqliteMantenimientoRepository` suite
 *
 * WHAT THIS SUITE IS: the contract test of the maintenance SQLite adapter, over
 * the shared D2b double from Unit S
 * (`src/store/sqlite/__tests__/fakeSqliteStore.ts`). It pins the same things the
 * D2 suite pins — the mapper round trip with no `Database` in scope,
 * insert-then-read, the duplicate rejection leaving the stored record UNCHANGED,
 * the unknown-id rejection creating NOTHING, chronological ordering owned by the
 * adapter, the open-record query resolving the `MantenimientoAbierto` alias
 * without a cast at the call site, descriptive error propagation with `cause`,
 * and the update-in-place case adding no second row — plus the four things that
 * are F2's own: a maintenance NEVER carries an order link and NEVER a duration
 * (ADR 0006 / ADR 0007), `dano_id` reads back `null` for a preventive record,
 * `tipo` is narrowed by validation instead of assertion, and `listarPorOrden`
 * is absent from the port.
 *
 * WHAT THIS SUITE IS NOT: a re-test of the double (that is
 * `fakeSqliteStore.test.ts`, once, for all five suites) and not a domain test.
 * The domain rules this port deliberately does NOT enforce — a reactive
 * maintenance implying a `danoId`, a preventive never carrying one, `fin` not
 * before `inicio`, `queSeRevisoReparo` required at close, at most one open
 * maintenance per machine — live in `src/domain/mantenimiento.ts`, are
 * unchanged, and are out of scope here. Where a test builds a record BY HAND
 * instead of through the domain, that is deliberate: the port is a storage
 * boundary and the white-box cases need inputs the domain would refuse to
 * produce (a preventive record is the only one the domain itself produces with
 * `danoId: null`).
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
import { cerrarMantenimiento } from "../../../domain/mantenimiento";
import type { Mantenimiento, MantenimientoAbierto } from "../../../domain/types";
import {
  mapMantenimientoRow,
  mapMantenimientoToSql,
  SqliteMantenimientoRepository,
  type MantenimientoRow,
} from "../sqliteMantenimientoRepository";
import { createFakeSqliteStore, type FakeSqliteStore } from "./fakeSqliteStore";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Un mantenimiento completo y explícito; nada se hereda de otra fixture. Por
 * defecto es PREVENTIVO SIN enlaces ni opcionales: `danoId: null` (valor de
 * dominio legítimo, no ausencia), `fin` presente — el dominio no exige que el
 * fixture sea abierto, eso lo decide el caso.
 */
function mantenimiento(overrides: Partial<Mantenimiento> = {}): Mantenimiento {
  return {
    id: "mant-1",
    maquinaId: "M1",
    tipo: "preventivo",
    operatorName: "Laura",
    motivo: "cambio de cuadro Jessie",
    fechaOperativa: "2026-09-14",
    inicio: "2026-09-14T07:00:00.000Z",
    fin: "2026-09-14T08:00:00.000Z",
    danoId: null,
    ...overrides,
  };
}

/** Un mantenimiento abierto: `fin: null` es lo que lo marca como tal. */
function abierto(overrides: Partial<Mantenimiento> = {}): Mantenimiento {
  return mantenimiento({ fin: null, ...overrides });
}

function repoSobre(store: FakeSqliteStore): SqliteMantenimientoRepository {
  return new SqliteMantenimientoRepository(store);
}

/**
 * Siembra la fila destino de la FK de `mantenimiento`, para que un enlace sea
 * resoluble. El doble sólo exige que exista una fila con ese `id` en la tabla
 * destino; no aplica el DDL de `dano`.
 */
function sembrarDano(store: FakeSqliteStore): void {
  store.dano.push({ id: "dano-1" });
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
  repo: SqliteMantenimientoRepository;
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
  return { repo: new SqliteMantenimientoRepository(db), consultas, enlaces };
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

describe("sqliteMantenimientoRepository — mappers puros", () => {
  it("la ida y vuelta del mapper no necesita ninguna Database en scope", () => {
    // Sin `createFakeSqliteStore()` en este test: los mappers son funciones
    // puras y el round trip se demuestra sin conexión alguna.
    const original = mantenimiento({
      queSeRevisoReparo: "se cambió el cuadro Jessie",
      observaciones: "revisar tensión",
    });

    const fila = mapMantenimientoToSql(original) as unknown as MantenimientoRow;
    const recuperada = mapMantenimientoRow(fila);

    expect(recuperada).toEqual(original);
    // D1, en los dos sentidos: el vocabulario cambia en el mapper y sólo ahí.
    expect(fila.machine_id).toBe("M1");
    expect(fila.operario).toBe("Laura");
    expect(recuperada.maquinaId).toBe("M1");
    expect(recuperada.operatorName).toBe("Laura");
    // Una fila nueva, no una referencia compartida con la entrada.
    expect(recuperada).not.toBe(original);
  });

  it("traduce exactamente las 11 columnas que 004+005 declaran, ni una más ni una menos", () => {
    const fila = mapMantenimientoToSql(mantenimiento());

    expect(Object.keys(fila).sort()).toEqual([
      "dano_id",
      "fecha_operativa",
      "fin",
      "id",
      "inicio",
      "machine_id",
      "motivo",
      "observaciones",
      "operario",
      "que_se_reviso_reparo",
      "tipo",
    ]);
    // Ni un orden_id ni una duracion: ADR 0006 y ADR 0007 son formas (las
    // columnas no existen), no reglas que se relajen. Ausentes por construcción.
    expect(Object.keys(fila)).not.toContain("orden_id");
    expect(Object.keys(fila)).not.toContain("duracion");
    expect(Object.keys(fila)).not.toContain("machine");

    // La lectura produce SIEMPRE los 7 campos del dominio, con forma estable:
    // los dos opcionales aparecen con valor `undefined` en vez de omitirse.
    expect(Object.keys(mapMantenimientoRow(fila)).sort()).toEqual([
      "danoId",
      "fechaOperativa",
      "fin",
      "id",
      "inicio",
      "maquinaId",
      "motivo",
      "observaciones",
      "operatorName",
      "queSeRevisoReparo",
      "tipo",
    ]);
    // Nada que no esté en el dominio: ningún ordenId, ninguna duracion.
    expect(Object.keys(mapMantenimientoRow(fila))).not.toContain("ordenId");
    expect(Object.keys(mapMantenimientoRow(fila))).not.toContain("duracion");
  });

  it("escribe los opcionales ausentes como null y los lee como undefined", () => {
    const sinOpcionales = abierto({ id: "mant-sin" });

    const fila = mapMantenimientoToSql(sinOpcionales);
    // NUNCA `""` ni `undefined`: la columna es NULL y punto.
    expect(fila.que_se_reviso_reparo).toBeNull();
    expect(fila.observaciones).toBeNull();
    expect(fila.fin).toBeNull();

    const recuperada = mapMantenimientoRow(fila);
    expect(recuperada.queSeRevisoReparo).toBeUndefined();
    expect(recuperada.observaciones).toBeUndefined();
    // `fin` se conserva como `null`: es lo que significa "abierto".
    expect(recuperada.fin).toBeNull();

    // Y un valor opcional PRESENTE sobrevive: `?? undefined` no borra lo real.
    const conTodo = mapMantenimientoRow(
      mapMantenimientoToSql(
        mantenimiento({
          queSeRevisoReparo: "se cambió la malla",
          observaciones: "tensión al máximo",
        })
      )
    );
    expect(conTodo.queSeRevisoReparo).toBe("se cambió la malla");
    expect(conTodo.observaciones).toBe("tensión al máximo");
  });

  it("conserva `danoId` nulo como valor: un preventivo NO tiene daño vinculado", () => {
    const fila = mapMantenimientoToSql(mantenimiento());
    expect(fila.dano_id).toBeNull();

    const recuperada = mapMantenimientoRow(fila);
    // A diferencia de los opcionales, aquí `null` es un valor de dominio: un
    // mantenimiento preventivo no se vincula a ningún daño. Nunca `undefined`.
    expect(recuperada.danoId).toBeNull();
  });

  it("un `danoId` presente viaja verbatim y se lee idéntico (mantenimiento reactivo)", () => {
    const fila = mapMantenimientoToSql(
      mantenimiento({ tipo: "reactivo", danoId: "dano-1" })
    );
    expect(fila.dano_id).toBe("dano-1");

    const recuperada = mapMantenimientoRow(fila);
    expect(recuperada.tipo).toBe("reactivo");
    expect(recuperada.danoId).toBe("dano-1");
  });

  it("estrecha `tipo` por VALIDACIÓN, no por aserción: un valor corrupto falla en voz alta", () => {
    // La columna es TEXT; el catálogo del dominio tiene dos valores. Un byte
    // ajeno ("REACTIVO", "") jamás debe entrar al dominio con un TipoMantenimientoId.
    const fila = mapMantenimientoToSql(mantenimiento()) as unknown as MantenimientoRow;
    fila.tipo = "REACTIVO";

    const err = (() => {
      try {
        mapMantenimientoRow(fila);
        return null;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe(
      'no se pudo mapear el mantenimiento "mant-1": el tipo "REACTIVO" no es un tipo de mantenimiento conocido ("reactivo" | "preventivo")'
    );
    expect((err!.cause as Error).message).toBe(
      'valor inesperado en la columna "tipo": "REACTIVO"'
    );
  });
});

// ── 2. Insertar y leer ───────────────────────────────────────────────────────

describe("sqliteMantenimientoRepository — insertar y leer", () => {
  it("insertMantenimiento resuelve y obtenerPorId devuelve el registro", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const original = mantenimiento({
      tipo: "reactivo",
      danoId: "dano-1",
      queSeRevisoReparo: "se cambió el rodamiento",
      observaciones: "fue reactivo tras el daño",
    });
    // Reactivo con enlace: el dueño de la FK es el doble, no este test.
    sembrarDano(store);

    await repo.insertMantenimiento(original);
    expect(store.mantenimiento).toHaveLength(1);

    await expect(repo.obtenerPorId(original.id)).resolves.toEqual(original);
  });

  it("obtenerPorId resuelve undefined — nunca null — para un id ausente", async () => {
    const repo = repoSobre(createFakeSqliteStore());

    await expect(repo.obtenerPorId("no-existe")).resolves.toBeUndefined();
  });

  it("inserta un mantenimiento preventivo sin enlace ni opcionales sin inventar valores", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const preventivo = abierto({ id: "mant-preventivo" });
    await repo.insertMantenimiento(preventivo);

    const fila = store.mantenimiento[0];
    expect(fila.dano_id).toBeNull();
    expect(fila.que_se_reviso_reparo).toBeNull();
    expect(fila.observaciones).toBeNull();
    expect(fila.fin).toBeNull();

    // La lectura reconstruye el dominio tal cual: `danoId` null, opcionales ausentes.
    await expect(repo.obtenerPorId("mant-preventivo")).resolves.toEqual(preventivo);
  });
});

// ── 3. Rechazo por duplicado ─────────────────────────────────────────────────

describe("sqliteMantenimientoRepository — rechazo por duplicado", () => {
  it("insertMantenimiento rechaza el id repetido y la fila conserva los valores originales", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const original = mantenimiento({ id: "mant-dupe", motivo: "original" });
    await repo.insertMantenimiento(original);

    // El duplicado no es un no-op: es un RECHAZO, y lo que ya estaba NO cambia.
    const duplicado = mantenimiento({ id: "mant-dupe", motivo: "copia tardía" });
    await expect(repo.insertMantenimiento(duplicado)).rejects.toThrow(
      "ya existe un mantenimiento con el id mant-dupe"
    );

    expect(store.mantenimiento).toHaveLength(1);
    const fila = store.mantenimiento[0];
    expect(fila.motivo).toBe("original");

    // El error del adaptador es exacto, sin envoltura adicional.
    await expect(repo.insertMantenimiento(duplicado)).rejects.toMatchObject({
      message: "ya existe un mantenimiento con el id mant-dupe",
    });
  });
});

// ── 4. Rechazo por id desconocido ────────────────────────────────────────────

describe("sqliteMantenimientoRepository — rechazo por id desconocido", () => {
  it("updateMantenimiento rechaza un id ausente y no crea ninguna fila", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);

    await expect(repo.updateMantenimiento(mantenimiento())).rejects.toThrow(
      "no existe un mantenimiento con el id mant-1"
    );

    // NADA se guardó: una actualización nunca es un insert disfrazado.
    expect(store.mantenimiento).toHaveLength(0);
  });
});

// ── 5. Orden cronológico ─────────────────────────────────────────────────────

describe("sqliteMantenimientoRepository — orden cronológico", () => {
  it("listarPorMaquina ordena por inicio aunque se inserten desordenadas", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    // Se insertan en orden inverso a la cronología.
    await repo.insertMantenimiento(mantenimiento({ id: "mant-tarde", inicio: "2026-09-14T09:00:00.000Z" }));
    await repo.insertMantenimiento(mantenimiento({ id: "mant-temprano", inicio: "2026-09-14T07:00:00.000Z" }));
    await repo.insertMantenimiento(mantenimiento({ id: "mant-medio", inicio: "2026-09-14T08:00:00.000Z" }));

    const lista = await repo.listarPorMaquina("M1");
    expect(lista.map((m) => m.id)).toEqual(["mant-temprano", "mant-medio", "mant-tarde"]);
  });

  it("listarPorMaquina no mezcla máquinas y devuelve abiertas y cerradas", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    // El tipo del dominio sólo admite "M1" (una sola máquina), pero el adaptador
    // filtra por la columna: un valor de otra máquina en la tabla no contamina.
    store.mantenimiento.push({
      id: "mant-otra",
      machine_id: "M2",
      tipo: "preventivo",
      operario: "Laura",
      motivo: "otro",
      inicio: "2026-09-14T07:00:00.000Z",
      fin: null,
      que_se_reviso_reparo: null,
      dano_id: null,
      observaciones: null,
    });
    await repo.insertMantenimiento(mantenimiento({ id: "mant-a", inicio: "2026-09-14T08:00:00.000Z" }));
    await repo.insertMantenimiento(abierto({ id: "mant-abierta", inicio: "2026-09-14T06:00:00.000Z" }));

    const lista = await repo.listarPorMaquina("M1");
    expect(lista.map((m) => m.id)).toEqual(["mant-abierta", "mant-a"]);
  });
});

// ── 6. Consulta de abiertas ──────────────────────────────────────────────────

describe("sqliteMantenimientoRepository — getMantenimientoAbierto", () => {
  it("resuelve el alias MantenimientoAbierto, utilizable por cerrarMantenimiento sin cast", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const registro = abierto({ id: "mant-abierto" });
    await repo.insertMantenimiento(registro);

    const abiertaL = await repo.getMantenimientoAbierto("M1");
    expect(abiertaL).not.toBeNull();
    // El contrato del puerto es `MantenimientoAbierto` (fin: null); el llamador
    // no casta nada.
    const finDeAbierta: MantenimientoAbierto["fin"] = abiertaL!.fin;
    expect(finDeAbierta).toBeNull();

    // Y el flujo real: el dominio la cierra y el adaptador la persiste.
    const { errores, mantenimiento: cerrado } = cerrarMantenimiento(
      abiertaL!,
      "2026-09-14T10:30:00.000Z",
      "se cambió la malla del cuadro 3"
    );
    expect(errores).toEqual([]);
    await repo.updateMantenimiento(cerrado!);
  });

  it("resuelve null cuando no hay ningún mantenimiento abierto", async () => {
    const repo = repoSobre(createFakeSqliteStore());

    await expect(repo.getMantenimientoAbierto("M1")).resolves.toBeNull();
  });

  it("es determinista ante varios abiertos: gana el más antiguo, no el primero insertado", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    // Se inserta primero la MÁS NUEVA; la consulta debe preferir la más antigua.
    await repo.insertMantenimiento(abierto({ id: "mant-nuevo", inicio: "2026-09-14T09:00:00.000Z" }));
    await repo.insertMantenimiento(abierto({ id: "mant-viejo", inicio: "2026-09-14T07:00:00.000Z" }));

    const abiertaL = await repo.getMantenimientoAbierto("M1");
    expect(abiertaL?.id).toBe("mant-viejo");
  });
});

// ── 7. El puerto NO tiene listarPorOrden ─────────────────────────────────────

describe("sqliteMantenimientoRepository — ausencia de listarPorOrden", () => {
  it("el adaptador y el puerto no exponen la consulta por orden (ADR 0006)", async () => {
    const repo = repoSobre(createFakeSqliteStore());
    // En runtime: ni siquiera existe el método. Un mantenimiento es un evento de
    // MÁQUINA, nunca de una orden, así que el puerto no tiene esa consulta.
    expect("listarPorOrden" in repo).toBe(false);
  });
});

// ── 8. D2b: enlace colgante, verbatim y sin lookup ───────────────────────────

describe("sqliteMantenimientoRepository — D2b: enlace colgante, verbatim y sin lookup", () => {
  it("el INSERT liga el `danoId` tal cual y el adaptador no consulta la tabla `dano`", async () => {
    const store = createFakeSqliteStore();
    const { repo, consultas, enlaces } = repoQueRegistra(store);
    // Mantenimiento construido a mano, SIN pasar por `registrarMantenimiento`:
    // el dominio jamás dejaría llegar un `danoId` colgante, y por eso este es el
    // control blanco — el puerto es una frontera de almacenamiento puro.
    const colgante = mantenimiento({ tipo: "reactivo", danoId: "dano-que-no-existe" });

    // El doble modela la FK y rechaza; eso se afirma aparte, más abajo. Lo que
    // importa aquí es QUÉ se intentó escribir y qué NO se hizo antes de intentarlo.
    await expect(repo.insertMantenimiento(colgante)).rejects.toThrow();

    // 1. Exactamente DOS sentencias: el pre-chequeo y el INSERT. Ni una más.
    expect(consultas).toHaveLength(2);
    expect(consultas[0]).toBe("SELECT id FROM mantenimiento WHERE id = $1");
    expect(consultas[1]).toMatch(/^INSERT INTO mantenimiento \(/);

    // 2. El adaptador NO hace lookup de su cuenta: `dano` sólo aparece como
    //    COLUMNA (dano_id), nunca como FROM.
    for (const consulta of consultas) {
      expect(consulta).not.toMatch(/FROM\s+dano/i);
      expect(consulta).not.toMatch(/FROM\s+orden/i);
    }

    // 3. El `dano_id` viaja VERBATIM, deducido del texto emitido y no de memoria.
    const insercion = enlaces[1];
    expect(valorLigado(insercion, "dano_id")).toBe("dano-que-no-existe");
    // Y el INSERT no inventa ninguna de las columnas prohibidas.
    expect(valorLigado(insercion, "tipo")).toBe("reactivo");
    expect(insercion.query).not.toMatch(/orden_id/i);
    expect(insercion.query).not.toMatch(/duracion/i);
  });
});

// ── 9. Las claves foráneas fallan en voz alta ────────────────────────────────

describe("sqliteMantenimientoRepository — enlaces no resolubles", () => {
  it("un `danoId` inexistente hace fallar el INSERT en vez de persistir el enlace", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    // `dano-1` NO está sembrada: el enlace no resuelve.
    const roto = mantenimiento({ id: "mant-a1", tipo: "reactivo", danoId: "dano-inexistente" });

    const err = await repo.insertMantenimiento(roto).then(() => null, (e: unknown) => e as Error);

    // El adaptador envuelve la falla de la sentencia, conservando la causa.
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe('no se pudo persistir el mantenimiento "mant-a1"');
    expect((err!.cause as Error).message).toBe("FOREIGN KEY constraint failed");
    // NADA se persistió: un enlace roto no deja una fila a medias.
    expect(store.mantenimiento).toHaveLength(0);
  });

  it("A1b — con el daño sembrado, el mismo mantenimiento SÍ persiste (el doble no rechaza todo)", async () => {
    const store = createFakeSqliteStore();
    sembrarDano(store);
    const repo = repoSobre(store);
    const valido = mantenimiento({
      id: "mant-a1b",
      tipo: "reactivo",
      danoId: "dano-1",
    });

    await expect(repo.insertMantenimiento(valido)).resolves.toBeUndefined();

    // La diferencia entre A1 y A1b es SÓLO la resolubilidad del enlace: prueba
    // de que el rechazo anterior no era un "rechaza todo" disfrazado.
    await expect(repo.obtenerPorId("mant-a1b")).resolves.toEqual(valido);
    expect(store.mantenimiento).toHaveLength(1);
  });
});

// ── 10. Envoltura de error con `cause` ───────────────────────────────────────

describe("sqliteMantenimientoRepository — propagación de errores", () => {
  it("un fallo del INSERT se propaga con la causa original y nunca como éxito", async () => {
    const store = createFakeSqliteStore();
    const fallo = new Error("no such table: mantenimiento");
    const repo = new SqliteMantenimientoRepository(dbQueFallaAlEscribir(store, fallo));

    const err = await repo
      .insertMantenimiento(mantenimiento({ id: "mant-falla" }))
      .then(() => null, (e: unknown) => e as Error);

    // Descriptivo, nombrando la entidad y el id (patrón 10.3/10.4).
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe('no se pudo persistir el mantenimiento "mant-falla"');
    // La causa original se conserva: no se traga ni se convierte en éxito.
    expect(err!.cause).toBe(fallo);
    expect(store.mantenimiento).toHaveLength(0);
  });

  it("un fallo del UPDATE se propaga con la causa original y deja la fila intacta", async () => {
    const store = createFakeSqliteStore();
    // Primero, sembrar por la vía buena para que el pre-chequeo del UPDATE pase.
    await repoSobre(store).insertMantenimiento(abierto({ id: "mant-actualizable" }));
    const fallo = new Error("disk I/O error");
    const repo = new SqliteMantenimientoRepository(dbQueFallaAlEscribir(store, fallo));

    const err = await repo
      .updateMantenimiento(mantenimiento({ id: "mant-actualizable" }))
      .then(() => null, (e: unknown) => e as Error);

    expect(err!.message).toBe('no se pudo persistir el mantenimiento "mant-actualizable"');
    expect(err!.cause).toBe(fallo);
    // La escritura no se aplicó a medias: sigue abierta y sin tocar.
    expect(store.mantenimiento[0].fin).toBeNull();
  });
});

// ── 11. Update en el mismo lugar ─────────────────────────────────────────────

describe("sqliteMantenimientoRepository — update en el mismo lugar", () => {
  it("cerrar un mantenimiento actualiza la MISMA fila y no añade ninguna otra", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const abiertoInicial = abierto({ id: "mant-cierre" });
    await repo.insertMantenimiento(abiertoInicial);
    expect(store.mantenimiento).toHaveLength(1);

    // El flujo real de cierre: el dominio devuelve una copia con `fin`, y se
    // persiste con la misma actualización.
    const abiertoLeido = (await repo.getMantenimientoAbierto("M1"))!;
    const { errores, mantenimiento: cerrado } = cerrarMantenimiento(
      abiertoLeido,
      "2026-09-14T10:30:00.000Z",
      "se cambió la malla del cuadro 3"
    );
    expect(errores).toEqual([]);
    await repo.updateMantenimiento(cerrado!);

    // Ni una fila de más: el update es in situ, no un insert disfrazado.
    expect(store.mantenimiento).toHaveLength(1);
    const fila = store.mantenimiento[0];
    expect(fila.id).toBe("mant-cierre");
    expect(fila.fin).toBe("2026-09-14T10:30:00.000Z");
    expect(fila.que_se_reviso_reparo).toBe("se cambió la malla del cuadro 3");
    // La identidad y lo que no se tocó sobreviven intactos.
    expect(fila.machine_id).toBe(abiertoInicial.maquinaId);
    expect(fila.operario).toBe(abiertoInicial.operatorName);
    expect(fila.inicio).toBe(abiertoInicial.inicio);
    // ADR 0007: este update NO inventa ninguna columna de duración.
    expect("duracion" in fila).toBe(false);

    // Y una vez cerrado ya no aparece como abierto: el `fin IS NULL` de la
    // consulta de abiertas responde con la verdad almacenada.
    expect(await repo.getMantenimientoAbierto("M1")).toBeNull();
    await expect(repo.obtenerPorId("mant-cierre")).resolves.toMatchObject({
      id: "mant-cierre",
      fin: "2026-09-14T10:30:00.000Z",
      queSeRevisoReparo: "se cambió la malla del cuadro 3",
    });
  });

  it("updateMantenimiento escribe las 10 columnas no-PK y nunca `id` en un SET", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertMantenimiento(mantenimiento({ id: "mant-completo" }));

    // `observaciones` se añade, `queSeRevisoReparo` se retira y `fin` se limpia
    // en la misma llamada: un SET incompleto dejaría el valor viejo pegado.
    await repo.updateMantenimiento(
      abierto({
        id: "mant-completo",
        queSeRevisoReparo: undefined,
        observaciones: "cambio de cuadro Jessie",
      })
    );

    const fila = store.mantenimiento[0];
    expect(fila.fin).toBeNull();
    expect(fila.que_se_reviso_reparo).toBeNull();
    expect(fila.observaciones).toBe("cambio de cuadro Jessie");
    // El id sigue siendo el mismo: la identidad no se reescribe.
    expect(fila.id).toBe("mant-completo");
  });

  it("el texto emitido es la forma prescrita: 11 placeholders y `id` sólo en el WHERE", async () => {
    const store = createFakeSqliteStore();
    const { repo, consultas } = repoQueRegistra(store);
    await repo.insertMantenimiento(mantenimiento({ id: "mant-sql" }));
    await repo.updateMantenimiento(mantenimiento({ id: "mant-sql", observaciones: "ok" }));

    const insert = consultas.find((q) => q.startsWith("INSERT INTO mantenimiento"))!;
    const update = consultas.find((q) => q.startsWith("UPDATE mantenimiento"))!;

    // INSERT: una sola sentencia con las 11 columnas y sus 11 placeholders.
    expect(insert).not.toBeUndefined();
    expect(insert.match(/\$\d+/g)).toHaveLength(11);
    // Sin upsert, sin OR REPLACE, sin transacción, sin columnas prohibidas.
    expect(insert).not.toMatch(/OR REPLACE|ON CONFLICT|BEGIN|COMMIT/i);
    expect(insert).not.toMatch(/orden_id|duracion/i);

    // UPDATE: 10 asignaciones no-PK, y `id` NO aparece en la lista SET.
    const set = update.slice(update.indexOf("SET ") + 4, update.indexOf(" WHERE "));
    expect(set.split(",")).toHaveLength(10);
    expect(set).not.toMatch(/(^|,\s*)id = /);
    expect(update).toContain("WHERE id = $1");
    expect(update).not.toMatch(/orden_id|duracion/i);
  });
});