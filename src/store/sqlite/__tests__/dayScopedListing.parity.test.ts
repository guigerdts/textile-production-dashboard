// @vitest-environment node
/**
 * CHANGE 2 (historical-day-navigation) — day-scoped listing parity across BOTH
 * adapter families, over a real SQLite engine (WU4)
 *
 * WHAT THIS SUITE IS: one contract, run twice. `describeDayScopedListingContract`
 * is called once per event type for the in-memory family and once for the SQLite
 * family, so all six attribution shapes plus the chronological-order and
 * full-history guarantees are executed against **both**, through the same code
 * path. Neither family gets a case the other does not run (DD10), which is what
 * makes "the day filter cannot drift between them" a statement about evidence
 * rather than about intent.
 *
 * The SQLite side runs the **unmodified production adapter classes** against a
 * real `node:sqlite` `DatabaseSync` carrying the **real migrations 001–005** (see
 * `realSqlite.ts`). Only the injected `Database` differs.
 *
 * WHAT THIS SUITE IS NOT: it does NOT run the Tauri migration and it does NOT
 * exercise the Tauri plugin transport. Migrations are applied by `node:sqlite`'s
 * `exec`, not by `lib.rs`'s `include_str!` registration nor by tauri-plugin-sql's
 * per-migration application on `Database.load()`. Whether the transport enforces
 * the same predicates stays PENDING runtime validation (R5/R6), exactly as
 * `recovery.test.ts` and `startup.test.ts` already state. Those two honesty
 * notes are deliberately left unedited.
 *
 * SEPARATE EVIDENCE, NOT CLAIMED HERE: the migration DDL behaviour was verified
 * separately against a real SQLite engine with `src-tauri/migrations/validate_r56.py`
 * (read-only). That harness is a Python `sqlite3` script, NOT the Tauri runtime,
 * and not equivalent to it: sqlx applies each migration inside a transaction
 * while `executescript` is autocommit. This suite therefore proves that a real
 * SQLite engine enforces the day predicate over the real migrations 005 shipped —
 * and claims nothing beyond that.
 *
 * It also does not claim the Tauri connection applies `PRAGMA foreign_keys`.
 * `node:sqlite` enables it by default (verified before this file was written), so
 * the `orden` rows below are seeded as valid rather than to work around a
 * disabled check.
 */

// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  ActividadPlanificada,
  Dano,
  Mantenimiento,
  Parada,
} from "../../../domain/types";
import { InMemoryActividadPlanificadaRepository } from "../../inMemoryActividadesRepository";
import { InMemoryDanoRepository } from "../../inMemoryDanosRepository";
import { InMemoryMantenimientoRepository } from "../../inMemoryMantenimientoRepository";
import { InMemoryParadaRepository } from "../../inMemoryParadasRepository";
import {
  D1,
  describeDayScopedListingContract,
  type CasoDia,
  type RecetaDia,
} from "../../__tests__/dayScopedListingContract";
import { SqliteActividadPlanificadaRepository } from "../sqliteActividadPlanificadaRepository";
import { SqliteDanoRepository } from "../sqliteDanoRepository";
import { SqliteMantenimientoRepository } from "../sqliteMantenimientoRepository";
import { SqliteParadaRepository } from "../sqliteParadaRepository";
import { abrirSqliteReal, explicar, type DatabaseLike } from "./realSqlite";

const M1 = "M1";

// ── Receta → registro de dominio ─────────────────────────────────────────────

function paradaDe(receta: RecetaDia): Parada {
  return {
    id: receta.id,
    maquinaId: M1,
    ordenId: receta.ordenId,
    operatorName: "Laura",
    causaId: "falta_tela",
    camposEspecificos: {},
    fechaOperativa: receta.fechaOperativa,
    inicio: receta.inicio,
    fin: receta.fin,
  };
}

function actividadDe(receta: RecetaDia): ActividadPlanificada {
  return {
    id: receta.id,
    maquinaId: M1,
    // `cambio_diseno` para no arrastrar `queSeLimpio`, que sólo aplica a
    // `limpieza`. Esa obligatoriedad la valida el dominio; aquí no hay dominio.
    tipo: "cambio_diseno",
    fechaOperativa: receta.fechaOperativa,
    inicio: receta.inicio,
    fin: receta.fin,
    operatorName: "Laura",
  };
}

function danoDe(receta: RecetaDia): Dano {
  return {
    id: receta.id,
    maquinaId: M1,
    ordenId: receta.ordenId,
    operatorName: "Laura",
    tipo: "mecanico",
    componente: "eje trasero",
    fechaOperativa: receta.fechaOperativa,
    inicio: receta.inicio,
    fin: receta.fin,
    // `causoParada: false` ⇒ `paradaId` null: la coherencia la valida el dominio,
    // pero sembrarla coherente evita sembrar datos que la producción no produce.
    causoParada: false,
    paradaId: null,
    posibleSegunda: false,
  };
}

function mantenimientoDe(receta: RecetaDia): Mantenimiento {
  return {
    id: receta.id,
    maquinaId: M1,
    // `preventivo` ⇒ `danoId` siempre null, así que esta familia no necesita
    // sembrar filas de `dano`.
    tipo: "preventivo",
    operatorName: "Laura",
    motivo: "cambio de cuadro",
    fechaOperativa: receta.fechaOperativa,
    inicio: receta.inicio,
    fin: receta.fin,
    danoId: null,
  };
}

// ── Familia en memoria ───────────────────────────────────────────────────────

function casoParadaEnMemoria(registros: RecetaDia[]): CasoDia<Parada> {
  const repo = new InMemoryParadaRepository(registros.map(paradaDe));
  return {
    listarPorDia: (m, f) => repo.listarPorMaquinaYFecha(m, f),
    listarSinDia: (m) => repo.listarPorMaquina(m),
  };
}

function casoActividadEnMemoria(registros: RecetaDia[]): CasoDia<ActividadPlanificada> {
  const repo = new InMemoryActividadPlanificadaRepository(registros.map(actividadDe));
  return {
    listarPorDia: (m, f) => repo.listarPorMaquinaYFecha(m, f),
    listarSinDia: (m) => repo.listarPorMaquina(m),
  };
}

function casoDanoEnMemoria(registros: RecetaDia[]): CasoDia<Dano> {
  const repo = new InMemoryDanoRepository(registros.map(danoDe));
  return {
    listarPorDia: (m, f) => repo.listarPorMaquinaYFecha(m, f),
    listarSinDia: (m) => repo.listarPorMaquina(m),
  };
}

function casoMantenimientoEnMemoria(registros: RecetaDia[]): CasoDia<Mantenimiento> {
  const repo = new InMemoryMantenimientoRepository(registros.map(mantenimientoDe));
  return {
    listarPorDia: (m, f) => repo.listarPorMaquinaYFecha(m, f),
    listarSinDia: (m) => repo.listarPorMaquina(m),
  };
}

// ── Familia SQLite sobre el motor real ───────────────────────────────────────

/**
 * Siembra las órdenes que referencian los registros con `ordenId`, porque
 * `PRAGMA foreign_keys` está activo en `node:sqlite` y `orden_id` es FK a
 * `orden(id)`. Se siembran por SQL directo — no por `IOrderRepository` — porque
 * una orden completa es material de otro contrato (lectura de golpe, estado,
 * unidades) y este suite no afirma nada sobre él.
 */
async function sembrarOrdenes(db: DatabaseLike, recetas: RecetaDia[]): Promise<void> {
  const ids = [...new Set(recetas.map((r) => r.ordenId).filter((id): id is string => id !== null))];
  for (const id of ids) {
    await db.execute(
      "INSERT INTO orden (id, numero_orden, fecha_operativa, referencia_tela, disenio, unidades_solicitadas, machine_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [id, id, D1, "tela-1", "Jessie", 100, M1, `${D1}T07:00:00.000Z`, `${D1}T07:00:00.000Z`]
    );
  }
}

async function casoParadaSqlite(registros: RecetaDia[]): Promise<CasoDia<Parada>> {
  const { db } = abrirSqliteReal();
  await sembrarOrdenes(db, registros);
  const repo = new SqliteParadaRepository(db);
  for (const receta of registros) await repo.insertParada(paradaDe(receta));
  return {
    listarPorDia: (m, f) => repo.listarPorMaquinaYFecha(m, f),
    listarSinDia: (m) => repo.listarPorMaquina(m),
  };
}

async function casoActividadSqlite(registros: RecetaDia[]): Promise<CasoDia<ActividadPlanificada>> {
  const { db } = abrirSqliteReal();
  await sembrarOrdenes(db, registros);
  const repo = new SqliteActividadPlanificadaRepository(db);
  for (const receta of registros) await repo.insertActividad(actividadDe(receta));
  return {
    listarPorDia: (m, f) => repo.listarPorMaquinaYFecha(m, f),
    listarSinDia: (m) => repo.listarPorMaquina(m),
  };
}

async function casoDanoSqlite(registros: RecetaDia[]): Promise<CasoDia<Dano>> {
  const { db } = abrirSqliteReal();
  await sembrarOrdenes(db, registros);
  const repo = new SqliteDanoRepository(db);
  for (const receta of registros) await repo.insertDano(danoDe(receta));
  return {
    listarPorDia: (m, f) => repo.listarPorMaquinaYFecha(m, f),
    listarSinDia: (m) => repo.listarPorMaquina(m),
  };
}

async function casoMantenimientoSqlite(registros: RecetaDia[]): Promise<CasoDia<Mantenimiento>> {
  const { db } = abrirSqliteReal();
  const repo = new SqliteMantenimientoRepository(db);
  for (const receta of registros) await repo.insertMantenimiento(mantenimientoDe(receta));
  return {
    listarPorDia: (m, f) => repo.listarPorMaquinaYFecha(m, f),
    listarSinDia: (m) => repo.listarPorMaquina(m),
  };
}

// ── El contrato, una vez por familia y por tipo de evento ────────────────────

describe("paridad del listado por día — las dos familias, motor real", () => {
  describe("in-memory", () => {
    describeDayScopedListingContract<Parada>(
      "in-memory · parada",
      casoParadaEnMemoria,
    );
    describeDayScopedListingContract<ActividadPlanificada>(
      "in-memory · actividad",
      casoActividadEnMemoria,
    );
    describeDayScopedListingContract<Dano>(
      "in-memory · daño",
      casoDanoEnMemoria,
    );
    describeDayScopedListingContract<Mantenimiento>(
      "in-memory · mantenimiento",
      casoMantenimientoEnMemoria,
    );
  });

  describe("sqlite (motor real, migraciones 001-005)", () => {
    describeDayScopedListingContract<Parada>(
      "sqlite · parada",
      casoParadaSqlite,
    );
    describeDayScopedListingContract<ActividadPlanificada>(
      "sqlite · actividad",
      casoActividadSqlite,
    );
    describeDayScopedListingContract<Dano>(
      "sqlite · daño",
      casoDanoSqlite,
    );
    describeDayScopedListingContract<Mantenimiento>(
      "sqlite · mantenimiento",
      casoMantenimientoSqlite,
    );
  });
});

// ── El predicado es una igualdad, y nada más (4.3) ──────────────────────────

/**
 * La parte de 4.3 que no se puede observar en el comportamiento.
 *
 * `fechaOperativa` decide la pertenencia a un día: es un hecho del registro, no se
 * deriva de `inicio` y no se altera al cerrar. Eso ya lo demuestra el
 * comportamiento — las formas 3 y 4 y la igualdad exacta se ponen rojas ante
 * cualquier predicado derivado de timestamps.
 *
 * Lo que el comportamiento NO puede demostrar es la ausencia de una segunda
 * fuente de decisión. `jornada` no es una columna de las tablas de eventos (es una
 * tabla, en la migración 001), así que no hay ningún caso que sembrar que la
 * contradiga: un filtro por jornada sería inobservable con datos sembrados. Por
 * eso lleva una guarda estática en vez de un test que finja cubrirla.
 *
 * La guarda lee el SQL del listado por día de los cuatro adaptadores y comprueba
 * que existe la igualdad por `fecha_operativa`, que no se menciona `jornada`, y que
 * no hay predicado de rango, solapamiento ni «sigue abierta». Si alguien reescribe
 * el listado con un `BETWEEN` o un `LEFT JOIN jornada`, esto se pone rojo hoy y no
 * en producción.
 */
const ADAPTADORES_DIA: ReadonlyArray<readonly [string, string]> = [
  ["parada", "sqliteParadaRepository.ts"],
  ["actividad", "sqliteActividadPlanificadaRepository.ts"],
  ["dano", "sqliteDanoRepository.ts"],
  ["mantenimiento", "sqliteMantenimientoRepository.ts"],
];

/** El literal `SELECT` del método `listarPorMaquinaYFecha` de un adaptador. */
function sqlDelListadoPorDia(archivo: string): string {
  const fuente = readFileSync(new URL(`../${archivo}`, import.meta.url), "utf8");

  const cuerpo = fuente.match(/listarPorMaquinaYFecha\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/);
  expect(cuerpo, `no se encontró listarPorMaquinaYFecha en ${archivo}`).not.toBeNull();

  const sentencia = cuerpo?.[1]?.match(/"(SELECT[\s\S]*?)"/);
  expect(sentencia, `no se encontró el SELECT de día en ${archivo}`).not.toBeNull();

  return sentencia?.[1] ?? "";
}

describe("el listado por día decide por igualdad de fechaOperativa, y sólo por eso", () => {
  it.each(ADAPTADORES_DIA)("%s · la sentencia filtra por fecha_operativa = $2", (_familia, archivo) => {
    expect(sqlDelListadoPorDia(archivo)).toContain("WHERE machine_id = $1 AND fecha_operativa = $2");
  });

  it.each(ADAPTADORES_DIA)("%s · la sentencia no menciona jornada", (_familia, archivo) => {
    expect(sqlDelListadoPorDia(archivo)).not.toMatch(/jornada/i);
  });

  it.each(ADAPTADORES_DIA)(
    "%s · la sentencia no usa rango, solapamiento ni «sigue abierta»",
    (_familia, archivo) => {
      const sql = sqlDelListadoPorDia(archivo);

      // Cualquier predicado temporal sobre `inicio`/`fin` — `>=`, `<=`,
      // `BETWEEN`, `OR`, `julianday(...)` — convertiría la atribución exclusiva
      // en una ventana. Una igualdad por `fecha_operativa` no lleva ninguno.
      expect(sql).not.toMatch(/\bBETWEEN\b/i);
      expect(sql).not.toMatch(/\bOR\b/i);
      expect(sql).not.toMatch(/\bjulianday\b/i);
      expect(sql).not.toMatch(/\b(inicio|fin)\b\s*(>=|<=|>|<|BETWEEN)/i);
    }
  );

  it("ninguna de las cuatro tablas de evento persiste una columna jornada", () => {
    // El otro extremo de la ausencia: aunque hoy el SQL no la use, una columna
    // `jornada` en estas tablas invitaría a que alguien la use después.
    const { crudo } = abrirSqliteReal();

    for (const tabla of ["parada", "actividad_planificada", "dano", "mantenimiento"]) {
      const columnas = crudo.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[];
      expect(columnas.map((c) => c.name), `${tabla} no debe persistir jornada`).not.toContain("jornada");
    }
  });
});

// ── El índice de la migración 005 se usa de verdad (DD11) ────────────────────

/**
 * El predicado no sólo tiene que ser correcto: tiene que ser barato. Un
 * `WHERE machine_id = ? AND fecha_operativa = ?` sin índice es un escaneo completo
 * por día consulted, y el coste se paga cada vez que el operario abre un día.
 *
 * Esta aserción es la que convierte la observación de sesión del design en
 * evidencia. Se consulta `EXPLAIN QUERY PLAN` sobre el motor real, no sobre el
 * doble — el doble no tiene plan de acceso, así que esta prueba no podría existir
 * sobre él.
 */
describe("el índice de la migración 005 sirve el predicado de día", () => {
  it("SEARCH parada USING INDEX idx_parada_maquina_fecha (machine_id=? AND fecha_operativa=?)", () => {
    const { crudo } = abrirSqliteReal();

    const plan = explicar(
      crudo,
      "EXPLAIN QUERY PLAN SELECT * FROM parada WHERE machine_id = $1 AND fecha_operativa = $2",
      [M1, D1]
    );

    expect(plan).toHaveLength(1);
    expect(plan[0]).toBe(
      "SEARCH parada USING INDEX idx_parada_maquina_fecha (machine_id=? AND fecha_operativa=?)"
    );
  });

  it("los cuatro índices de día existen con el nombre que la migración 005 declara", () => {
    const { crudo } = abrirSqliteReal();

    for (const nombre of [
      "idx_parada_maquina_fecha",
      "idx_actividad_maquina_fecha",
      "idx_dano_maquina_fecha",
      "idx_mantenimiento_maquina_fecha",
    ]) {
      const filas = crudo
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .all(nombre);
      expect(filas, `falta el índice ${nombre}`).toHaveLength(1);
    }
  });
});