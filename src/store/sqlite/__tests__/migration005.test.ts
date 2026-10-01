/**
 * CHANGE 1 (operational-event-operative-date) — Migration 005
 * (event_fecha_operativa) SQL contract
 *
 * WHAT THIS SUITE IS: a contract test over the *text* of the migration script.
 * It parses both copies — the canonical file the real Tauri binary embeds and the
 * frontend mirror — and asserts the approved `operational-events-schema`
 * requirements: one `fecha_operativa TEXT NOT NULL` on each of the four
 * machine-event tables that are not day-bound through an orden, `inspeccion_tela`
 * untouched, no DEFAULT, no backfill and no data statement at all, the four
 * day-scoped indexes with their exact names, byte equality between the two copies,
 * and that version 5 is actually registered on both sides.
 *
 * WHAT THIS SUITE IS NOT: it does NOT run the real Tauri migration. That runs
 * Rust-side — `src-tauri/src/lib.rs` registers version 5 via `include_str!` and
 * tauri-plugin-sql applies it on `Database.load()`. This environment cannot run
 * the Tauri runtime, so nothing here executes the DDL against a real sqlite
 * engine. That limitation is unchanged from 001/002/003/004 (R5/R6, open).
 *
 * SEPARATE EVIDENCE, NOT CLAIMED HERE: the DDL behaviour this change depends on
 * was verified directly against a real SQLite engine with
 * `src-tauri/migrations/validate_r56.py` (migrations 001-005 on an empty
 * database -> 63 columns and the four new indexes; and 005 against a populated
 * `parada` -> OperationalError "Cannot add a NOT NULL column with default value
 * NULL"). That harness is a Python sqlite3 script, NOT the Tauri runtime, and it
 * is not equivalent to it: sqlx applies each migration inside a transaction,
 * while `executescript` is autocommit. This suite therefore proves the declared
 * contract of the script, never that a real connection enforces it.
 *
 * Modelled structurally on `migration004.test.ts` (same `?raw` imports, same
 * parse-the-script-not-the-engine approach). 005 needs no table parser: it adds
 * columns with ALTER TABLE and never declares a table.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import canonicalSql from "../../../../src-tauri/migrations/005_event_fecha_operativa.sql?raw";
import mirrorSql from "../migrations/005_event_fecha_operativa.sql?raw";
import { CURRENT_MIGRATION_VERSION } from "../migrations/index";

// ── Parser mínimo del script ─────────────────────────────────────────────────

/** Elimina comentarios de bloque y de línea; 005 sólo usa comentarios `--`. */
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

function statements(sql: string): string[] {
  return stripComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const ADD_COLUMN =
  /^ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\s+(\w+(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?)((?:\s+NOT\s+NULL)?)$/i;
const CREATE_INDEX =
  /^CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]*)\)\s*$/i;

/** Tablas de evento de máquina que reciben fecha_operativa, con su columna. */
const TABLAS_CON_FECHA = [
  "parada",
  "actividad_planificada",
  "dano",
  "mantenimiento",
] as const;

/** Índices día-escoped, con su nombre exacto en español. */
const INDICES_FECHA = [
  ["idx_parada_maquina_fecha", "parada"],
  ["idx_actividad_maquina_fecha", "actividad_planificada"],
  ["idx_dano_maquina_fecha", "dano"],
  ["idx_mantenimiento_maquina_fecha", "mantenimiento"],
] as const;

describe("migration 005 — event_fecha_operativa: contrato del script", () => {
  describe("las dos copias", () => {
    it("el mirror del frontend es byte-idéntico al canónico que embebe Tauri", () => {
      expect(mirrorSql).toBe(canonicalSql);
    });
  });

  describe("columnas añadidas", () => {
    it("añade exactamente una columna, en cada una de las cuatro tablas", () => {
      const adds = statements(canonicalSql)
        .map((s) => ADD_COLUMN.exec(s))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => ({ tabla: m[1].toLowerCase(), columna: m[2], tipo: m[3].trim(), notNull: m[4].trim() }));

      expect(adds).toHaveLength(4);
      expect(adds.map((a) => a.tabla)).toEqual([...TABLAS_CON_FECHA]);
      for (const add of adds) {
        expect(add.columna).toBe("fecha_operativa");
        expect(add.tipo.toUpperCase()).toBe("TEXT");
        expect(add.notNull.toUpperCase()).toBe("NOT NULL");
      }
    });

    it("no toca inspeccion_tela: una inspección hereda su día de la orden", () => {
      // Es el diseño cerrado de CHANGE 1 (Q1/Q2): inspeccion_tela siempre tiene
      // ordenId y llega a su jornada por ella, así que no necesita la columna.
      const tablasAlteradas = statements(canonicalSql)
        .map((s) => ADD_COLUMN.exec(s))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => m[1].toLowerCase());

      expect(tablasAlteradas).not.toContain("inspeccion_tela");
    });

    it("no declara DEFAULT: el día operativo no puede inventarse en la escritura", () => {
      const conDefault = statements(canonicalSql).filter((s) =>
        /\bDEFAULT\b/i.test(s),
      );
      expect(conDefault).toEqual([]);
    });
  });

  describe("ausencia de backfill y de sentencias de datos", () => {
    it("no contiene ninguna sentencia UPDATE/INSERT/DELETE/SELECT", () => {
      const deDatos = statements(canonicalSql).filter((s) =>
        /^\s*(UPDATE|INSERT|DELETE|SELECT|REPLACE|WITH)\b/i.test(s),
      );
      expect(deDatos).toEqual([]);
    });

    it("sólo contiene ALTER TABLE y CREATE INDEX", () => {
      const verbs = statements(canonicalSql).map(
        (s) => s.split(/\s+/)[0].toUpperCase(),
      );
      expect(new Set(verbs)).toEqual(new Set(["ALTER", "CREATE"]));
    });
  });

  describe("índices día-escoped", () => {
    it("crea los cuatro índices (machine_id, fecha_operativa) con IF NOT EXISTS", () => {
      const indexes = statements(canonicalSql)
        .map((s) => CREATE_INDEX.exec(s))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => ({
          nombre: m[1],
          tabla: m[2].toLowerCase(),
          columnas: m[3].split(",").map((c) => c.trim()),
        }));

      expect(indexes).toHaveLength(4);
      expect(indexes.map((i) => i.nombre)).toEqual(
        INDICES_FECHA.map(([nombre]) => nombre),
      );
      indexes.forEach((idx, i) => {
        const [nombre, tabla] = INDICES_FECHA[i];
        expect(idx.nombre).toBe(nombre);
        expect(idx.tabla).toBe(tabla);
        expect(idx.columnas).toEqual(["machine_id", "fecha_operativa"]);
      });
    });

    it("usa CREATE INDEX IF NOT EXISTS en los cuatro", () => {
      const sinIfNotExists = statements(canonicalSql).filter(
        (s) => /^CREATE\s+INDEX\s+/i.test(s) && !/^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/i.test(s),
      );
      expect(sinIfNotExists).toEqual([]);
    });

    it("no añade índices especulativos: los cuatro son los de esta change", () => {
      const indexes = statements(canonicalSql)
        .map((s) => CREATE_INDEX.exec(s))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => m[1]);
      expect(indexes).toHaveLength(4);
    });
  });

  describe("registro de la versión 5", () => {
    it("el frontend espera la versión 5", () => {
      expect(CURRENT_MIGRATION_VERSION).toBe(5);
    });

    it("el binario Tauri registra la versión 5 apuntando al canónico", () => {
      // Sin esto, la app arranca contra un esquema de 004 y escribe sin la
      // columna: el NOT NULL rechazaría la escritura en runtime, no en el
      // typecheck. El fallo sería en la máquina del operario, no en el repo.
      const libRs = readFileSync(
        resolve(__dirname, "../../../../src-tauri/src/lib.rs"),
        "utf8",
      );
      expect(libRs).toMatch(/version:\s*5,/);
      expect(libRs).toMatch(
        /version:\s*5,\s*\n\s*description:\s*"event_fecha_operativa",\s*\n\s*sql:\s*include_str!\("\.\.\/migrations\/005_event_fecha_operativa\.sql"\),/,
      );
    });

    it("el script embebido por Rust es el mismo archivo que el canónico", () => {
      const libRs = readFileSync(
        resolve(__dirname, "../../../../src-tauri/src/lib.rs"),
        "utf8",
      );
      const incluido = libRs.match(
        /version:\s*5,[\s\S]*?include_str!\("\.\.\/migrations\/([^"]+)"\)/,
      );
      expect(incluido).not.toBeNull();
      const enDisco = readFileSync(
        resolve(__dirname, "../../../../src-tauri/migrations/", incluido![1]),
        "utf8",
      );
      expect(enDisco).toBe(canonicalSql);
    });
  });
});