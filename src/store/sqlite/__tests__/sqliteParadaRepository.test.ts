/**
 * Unit B2 (CORRECTION 10) — `sqliteParadaRepository` suite.
 *
 * Mismo contrato que `InMemoryParadaRepository` (paradasRepository.test.ts),
 * mismo doble compartido que sus hermanos (fakeSqliteStore.ts) y la misma
 * disciplina que la suite F2: los mappers se prueban sin conexión, las
 * sentencias se fijan por texto (D2j), los rechazos viajan verbatim y los
 * fallos de I/O se envuelven con causa.
 *
 * D2d — HONESTY NOTE: el adaptador no abre ni cierra conexiones; consume la
 * Database que recibe y cierra en el mismo lugar en que la creó. Este archivo
 * no toca `path`, `close` ni el DDL real: la migración 004 se prueba aparte.
 */
import { describe, expect, it } from "vitest";
import type Database from "@tauri-apps/plugin-sql";
import { cerrarParada, registrarParada } from "../../../domain/paradas";
import type { Parada, ParadaAbierta } from "../../../domain/types";
import {
  mapParadaRow,
  mapParadaToSql,
  SqliteParadaRepository,
  type ParadaRow,
} from "../sqliteParadaRepository";
import { createFakeSqliteStore, type FakeSqliteStore } from "./fakeSqliteStore";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Una parada completa y explícita; nada se hereda de otra fixture. Por
 * defecto es SIN orden (dominio legítimo), SIN opcionales y CERRADA: el
 * dominio no exige que el fixture esté abierto, eso lo decide el caso. La
 * causa por defecto, `falta_tela`, no exige campos específicos.
 */
function parada(overrides: Partial<Parada> = {}): Parada {
  return {
    id: "parada-1",
    maquinaId: "M1",
    ordenId: null,
    operatorName: "Laura",
    causaId: "falta_tela",
    camposEspecificos: {},
    fechaOperativa: "2026-09-14",
    inicio: "2026-09-14T07:00:00.000Z",
    fin: "2026-09-14T08:00:00.000Z",
    ...overrides,
  };
}

/** Una parada abierta: `fin: null` es lo que la marca como tal. */
function abierta(overrides: Partial<Parada> = {}): Parada {
  return parada({ fin: null, ...overrides });
}

function repoSobre(store: FakeSqliteStore): SqliteParadaRepository {
  return new SqliteParadaRepository(store);
}

/**
 * Siembra la fila destino de la FK de `parada`, para que un enlace sea
 * resoluble. El doble sólo exige que exista una fila con ese `id` en la tabla
 * destino; no aplica el DDL de `orden`.
 */
function sembrarOrden(store: FakeSqliteStore, id = "ord-1"): void {
  store.orden.push({ id });
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

/** Como `repoSobre`, pero además registra cada sentencia y sus binds, para fijarlas por texto. */
function repoQueRegistra(store: FakeSqliteStore): {
  repo: SqliteParadaRepository;
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
  return { repo: new SqliteParadaRepository(db), consultas, enlaces };
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

/**
 * El valor ligado a `columna` en un UPDATE, deducido de la parte SET del
 * propio texto emitido. Mismo espíritu que `valorLigado`, pero para la forma
 * `SET col = $n, ... WHERE id = $n` (los mappers no declaran placeholders).
 */
function valorLigadoUpdate(
  enlace: { query: string; binds: unknown[] },
  columna: string
): unknown {
  const setParte = enlace.query.slice(
    enlace.query.indexOf("SET ") + "SET ".length,
    enlace.query.indexOf(" WHERE ")
  );
  for (const asignacion of setParte.split(",").map((a) => a.trim())) {
    const a = /^(\w+) = \$(\d+)$/.exec(asignacion);
    if (!a) throw new Error("asignación no soportada");
    if (a[1] === columna) return enlace.binds[Number(a[2]) - 1];
  }
  throw new Error(`el UPDATE no asigna la columna ${columna}`);
}

// ── 1. Los mappers son puros: ida y vuelta sin conexión ──────────────────────

describe("sqliteParadaRepository — mappers puros", () => {
  it("la ida y vuelta del mapper no necesita ninguna Database en scope", () => {
    // Sin `createFakeSqliteStore()` en este test: los mappers son funciones
    // puras y el round trip se demuestra sin conexión alguna.
    const original = parada({
      id: "parada-campos",
      ordenId: "ord-1",
      causaId: "rotura_cuadro",
      camposEspecificos: { carro: 3, cuadro: "Jessie" },
      observaciones: "grieta en el marco",
    });

    const fila = mapParadaToSql(original) as unknown as ParadaRow;
    const recuperada = mapParadaRow(fila);

    expect(recuperada).toEqual(original);
    // D1, en los dos sentidos: el vocabulario cambia en el mapper y sólo ahí.
    expect(fila.machine_id).toBe("M1");
    expect(fila.operario).toBe("Laura");
    expect(fila.orden_id).toBe("ord-1");
    expect(recuperada.maquinaId).toBe("M1");
    expect(recuperada.operatorName).toBe("Laura");
    expect(recuperada.ordenId).toBe("ord-1");
    // Una fila nueva, no una referencia compartida con la entrada.
    expect(recuperada).not.toBe(original);
  });

  it("traduce exactamente las 10 columnas que 004+005 declaran, ni una más ni una menos", () => {
    const valores = mapParadaToSql(parada());
    expect(Object.keys(valores).sort()).toEqual(
      [
        "id",
        "machine_id",
        "orden_id",
        "operario",
        "causa_id",
        "campos_especificos",
        "observaciones",
        "inicio",
        "fin",
        "fecha_operativa",
      ].sort()
    );
  });

  it("preserva los nulos de dominio: ordenId null, fin null y opcionales ausentes", () => {
    const abiertaSinOrden = abierta({ id: "parada-nulls" });

    const fila = mapParadaToSql(abiertaSinOrden) as unknown as ParadaRow;
    expect(fila.orden_id).toBeNull();
    expect(fila.fin).toBeNull();
    expect(fila.observaciones).toBeNull();

    const recuperada = mapParadaRow(fila);
    expect(recuperada.ordenId).toBeNull();
    expect(recuperada.fin).toBeNull();
    // El opcional ausente vuelve ausente, nunca "" ni un string vacío.
    expect(recuperada.observaciones).toBeUndefined();
  });

  it("serializa campos_especificos como JSON text y lo devuelve idéntico", () => {
    const original = parada({
      camposEspecificos: { carrosAfectados: [2, 5], motivo: "registro", mix: { a: 1 } },
    });

    const fila = mapParadaToSql(original) as unknown as ParadaRow;
    expect(fila.campos_especificos).toBe(
      JSON.stringify({ carrosAfectados: [2, 5], motivo: "registro", mix: { a: 1 } })
    );

    const recuperada = mapParadaRow(fila);
    expect(recuperada.camposEspecificos).toEqual({
      carrosAfectados: [2, 5],
      motivo: "registro",
      mix: { a: 1 },
    });
  });

  it("un causa_id desconocido es un error de mapeo con causa, nunca un `as`", () => {
    const fila: ParadaRow = {
      id: "parada-mala-causa",
      machine_id: "M1",
      orden_id: null,
      operario: "Laura",
      causa_id: "explosion",
      campos_especificos: "{}",
      observaciones: null,
      fecha_operativa: "2026-09-14",
      inicio: "2026-09-14T07:00:00.000Z",
      fin: null,
    };

    expect(() => mapParadaRow(fila)).toThrow(
      'no se pudo mapear la parada "parada-mala-causa": causa_id desconocido: "explosion"'
    );
  });

  it("un JSON inválido en campos_especificos es un error de mapeo con causa", () => {
    const fila = mapParadaToSql(parada()) as unknown as ParadaRow;
    fila.campos_especificos = "{mal";

    expect(() => mapParadaRow(fila)).toThrow(
      'no se pudo mapear la parada "parada-1"'
    );
  });

  it("un JSON no-objeto en campos_especificos es un error, nunca un silencio", () => {
    const fila = mapParadaToSql(parada()) as unknown as ParadaRow;
    fila.campos_especificos = "[1,2,3]";

    expect(() => mapParadaRow(fila)).toThrow(
      'no se pudo mapear la parada "parada-1"'
    );
  });
});

// ── 2. Insertar y leer ───────────────────────────────────────────────────────

describe("sqliteParadaRepository — insertar y leer", () => {
  it("insertParada resuelve y obtenerPorId devuelve el registro", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const original = parada({
      id: "parada-leida",
      ordenId: "ord-1",
      causaId: "falta_color",
      camposEspecificos: { color: "cyan" },
      observaciones: "faltaba la tinta reactiva",
    });
    // Con enlace: el dueño de la FK es el doble, no este test.
    sembrarOrden(store);

    await repo.insertParada(original);
    expect(store.parada).toHaveLength(1);

    await expect(repo.obtenerPorId(original.id)).resolves.toEqual(original);
  });

  it("obtenerPorId resuelve undefined — nunca null — para un id ausente", async () => {
    const repo = repoSobre(createFakeSqliteStore());

    await expect(repo.obtenerPorId("no-existe")).resolves.toBeUndefined();
  });

  it("inserta una parada sin orden ni opcionales sin inventar valores", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const suelta = abierta({ id: "parada-suelta" });
    await repo.insertParada(suelta);

    const fila = store.parada[0];
    expect(fila.orden_id).toBeNull();
    expect(fila.observaciones).toBeNull();
    expect(fila.fin).toBeNull();

    // La lectura reconstruye el dominio tal cual: ordenId null, opcionales ausentes.
    await expect(repo.obtenerPorId("parada-suelta")).resolves.toEqual(suelta);
  });
});

// ── 3. Rechazo por duplicado ─────────────────────────────────────────────────

describe("sqliteParadaRepository — rechazo por duplicado", () => {
  it("insertParada rechaza el id repetido y la fila conserva los valores originales", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const original = parada({ id: "parada-dupe", causaId: "atasco_tela" });
    await repo.insertParada(original);

    // El duplicado no es un no-op: es un RECHAZO, y lo que ya estaba NO cambia.
    const duplicado = parada({ id: "parada-dupe", causaId: "problema_horno" });
    await expect(repo.insertParada(duplicado)).rejects.toThrow(
      "ya existe una parada con el id parada-dupe"
    );

    expect(store.parada).toHaveLength(1);
    const fila = store.parada[0];
    expect(fila.causa_id).toBe("atasco_tela");
  });
});

// ── 4. Rechazo por id desconocido ────────────────────────────────────────────

describe("sqliteParadaRepository — rechazo por id desconocido", () => {
  it("updateParada rechaza un id inexistente con el mensaje del port", async () => {
    const repo = repoSobre(createFakeSqliteStore());

    await expect(repo.updateParada(parada({ id: "fantasma", fin: null }))).rejects.toThrow(
      "no existe una parada con el id fantasma"
    );
  });

  it("updateParada acepta un id existente y deja una sola fila", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const original = abierta({ id: "parada-update", operatorName: "Laura" });
    await repo.insertParada(original);

    await repo.updateParada(parada({ id: "parada-update", operatorName: "Marcos" }));

    expect(store.parada).toHaveLength(1);
    expect(store.parada[0].operario).toBe("Marcos");
    await expect(repo.obtenerPorId("parada-update")).resolves.toMatchObject({
      operatorName: "Marcos",
    });
  });
});

// ── 5. Orden cronológico de los listados ─────────────────────────────────────

describe("sqliteParadaRepository — orden cronológico", () => {
  it("listarPorMaquina ordena por inicio ASC e incluye las paradas sin orden", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertParada(parada({ id: "p-tarde", inicio: "2026-09-14T09:00:00.000Z" }));
    await repo.insertParada(parada({ id: "p-temprano", inicio: "2026-09-14T07:00:00.000Z" }));
    await repo.insertParada(parada({ id: "p-medio", inicio: "2026-09-14T08:00:00.000Z" }));

    const listadas = await repo.listarPorMaquina("M1");

    expect(listadas.map((p) => p.id)).toEqual(["p-temprano", "p-medio", "p-tarde"]);
  });

  it("listarPorOrden ordena por inicio ASC y excluye las paradas sin orden", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    sembrarOrden(store);
    await repo.insertParada(
      parada({ id: "p-ord-tarde", ordenId: "ord-1", inicio: "2026-09-14T09:00:00.000Z" })
    );
    await repo.insertParada(parada({ id: "p-ord-temprano", ordenId: "ord-1", inicio: "2026-09-14T07:00:00.000Z" }));
    await repo.insertParada(parada({ id: "p-suelta", inicio: "2026-09-14T08:00:00.000Z" }));

    const deLaOrden = await repo.listarPorOrden("ord-1");

    expect(deLaOrden.map((p) => p.id)).toEqual(["p-ord-temprano", "p-ord-tarde"]);
  });
});

// ── 6. getParadaAbierta: el predicado null-safe `IS $2` ──────────────────────

describe("sqliteParadaRepository — getParadaAbierta", () => {
  it("con ordenId null devuelve la abierta SIN orden, nunca la de una orden", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    sembrarOrden(store);
    await repo.insertParada(abierta({ id: "p-abierta-con-orden", ordenId: "ord-1" }));
    await repo.insertParada(abierta({ id: "p-abierta-suelta", inicio: "2026-09-14T06:00:00.000Z" }));

    const leida = await repo.getParadaAbierta("M1", null);

    expect(leida?.id).toBe("p-abierta-suelta");
    expect(leida?.ordenId).toBeNull();
  });

  it("con ordenId concreto devuelve la abierta de esa orden (flujo real de dominio)", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    sembrarOrden(store);

    const resultado = registrarParada([], {
      maquinaId: "M1",
      ordenId: "ord-1",
      operatorName: "Laura",
      causaId: "ajuste_registro",
      camposEspecificos: { carrosAfectados: [3] },
      fechaOperativa: "2026-09-14",
      inicio: "2026-09-14T07:00:00.000Z",
    });
    expect(resultado.errores).toEqual([]);
    const abiertaPorDominio = resultado.parada as ParadaAbierta;

    await repo.insertParada(abiertaPorDominio);
    await expect(repo.getParadaAbierta("M1", "ord-1")).resolves.toEqual(abiertaPorDominio);

    // El cierre también es del dominio: cerrarParada produce la Parada que se
    // persiste con update, y la lectura ya no encuentra ninguna abierta.
    const cerrada = cerrarParada(abiertaPorDominio, "2026-09-14T08:00:00.000Z");
    expect(cerrada.errores).toEqual([]);
    await repo.updateParada(cerrada.parada as Parada);

    await expect(repo.getParadaAbierta("M1", "ord-1")).resolves.toBeNull();
  });

  it("resuelve null — nunca undefined — cuando no hay ninguna abierta", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertParada(parada({ id: "p-cerrada" }));

    await expect(repo.getParadaAbierta("M1", null)).resolves.toBeNull();
  });

  it("ante varias abiertas de la misma máquina+orden, elige la más antigua (LIMIT 1)", async () => {
    // El dominio impide esto (una sola abierta por máquina+orden); el doble lo
    // modela igual: el orden por inicio + LIMIT 1 es determinista.
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertParada(abierta({ id: "p-abierta-tarde", inicio: "2026-09-14T08:00:00.000Z" }));
    await repo.insertParada(abierta({ id: "p-abierta-temprana", inicio: "2026-09-14T07:00:00.000Z" }));

    const leida = await repo.getParadaAbierta("M1", null);

    expect(leida?.id).toBe("p-abierta-temprana");
  });

  it("emite UNA sola sentencia null-safe, sin ramas, para null y para id", async () => {
    const store = createFakeSqliteStore();
    const { repo, consultas, enlaces } = repoQueRegistra(store);
    await repo.insertParada(abierta({ id: "p-x" }));

    consultas.length = 0;
    enlaces.length = 0;
    await repo.getParadaAbierta("M1", null);
    await repo.getParadaAbierta("M1", "ord-1");

    // Las dos llamadas usan la MISMA sentencia; sólo cambia el bind. Ningún
    // `WHERE` condicional, ningún segundo statement.
    expect(consultas).toEqual([
      "SELECT * FROM parada WHERE machine_id = $1 AND fin IS NULL AND orden_id IS $2 ORDER BY inicio ASC LIMIT 1",
      "SELECT * FROM parada WHERE machine_id = $1 AND fin IS NULL AND orden_id IS $2 ORDER BY inicio ASC LIMIT 1",
    ]);
    expect(enlaces[0].binds).toEqual(["M1", null]);
    expect(enlaces[1].binds).toEqual(["M1", "ord-1"]);
  });
});

// ── OQ-4: getParadaAbiertaDeMaquina, day-free y sin condición de orden ────────

describe("sqliteParadaRepository — getParadaAbiertaDeMaquina (OQ-4)", () => {
  it("resuelve null — nunca undefined — cuando la máquina no está parada", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertParada(parada({ id: "p-cerrada" }));

    await expect(repo.getParadaAbiertaDeMaquina("M1")).resolves.toBeNull();
  });

  it("encuentra la parada abierta SIN orden", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertParada(abierta({ id: "p-suelta", ordenId: null }));

    const leida = await repo.getParadaAbiertaDeMaquina("M1");

    expect(leida?.id).toBe("p-suelta");
    expect(leida?.ordenId).toBeNull();
  });

  it("encuentra la parada abierta de la orden ACTUAL", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    sembrarOrden(store, "ord-B");
    await repo.insertParada(abierta({ id: "p-de-hoy", ordenId: "ord-B" }));

    await expect(repo.getParadaAbiertaDeMaquina("M1")).resolves.toMatchObject({
      id: "p-de-hoy",
      ordenId: "ord-B",
    });
  });

  it("encuentra la parada abierta de una orden ANTERIOR tras cambiar de orden (OQ-4)", async () => {
    // El escenario que originó OQ-4: día A con orden A y una parada abierta; día
    // B con orden B y esa parada todavía abierta.
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    sembrarOrden(store, "ord-A");
    sembrarOrden(store, "ord-B");
    await repo.insertParada(
      abierta({
        id: "p-de-orden-a",
        ordenId: "ord-A",
        fechaOperativa: "2026-09-14",
        inicio: "2026-09-14T07:00:00.000Z",
      }),
    );

    // Los dos alcances por orden NO la alcanzan…
    await expect(repo.getParadaAbierta("M1", "ord-B")).resolves.toBeNull();
    await expect(repo.getParadaAbierta("M1", null)).resolves.toBeNull();
    // …pero la máquina está parada, y su día de origen sigue siendo el suyo.
    const leida = await repo.getParadaAbiertaDeMaquina("M1");
    expect(leida?.id).toBe("p-de-orden-a");
    expect(leida?.ordenId).toBe("ord-A");
    expect(leida?.fechaOperativa).toBe("2026-09-14");
  });

  it("no reatribuye ni duplica: la fila sigue siendo una sola y con su fecha original", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    sembrarOrden(store, "ord-A");
    await repo.insertParada(
      abierta({ id: "p-de-orden-a", ordenId: "ord-A", fechaOperativa: "2026-09-14" }),
    );

    await repo.getParadaAbiertaDeMaquina("M1");
    await repo.getParadaAbiertaDeMaquina("M1");

    // Lectura pura: ni una fila nueva, ni una fecha cambiada, ni un UPDATE.
    expect(store.parada).toHaveLength(1);
    expect(store.parada[0].fecha_operativa).toBe("2026-09-14");
    // Y el listado por máquina sigue devolviéndola una sola vez.
    expect((await repo.listarPorMaquina("M1")).map((p) => p.id)).toEqual(["p-de-orden-a"]);
  });

  it("convive con el filtro de fecha: la parada de ayer no pertenece al día de hoy", async () => {
    // La coexistence que exige la atribución por `fechaOperativa`: el lookup
    // day-free devuelve un registro que NO es de hoy, y por eso su consumidor
    // histórico no debe usarlo.
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertParada(abierta({ id: "p-de-ayer", fechaOperativa: "2026-09-13" }));
    await repo.insertParada(abierta({ id: "p-de-hoy", fechaOperativa: "2026-09-14" }));

    // La máquina está parada (una sola puede estarlo): la más antigua.
    const leida = await repo.getParadaAbiertaDeMaquina("M1");
    expect(leida?.fechaOperativa).toBe("2026-09-13");
    // Y las dos conviven en el listado, con su día intacto.
    expect((await repo.listarPorMaquina("M1")).map((p) => p.fechaOperativa)).toEqual([
      "2026-09-13",
      "2026-09-14",
    ]);
  });

  it("sobrevive a un reinicio: un repositorio nuevo sobre el mismo store la encuentra", async () => {
    // "Reinicio" a nivel de adaptador: la parada abierta no vive en memoria del
    // proceso, se releyó del almacén. Sin el lookup de máquina esto exigiría
    // conocer la orden con la que se abrió.
    const store = createFakeSqliteStore();
    const antesDelReinicio = repoSobre(store);
    sembrarOrden(store, "ord-A");
    await antesDelReinicio.insertParada(
      abierta({ id: "p-de-orden-a", ordenId: "ord-A", fechaOperativa: "2026-09-14" }),
    );

    const despuesDelReinicio = repoSobre(store);

    await expect(despuesDelReinicio.getParadaAbiertaDeMaquina("M1")).resolves.toMatchObject({
      id: "p-de-orden-a",
    });
  });

  it("ante varias abiertas de la máquina, elige la más antigua (paridad con el port)", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertParada(abierta({ id: "p-tarde", inicio: "2026-09-14T08:00:00.000Z" }));
    await repo.insertParada(abierta({ id: "p-temprana", inicio: "2026-09-14T07:00:00.000Z" }));

    const leida = await repo.getParadaAbiertaDeMaquina("M1");

    expect(leida?.id).toBe("p-temprana");
  });

  it("emite UNA sentencia sin condición de orden ni de fecha, y un solo bind", async () => {
    const store = createFakeSqliteStore();
    const { repo, consultas, enlaces } = repoQueRegistra(store);
    await repo.insertParada(abierta({ id: "p-x" }));

    consultas.length = 0;
    enlaces.length = 0;
    await repo.getParadaAbiertaDeMaquina("M1");

    // Ni `orden_id`, ni `fecha_operativa`: ese es exactamente el alcance de la
    // excepción documentada, y la razón de que no pueda servir a un listado.
    expect(consultas).toEqual([
      "SELECT * FROM parada WHERE machine_id = $1 AND fin IS NULL ORDER BY inicio ASC LIMIT 1",
    ]);
    expect(enlaces[0].binds).toEqual(["M1"]);
  });
});

// ── 7. D2b: FK impuesta por el doble, null aceptado, sin lookup manual ───────

describe("sqliteParadaRepository — D2b: FK de parada, null aceptado, sin lookup", () => {
  it("una parada sin orden persiste sin requerir siembra: null es el escape hatch diseñado", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);

    await repo.insertParada(abierta({ id: "p-suelta-fk" }));

    expect(store.parada).toHaveLength(1);
    expect(store.parada[0].orden_id).toBeNull();
  });

  it("el adaptador NO hace lookup de la orden: pre-check + INSERT, dos sentencias", async () => {
    const store = createFakeSqliteStore();
    const { repo, consultas } = repoQueRegistra(store);
    sembrarOrden(store);

    await repo.insertParada(parada({ id: "p-con-orden", ordenId: "ord-1" }));

    // Exactamente dos consultas: el pre-check de existencia y el INSERT.
    // La resolución de la FK la hace el doble (verificarClavesForaneas), nunca
    // un SELECT de `orden` por parte del adaptador.
    expect(consultas).toHaveLength(2);
    expect(consultas[0]).toBe("SELECT id FROM parada WHERE id = $1");
    expect(consultas[1]).toContain("INSERT INTO parada");
  });
});

// ── 8. Enlaces no resolubles ─────────────────────────────────────────────────

describe("sqliteParadaRepository — enlaces no resolubles", () => {
  it("una orden inexistente rechaza la escritura con causa FK, envuelta", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const conOrdenFantasma = parada({ id: "p-fk-rota", ordenId: "ord-inexistente" });

    await expect(repo.insertParada(conOrdenFantasma)).rejects.toThrow(
      'no se pudo persistir la parada "p-fk-rota"'
    );
    await expect(repo.insertParada(conOrdenFantasma)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining("FOREIGN KEY constraint failed") }),
    });
    expect(store.parada).toHaveLength(0);
  });

  it("el mismo enlace resuelto por un id sembrado sí persiste (el dueño es el doble)", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    sembrarOrden(store, "ord-7");

    await repo.insertParada(parada({ id: "p-fk-bien", ordenId: "ord-7" }));

    expect(store.parada).toHaveLength(1);
    await expect(repo.obtenerPorId("p-fk-bien")).resolves.toMatchObject({ ordenId: "ord-7" });
  });
});

// ── 9. Propagación de errores ────────────────────────────────────────────────

describe("sqliteParadaRepository — propagación de errores", () => {
  it("un fallo del INSERT viaja envuelto con la causa subyacente", async () => {
    const store = createFakeSqliteStore();
    const causa = new Error("disco lleno");
    const repo = new SqliteParadaRepository(dbQueFallaAlEscribir(store, causa));

    await expect(repo.insertParada(abierta({ id: "p-io" }))).rejects.toThrow(
      'no se pudo persistir la parada "p-io"'
    );
    await expect(repo.insertParada(abierta({ id: "p-io" }))).rejects.toMatchObject({ cause: causa });
  });

  it("un fallo del UPDATE viaja envuelto con la causa subyacente", async () => {
    const store = createFakeSqliteStore();
    const causa = new Error("disco lleno");
    // El pre-check responde (select sigue vivo) y el execute es el que rompe.
    store.parada.push({ id: "p-io", machine_id: "M1", orden_id: null, operario: "Laura", causa_id: "otro", campos_especificos: "{}", observaciones: null, inicio: "2026-09-14T07:00:00.000Z", fin: null });
    const repo = new SqliteParadaRepository(dbQueFallaAlEscribir(store, causa));

    await expect(repo.updateParada(abierta({ id: "p-io" }))).rejects.toThrow(
      'no se pudo actualizar la parada "p-io"'
    );
    await expect(repo.updateParada(abierta({ id: "p-io" }))).rejects.toMatchObject({ cause: causa });
  });
});

// ── 10. Update en el mismo lugar ─────────────────────────────────────────────

describe("sqliteParadaRepository — update en el mismo lugar", () => {
  it("cerrar una abierta actualiza la fila existente, sin crear otra", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const original = abierta({ id: "parada-inplace", causaId: "falta_tela" });
    await repo.insertParada(original);

    const cerrada = cerrarParada(original as ParadaAbierta, "2026-09-14T08:30:00.000Z");
    expect(cerrada.errores).toEqual([]);
    await repo.updateParada(cerrada.parada as Parada);

    expect(store.parada).toHaveLength(1);
    const fila = store.parada[0];
    expect(fila.fin).toBe("2026-09-14T08:30:00.000Z");
    // Lo demás permanece intacto: nada se re-crea ni se vacía.
    expect(fila.operario).toBe("Laura");
    expect(fila.causa_id).toBe("falta_tela");
    expect(fila.campos_especificos).toBe("{}");
  });

  it("el cierre preserva los campos_especificos JSON de la abierta", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const original = abierta({
      id: "parada-inplace-json",
      causaId: "rotura_cuadro",
      camposEspecificos: { carro: 3 },
    });
    await repo.insertParada(original);

    const cerrada = cerrarParada(original as ParadaAbierta, "2026-09-14T08:30:00.000Z");
    await repo.updateParada(cerrada.parada as Parada);

    expect(store.parada).toHaveLength(1);
    expect(store.parada[0].campos_especificos).toBe('{"carro":3}');
    await expect(repo.obtenerPorId("parada-inplace-json")).resolves.toMatchObject({
      camposEspecificos: { carro: 3 },
      fin: "2026-09-14T08:30:00.000Z",
    });
  });
});

// ── 11. D2j: sentencias prescritas, fijadas por texto ────────────────────────

describe("sqliteParadaRepository — D2j: pre-check + una sentencia, id solo en WHERE", () => {
  it("el INSERT declara las 10 columnas y liga el JSON como texto", async () => {
    const store = createFakeSqliteStore();
    const { repo, consultas, enlaces } = repoQueRegistra(store);
    const conJson = parada({
      id: "parada-d2j",
      ordenId: "ord-1",
      causaId: "danio_mecanico",
      camposEspecificos: { carro: 2, componente: "brazo" },
      observaciones: "revisar el carro",
    });
    sembrarOrden(store);

    await repo.insertParada(conJson);

    expect(consultas).toHaveLength(2);
    expect(consultas[0]).toBe("SELECT id FROM parada WHERE id = $1");
    expect(consultas[1]).toBe(
      "INSERT INTO parada (id, machine_id, orden_id, operario, causa_id, campos_especificos, observaciones, inicio, fin, fecha_operativa) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
    );
    expect(valorLigado(enlaces[1], "campos_especificos")).toBe(
      JSON.stringify({ carro: 2, componente: "brazo" })
    );
    expect(valorLigado(enlaces[1], "orden_id")).toBe("ord-1");
  });

  it("el UPDATE pone los 9 no-PK en SET, id solo en WHERE, y el cierre liga fin", async () => {
    const store = createFakeSqliteStore();
    const { repo, consultas, enlaces } = repoQueRegistra(store);
    const original = abierta({ id: "parada-d2j-up", causaId: "falta_color", camposEspecificos: { color: "magenta" } });
    await repo.insertParada(original);

    consultas.length = 0;
    enlaces.length = 0;
    const cerrada = cerrarParada(original as ParadaAbierta, "2026-09-14T08:00:00.000Z");
    await repo.updateParada(cerrada.parada as Parada);

    expect(consultas).toHaveLength(2);
    expect(consultas[0]).toBe("SELECT id FROM parada WHERE id = $1");
    expect(consultas[1]).toBe(
      "UPDATE parada SET machine_id = $2, orden_id = $3, operario = $4, causa_id = $5, campos_especificos = $6, observaciones = $7, inicio = $8, fin = $9, fecha_operativa = $10 WHERE id = $1"
    );
    // `id` no aparece en la parte SET — solo en el WHERE final.
    const setParte = consultas[1].slice(
      consultas[1].indexOf("SET ") + "SET ".length,
      consultas[1].indexOf(" WHERE ")
    );
    expect(setParte).not.toMatch(/\bid\b/);
    // El cierre liga el timestamp de fin en el bind $9.
    expect(valorLigadoUpdate(enlaces[1], "fin")).toBe("2026-09-14T08:00:00.000Z");
  });

  it("obtenerPorId emite SELECT * WHERE id y listarPorOrden el predicado de la orden", async () => {
    const store = createFakeSqliteStore();
    const { repo, consultas } = repoQueRegistra(store);

    await repo.obtenerPorId("x");
    await repo.listarPorMaquina("M1");
    await repo.listarPorOrden("ord-1");

    expect(consultas).toEqual([
      "SELECT * FROM parada WHERE id = $1",
      "SELECT * FROM parada WHERE machine_id = $1 ORDER BY inicio ASC",
      "SELECT * FROM parada WHERE orden_id = $1 ORDER BY inicio ASC",
    ]);
  });
});