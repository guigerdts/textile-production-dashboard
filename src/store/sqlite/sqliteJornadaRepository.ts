/**
 * Ticket 10.3 — SqliteJornadaRepository
 *
 * SQLite implementation of IJornadaRepository. Persists the jornada (shift
 * window) per fecha operativa across restarts. This is the FIRST entity
 * repository and establishes the pattern for the subsequent SQLite repos.
 *
 * Async contract: IJornadaRepository is async (ticket 10.2). The plugin's
 * execute/select return Promises; this repo implements the async interface.
 *
 * Table (migration 001, UNTOUCHED):
 *   CREATE TABLE jornada (
 *     fecha_operativa TEXT PRIMARY KEY,
 *     inicio TEXT NOT NULL,
 *     fin TEXT NOT NULL
 *   );
 *
 * Design decisions:
 * - Flag = fecha operativa "YYYY-MM-DD" (same as Orden.fechaOperativa).
 * - obtenerParaFecha(fecha):
 *     1. validate fecha format (same descriptive error as the domain/repos);
 *     2. SELECT inicio, fin FROM jornada WHERE fecha_operativa = $1;
 *     3. row found -> fresh JornadaTurno (new object, never the row reused);
 *     4. no row -> jornadaDefault(fecha) (07:00-17:00, from domain);
 *     5. the default is NEVER auto-persisted.
 * - guardarJornada(fecha, jornada):
 *     1. validate fecha format;
 *     2. validarJornada(jornada) from domain (fin > inicio) — same
 *        join("; ") error convention as InMemoryJornadaRepository;
 *     3. ONE single atomic UPSERT statement:
 *          INSERT INTO jornada (fecha_operativa, inicio, fin)
 *          VALUES ($1, $2, $3)
 *          ON CONFLICT(fecha_operativa)
 *          DO UPDATE SET inicio = excluded.inicio, fin = excluded.fin
 *        NO INSERT OR REPLACE: ON CONFLICT DO UPDATE avoids delete+reinsert
 *        side effects (triggers/FKs) and keeps a single atomic write, the
 *        same one-statement policy used by 10.5/10.6 (no BEGIN/COMMIT).
 *     4. binds: [fechaOperativa, jornada.inicio, jornada.fin];
 *     5. if the plugin rejects the write, throw a descriptive error that
 *        keeps the original cause (Error cause chain) — never swallowed.
 * - No transactions from JavaScript (tauri-plugin-sql has no transaction API).
 * - No Rust command; no plugin internals; only the installed public API.
 * - Placeholders: SQLite uses $1/$2/... (the `?` form is MySQL-only in the
 *   plugin examples), consistent with SqliteLecturaGolpeRepository.
 */

import type Database from "@tauri-apps/plugin-sql";
import type { JornadaTurno } from "../../domain/types";
import { jornadaDefault, validarJornada } from "../../domain/tiempo";
import type { IJornadaRepository } from "../jornadaRepository";

/** Formato estricto de fecha operativa (igual que Orden.fechaOperativa). */
const FECHA_OPERATIVA_RX = /^\d{4}-\d{2}-\d{2}$/;

/** Fila SQL de `jornada` (projection de lectura). */
interface JornadaRow {
  inicio: string;
  fin: string;
}

/** SQL Row → TypeScript. Returns a NEW object; the row is never reused. */
export function mapJornadaRow(row: JornadaRow): JornadaTurno {
  return { inicio: row.inicio, fin: row.fin };
}

export class SqliteJornadaRepository implements IJornadaRepository {
  constructor(private db: Database) {}

  /**
   * Devuelve la jornada guardada para la fecha operativa.
   * Sin registro → jornadaDefault(fecha) (07:00–17:00), sin persistirlo.
   * @throws Si la fecha no tiene formato YYYY-MM-DD.
   */
  async obtenerParaFecha(fechaOperativa: string): Promise<JornadaTurno> {
    this.validarFecha(fechaOperativa);

    const rows = await this.db.select<JornadaRow[]>(
      "SELECT inicio, fin FROM jornada WHERE fecha_operativa = $1",
      [fechaOperativa]
    );

    if (rows.length === 0) {
      return jornadaDefault(fechaOperativa);
    }
    return mapJornadaRow(rows[0]);
  }

  /**
   * Guarda/sobrescribe la jornada del turno (UPSERT atómico en una sentencia).
   * @throws Si la fecha no tiene formato YYYY-MM-DD, si la jornada es inválida
   *         (delegado a validarJornada del dominio), o si SQLite/plugin
   *         rechaza la operación (error descriptivo con la causa original).
   */
  async guardarJornada(fechaOperativa: string, jornada: JornadaTurno): Promise<void> {
    this.validarFecha(fechaOperativa);

    const errores = validarJornada(jornada);
    if (errores.length > 0) {
      throw new Error(errores.join("; "));
    }

    try {
      await this.db.execute(
        `INSERT INTO jornada (fecha_operativa, inicio, fin)
         VALUES ($1, $2, $3)
         ON CONFLICT(fecha_operativa)
         DO UPDATE SET
           inicio = excluded.inicio,
           fin = excluded.fin`,
        [fechaOperativa, jornada.inicio, jornada.fin]
      );
    } catch (error) {
      // Descriptive error with context, preserving the original cause.
      throw new Error(
        `no se pudo persistir la jornada para "${fechaOperativa}"`,
        { cause: error }
      );
    }
  }

  private validarFecha(fechaOperativa: string): void {
    if (!FECHA_OPERATIVA_RX.test(fechaOperativa)) {
      throw new Error(
        `fecha operativa inválida: "${fechaOperativa}" (formato esperado YYYY-MM-DD)`
      );
    }
  }
}