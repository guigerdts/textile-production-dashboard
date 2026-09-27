/**
 * Ticket 10 (Phase 2) — Unit A2 — Migration 004 (operational_events) SQL contract
 *
 * WHAT THIS SUITE IS: a contract test over the *text* of the migration script. It
 * parses the SQL of both copies — the canonical file the real Tauri binary embeds
 * and the frontend mirror — and asserts the twelve approved
 * `operational-events-schema` requirements: 5 tables, 59 columns with the exact
 * names and nullability, 5 foreign keys, 11 indexes (4 of them partial), no CHECK,
 * no DEFAULT, no speculative index, no derived column, and byte equality between
 * the two copies. A later column, index or vocabulary drift fails here instead of
 * in a review.
 *
 * WHAT THIS SUITE IS NOT: it does NOT run the real Tauri migration. That runs
 * Rust-side — `src-tauri/src/lib.rs` registers version 4 via `include_str!` and
 * tauri-plugin-sql applies it on `Database.load()`. This environment cannot run
 * the Tauri runtime, so nothing here executes the DDL against a real sqlite
 * engine, opens a connection, or reads `PRAGMA table_info` / `PRAGMA
 * foreign_key_list`. What it proves is the declared contract of the script, never
 * that a real connection enforces it.
 *
 * HONESTY NOTE (D2d): the five foreign keys are asserted as *declared* in the
 * script. `PRAGMA foreign_keys` is a per-connection setting and tauri-plugin-sql
 * may serve statements from a pool, so enforcement on the connection actually used
 * remains unverified (R5/R6, open exactly as for 001/002/003). The named runtime
 * probe is `getForeignKeys()` (`src/store/sqlite/database.ts:136-140`) on the real
 * Tauri binary. `src/store/sqlite/database.ts` is deliberately unchanged: no
 * unverifiable workaround is added here.
 *
 * Modelled structurally on `migration003.test.ts` (same `?raw` import, same
 * parse-the-script-not-the-engine approach). 003 also modelled a schema shape
 * because its ALTERs were observable through a repository; 004 has no modelled
 * schema because nothing in this phase executes the migration.
 */

import { describe, expect, it } from "vitest";
import canonicalSql from "../../../../src-tauri/migrations/004_operational_events.sql?raw";
import mirrorSql from "../migrations/004_operational_events.sql?raw";

// ── Parser mínimo del script ─────────────────────────────────────────────────

interface ColumnDefinition {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  /** Resto de la definición tal cual aparece, para aserciones dirigidas. */
  rest: string;
}

interface ForeignKeyDefinition {
  table: string;
  columns: string[];
  referencesTable: string;
  referencesColumns: string[];
}

interface IndexDefinition {
  name: string;
  table: string;
  columns: string[];
  where: string | null;
}

interface ParsedMigration {
  /** Statements `CREATE TABLE` en el orden del script. */
  tables: Map<string, ColumnDefinition[]>;
  tableNames: string[];
  foreignKeys: ForeignKeyDefinition[];
  indexes: IndexDefinition[];
}

/** Elimina comentarios de bloque y de línea; 004 sólo usa comentarios `--`. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

/** Divide el cuerpo entre paréntesis por comas de primer nivel. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

const CREATE_TABLE = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*)\)$/i;
const CREATE_INDEX =
  /^CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]*)\)\s*(?:WHERE\s+([\s\S]+))?$/i;
const FOREIGN_KEY = /^FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+(\w+)\s*\(([^)]*)\)$/i;
const COLUMN = /^(\w+)\s+(\w+)([\s\S]*)$/;

function parseMigration(sql: string): ParsedMigration {
  const body = stripComments(sql);
  const tables = new Map<string, ColumnDefinition[]>();
  const foreignKeys: ForeignKeyDefinition[] = [];
  const indexes: IndexDefinition[] = [];

  const statements = body
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    const createTable = CREATE_TABLE.exec(statement);
    if (createTable) {
      const [, tableName, inner] = createTable;
      const columns: ColumnDefinition[] = [];
      for (const part of splitTopLevel(inner)) {
        const fk = FOREIGN_KEY.exec(part);
        if (fk) {
          foreignKeys.push({
            table: tableName,
            columns: fk[1].split(",").map((c) => c.trim()),
            referencesTable: fk[2],
            referencesColumns: fk[3].split(",").map((c) => c.trim()),
          });
          continue;
        }
        const column = COLUMN.exec(part);
        if (!column) {
          throw new Error(`parseMigration: unsupported table part: ${part}`);
        }
        const rest = column[3].trim();
        columns.push({
          name: column[1],
          type: column[2].toUpperCase(),
          notNull: /\bNOT\s+NULL\b/i.test(rest),
          primaryKey: /\bPRIMARY\s+KEY\b/i.test(rest),
          rest,
        });
      }
      tables.set(tableName, columns);
      continue;
    }

    const createIndex = CREATE_INDEX.exec(statement);
    if (createIndex) {
      indexes.push({
        name: createIndex[1],
        table: createIndex[2],
        columns: createIndex[3].split(",").map((c) => c.trim()),
        where: createIndex[4] === undefined ? null : createIndex[4].trim(),
      });
      continue;
    }

    throw new Error(`parseMigration: unsupported statement: ${statement}`);
  }

  return { tables, tableNames: [...tables.keys()], foreignKeys, indexes };
}

// ── Contrato esperado (specs/operational-events-schema/spec.md) ──────────────

/** Los cinco conjuntos exactos de columnas, en el orden del script. */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  parada: [
    "id", "machine_id", "orden_id", "operario", "causa_id",
    "campos_especificos", "observaciones", "inicio", "fin",
  ],
  actividad_planificada: [
    "id", "machine_id", "tipo", "inicio", "fin",
    "que_se_limpio", "observaciones", "operario",
  ],
  dano: [
    "id", "machine_id", "orden_id", "operario", "tipo", "componente", "inicio",
    "fin", "solucion_aplicada", "causo_parada", "parada_id", "posible_segunda",
    "unidades_sospechadas", "observaciones",
  ],
  inspeccion_tela: [
    "id", "orden_id", "operario", "lote", "absorcion", "tundido", "manchas",
    "dimensiones", "estado_general", "otra_anomalia", "timestamp", "observaciones",
    "resolucion", "motivo_devolucion", "autorizado_por", "registrada_por",
    "resolucion_timestamp", "autorizacion_observaciones",
  ],
  mantenimiento: [
    "id", "machine_id", "tipo", "operario", "motivo", "inicio", "fin",
    "que_se_reviso_reparo", "dano_id", "observaciones",
  ],
};

/**
 * Columnas con `NOT NULL` explícito, transcritas de spec.md:95-116. La aserción
 * es sobre el token declarado, no sobre la semántica de nulabilidad de una PRIMARY
 * KEY en SQLite: esa semántica es del motor real y queda pendiente del probe.
 */
const EXPECTED_NOT_NULL: Record<string, string[]> = {
  parada: ["machine_id", "operario", "causa_id", "campos_especificos", "inicio"],
  actividad_planificada: ["machine_id", "tipo", "inicio", "operario"],
  dano: [
    "machine_id", "operario", "tipo", "componente", "inicio",
    "causo_parada", "posible_segunda",
  ],
  inspeccion_tela: [
    "orden_id", "operario", "timestamp",
    "absorcion", "tundido", "manchas", "dimensiones", "estado_general",
  ],
  mantenimiento: ["machine_id", "tipo", "operario", "motivo", "inicio"],
};

/** Las cinco claves foráneas físicas, con su tabla destino. */
const EXPECTED_FOREIGN_KEYS: Array<{
  table: string;
  column: string;
  referencesTable: string;
  referencesColumn: string;
}> = [
  { table: "parada", column: "orden_id", referencesTable: "orden", referencesColumn: "id" },
  { table: "dano", column: "orden_id", referencesTable: "orden", referencesColumn: "id" },
  { table: "dano", column: "parada_id", referencesTable: "parada", referencesColumn: "id" },
  {
    table: "inspeccion_tela",
    column: "orden_id",
    referencesTable: "orden",
    referencesColumn: "id",
  },
  { table: "mantenimiento", column: "dano_id", referencesTable: "dano", referencesColumn: "id" },
];

/** Los once índices, uno por query que los ports emiten (spec.md:200-212). */
const EXPECTED_INDEXES: Array<{
  name: string;
  table: string;
  columns: string[];
  where: string | null;
}> = [
  { name: "idx_parada_maquina_inicio", table: "parada", columns: ["machine_id", "inicio"], where: null },
  {
    name: "idx_actividad_maquina_inicio",
    table: "actividad_planificada",
    columns: ["machine_id", "inicio"],
    where: null,
  },
  { name: "idx_dano_maquina_inicio", table: "dano", columns: ["machine_id", "inicio"], where: null },
  {
    name: "idx_mantenimiento_maquina_inicio",
    table: "mantenimiento",
    columns: ["machine_id", "inicio"],
    where: null,
  },
  {
    name: "idx_parada_abierta",
    table: "parada",
    columns: ["machine_id", "orden_id"],
    where: "fin IS NULL",
  },
  {
    name: "idx_actividad_abierta",
    table: "actividad_planificada",
    columns: ["machine_id", "tipo"],
    where: "fin IS NULL",
  },
  { name: "idx_dano_abierta", table: "dano", columns: ["machine_id"], where: "fin IS NULL" },
  {
    name: "idx_mantenimiento_abierta",
    table: "mantenimiento",
    columns: ["machine_id"],
    where: "fin IS NULL",
  },
  { name: "idx_parada_orden", table: "parada", columns: ["orden_id"], where: null },
  { name: "idx_dano_orden", table: "dano", columns: ["orden_id"], where: null },
  {
    name: "idx_inspeccion_orden",
    table: "inspeccion_tela",
    columns: ["orden_id", "timestamp"],
    where: null,
  },
];

/** Las seis columnas de la unión `ResolucionInspeccion`, todas nullable. */
const RESOLUTION_COLUMNS = [
  "resolucion",
  "motivo_devolucion",
  "autorizado_por",
  "registrada_por",
  "resolucion_timestamp",
  "autorizacion_observaciones",
];

/** Los cinco ítems del checklist, planos y NOT NULL. */
const CHECKLIST_COLUMNS = [
  "absorcion",
  "tundido",
  "manchas",
  "dimensiones",
  "estado_general",
];

/**
 * Nombres derivados que NO pueden existir como columna (spec.md:375-382). Origen de
 * los nombres: ADR 0004 (tiempo productivo derivado), ADR 0007 (mantenimiento
 * documental, sin `duracion`), y los tickets 04/05/06/07 del dominio.
 */
const DERIVED_COLUMN_NAMES = [
  "tiempo_productivo",
  "duracion",
  "duracion_segundos",
  "porcentaje_2da_proyectado",
  "alerta_2da",
  "buena_racha",
  "con_anomalia",
  "estado_inspeccion",
  "estado_maquina",
  "delta_golpes",
  "progreso",
];

// ── Las dos copias del script ────────────────────────────────────────────────

const SQL_FILES: Array<{ label: string; sql: string; parsed: ParsedMigration }> = [
  { label: "canonical (src-tauri)", sql: canonicalSql, parsed: parseMigration(canonicalSql) },
  { label: "mirror (src/store/sqlite)", sql: mirrorSql, parsed: parseMigration(mirrorSql) },
];

// ── Contrato SQL, sobre cada copia ───────────────────────────────────────────

describe.each(SQL_FILES)("Migration 004 (operational_events) — $label", ({ sql, parsed }) => {
  // ── A. Cinco tablas, 59 columnas ─────────────────────────────────────────

  it("A: exactly 5 CREATE TABLE, the five names, and 59 columns in total", () => {
    expect(parsed.tableNames).toEqual([
      "parada",
      "actividad_planificada",
      "dano",
      "inspeccion_tela",
      "mantenimiento",
    ]);

    const total = parsed.tableNames.reduce(
      (sum, table) => sum + (parsed.tables.get(table) ?? []).length,
      0
    );
    expect(total).toBe(59);

    // La PRIMARY KEY de cada tabla es `id`: es lo que hace innecesario un índice
    // dedicado para obtenerPorId (spec.md:228, afirmado en H).
    for (const table of parsed.tableNames) {
      const pk = (parsed.tables.get(table) ?? []).filter((c) => c.primaryKey);
      expect(pk.map((c) => c.name)).toEqual(["id"]);
    }
  });

  // ── B. Los cinco conjuntos exactos de columnas ───────────────────────────

  it("B1: parada exposes exactly its 9 columns, in order", () => {
    expect((parsed.tables.get("parada") ?? []).map((c) => c.name)).toEqual(
      EXPECTED_COLUMNS.parada
    );
  });

  it("B2: actividad_planificada exposes exactly its 8 columns, in order", () => {
    expect((parsed.tables.get("actividad_planificada") ?? []).map((c) => c.name)).toEqual(
      EXPECTED_COLUMNS.actividad_planificada
    );
  });

  it("B3: dano exposes exactly its 14 columns, in order", () => {
    expect((parsed.tables.get("dano") ?? []).map((c) => c.name)).toEqual(
      EXPECTED_COLUMNS.dano
    );
  });

  it("B4: inspeccion_tela exposes exactly its 18 columns, in order", () => {
    expect((parsed.tables.get("inspeccion_tela") ?? []).map((c) => c.name)).toEqual(
      EXPECTED_COLUMNS.inspeccion_tela
    );
  });

  it("B5: mantenimiento exposes exactly its 10 columns, in order", () => {
    expect((parsed.tables.get("mantenimiento") ?? []).map((c) => c.name)).toEqual(
      EXPECTED_COLUMNS.mantenimiento
    );
  });

  // ── C. Ni CHECK ni DEFAULT ──────────────────────────────────────────────

  it("C: no CHECK constraint and no DEFAULT value anywhere in the script", () => {
    // El encabezado advierte de inmutabilidad con la palabra "checksum", así que una
    // regex /CHECK/i sin word boundary daría falso positivo: el boundary es lo que
    // hace correcta la aserción. Se afirma el pretexto para dejarlo documentado.
    expect(sql).toMatch(/checksum/i);
    expect(sql).not.toMatch(/\bCHECK\b/i);
    expect(sql).not.toMatch(/\bDEFAULT\b/i);

    // Y sobre el cuerpo sin comentarios, para que un CHECK escondido en un
    // comentario tampoco pueda pasar por "no declarado".
    const body = stripComments(sql);
    expect(body).not.toMatch(/\bCHECK\b/i);
    expect(body).not.toMatch(/\bDEFAULT\b/i);
  });

  // ── D. Nulabilidad según spec.md:95-116 ─────────────────────────────────

  it("D1: parada — 5 NOT NULL (machine_id, operario, causa_id, campos_especificos, inicio)", () => {
    const columns = parsed.tables.get("parada") ?? [];
    expect(columns.filter((c) => c.notNull).map((c) => c.name).sort()).toEqual(
      [...EXPECTED_NOT_NULL.parada].sort()
    );
  });

  it("D2: actividad_planificada — 4 NOT NULL (machine_id, tipo, inicio, operario)", () => {
    const columns = parsed.tables.get("actividad_planificada") ?? [];
    expect(columns.filter((c) => c.notNull).map((c) => c.name).sort()).toEqual(
      [...EXPECTED_NOT_NULL.actividad_planificada].sort()
    );
  });

  it("D3: dano — 7 NOT NULL, including both independent 0/1 flags", () => {
    const columns = parsed.tables.get("dano") ?? [];
    expect(columns.filter((c) => c.notNull).map((c) => c.name).sort()).toEqual(
      [...EXPECTED_NOT_NULL.dano].sort()
    );
  });

  it("D4: inspeccion_tela — 8 NOT NULL: orden_id, operario, timestamp and the 5 checklist items", () => {
    const columns = parsed.tables.get("inspeccion_tela") ?? [];
    expect(columns.filter((c) => c.notNull).map((c) => c.name).sort()).toEqual(
      [...EXPECTED_NOT_NULL.inspeccion_tela].sort()
    );
  });

  it("D5: mantenimiento — 5 NOT NULL (machine_id, tipo, operario, motivo, inicio)", () => {
    const columns = parsed.tables.get("mantenimiento") ?? [];
    expect(columns.filter((c) => c.notNull).map((c) => c.name).sort()).toEqual(
      [...EXPECTED_NOT_NULL.mantenimiento].sort()
    );
  });

  // ── E. Machine events registrables sin orden; la inspección no ───────────

  it("E: orden_id absent on actividad_planificada and mantenimiento, NOT NULL on inspeccion_tela, nullable on parada and dano", () => {
    const columnNames = (table: string) =>
      (parsed.tables.get(table) ?? []).map((c) => c.name);

    expect(columnNames("actividad_planificada")).not.toContain("orden_id");
    expect(columnNames("mantenimiento")).not.toContain("orden_id");

    const inspeccion = (parsed.tables.get("inspeccion_tela") ?? []).find(
      (c) => c.name === "orden_id"
    );
    expect(inspeccion?.notNull).toBe(true);

    for (const table of ["parada", "dano"]) {
      const ordenId = (parsed.tables.get(table) ?? []).find((c) => c.name === "orden_id");
      expect(ordenId).toBeDefined();
      expect(ordenId?.notNull).toBe(false);
    }
  });

  // ── F. Las cinco claves foráneas físicas ─────────────────────────────────

  it("F: exactly 5 foreign keys with the declared targets; actividad_planificada declares none", () => {
    expect(
      parsed.foreignKeys.map((fk) => ({
        table: fk.table,
        columns: fk.columns,
        referencesTable: fk.referencesTable,
        referencesColumns: fk.referencesColumns,
      }))
    ).toEqual(
      EXPECTED_FOREIGN_KEYS.map((fk) => ({
        table: fk.table,
        columns: [fk.column],
        referencesTable: fk.referencesTable,
        referencesColumns: [fk.referencesColumn],
      }))
    );

    expect(
      parsed.foreignKeys.filter((fk) => fk.table === "actividad_planificada")
    ).toEqual([]);
  });

  // ── G. Once índices, cuatro parciales ───────────────────────────────────

  it("G1: exactly 11 indexes, with the declared names, tables and column lists", () => {
    expect(parsed.indexes).toEqual(EXPECTED_INDEXES);
  });

  it("G2: exactly 4 indexes carry the partial predicate WHERE fin IS NULL", () => {
    const partial = parsed.indexes.filter((i) => i.where !== null);
    expect(partial).toHaveLength(4);
    expect(partial.map((i) => i.name).sort()).toEqual([
      "idx_actividad_abierta",
      "idx_dano_abierta",
      "idx_mantenimiento_abierta",
      "idx_parada_abierta",
    ]);
    for (const index of partial) {
      expect(index.where).toBe("fin IS NULL");
    }
  });

  // ── H. Ningún índice especulativo ────────────────────────────────────────

  it("H: no speculative index on dano.parada_id, mantenimiento.dano_id, or tipo alone", () => {
    // `idx_dano_orden (orden_id)` es uno de los once índices del contrato
    // (spec.md:211): lo que se prohíbe es un SEGUNDO índice sobre `dano.orden_id`,
    // no el que ya sirve `danoRepository.listarPorOrden`.
    const indexesOn = (table: string, column: string) =>
      parsed.indexes.filter((i) => i.table === table && i.columns.includes(column));

    expect(indexesOn("dano", "parada_id")).toEqual([]);
    expect(indexesOn("mantenimiento", "dano_id")).toEqual([]);
    expect(
      parsed.indexes.filter(
        (i) => i.table === "actividad_planificada" && i.columns.join() === "tipo"
      )
    ).toEqual([]);
    expect(indexesOn("dano", "orden_id").map((i) => i.name)).toEqual(["idx_dano_orden"]);

    // obtenerPorId no tiene índice propio: la PRIMARY KEY ya lo sirve.
    expect(
      parsed.indexes.filter((i) => i.columns.join() === "id" || i.columns.join() === "parada.id")
    ).toEqual([]);
  });

  // ── I. campos_especificos es una sola columna TEXT NOT NULL ──────────────

  it("I: campos_especificos is one TEXT NOT NULL column and no per-cause column exists", () => {
    const columns = parsed.tables.get("parada") ?? [];
    const campos = columns.find((c) => c.name === "campos_especificos");

    expect(campos).toBeDefined();
    expect(campos?.type).toBe("TEXT");
    expect(campos?.notNull).toBe(true);

    // Columnas por causa mentioned por el spec (carro, color, tiempo_reparacion, …).
    for (const perCause of ["carro", "color", "tiempo_reparacion"]) {
      expect(columns.map((c) => c.name)).not.toContain(perCause);
    }
  });

  // ── J. Los dos flags de dano son INTEGER NOT NULL e independientes ───────

  it("J: causo_parada and posible_segunda are INTEGER NOT NULL with no CHECK tying them", () => {
    const columns = parsed.tables.get("dano") ?? [];
    for (const flag of ["causo_parada", "posible_segunda"]) {
      const column = columns.find((c) => c.name === flag);
      expect(column?.type).toBe("INTEGER");
      expect(column?.notNull).toBe(true);
      // Sin REFERENCES, sin CHECK y sin DEFAULT en la definición: el acoplamiento
      // con parada_id / unidades_sospechadas es regla de dominio, no del esquema.
      expect(column?.rest).not.toMatch(/REFERENCES/i);
      expect(column?.rest).not.toMatch(/\bCHECK\b/i);
      expect(column?.rest).not.toMatch(/\bDEFAULT\b/i);
    }
    expect(stripComments(sql)).not.toMatch(/\bCHECK\b/i);
  });

  // ── K. El checklist son cinco columnas planas NOT NULL ───────────────────

  it("K: the 5 checklist columns are NOT NULL and no con_anomalia / estado column exists", () => {
    const columns = parsed.tables.get("inspeccion_tela") ?? [];
    for (const item of CHECKLIST_COLUMNS) {
      expect(columns.find((c) => c.name === item)?.notNull).toBe(true);
    }

    const names = columns.map((c) => c.name);
    for (const derived of ["con_anomalia", "estado_inspeccion", "estado_tela"]) {
      expect(names).not.toContain(derived);
    }
  });

  // ── L. El conjunto de columnas de resolución está completo ───────────────

  it("L: the 6 resolution columns are present, nullable, and no others", () => {
    const columns = parsed.tables.get("inspeccion_tela") ?? [];
    const resolution = columns.filter((c) => RESOLUTION_COLUMNS.includes(c.name));

    expect(resolution.map((c) => c.name)).toEqual(RESOLUTION_COLUMNS);
    for (const column of resolution) {
      expect(column.notNull).toBe(false);
    }
  });

  // ── M. Ninguna columna derivada (task 2.2) ──────────────────────────────

  it("M: no derived value is persisted — none of the 11 derived names is a column", () => {
    for (const table of parsed.tableNames) {
      const names = (parsed.tables.get(table) ?? []).map((c) => c.name);
      for (const derived of DERIVED_COLUMN_NAMES) {
        expect(names).not.toContain(derived);
      }
    }
  });
});

// ── Igualdad byte a byte entre las dos copias ────────────────────────────────
// Ambas copias se parsean al cargar el módulo (fallarían aquí si una no fuera
// SQL válido), así que N + la igualdad de bytes implican parseos idénticos: una
// segunda aserción de igualdad estructural sería redundante.

describe("Migration 004 — canonical ≡ mirror", () => {
  it("N: the two copies are byte for byte identical, with the same length", () => {
    expect(mirrorSql.length).toBe(canonicalSql.length);
    expect(mirrorSql).toBe(canonicalSql);
  });
});
