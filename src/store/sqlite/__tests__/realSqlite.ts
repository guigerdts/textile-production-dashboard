/**
 * CHANGE 2 (historical-day-navigation) — real `node:sqlite` engine behind a
 * `Database` shim (WU4)
 *
 * WHAT THIS IS: the harness that lets the **real, unmodified** SQLite adapter
 * classes run against a **real SQLite engine** carrying the **real migrations
 * 001–005**. It injects only a `Database`; the adapters' own code — their SQL,
 * their mappers, their duplicate/unknown-id rejection — is never re-implemented
 * here. That is what makes a passing parity run evidence about the adapters
 * rather than evidence about a re-implementation of them.
 *
 * WHAT THIS IS NOT: it is NOT the Tauri plugin transport. The production runtime
 * speaks `@tauri-apps/plugin-sql`; this speaks `node:sqlite`'s `DatabaseSync`.
 * That the plugin enforces the same predicates over the same transport remains
 * PENDING runtime validation (R5/R6) and is claimed by no suite in this change.
 * The existing honesty notes in `recovery.test.ts` and `startup.test.ts` stay
 * in place, unedited.
 *
 * The two `node:sqlite` behaviours this shim absorbs, both verified
 * experimentally before this file was written (design §8):
 *
 *  1. **`$1` is NAMED, not positional.** `node:sqlite` binds
 *     `{"1": …}` to `$1`, so the adapters' `$N` statements would receive
 *     `undefined` values instead of rows. `aPositional()` rewrites `$N` → `?`
 *     before `prepare()` so positional binds apply.
 *  2. **The builtin cannot be bundled by the jsdom environment container.**
 *     The importing test file opens with `// @vitest-environment node`.
 *
 * The rewrite is safe here because **no adapter query repeats a placeholder**:
 * positional `?` binds cannot express `$1 … $1`, which a named bind could. That
 * was verified across every SQL string literal in the six SQLite adapters before
 * this shim was written. A future adapter that reuses a placeholder must extend
 * this file rather than assume the rewrite keeps working.
 *
 * Migrations are applied from the **canonical `src-tauri/migrations/` copies** —
 * the ones `lib.rs` embeds with `include_str!` and that tauri-plugin-sql applies
 * on `Database.load()`. `migration005.test.ts:34-42` already asserts those files
 * are byte-equal to the frontend mirror, so applying the canonical copies is
 * applying what the binary ships.
 */

// @ts-expect-error type error without @types/node package
import { DatabaseSync } from "node:sqlite";

import m001 from "../../../../src-tauri/migrations/001_initial_schema.sql?raw";
import m002 from "../../../../src-tauri/migrations/002_lectura_orden_sequence_unique.sql?raw";
import m003 from "../../../../src-tauri/migrations/003_d1_orden_persistence.sql?raw";
import m004 from "../../../../src-tauri/migrations/004_operational_events.sql?raw";
import m005 from "../../../../src-tauri/migrations/005_event_fecha_operativa.sql?raw";

/** Migrations 001–005, in version order. None of them opens a transaction. */
const MIGRACIONES: ReadonlyArray<readonly [number, string]> = [
  [1, m001],
  [2, m002],
  [3, m003],
  [4, m004],
  [5, m005],
];

/**
 * La superficie de `@tauri-apps/plugin-sql`'s `Database` que los adaptadores
 * necesitan: `path`, `select`, `execute`, `close`. Estructuralmente compatible
 * con la clase real, así que el shim se pasa a los adaptadores sin `as` ni `any`
 * en el punto de uso — si la superficie se desalinea, el compilador lo dice.
 *
 * `path` no lo consulta ningún adaptador de este cambio, pero forma parte del
 * tipo público de la clase, así que se declara en lugar de dejarlo fuera y
 * obligar a los testes a castear.
 */
export interface DatabaseLike {
  path: string;
  select<T>(sql: string, binds?: unknown[]): Promise<T>;
  execute(sql: string, binds?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number }>;
  close(): Promise<boolean>;
}

/**
 * `$N` → `?`, so the statement binds positionally.
 *
 * Order-preserving and index-agnostic: the `N` values are not renumbered,
 * because no adapter reuses a placeholder (see the header). If one ever did,
 * `?` would shift every later bind and this rewrite would silently bind the
 * wrong value — the guard in `sinPlaceholdersRepetidos()` below is the tripwire.
 */
function aPosicional(sql: string): string {
  return sql.replace(/\$\d+/g, "?");
}

/**
 * Tripwire for the rewrite above: fails loudly if a `$N` appears twice in one
 * statement. Cheap to check, and the failure mode it prevents is silent.
 */
function sinPlaceholdersRepetidos(sql: string): void {
  const vistos = new Set<string>();
  for (const ph of sql.match(/\$\d+/g) ?? []) {
    if (vistos.has(ph)) {
      throw new Error(
        `realSqlite: el placeholder ${ph} se repite en la sentencia, y el bind posicional no lo expresa. ` +
          "Ampliá aPositional() en vez de asumir que la reescritura sigue siendo correcta.\n" +
          sql
      );
    }
    vistos.add(ph);
  }
}

export interface RealSqlite {
  /** La `Database` que se inyecta en los adaptadores, sin modificar. */
  db: DatabaseLike;
  /** Acceso al motor de verdad, para lo que el shim no expone (EXPLAIN). */
  crudo: DatabaseSync;
}

/**
 * Abre una base en memoria con las migraciones 001–005 aplicadas.
 *
 * `:memory:` a propósito: cada caso de paridad obtiene una base aislada y no
 * depende del orden de ejecución entre casos.
 */
export function abrirSqliteReal(): RealSqlite {
  const crudo = new DatabaseSync(":memory:");

  for (const [version, sql] of MIGRACIONES) {
    try {
      crudo.exec(sql);
    } catch (error) {
      // Nombrar la versión convierte un fallo opaco de DDL en un diagnóstico.
      throw new Error(
        `realSqlite: la migración ${String(version).padStart(3, "0")} no se aplicó sobre el motor real`,
        { cause: error }
      );
    }
  }

  const db: DatabaseLike = {
    path: ":memory:",

    async select<T>(sql: string, binds: unknown[] = []): Promise<T> {
      sinPlaceholdersRepetidos(sql);
      const filas = crudo.prepare(aPosicional(sql)).all(...binds);
      // `node:sqlite` devuelve objetos sin prototipo; se copian a objetos
      // normales para que los comparadores de las suites y los mappers vean
      // exactamente lo que verían con el plugin real.
      return filas.map((fila: unknown) => ({ ...(fila as object) })) as T;
    },

    async execute(sql: string, binds: unknown[] = []) {
      sinPlaceholdersRepetidos(sql);
      const resultado = crudo.prepare(aPosicional(sql)).run(...binds);
      // `changes` es el equivalente declarado de `rowsAffected`. El shim lo
      // traduce aunque las cuatro familias de adaptadores de este cambio no lo
      // consulten: `sqliteOrderRepository.ts:369` sí lo hace, y un shim que
      // devolviera `undefined` ahí fallaría en el motor real y no en el doble.
      return {
        rowsAffected: Number(resultado.changes),
        lastInsertId: Number(resultado.lastInsertRowid),
      };
    },

    async close() {
      crudo.close();
      return true;
    },
  };

  return { db, crudo };
}

/**
 * El plan que SQLite elige de verdad para una sentencia. Se consulta sobre el
 * motor crudo porque el shim `DatabaseLike` no expone `EXPLAIN`.
 */
export function explicar(crudo: DatabaseSync, sql: string, binds: unknown[]): string[] {
  return crudo
    .prepare(aPosicional(sql))
    .all(...binds)
    .map((fila: unknown) => String((fila as { detail?: unknown }).detail ?? ""));
}