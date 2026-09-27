/**
 * Ticket 10 (Phase 2) — Unit S — the shared FK-capable fake store's own suite
 *
 * WHAT THIS SUITE IS: the contract test of the D2b double
 * (`fakeSqliteStore.ts`) itself. The five adapter suites (C2/D2/E2/F2) and the
 * restart-survival suite consume the double, so the double's own behaviour has
 * to be pinned HERE, once, instead of being re-asserted five times: the loud
 * throw on an unmodelled statement, the five enforced foreign keys, the
 * `null`-link acceptance, ordering owned by the double (from the row value, not
 * from insertion order), `LIMIT 1` honoured literally, and the pre-check
 * `SELECT id FROM t WHERE id = $1` answered from the array.
 *
 * WHAT THIS SUITE IS NOT: an adapter test. No repository is instantiated here —
 * C2/D2/E2/F2 do that over this same double. This suite never re-tests them.
 *
 * HONESTY NOTE (D2d): this double MODELS SQLite, it never executes it. It
 * applies no DDL, opens no connection and simulates no `PRAGMA
 * foreign_keys`. Everything asserted below is a fact about the double's
 * modelling of the statements declared in migration 004, never about a real
 * sqlite engine — a fact that still needs `getForeignKeys()` on the real Tauri
 * binary (R5). The five FK rejections prove the *double* bites (D2b's A1/A1b
 * control); whether the real connection enforces them remains PENDING.
 *
 * Anti-vacuity note: every expectation below drives the double through its
 * public surface (`execute` / `select` / the row accessors) with the exact SQL
 * the adapters emit, so a change in the modelled vocabulary fails here.
 */

import { describe, expect, it } from "vitest";
import {
  createFakeSqliteStore,
  SqliteFkError,
  type FakeSqliteStore,
} from "./fakeSqliteStore";

// ── Helpers: las sentencias exactas de design.md §Statement shapes ───────────

const ORDEN_ID = "ord-1";

function storeConOrden(): FakeSqliteStore {
  const store = createFakeSqliteStore();
  // `orden` está en el doble sólo para poder primed los destinos de las FK.
  store.orden.push({ id: ORDEN_ID, machine_id: "M1", estado: "in_production" });
  return store;
}

/** INSERT de parada con las 9 columnas de 004. */
const INSERT_PARADA =
  "INSERT INTO parada (id, machine_id, orden_id, operario, causa_id, campos_especificos, observaciones, inicio, fin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)";

function bindsParada(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const fila = {
    id: "par-1",
    machine_id: "M1",
    orden_id: ORDEN_ID,
    operario: "Laura",
    causa_id: "sin_tinta",
    campos_especificos: "{}",
    observaciones: null,
    inicio: "2026-09-14T08:00:00.000Z",
    fin: null,
    ...overrides,
  };
  return [
    fila.id,
    fila.machine_id,
    fila.orden_id,
    fila.operario,
    fila.causa_id,
    fila.campos_especificos,
    fila.observaciones,
    fila.inicio,
    fila.fin,
  ];
}

/** INSERT de daño con las 14 columnas de 004 (los dos flags 0/1 van sueltos). */
const INSERT_DANO =
  "INSERT INTO dano (id, machine_id, orden_id, operario, tipo, componente, inicio, fin, solucion_aplicada, causo_parada, parada_id, posible_segunda, unidades_sospechadas, observaciones) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)";

function bindsDano(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const fila = {
    id: "dano-1",
    machine_id: "M1",
    orden_id: ORDEN_ID,
    operario: "Laura",
    tipo: "electrico",
    componente: "motor",
    inicio: "2026-09-14T09:00:00.000Z",
    fin: null,
    solucion_aplicada: null,
    causo_parada: 0,
    parada_id: null as unknown,
    posible_segunda: 0,
    unidades_sospechadas: null,
    observaciones: null,
    ...overrides,
  };
  return [
    fila.id,
    fila.machine_id,
    fila.orden_id,
    fila.operario,
    fila.tipo,
    fila.componente,
    fila.inicio,
    fila.fin,
    fila.solucion_aplicada,
    fila.causo_parada,
    fila.parada_id,
    fila.posible_segunda,
    fila.unidades_sospechadas,
    fila.observaciones,
  ];
}

// ── 1. Deriva de una sentencia: throw en voz alta ───────────────────────────

describe("fakeSqliteStore — deriva de sentencia (anti-vacuousidad)", () => {
  it("execute lanza ante una sentencia no modelada", async () => {
    const store = createFakeSqliteStore();
    await expect(store.execute("DELETE FROM parada WHERE id = $1", ["par-1"])).rejects.toThrow(
      "execute: unsupported query in mock: DELETE FROM parada WHERE id = $1"
    );
  });

  it("select lanza ante una sentencia no modelada en vez de devolver []", async () => {
    const store = createFakeSqliteStore();
    // Un `SELECT` fuera del vocabulario modelado es deriva: el `return []`
    // silencioso de los dobles anteriores la volvería invisible.
    await expect(
      store.select("SELECT * FROM parada ORDER BY inicio DESC", [])
    ).rejects.toThrow("unsupported query in mock");
    // Proyección distinta de `*`: no es ninguna de las dos formas modeladas.
    await expect(
      store.select("SELECT orden_id, inicio FROM parada WHERE machine_id = $1", ["M1"])
    ).rejects.toThrow("select: unsupported query in mock");
    // `SELECT count(*)`: un agregado no está modelado y tampoco debe fingir.
    await expect(store.select("SELECT count(*) AS total FROM parada", [])).rejects.toThrow(
      "select: unsupported query in mock"
    );
  });

  it("launcha ante una tabla que el doble no modela", async () => {
    const store = createFakeSqliteStore();
    await expect(store.select("SELECT * FROM lectura_golpe WHERE id = $1", ["lg-1"])).rejects.toThrow(
      "select: unsupported query in mock"
    );
  });

  it("rechaza pedir foreignKeys: false — no hay segunda verdad (D2b)", () => {
    expect(() => createFakeSqliteStore({ foreignKeys: false })).toThrow(
      /no existe un modo sin claves foráneas/
    );
  });
});

// ── 2. Las cinco claves foráneas ─────────────────────────────────────────────

describe("fakeSqliteStore — las cinco FK de 004", () => {
  it("parada.orden_id → orden.id: rechaza un enlace colgante, con la causa", async () => {
    const store = storeConOrden();
    const err = await store
      .execute(INSERT_PARADA, bindsParada({ orden_id: "no-existe" }))
      .then(() => null, (e: unknown) => e as Error);

    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain("FOREIGN KEY constraint failed");
    const causa = err!.cause as SqliteFkError;
    expect(causa).toBeInstanceOf(SqliteFkError);
    expect(causa.table).toBe("parada");
    expect(causa.column).toBe("orden_id");
    expect(causa.value).toBe("no-existe");
    // La fila rechazada NO se aplica: el rechazo es previo a la escritura.
    expect(store.parada).toHaveLength(0);
  });

  it("dano.orden_id → orden.id: rechaza un enlace colgante", async () => {
    const store = storeConOrden();
    const err = await store
      .execute(INSERT_DANO, bindsDano({ orden_id: "no-existe" }))
      .then(() => null, (e: unknown) => e as Error);

    expect(err!.message).toContain("FOREIGN KEY constraint failed");
    expect((err!.cause as SqliteFkError).column).toBe("orden_id");
    expect((err!.cause as SqliteFkError).table).toBe("dano");
    expect(store.dano).toHaveLength(0);
  });

  it("dano.parada_id → parada.id: rechaza un enlace colgante (A1 de D2b)", async () => {
    const store = storeConOrden();
    const err = await store
      .execute(INSERT_DANO, bindsDano({ parada_id: "no-existe" }))
      .then(() => null, (e: unknown) => e as Error);

    expect(err!.message).toContain("FOREIGN KEY constraint failed");
    const causa = err!.cause as SqliteFkError;
    expect(causa.column).toBe("parada_id");
    expect(causa.value).toBe("no-existe");
    expect(store.dano).toHaveLength(0);
  });

  it("inspeccion_tela.orden_id → orden.id: rechaza un enlace colgante", async () => {
    const store = storeConOrden();
    const sql =
      "INSERT INTO inspeccion_tela (id, orden_id, operario, lote, absorcion, tundido, manchas, dimensiones, estado_general, otra_anomalia, timestamp, observaciones, resolucion, motivo_devolucion, autorizado_por, registrada_por, resolucion_timestamp, autorizacion_observaciones) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)";
    const binds = [
      "insp-1", "no-existe", "Laura", null, "ok", "ok", "ok", "ok", "ok",
      null, "2026-09-14T10:00:00.000Z", null, null, null, null, null, null, null,
    ];
    const err = await store.execute(sql, binds).then(() => null, (e: unknown) => e as Error);

    expect(err!.message).toContain("FOREIGN KEY constraint failed");
    expect((err!.cause as SqliteFkError).table).toBe("inspeccion_tela");
    expect((err!.cause as SqliteFkError).column).toBe("orden_id");
    expect(store.inspeccion_tela).toHaveLength(0);
  });

  it("mantenimiento.dano_id → dano.id: rechaza un enlace colgante", async () => {
    const store = storeConOrden();
    const sql =
      "INSERT INTO mantenimiento (id, machine_id, tipo, operario, motivo, inicio, fin, que_se_reviso_reparo, dano_id, observaciones) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)";
    const binds = [
      "mant-1", "M1", "preventivo", "Laura", "ajuste de carro", "2026-09-14T11:00:00.000Z",
      null, null, "no-existe", null,
    ];
    const err = await store.execute(sql, binds).then(() => null, (e: unknown) => e as Error);

    expect(err!.message).toContain("FOREIGN KEY constraint failed");
    expect((err!.cause as SqliteFkError).table).toBe("mantenimiento");
    expect((err!.cause as SqliteFkError).column).toBe("dano_id");
    expect(store.mantenimiento).toHaveLength(0);
  });

  it("acepta un enlace null (parada sin orden en un día vacío)", async () => {
    const store = storeConOrden();
    await store.execute(INSERT_PARADA, bindsParada({ orden_id: null }));

    expect(store.parada).toHaveLength(1);
    expect(store.parada[0].orden_id).toBeNull();
  });

  it("acepta un enlace válido con el padre primed (A1b de D2b)", async () => {
    const store = storeConOrden();
    await store.execute(INSERT_PARADA, bindsParada());
    await store.execute(INSERT_DANO, bindsDano({ parada_id: "par-1" }));

    expect(store.parada).toHaveLength(1);
    expect(store.dano).toHaveLength(1);
    expect(store.dano[0].parada_id).toBe("par-1");
  });

  it("verifica también el UPDATE que escribe una columna de enlace", async () => {
    const store = storeConOrden();
    await store.execute(INSERT_DANO, bindsDano());
    const err = await store
      .execute(
        "UPDATE dano SET parada_id = $1 WHERE id = $2",
        ["no-existe", "dano-1"]
      )
      .then(() => null, (e: unknown) => e as Error);

    expect(err!.message).toContain("FOREIGN KEY constraint failed");
    expect((err!.cause as SqliteFkError).column).toBe("parada_id");
    // La escritura no se aplicó a medias.
    expect(store.dano[0].parada_id).toBeNull();
  });

  it("actividad_planificada no tiene orden_id: ninguna FK que imponer", async () => {
    const store = createFakeSqliteStore();
    const sql =
      "INSERT INTO actividad_planificada (id, machine_id, tipo, inicio, fin, que_se_limpio, observaciones, operario) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)";
    await store.execute(sql, ["act-1", "M1", "limpieza", "2026-09-14T07:00:00.000Z", null, null, null, "Laura"]);

    expect(store.actividad_planificada).toHaveLength(1);
  });
});

// ── 3. Pre-chequeo, orden y LIMIT 1 ──────────────────────────────────────────

describe("fakeSqliteStore — pre-chequeo, orden y LIMIT 1", () => {
  it("responde el pre-chequeo SELECT id FROM t WHERE id = $1 desde el array", async () => {
    const store = createFakeSqliteStore();
    await store.execute(INSERT_PARADA, bindsParada({ orden_id: null }));

    const existente = await store.select<{ id: string }[]>(
      "SELECT id FROM parada WHERE id = $1",
      ["par-1"]
    );
    const ausente = await store.select<{ id: string }[]>(
      "SELECT id FROM parada WHERE id = $1",
      ["par-999"]
    );

    expect(existente).toEqual([{ id: "par-1" }]);
    expect(ausente).toEqual([]);
  });

  it("ordena por el valor de la fila, no por el orden de inserción", async () => {
    const store = createFakeSqliteStore();
    // Se insertan deliberadamente fuera de orden cronológico.
    await store.execute(INSERT_PARADA, bindsParada({ id: "par-3", orden_id: null, inicio: "2026-09-14T12:00:00.000Z" }));
    await store.execute(INSERT_PARADA, bindsParada({ id: "par-1", orden_id: null, inicio: "2026-09-14T08:00:00.000Z" }));
    await store.execute(INSERT_PARADA, bindsParada({ id: "par-2", orden_id: null, inicio: "2026-09-14T10:00:00.000Z" }));

    const filas = await store.select<{ id: string }[]>(
      "SELECT * FROM parada WHERE machine_id = $1 ORDER BY inicio ASC",
      ["M1"]
    );

    expect(filas.map((f) => f.id)).toEqual(["par-1", "par-2", "par-3"]);
    // El array de filas conserva el orden de inserción: el orden lo aplica la
    // consulta, no el almacenamiento.
    expect(store.parada.map((f) => f.id)).toEqual(["par-3", "par-1", "par-2"]);
  });

  it("ordena por timestamp (inspecciones) desde el valor de la fila", async () => {
    const store = storeConOrden();
    const sql =
      "INSERT INTO inspeccion_tela (id, orden_id, timestamp) VALUES ($1, $2, $3)";
    // Sólo se modelan las columnas que el test necesita: el doble no exige
    // el juego completo de columnas, es un doble, no un esquema.
    await store.execute("INSERT INTO inspeccion_tela (id, orden_id, timestamp) VALUES ($1, $2, $3)", ["insp-2", ORDEN_ID, "2026-09-14T15:00:00.000Z"]);
    await store.execute(sql, ["insp-1", ORDEN_ID, "2026-09-14T12:00:00.000Z"]);

    const filas = await store.select<{ id: string }[]>(
      "SELECT * FROM inspeccion_tela WHERE orden_id = $1 ORDER BY timestamp ASC",
      [ORDEN_ID]
    );

    expect(filas.map((f) => f.id)).toEqual(["insp-1", "insp-2"]);
  });

  it("LIMIT 1 devuelve exactamente una fila", async () => {
    const store = createFakeSqliteStore();
    await store.execute(INSERT_PARADA, bindsParada({ id: "par-2", orden_id: null, inicio: "2026-09-14T12:00:00.000Z", fin: null }));
    await store.execute(INSERT_PARADA, bindsParada({ id: "par-1", orden_id: null, inicio: "2026-09-14T08:00:00.000Z", fin: null }));

    const filas = await store.select<{ id: string }[]>(
      "SELECT * FROM parada WHERE machine_id = $1 AND fin IS NULL ORDER BY inicio ASC LIMIT 1",
      ["M1"]
    );

    expect(filas).toHaveLength(1);
    // El `LIMIT 1` va después del `ORDER BY`: gana la más antigua, no la
    // primera insertada.
    expect(filas[0].id).toBe("par-1");
  });

  it("`orden_id IS $2` es null-safe: la parada abierta sin orden aparece", async () => {
    const store = storeConOrden();
    await store.execute(INSERT_PARADA, bindsParada({ id: "par-sin-orden", orden_id: null }));
    await store.execute(INSERT_PARADA, bindsParada({ id: "par-con-orden", orden_id: ORDEN_ID, inicio: "2026-09-14T09:00:00.000Z" }));

    const sinOrden = await store.select<{ id: string }[]>(
      "SELECT * FROM parada WHERE machine_id = $1 AND orden_id IS $2 AND fin IS NULL ORDER BY inicio ASC LIMIT 1",
      ["M1", null]
    );
    const conOrden = await store.select<{ id: string }[]>(
      "SELECT * FROM parada WHERE machine_id = $1 AND orden_id IS $2 AND fin IS NULL ORDER BY inicio ASC LIMIT 1",
      ["M1", ORDEN_ID]
    );

    expect(sinOrden.map((f) => f.id)).toEqual(["par-sin-orden"]);
    expect(conOrden.map((f) => f.id)).toEqual(["par-con-orden"]);
  });

  it("`= $1` con bind null no casa: listarPorOrden excluye los enlaces nulos", async () => {
    const store = storeConOrden();
    await store.execute(INSERT_PARADA, bindsParada({ id: "par-sin-orden", orden_id: null }));
    await store.execute(INSERT_PARADA, bindsParada({ id: "par-con-orden", orden_id: ORDEN_ID, inicio: "2026-09-14T09:00:00.000Z" }));

    const porOrden = await store.select<{ id: string }[]>(
      "SELECT * FROM parada WHERE orden_id = $1 ORDER BY inicio ASC",
      [ORDEN_ID]
    );
    const porOrdenNull = await store.select<{ id: string }[]>(
      "SELECT * FROM parada WHERE orden_id = $1 ORDER BY inicio ASC",
      [null]
    );

    expect(porOrden.map((f) => f.id)).toEqual(["par-con-orden"]);
    expect(porOrdenNull).toEqual([]);
  });

  it("obtenerPorId devuelve una copia de la fila, no la fila viva", async () => {
    const store = createFakeSqliteStore();
    await store.execute(INSERT_PARADA, bindsParada({ orden_id: null }));

    const fila = await store.select<{ fin: unknown }[]>("SELECT * FROM parada WHERE id = $1", ["par-1"]);
    fila[0].fin = "manipulado";

    expect(store.parada[0].fin).toBeNull();
  });

  it("un UPDATE en el mismo lugar no crea una fila nueva", async () => {
    const store = storeConOrden();
    await store.execute(INSERT_DANO, bindsDano());
    const resultado = await store.execute(
      "UPDATE dano SET fin = $1, solucion_aplicada = $2 WHERE id = $3",
      ["2026-09-14T09:30:00.000Z", "cambio de motor", "dano-1"]
    );

    expect(resultado.rowsAffected).toBe(1);
    expect(store.dano).toHaveLength(1);
    expect(store.dano[0].fin).toBe("2026-09-14T09:30:00.000Z");
    expect(store.dano[0].solucion_aplicada).toBe("cambio de motor");
  });
});
