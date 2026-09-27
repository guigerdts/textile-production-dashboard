/**
 * Ticket 10 (Phase 2) — Unit S — shared FK-capable fake store (D2b)
 *
 * WHAT THIS IS: the one store double the five SQLite operational adapter suites
 * (C2/D2/E2/F2) and the restart-survival suite consume. It is a
 * **statement-shape-matching fake**: `execute` / `select` dispatch on the exact
 * statements the adapters emit, and it enforces **exactly the five foreign
 * keys declared in migration 004** before applying an INSERT or an UPDATE that
 * writes a link column.
 *
 * WHAT THIS IS NOT: a SQL engine, and never SQLite itself. It MODELS the
 * declared behaviour of the 004 statements; it does not execute DDL, does not
 * open a connection, does not simulate `PRAGMA foreign_keys` (D2d declines that
 * as unverifiable) and does not model CHECK constraints or DEFAULTs.
 *
 * HONESTY NOTE (D2d): the five foreign keys enforced here are the ones 004
 * *declares*. Whether the real Tauri connection enforces them — `PRAGMA
 * foreign_keys` is a per-connection setting and tauri-plugin-sql may serve
 * statements from a pool — stays unverified (R5). The named runtime probe is
 * `getForeignKeys()` on the real binary. A test that passes over this double
 * proves the repository logic and the exact SQL it emits; it never proves real
 * SQLite behaviour.
 *
 * ANTI-VACUITY (D2b): an unmodelled statement THROWS instead of returning
 * nothing, so an adapter that drifts from its declared statement shape fails
 * loudly. That is what makes the R2 regression guard meaningful instead of a
 * tautology.
 *
 * Scope: test infrastructure, not a second persistence system. It lives in
 * `__tests__/`, it never translates `machine_id` / `operario` (SQL vocabulary
 * is the adapters' business), and it duplicates neither the adapters'
 * duplicate/unknown-id rejection nor any domain rule.
 */

import type Database from "@tauri-apps/plugin-sql";

// ── Contrato público ─────────────────────────────────────────────────────────

export interface FakeSqliteStoreOptions {
  foreignKeys: boolean;
}

/** La clave primaria de 004 es `id` en las seis tablas modeladas. */
export type FakeSqliteRow = Record<string, unknown> & { id: string };

export type FakeSqliteTableName =
  | "orden"
  | "parada"
  | "actividad_planificada"
  | "dano"
  | "inspeccion_tela"
  | "mantenimiento";

export type FakeSqliteTables = {
  [T in FakeSqliteTableName]: FakeSqliteRow[];
};

export type FakeSqliteStore = Database & FakeSqliteTables;

/**
 * Causa sintética del rechazo por clave foránea: nombra tabla, columna y valor.
 * Deliberadamente distinta del mensaje de la rejection (`FOREIGN KEY constraint
 * failed`, el vocabulario de SQLite), para que una capa de dominio nunca pueda
 * confundir un error de persistencia con su propio mensaje.
 */
export class SqliteFkError extends Error {
  readonly table: string;
  readonly column: string;
  readonly value: unknown;

  constructor(table: string, column: string, value: unknown) {
    super(`FK no resoluble: ${table}.${column} = ${String(value)}`);
    this.name = "SqliteFkError";
    this.table = table;
    this.column = column;
    this.value = value;
  }
}

// ── Las CINCO claves foráneas declaradas en 004 ──────────────────────────────
//
// Ninguna otra tabla tiene FK, y `actividad_planificada` no tiene `orden_id` por
// diseño (ADR 0005). Un enlace ausente NO se inventa: se rechaza.

const FOREIGN_KEYS: Partial<Record<FakeSqliteTableName, Record<string, FakeSqliteTableName>>> = {
  parada: { orden_id: "orden" },
  dano: { orden_id: "orden", parada_id: "parada" },
  inspeccion_tela: { orden_id: "orden" },
  mantenimiento: { dano_id: "dano" },
};

// ── Predicados modelados: sólo el vocabulario exacto de las sentencias 004 ────

type Operador = "=" | "IS" | "IS NULL";

interface Predicado {
  columna: string;
  operador: Operador;
  /** Índice del bind (base 1) para `=` e `IS $n`. */
  bind: number;
}

/** `col = $n` | `col IS $n` (null-safe) | `col IS NULL`, unidos por ` AND `. */
function parsePredicados(clause: string, query: string): Predicado[] {
  return clause.split(" AND ").map((crudo) => {
    const m = /^(\w+) (= \$(\d+)|IS \$(\d+)|IS NULL)$/.exec(crudo.trim());
    if (!m) throw new Error(`select: unsupported query in mock: ${query}`);
    const columna = m[1];
    if (m[3] !== undefined) return { columna, operador: "=", bind: Number(m[3]) };
    if (m[4] !== undefined) return { columna, operador: "IS", bind: Number(m[4]) };
    return { columna, operador: "IS NULL", bind: 0 };
  });
}

function cumple(row: FakeSqliteRow, p: Predicado, binds: unknown[]): boolean {
  const valor = row[p.columna];
  if (p.operador === "IS NULL") return valor === null || valor === undefined;
  const esperado = binds[p.bind - 1];
  if (p.operador === "IS") {
    // `IS` es null-safe: la forma correcta para `orden_id IS $2` de
    // getParadaAbierta, donde el segundo parámetro puede ser `null`.
    if (valor === null || valor === undefined) {
      return esperado === null || esperado === undefined;
    }
    return valor === esperado;
  }
  // `=` con bind null NUNCA casa (lógica de tres valores): por eso
  // `listarPorOrden` excluye los `orden_id` nulos sin un `IS NOT NULL` extra.
  if (valor === null || valor === undefined) return false;
  return valor === esperado;
}

/** Orden lexicográfico sobre el valor de la fila (ISO ordena = cronológico). */
function comparar(a: unknown, b: unknown): number {
  const sa = a === null || a === undefined ? "" : String(a);
  const sb = b === null || b === undefined ? "" : String(b);
  if (sa === sb) return 0;
  return sa < sb ? -1 : 1;
}

// ── El doble ─────────────────────────────────────────────────────────────────

export function createFakeSqliteStore(
  options: FakeSqliteStoreOptions = { foreignKeys: true }
): FakeSqliteStore {
  // Una sola configuración (D2b): no hay modo sin FK, ni toggle, ni segunda
  // verdad. Pedir `foreignKeys: false` falla en voz alta en vez de fingir.
  if (options.foreignKeys !== true) {
    throw new Error(
      "createFakeSqliteStore: no existe un modo sin claves foráneas (D2b) — " +
        "las cinco FK de 004 se imponen siempre"
    );
  }

  const tablas: FakeSqliteTables = {
    orden: [],
    parada: [],
    actividad_planificada: [],
    dano: [],
    inspeccion_tela: [],
    mantenimiento: [],
  };

  /** Tabla modelada, o el mismo throw de deriva si el nombre no existe. */
  function filasDe(nombre: string, query: string, verbo: string): FakeSqliteRow[] {
    const tabla = tablas[nombre as FakeSqliteTableName];
    if (!tabla) throw new Error(`${verbo}: unsupported query in mock: ${query}`);
    return tabla;
  }

  /** Se resuelve ANTES de aplicar la escritura; un enlace `null` se acepta. */
  function verificarClavesForaneas(nombre: FakeSqliteTableName, fila: FakeSqliteRow): void {
    const enlaces = FOREIGN_KEYS[nombre];
    if (!enlaces) return;
    for (const [columna, destino] of Object.entries(enlaces)) {
      const valor = fila[columna];
      if (valor === null || valor === undefined) continue;
      if (!tablas[destino].some((r) => r.id === valor)) {
        throw new Error("FOREIGN KEY constraint failed", {
          cause: new SqliteFkError(nombre, columna, valor),
        });
      }
    }
  }

  // ── SELECT ────────────────────────────────────────────────────────────────

  function modelarSelect(query: string, binds: unknown[]): FakeSqliteRow[] {
    const q = query.trim();

    // Pre-chequeo de escritura: SELECT id FROM <t> WHERE id = $1 → lo responde
    // el array. El rechazo por duplicado / desconocido es del adaptador, NO del
    // doble: aquí no vive ninguna regla de dominio.
    const pre = /^SELECT id FROM (\w+) WHERE id = \$1$/.exec(q);
    if (pre) {
      const [id] = binds as [string];
      const fila = filasDe(pre[1], query, "select").find((r) => r.id === id);
      return fila ? [{ id: fila.id }] : [];
    }

    const m = /^SELECT \* FROM (\w+)([\s\S]*)$/.exec(q);
    if (!m) throw new Error(`select: unsupported query in mock: ${query}`);
    const filas = filasDe(m[1], query, "select");

    let resto = m[2];
    let ordenPor: string | null = null;
    let limite = false;
    // El `LIMIT 1` se recorta PRIMERO: si no, el `ORDER BY` queda al final de
    // la cadena y su anclaje `$` ya no casa.
    if (/\s+LIMIT 1\s*$/i.test(resto)) {
      limite = true;
      resto = resto.replace(/\s+LIMIT 1\s*$/i, "");
    }
    const orden = /\s+ORDER BY\s+(\w+)\s+ASC\s*$/i.exec(resto);
    if (orden) {
      ordenPor = orden[1];
      resto = resto.slice(0, orden.index);
    }

    let predicados: Predicado[] = [];
    if (/^\s+WHERE\s+/.test(resto)) {
      const w = /^\s+WHERE\s+([\s\S]+)$/.exec(resto);
      if (!w) throw new Error(`select: unsupported query in mock: ${query}`);
      predicados = parsePredicados(w[1], query);
    } else if (resto.trim() !== "") {
      throw new Error(`select: unsupported query in mock: ${query}`);
    }

    // El orden lo aplica el doble, desde el valor de la fila — nunca desde el
    // orden de inserción (D2b §4: así "el repositorio es dueño del orden" es
    // una aserción real y no un accidente).
    const candidatas = filas.filter((f) => predicados.every((p) => cumple(f, p, binds)));
    if (ordenPor) candidatas.sort((a, b) => comparar(a[ordenPor as string], b[ordenPor as string]));
    // LIMIT 1 se respeta al pie de la letra: exactamente una fila.
    const devueltas = limite ? candidatas.slice(0, 1) : candidatas;
    return devueltas.map((f) => ({ ...f }));
  }

  // ── INSERT / UPDATE ───────────────────────────────────────────────────────

  function modelarExecute(query: string, binds: unknown[]): number {
    const q = query.trim();

    // INSERT INTO <t> (<cols>) VALUES ($1..$n)
    const ins = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/.exec(q);
    if (ins) {
      const filas = filasDe(ins[1], query, "execute");
      const columnas = ins[2].split(",").map((c) => c.trim());
      const placeholders = ins[3].split(",").map((c) => c.trim());
      if (columnas.length !== placeholders.length) {
        throw new Error(`execute: unsupported query in mock: ${query}`);
      }
      const fila: FakeSqliteRow = { id: "" };
      columnas.forEach((columna, i) => {
        const p = /^\$(\d+)$/.exec(placeholders[i]);
        if (!p) throw new Error(`execute: unsupported query in mock: ${query}`);
        fila[columna] = binds[Number(p[1]) - 1];
      });
      verificarClavesForaneas(ins[1] as FakeSqliteTableName, fila);
      filas.push(fila);
      return 1;
    }

    // UPDATE <t> SET <col = $n, ...> WHERE id = $n
    const upd = /^UPDATE (\w+) SET ([\s\S]+?) WHERE id = \$(\d+)$/.exec(q);
    if (upd) {
      const filas = filasDe(upd[1], query, "execute");
      const id = binds[Number(upd[3]) - 1];
      const fila = filas.find((r) => r.id === id);
      // "no existe" lo rechaza el adaptador; el doble responde 0 filas.
      if (!fila) return 0;
      const parcial: FakeSqliteRow = { id: fila.id };
      for (const asignacion of upd[2].split(",").map((c) => c.trim())) {
        const a = /^(\w+) = \$(\d+)$/.exec(asignacion);
        if (!a) throw new Error(`execute: unsupported query in mock: ${query}`);
        parcial[a[1]] = binds[Number(a[2]) - 1];
      }
      verificarClavesForaneas(upd[1] as FakeSqliteTableName, parcial);
      Object.assign(fila, parcial);
      return 1;
    }

    throw new Error(`execute: unsupported query in mock: ${query}`);
  }

  const store = {
    path: "sqlite:fake.db",
    ...tablas,
    async execute(query: string, bindValues: unknown[] = []) {
      return { rowsAffected: modelarExecute(query, bindValues) };
    },
    async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
      return modelarSelect(query, bindValues) as T;
    },
    async close() {
      return true;
    },
  };

  return store as unknown as FakeSqliteStore;
}