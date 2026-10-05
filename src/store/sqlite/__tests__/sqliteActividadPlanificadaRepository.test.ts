/**
 * Ticket 10 (Phase 2) — Unit C2 — `sqliteActividadPlanificadaRepository` suite
 *
 * WHAT THIS SUITE IS: the contract test of the first SQLite operational
 * adapter, over the shared D2b double from Unit S
 * (`src/store/sqlite/__tests__/fakeSqliteStore.ts`). It pins eight things: the
 * mapper round trip with no `Database` in scope, insert-then-read, the duplicate
 * rejection leaving the stored record UNCHANGED, the unknown-id rejection
 * creating NOTHING, chronological ordering owned by the adapter, the open-record
 * query resolving the `ActividadAbierta` alias (or `null`) without a cast at the
 * call site, descriptive error propagation with `cause`, and the update-in-place
 * case adding no second row.
 *
 * WHAT THIS SUITE IS NOT: a re-test of the double (that is `fakeSqliteStore.test.ts`,
 * once, for all five suites) and not a domain test. The domain rules this port
 * deliberately does NOT enforce — `queSeLimpio` required for `limpieza`, one
 * open activity per machine + type, `fin` not before `inicio` — live in
 * `src/domain/actividades.ts`, are unchanged, and are out of scope here.
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
 * OUT OF SCOPE, deliberately: per-order filtering (this table has **no**
 * `orden_id` column by design — ADR 0005 — so there is no `listarPorOrden` to
 * exercise), and JSON handling of `campos_especificos` (that column belongs to
 * `parada`, not to this table; the parada adapter owns that round trip and the
 * hard failure on invalid JSON).
 *
 * Anti-vacuity note: the double THROWS on any statement outside the vocabulary
 * of design.md §Statement shapes, so an adapter that drifts from its declared
 * SQL fails loudly here instead of silently no-op'ing.
 */

import { describe, expect, it } from "vitest";
import type Database from "@tauri-apps/plugin-sql";
import { finalizarActividad } from "../../../domain/actividades";
import type { ActividadAbierta, ActividadPlanificada } from "../../../domain/types";
import {
  mapActividadPlanificadaRow,
  mapActividadPlanificadaToSql,
  SqliteActividadPlanificadaRepository,
  type ActividadPlanificadaRow,
} from "../sqliteActividadPlanificadaRepository";
import { createFakeSqliteStore, type FakeSqliteStore } from "./fakeSqliteStore";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Una actividad completa y explícita; nada se hereda de otra fixture. */
function actividad(overrides: Partial<ActividadPlanificada> = {}): ActividadPlanificada {
  return {
    id: "act-1",
    maquinaId: "M1",
    tipo: "limpieza",
    fechaOperativa: "2026-09-14",
    inicio: "2026-09-14T07:00:00.000Z",
    fin: "2026-09-14T08:00:00.000Z",
    queSeLimpio: "mesa de estampado",
    operatorName: "Laura",
    ...overrides,
  };
}

/** Una actividad abierta: `fin: null` es lo que la marca como tal. */
function abierta(overrides: Partial<ActividadPlanificada> = {}): ActividadPlanificada {
  return actividad({ fin: null, queSeLimpio: undefined, ...overrides });
}

function repoSobre(store: FakeSqliteStore): SqliteActividadPlanificadaRepository {
  return new SqliteActividadPlanificadaRepository(store);
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

// ── 1. Los mappers son puros: ida y vuelta sin conexión ──────────────────────

describe("sqliteActividadPlanificadaRepository — mappers puros", () => {
  it("la ida y vuelta del mapper no necesita ninguna Database en scope", () => {
    // Sin `createFakeSqliteStore()` en este test: los mappers son funciones
    // puras y el round trip se demuestra sin conexión alguna.
    const original = actividad();

    const fila = mapActividadPlanificadaToSql(original) as unknown as ActividadPlanificadaRow;
    const recuperada = mapActividadPlanificadaRow(fila);

    expect(recuperada).toEqual(original);
    // D1, en los dos sentidos: el vocabulario cambia en el mapper y sólo ahí.
    expect(fila.machine_id).toBe("M1");
    expect(fila.operario).toBe("Laura");
    expect(recuperada.maquinaId).toBe("M1");
    expect(recuperada.operatorName).toBe("Laura");
    // Una fila nueva, no una referencia compartida con la entrada.
    expect(recuperada).not.toBe(original);
  });

  it("escribe los opcionales ausentes como null y los lee como undefined", () => {
    const sinOpcionales = abierta({ id: "act-sin", tipo: "pausa" });

    const fila = mapActividadPlanificadaToSql(sinOpcionales);
    // NUNCA `""` ni `undefined`: la columna es NULL y punto.
    expect(fila.que_se_limpio).toBeNull();
    expect(fila.observaciones).toBeNull();
    expect(fila.fin).toBeNull();

    const recuperada = mapActividadPlanificadaRow(fila);
    expect(recuperada.queSeLimpio).toBeUndefined();
    expect(recuperada.observaciones).toBeUndefined();
    // `fin` se conserva como `null`: es lo que significa "abierta".
    expect(recuperada.fin).toBeNull();
  });

  it("nunca produce un enlace a la orden: la tabla no tiene orden_id", () => {
    const fila = mapActividadPlanificadaToSql(actividad());

    expect(Object.keys(fila).sort()).toEqual([
      "fecha_operativa",
      "fin",
      "id",
      "inicio",
      "machine_id",
      "observaciones",
      "operario",
      "que_se_limpio",
      "tipo",
    ]);
    expect(fila).not.toHaveProperty("orden_id");

    const recuperada = mapActividadPlanificadaRow(fila);
    expect(recuperada).not.toHaveProperty("ordenId");
  });

  it("una fila sin fecha_operativa (null, ausente o vacía) es un error de mapeo que nombra la columna", () => {
    // 005 la declara NOT NULL sin DEFAULT: el día es dato persistido, así que
    // una fila dañada falla en voz alta en lugar de rendir un `fechaOperativa`
    // sin definir.
    const base = mapActividadPlanificadaToSql(actividad());

    // `null`: la declaración `Row` miente en runtime, por eso el validador
    // recibe `unknown`.
    const nula = { ...base, fecha_operativa: null } as unknown as ActividadPlanificadaRow;
    expect(() => mapActividadPlanificadaRow(nula)).toThrow(/fecha_operativa/);
    expect(() => mapActividadPlanificadaRow(nula)).toThrow(/NOT NULL sin DEFAULT/);

    // Columna ausente del todo.
    const ausente = { ...base } as Partial<ActividadPlanificadaRow>;
    delete ausente.fecha_operativa;
    expect(() => mapActividadPlanificadaRow(ausente as ActividadPlanificadaRow)).toThrow(
      /fecha_operativa/
    );

    // En blanco: la columna no puede legítimamente estar vacía.
    const vacia = { ...base, fecha_operativa: "" };
    expect(() => mapActividadPlanificadaRow(vacia)).toThrow(/fecha_operativa/);
  });

  it("la ruta feliz conserva la fecha operativa válida sin cambios", () => {
    const recuperada = mapActividadPlanificadaRow(mapActividadPlanificadaToSql(actividad()));

    expect(recuperada.fechaOperativa).toBe("2026-09-14");
  });
});

// ── 2. Insertar y leer de vuelta ────────────────────────────────────────────

describe("sqliteActividadPlanificadaRepository — insertar y leer", () => {
  it("insertActividad resuelve y obtenerPorId devuelve el registro", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const nueva = actividad({ id: "act-sql-1" });

    await expect(repo.insertActividad(nueva)).resolves.toBeUndefined();
    await expect(repo.obtenerPorId("act-sql-1")).resolves.toEqual(nueva);

    // La fila quedó en la tabla con el vocabulario de 004, no con el del dominio.
    expect(store.actividad_planificada).toHaveLength(1);
    expect(store.actividad_planificada[0]).toMatchObject({
      id: "act-sql-1",
      machine_id: "M1",
      operario: "Laura",
      tipo: "limpieza",
    });
  });

  it("obtenerPorId resuelve undefined — nunca null — para un id ausente", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);

    const ausente = await repo.obtenerPorId("act-nope");

    expect(ausente).toBeUndefined();
    expect(ausente).not.toBeNull();
  });
});

// ── 3. Duplicado: rechazo con el registro intacto ────────────────────────────

describe("sqliteActividadPlanificadaRepository — rechazo por duplicado", () => {
  it("insertActividad rechaza el id repetido y la fila conserva los valores originales", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const original = actividad({ id: "act-dup", inicio: "2026-09-14T07:00:00.000Z" });
    await repo.insertActividad(original);

    // Mismo id, valores DISTINTOS: si el adaptador sobrescribiera, se vería aquí.
    const intruder = actividad({
      id: "act-dup",
      inicio: "2026-09-20T10:00:00.000Z",
      queSeLimpio: "OTRO valor",
      observaciones: "no debe aparecer",
      operatorName: "Intruso",
    });

    const err = await repo.insertActividad(intruder).then(() => null, (e: unknown) => e as Error);

    // Mensaje del adaptador en memoria, VERBATIM — y sin envolver: el rechazo
    // ocurre en el pre-chequeo, antes de cualquier escritura.
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe("ya existe una actividad con el id act-dup");
    expect(err!.cause).toBeUndefined();

    // La fila almacenada sigue siendo la original, campo por campo.
    expect(store.actividad_planificada).toHaveLength(1);
    const fila = store.actividad_planificada[0];
    expect(fila.inicio).toBe("2026-09-14T07:00:00.000Z");
    expect(fila.que_se_limpio).toBe("mesa de estampado");
    expect(fila.operario).toBe("Laura");
    expect(fila.observaciones).toBeNull();

    // Y la lectura lo confirma por la vía pública del puerto.
    await expect(repo.obtenerPorId("act-dup")).resolves.toEqual(original);
  });
});

// ── 4. Id desconocido: rechazo sin crear nada ────────────────────────────────

describe("sqliteActividadPlanificadaRepository — rechazo por id desconocido", () => {
  it("updateActividad rechaza un id ausente y no crea ninguna fila", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertActividad(actividad({ id: "act-existente" }));

    const err = await repo
      .updateActividad(actividad({ id: "act-fantasma" }))
      .then(() => null, (e: unknown) => e as Error);

    // Verbatim del adaptador en memoria, y sin envolver (pre-chequeo).
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe("no existe una actividad con el id act-fantasma");
    expect(err!.cause).toBeUndefined();

    // NADA se creó: ni la fila fantasma ni una segunda copia de la existente.
    expect(store.actividad_planificada).toHaveLength(1);
    expect(store.actividad_planificada.map((f) => f.id)).toEqual(["act-existente"]);
    await expect(repo.obtenerPorId("act-fantasma")).resolves.toBeUndefined();
  });
});

// ── 5. El orden cronológico lo posee el adaptador ───────────────────────────

describe("sqliteActividadPlanificadaRepository — orden cronológico", () => {
  it("listarPorMaquina ordena por inicio aunque se inserten desordenadas", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);

    // Insertadas deliberadamente fuera de orden cronológico.
    await repo.insertActividad(actividad({ id: "act-tarde", inicio: "2026-09-14T12:00:00.000Z" }));
    await repo.insertActividad(actividad({ id: "act-temprano", inicio: "2026-09-14T08:00:00.000Z" }));
    await repo.insertActividad(actividad({ id: "act-medio", inicio: "2026-09-14T10:00:00.000Z" }));

    const listado = await repo.listarPorMaquina("M1");

    expect(listado.map((a) => a.id)).toEqual(["act-temprano", "act-medio", "act-tarde"]);

    // El almacenamiento conserva el orden de inserción: el orden lo aporta la
    // consulta (`ORDER BY inicio ASC`), no el doble ni el llamador.
    expect(store.actividad_planificada.map((f) => f.id)).toEqual([
      "act-tarde",
      "act-temprano",
      "act-medio",
    ]);
  });

  it("listarPorMaquina no mezcla máquinas", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertActividad(actividad({ id: "act-m1", maquinaId: "M1" }));
    // La tabla es de una sola máquina (ADR 0003), pero la consulta filtra igual.
    store.actividad_planificada.push({
      id: "act-otra",
      machine_id: "M2",
      tipo: "limpieza",
      inicio: "2026-09-14T07:00:00.000Z",
      fin: null,
      que_se_limpio: null,
      observaciones: null,
      operario: "Laura",
    });

    const listado = await repo.listarPorMaquina("M1");

    expect(listado.map((a) => a.id)).toEqual(["act-m1"]);
  });
});

// ── 6. La consulta de abierta ────────────────────────────────────────────────

describe("sqliteActividadPlanificadaRepository — getActividadAbierta", () => {
  it("resuelve el alias ActividadAbierta, utilizable por finalizarActividad sin cast", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    // Una limpieza CERRADA (no debe aparecer) y dos abiertas de tipos distintos.
    await repo.insertActividad(actividad({ id: "act-cerrada", fin: "2026-09-14T08:00:00.000Z" }));
    await repo.insertActividad(abierta({ id: "act-limpieza-abierta", tipo: "limpieza" }));
    await repo.insertActividad(abierta({ id: "act-almuerzo-abierta", tipo: "almuerzo" }));

    // La llamada ya recibe `ActividadAbierta` del tipo de retorno del puerto:
    // no hay cast en el sitio de llamada.
    const abiertaLimpieza: ActividadAbierta | null = await repo.getActividadAbierta("M1", "limpieza");

    expect(abiertaLimpieza).not.toBeNull();
    expect(abiertaLimpieza!.id).toBe("act-limpieza-abierta");
    expect(abiertaLimpieza!.fin).toBeNull();

    // La prueba real de "sin cast": el dominio la consume tal cual.
    const cerrada = finalizarActividad(abiertaLimpieza!, "2026-09-14T08:30:00.000Z");
    expect(cerrada.errores).toEqual([]);
    expect(cerrada.actividad?.fin).toBe("2026-09-14T08:30:00.000Z");

    // Cada tipo se consulta por separado: el almuerzo abierto no se confunde.
    const almuerzo = await repo.getActividadAbierta("M1", "almuerzo");
    expect(almuerzo?.id).toBe("act-almuerzo-abierta");
  });

  it("resuelve null cuando no hay ninguna actividad abierta de ese tipo", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertActividad(actividad({ id: "act-cerrada", fin: "2026-09-14T08:00:00.000Z" }));
    await repo.insertActividad(abierta({ id: "act-limpieza-abierta", tipo: "limpieza" }));

    // "pausa" nunca existió.
    const inexistente: ActividadAbierta | null = await repo.getActividadAbierta("M1", "pausa");
    expect(inexistente).toBeNull();

    // Y una abierta de OTRO tipo tampoco se cuela por el filtro `tipo = $2`.
    const otros = await repo.getActividadAbierta("M1", "cambio_diseno");
    expect(otros).toBeNull();
  });
});

// ── 7. Envoltura de error con `cause` ────────────────────────────────────────

describe("sqliteActividadPlanificadaRepository — propagación de errores", () => {
  it("un fallo del INSERT se propaga con la causa original y nunca como éxito", async () => {
    const store = createFakeSqliteStore();
    const fallo = new Error("no such table: actividad_planificada");
    const repo = new SqliteActividadPlanificadaRepository(dbQueFallaAlEscribir(store, fallo));

    const err = await repo
      .insertActividad(actividad({ id: "act-falla" }))
      .then(() => null, (e: unknown) => e as Error);

    // Descriptivo, nombrando la entidad y el id (patrón 10.3/10.4).
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe('no se pudo persistir la actividad "act-falla"');
    // La causa original se conserva: no se traga ni se convierte en éxito.
    expect(err!.cause).toBe(fallo);
    expect(store.actividad_planificada).toHaveLength(0);
  });

  it("un fallo del UPDATE se propaga con la causa original y deja la fila intacta", async () => {
    const store = createFakeSqliteStore();
    // Primero, sembrar por la vía buena para que el pre-chequeo del UPDATE pase.
    await repoSobre(store).insertActividad(abierta({ id: "act-actualizable" }));
    const fallo = new Error("disk I/O error");
    const repo = new SqliteActividadPlanificadaRepository(dbQueFallaAlEscribir(store, fallo));

    const err = await repo
      .updateActividad(actividad({ id: "act-actualizable" }))
      .then(() => null, (e: unknown) => e as Error);

    expect(err!.message).toBe('no se pudo persistir la actividad "act-actualizable"');
    expect(err!.cause).toBe(fallo);
    // La escritura no se aplicó a medias: sigue abierta y sin tocar.
    expect(store.actividad_planificada[0].fin).toBeNull();
  });
});

// ── 8. Update en el mismo lugar ──────────────────────────────────────────────

describe("sqliteActividadPlanificadaRepository — update en el mismo lugar", () => {
  it("cerrar una actividad actualiza la MISMA fila y no añade ninguna otra", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    const abiertaInicial = abierta({ id: "act-cierre", tipo: "limpieza" });
    await repo.insertActividad(abiertaInicial);
    expect(store.actividad_planificada).toHaveLength(1);

    // El flujo real de cierre: el dominio devuelve una copia con `fin`, y se
    // concreta `queSeLimpio` en la misma actualización.
    const abiertaLeida = (await repo.getActividadAbierta("M1", "limpieza"))!;
    const { errores, actividad: cerrada } = finalizarActividad(
      abiertaLeida,
      "2026-09-14T08:30:00.000Z"
    );
    expect(errores).toEqual([]);
    await repo.updateActividad({ ...cerrada!, queSeLimpio: "mesa de estampado y cuadros" });

    // Ni una fila de más: el update es in situ, no un insert disfrazado.
    expect(store.actividad_planificada).toHaveLength(1);
    const fila = store.actividad_planificada[0];
    expect(fila.id).toBe("act-cierre");
    expect(fila.fin).toBe("2026-09-14T08:30:00.000Z");
    expect(fila.que_se_limpio).toBe("mesa de estampado y cuadros");
    // La identidad y lo que no se tocó sobreviven intactos.
    expect(fila.machine_id).toBe(abiertaInicial.maquinaId);
    expect(fila.operario).toBe(abiertaInicial.operatorName);
    expect(fila.inicio).toBe(abiertaInicial.inicio);

    // Y una vez cerrada ya no aparece como abierta: el `fin IS NULL` de la
    // consulta de abiertas responde con la verdad almacenada.
    const sigueAbierta = await repo.getActividadAbierta("M1", "limpieza");
    expect(sigueAbierta).toBeNull();
    await expect(repo.obtenerPorId("act-cierre")).resolves.toMatchObject({
      id: "act-cierre",
      fin: "2026-09-14T08:30:00.000Z",
      queSeLimpio: "mesa de estampado y cuadros",
    });
  });

  it("updateActividad escribe las 7 columnas no-PK y nunca `id` en un SET", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertActividad(actividad({ id: "act-completa" }));

    // `observaciones` se añade y `queSeLimpio` se retira en la misma llamada:
    // un SET incompleto dejaría el valor viejo pegado.
    await repo.updateActividad(
      actividad({
        id: "act-completa",
        fin: null,
        queSeLimpio: undefined,
        observaciones: "cambio de cuadro Jessie",
      })
    );

    const fila = store.actividad_planificada[0];
    expect(fila.fin).toBeNull();
    expect(fila.que_se_limpio).toBeNull();
    expect(fila.observaciones).toBe("cambio de cuadro Jessie");
    // El id sigue siendo el mismo: la identidad no se reescribe.
    expect(fila.id).toBe("act-completa");
  });
});

// ── Listado por día operativo ────────────────────────────────────────────────

/**
 * HONESTY: estos casos pasan sobre el DOBLE, así que NO son evidencia de paridad.
 * El doble aplica el predicado en JavaScript: demuestran que el adaptador emite
 * la sentencia que dice y liga bien sus binds, y nada más. No demuestran que
 * SQLite evalúe ese `WHERE`, ni que el índice `(machine_id, fecha_operativa)` de
 * la migración 005 se use — para eso está `EXPLAIN QUERY PLAN` sobre un SQLite
 * real. La paridad entre las dos familias se demuestra en
 * `dayScopedListing.parity.test.ts` (WU4).
 */

describe("SqliteActividadPlanificadaRepository — listarPorMaquinaYFecha", () => {
  it("emite machine_id y fecha_operativa en un solo WHERE, con el día ligado en $2", async () => {
    const store = createFakeSqliteStore();
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
    const repo = new SqliteActividadPlanificadaRepository(db);
    await repo.insertActividad(actividad({ id: "a-a", fechaOperativa: "2026-09-11" }));

    await repo.listarPorMaquinaYFecha("M1", "2026-09-11");

    expect(consultas[consultas.length - 1]).toBe(
      "SELECT * FROM actividad_planificada WHERE machine_id = $1 AND fecha_operativa = $2 ORDER BY inicio ASC"
    );
    // se asserta el ÚLTIMO enlace, no cualquiera: el INSERT previo también emite
    // un SELECT de pre-chequeo con sus propios binds.
    expect(enlaces[enlaces.length - 1].binds).toEqual(["M1", "2026-09-11"]);
  });

  it("devuelve solo las actividades del día pedido, en orden cronológico", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertActividad(actividad({ id: "a-a", inicio: "2026-09-11T09:00:00.000Z", fechaOperativa: "2026-09-11" }));
    await repo.insertActividad(actividad({ id: "a-b", inicio: "2026-09-11T07:00:00.000Z", fechaOperativa: "2026-09-11" }));
    await repo.insertActividad(actividad({ id: "a-c", inicio: "2026-09-15T08:00:00.000Z", fechaOperativa: "2026-09-15" }));

    expect((await repo.listarPorMaquinaYFecha("M1", "2026-09-11")).map((a) => a.id)).toEqual([
      "a-b",
      "a-a",
    ]);
  });

  it("devuelve un array vacío para un día sin actividades, sin error", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertActividad(actividad({ id: "a-a", fechaOperativa: "2026-09-11" }));

    await expect(repo.listarPorMaquinaYFecha("M1", "2026-09-12")).resolves.toEqual([]);
  });

  it("filtra por el fechaOperativa persistido, no por el inicio", async () => {
    const store = createFakeSqliteStore();
    const repo = repoSobre(store);
    await repo.insertActividad(
      abierta({ id: "a-cruzada", inicio: "2026-09-14T23:30:00.000Z", fechaOperativa: "2026-09-15" })
    );

    expect((await repo.listarPorMaquinaYFecha("M1", "2026-09-15")).map((a) => a.id)).toEqual([
      "a-cruzada",
    ]);
    expect(await repo.listarPorMaquinaYFecha("M1", "2026-09-14")).toEqual([]);
  });
});
