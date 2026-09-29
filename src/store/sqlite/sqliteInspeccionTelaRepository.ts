/**
 * Ticket 10 (Phase 2) — Unit E2 — `sqliteInspeccionTelaRepository`
 *
 * WHAT THIS IS: the SQLite adapter for `IInspeccionRepository`, the shape
 * `sqliteDanoRepository` (D2) established, applied to the widest mapping in the
 * whole migration: a **flat five-column checklist** and the **complete
 * `ResolucionInspeccion` union in both directions**. It implements the port over
 * the `inspeccion_tela` table declared in migration 004 (18 columns), with the
 * Phase 1 pattern: an exported `Row` interface, exported **pure** mappers, and a
 * class holding `private db: Database`.
 *
 * WHAT THIS IS NOT: a SQL engine, and not a second set of rules. This file
 * contains NO domain validation whatsoever.
 *
 * ── Pure storage boundary (spec: "The ports remain a pure storage boundary") ──
 *
 * The repository does **not** validate business rules. It never checks that the
 * checklist is complete, that a `tundido: "anomalia"` implies `otraAnomalia`,
 * that a resolution's `motivo` is non-empty, that `autorizadoPor` names anyone,
 * that a `devolución` is pre-impresión, that an inspection without anomaly has no
 * resolution, or that two resolutions are mutually exclusive. Every one of those
 * rules lives in `src/domain/inspeccionTela.ts` (`registrarInspeccion`,
 * `registrarDevolucion`, `registrarAutorizacionGerencia`), which runs BEFORE this
 * adapter is called. An inspection the domain would have rejected is persisted
 * here without complaint — that is the contract, not an oversight.
 *
 * What the adapter DOES check is narrower and purely structural: that a row with
 * the given `id` is absent before an INSERT and present before an UPDATE, and that
 * the stored values it has to narrow are ones this mapper can actually rebuild. A
 * `TEXT` column is untyped — it can hold any bytes at all — so a checklist state
 * outside the `conforme` / `anomalia` vocabulary, or a resolution discriminator
 * this adapter does not recognise, is a **descriptive mapping error carrying the
 * defect as `cause`**: never a fabricated `""`, never a silent default. That is
 * corruption handling at the storage boundary, not validation of a business rule,
 * and it is the same shape as the `parada` JSON check the design prescribes. The
 * id pre-check is the rejection the port documents as its own ("throws if the id
 * already exists" / "throws if the id does not exist"), and its message matches
 * the in-memory adapter's verbatim.
 *
 * ── D1 — the mappers own the vocabulary translation ──────────────────────────
 *
 * 004 names the operator `operario` (NOT `operator_name`, the `actividad`/`dano`
 * vocabulary would agree here but 001 sets the precedent) and orders the two
 * machine tables with `machine_id`; the domain names them `maquinaId` and
 * `operatorName`. Both names are load-bearing and neither may be "simplified"
 * into the other. `mapInspeccionRow` is the only place `operario` becomes
 * `operatorName` and `orden_id` becomes `ordenId`; `mapInspeccionToSql` is the
 * only place the reverse happens. The mappers are **pure** — no I/O, no clock,
 * no randomness, no `Database` — so a full round trip is unit-testable with no
 * connection in scope.
 *
 * Note the one asymmetry with the other four tables: an inspection has **no
 * `machine_id`**. It is always an event of an ORDER, never a machine event, so
 * the approved ticket 07 model gives the port no machine query at all and this
 * adapter has no `machine_id` column to translate.
 *
 * ── The five checklist columns are a STORAGE fact, not a catalogue zip ───────
 *
 * 004 declares five flat `TEXT NOT NULL` columns — `absorcion`, `tundido`,
 * `manchas`, `dimensiones`, `estado_general` — one per catalogue item. The
 * rebuild iterates the **literal ordered tuple** exported as
 * `COLUMNAS_ITEMS_CHECKLIST`, and looks each item up **by id**, never by array
 * position: the domain validates the checklist with a set, so `items` may arrive
 * in any order and a positional zip would silently attach `tundido`'s state to
 * the wrong column.
 *
 * Why a literal tuple and not `getItemsChecklist()`: the column set is fixed by
 * migration 004, so the mapping is a fact about storage, not about a domain
 * catalogue that may grow. A catalogue-driven zip would keep yielding five items
 * even if the domain ever grew a sixth, instead of failing loudly — and a mapper
 * that fails loudly on schema drift is worth more here than the drift itself.
 * The cost of the literal is that catalogue-order drift would silently mis-map,
 * so the suite pins the tuple to `getItemsChecklist().map((i) => i.id)` and that
 * drift fails the build. The catalogue itself is NOT changed.
 *
 * Reading a checklist column is the ONE place this adapter narrows the domain
 * vocabulary instead of merely asserting it: `estadoItemChecklist` accepts exactly
 * `"conforme"` and `"anomalia"` and raises a descriptive mapping error on anything
 * else, so a stored `"CONFORME"` or `""` can never reach the domain wearing an
 * `ItemChecklistEstado`. That is NOT `validarChecklist`: no completeness rule, no
 * `anomalia` implying `otraAnomalia`, no cross-field semantics — only the shape of
 * five `TEXT` columns.
 *
 * ── Derived state has no column, and this adapter never invents one ──────────
 *
 * `conAnomalia` and `estadoInspeccion` are **derived on every read** by the
 * domain's own functions (`src/domain/inspeccionTela.ts`). There is no
 * `con_anomalia` column and no `estado_inspeccion` column in 004, this mapper
 * reads none, and this adapter **caches neither**. A read returns a rebuilt
 * `InspeccionTela` with those two values simply absent; the caller derives them.
 * Persisting them would freeze one moment's verdict over a record the domain is
 * free to resolve later — the resolution update would have to rewrite them too,
 * and a stale cached `conAnomalia: true` would contradict `resolucion`.
 *
 * ── The resolution union is branch-exclusive, in BOTH directions ─────────────
 *
 * `ResolucionInspeccion` is a union of exactly two mutually exclusive branches,
 * flattened into six columns: the `resolucion` discriminator plus five data
 * columns. `mapInspeccionToSql` writes **only** the columns belonging to the
 * active branch and NULLs the other branch's — never a serialised blob, never a
 * value of the other branch left over from a previous resolution:
 * - `resolucion = null` → all six columns NULL.
 * - `devolucion` → `resolucion='devolucion'`, `motivo_devolucion`,
 *   `registrada_por`, `resolucion_timestamp`; `autorizado_por` and
 *   `autorizacion_observaciones` NULL.
 * - `autorizacion_gerencia` → `resolucion='autorizacion_gerencia'`,
 *   `autorizado_por`, `resolucion_timestamp`, `autorizacion_observaciones`;
 *   `motivo_devolucion` and `registrada_por` NULL.
 *
 * That branch-exclusivity is what makes the resolution a *replacement* and not an
 * accumulation: the domain returns a new copy of the inspection (`{...inspeccion,
 * resolucion}`) and this adapter's `UPDATE` rewrites the same row, so the
 * unresolved state leaves no residue.
 *
 * `mapInspeccionRow` rebuilds the matching branch. A non-null discriminator whose
 * own data column is NULL, or a discriminator string this adapter does not
 * recognise, is a **descriptive mapping error carrying the defect as `cause`** —
 * never a fabricated `""` for a missing `motivo`, and never a silent `null` that
 * would turn a damaged row into "sin resolución" and downgrade a real `devolución`
 * to `no_usable`.
 *
 * ── `orden_id` is NOT NULL, so the link is never nullable here ───────────────
 *
 * Unlike `parada` and `dano`, whose `orden_id` is a nullable link (a stop or a
 * damage can happen on an empty day), an inspection is ALWAYS an event of an
 * order: `registrarInspeccion` refuses an orden-less inspection. 004 therefore
 * declares `orden_id TEXT NOT NULL`, and both mappers treat it as `string` — a
 * plain copy on read, never `?? null`, never `?? ""`. The link is recorded
 * verbatim; referential integrity against `orden(id)` is the database's business
 * (R5), and an unresolvable link is rejected by the engine and that error
 * propagates — see the honesty note below and the A1 test in the suite.
 *
 * ── D2j — explicit insert vs update ─────────────────────────────────────────
 *
 * `insertInspeccion` issues a pre-check `SELECT id …` and then ONE explicit
 * `INSERT`; `updateInspeccion` issues the same pre-check and then ONE explicit
 * `UPDATE` setting all 17 non-PK columns. No upsert, no `INSERT OR REPLACE`, no
 * branch on `rowsAffected` (its semantics across the plugin are unverified — R6),
 * no `BEGIN`/`COMMIT` (tauri-plugin-sql exposes no transaction and each write is
 * a single statement). `id` is the primary key and **never** appears in a `SET`
 * list. The two rejections reuse the in-memory messages verbatim — `ya existe
 * una inspección con el id <id>` / `no existe una inspección con el id <id>` — and
 * are thrown *before* the write, so they are NOT wrapped; only a failure of the
 * statement itself is wrapped as `no se pudo persistir la inspección "<id>"` with
 * the original error preserved as `cause`.
 *
 * ── HONESTY NOTE (D2d) ───────────────────────────────────────────────────────
 *
 * This adapter writes the columns 004 declares. That is a fact about the SQL it
 * emits, not about a running database. It is verified here only against a
 * statement-shape double that MODELS SQLite; it never executes the real Rust
 * migration, and whether the real Tauri connection enforces FK semantics
 * (`PRAGMA foreign_keys` is a per-connection setting and the plugin may serve
 * statements from a pool) stays unverified — R5. Per D2d, no workaround is added
 * here and `src/store/sqlite/database.ts` is left untouched. A test that passes
 * over this adapter proves the repository logic and the exact SQL it emits; it
 * never proves real SQLite behaviour.
 */

import type Database from "@tauri-apps/plugin-sql";
import type {
  EstadoItemChecklist,
  InspeccionTela,
  ItemChecklistEstado,
  ItemChecklistId,
  ResolucionInspeccion,
  TipoResolucionInspeccion,
} from "../../domain/types";
import type { IInspeccionRepository } from "../inspeccionRepository";

/**
 * SQL row of `inspeccion_tela` — the 18 columns of 004, in DDL order, with the
 * DDL's nullability and WITHOUT narrowing. `orden_id`, `operario`, the five
 * checklist columns and `timestamp` are `NOT NULL`, so they admit no `null` and
 * are typed `string`; `lote`, `otra_anomalia`, `observaciones` and the five
 * resolution data columns admit NULL, which is how absence is encoded (never
 * `""`, never an invented state).
 *
 * The five checklist columns arrive as `string`, NOT as `EstadoItemChecklist`: a
 * `TEXT` column can hold any bytes, so narrowing them to the `conforme` /
 * `anomalia` vocabulary is `mapInspeccionRow`'s job — and it does it by
 * validating, not by asserting. `row.tipo as TipoDano` in the `dano` adapter is
 * the weaker pattern: nothing stands behind that assertion.
 */
export interface InspeccionTelaRow {
  id: string;
  /** NOT NULL — an inspection is ALWAYS an event of an order. */
  orden_id: string;
  /** NOT NULL — D1: `operario`, never `operator_name`. */
  operario: string;
  lote: string | null;
  absorcion: string;
  tundido: string;
  manchas: string;
  dimensiones: string;
  estado_general: string;
  otra_anomalia: string | null;
  timestamp: string;
  observaciones: string | null;
  /** Resolution discriminator: NULL, or the `tipo` of the active branch. */
  resolucion: string | null;
  motivo_devolucion: string | null;
  autorizado_por: string | null;
  registrada_por: string | null;
  resolucion_timestamp: string | null;
  autorizacion_observaciones: string | null;
}

/**
 * The SIX resolution columns: the discriminator plus the five data columns. They
 * are grouped apart because they are written and read as a unit — the active
 * branch and only its own columns.
 */
type ColumnasResolucionSql = Pick<
  InspeccionTelaSqlValues,
  | "resolucion"
  | "motivo_devolucion"
  | "autorizado_por"
  | "registrada_por"
  | "resolucion_timestamp"
  | "autorizacion_observaciones"
>;

/**
 * Bind values for the explicit INSERT: the same set of 18 columns, in the order
 * the `$1..$18` placeholders receive them. The optionals are written as an
 * explicit `null`, never as `undefined` (D2j), and `resolucion` speaks the
 * domain's vocabulary (`TipoResolucionInspeccion`) because the write has to
 * BRANCH on it: that is what guarantees the inactive branch's columns land on
 * `null` with the compiler unable to forget them.
 *
 * The five checklist columns are declared `EstadoItemChecklist | null` even though
 * 004 makes them `NOT NULL`. By design, not by imprecision: the domain demands
 * all five items (`validarChecklist`) before calling the port, and this adapter
 * does NOT validate again. Facing an incomplete checklist it cannot invent a
 * state — neither `""` nor a default `conforme`, either of which would lie about
 * the fabric — so it writes `null` and it is the real engine's `NOT NULL` that
 * rejects that row (R6). Declaring them `EstadoItemChecklist` would force a cast
 * hiding exactly that gap.
 */
export interface InspeccionTelaSqlValues {
  id: string;
  orden_id: string;
  operario: string;
  lote: string | null;
  absorcion: EstadoItemChecklist | null;
  tundido: EstadoItemChecklist | null;
  manchas: EstadoItemChecklist | null;
  dimensiones: EstadoItemChecklist | null;
  estado_general: EstadoItemChecklist | null;
  otra_anomalia: string | null;
  timestamp: string;
  observaciones: string | null;
  resolucion: TipoResolucionInspeccion | null;
  motivo_devolucion: string | null;
  autorizado_por: string | null;
  registrada_por: string | null;
  resolucion_timestamp: string | null;
  autorizacion_observaciones: string | null;
}

/**
 * The five checklist columns, IN ORDER and BY NAME — a storage fact fixed by
 * 004, deliberately literal and deliberately exported so the suite can pin it
 * against `getItemsChecklist()`.
 *
 * This is NOT `getItemsChecklist()`: that function describes the domain
 * catalogue, which may grow; these five describe the columns of a table already
 * written. If the catalogue grows, the mapper must FAIL (or the engine will,
 * since the sixth column does not exist), not keep returning five items in
 * silence. The suite turns that "must fail" into an assertion:
 * `COLUMNAS_ITEMS_CHECKLIST` must match `getItemsChecklist().map((i) => i.id)`.
 */
export const COLUMNAS_ITEMS_CHECKLIST: readonly ItemChecklistId[] = [
  "absorcion",
  "tundido",
  "manchas",
  "dimensiones",
  "estado_general",
] as const;

/**
 * SQL row → TypeScript. PURE: no I/O, no clock, no randomness, no `Database`.
 * Returns a NEW object; the row is never reused nor retained.
 *
 * - D1: `operario` → `operatorName`, `orden_id` → `ordenId`.
 * - `orden_id` and `operario` do NOT enter the `?? undefined` rule: they are
 *   `NOT NULL`, so they are copied verbatim and a `?? ""` would invent a value the
 *   column cannot contain.
 * - `items` is rebuilt by walking `COLUMNAS_ITEMS_CHECKLIST` in that order and
 *   narrowing each column to the `conforme` / `anomalia` catalogue. This is a
 *   REAL check, not an assertion: `estadoItemChecklist` raises a descriptive
 *   mapping error with a `cause` for any value outside that vocabulary, so a
 *   stored `"CONFORME"` or `""` can never enter the domain as an
 *   `ItemChecklistEstado`. It is not the domain's `validarChecklist` — no
 *   completeness rule, no cross-field semantics — only the shape of five `TEXT`
 *   columns.
 * - The resolution is rebuilt by `mapResolucionRow`, which also fails loudly on a
 *   damaged row.
 * - `conAnomalia` and `estadoInspeccion` are NOT read, NOT computed and NOT
 *   cached: there is no column for them. The domain derives them from the rebuilt
 *   record (`conAnomalia`, `estadoInspeccion`).
 */
export function mapInspeccionRow(row: InspeccionTelaRow): InspeccionTela {
  const items: ItemChecklistEstado[] = COLUMNAS_ITEMS_CHECKLIST.map((columna) => ({
    id: columna,
    estado: estadoItemChecklist(row.id, columna, row[columna]),
  }));

  return {
    id: row.id,
    ordenId: row.orden_id,
    operatorName: row.operario,
    lote: row.lote ?? undefined,
    items,
    otraAnomalia: row.otra_anomalia ?? undefined,
    timestamp: row.timestamp,
    observaciones: row.observaciones ?? undefined,
    resolucion: mapResolucionRow(row),
  };
}

/**
 * The `conforme` / `anomalia` vocabulary a checklist column may hold — the only
 * two stored values a readable `absorcion` … `estado_general` can carry.
 *
 * This narrows, it does not apply a business rule: the check is that the bytes are
 * one of the two states this mapper knows how to rebuild. Anything else — `""`,
 * `"CONFORME"`, a typo, a catalogue renamed underneath 004 — is a damaged row and
 * leaves through `errorDeMapeo` naming the inspection id and the concrete defect,
 * with the offending column and value carried as `cause`. Same contract as
 * `mapResolucionRow`, same reason: a corrupt state silently read as `"conforme"`
 * would report a damaged fabric as a sound one, and nobody would see it happen.
 *
 * The `valor === "conforme" || valor === "anomalia"` guard IS the narrowing, so
 * the returned literal union needs no assertion.
 */
function estadoItemChecklist(
  inspeccionId: string,
  columna: ItemChecklistId,
  valor: string
): EstadoItemChecklist {
  if (valor === "conforme" || valor === "anomalia") {
    return valor;
  }

  throw errorDeMapeo(
    inspeccionId,
    `el ítem "${columna}" del checklist no puede reconstruirse: "${valor}" no es un estado conocido ("conforme" | "anomalia")`,
    new Error(`valor inesperado en la columna "${columna}": "${valor}"`)
  );
}

/**
 * TypeScript → SQL values for the explicit INSERT. PURE, like its inverse.
 *
 * - D1 in the other direction: `operatorName` → `operario`, `ordenId` → `orden_id`.
 * - Absent optionals are written as `null` (NULL column), never `""`: that way
 *   the read's `?? undefined` recovers exactly the absence.
 * - `ordenId` is written verbatim, without `?? null`: it is `NOT NULL` and the
 *   domain type admits no absence.
 * - The five checklist states are copied VERBATIM by id (never by position) and
 *   nothing is derived from them: `conAnomalia` is not written because it has no
 *   column.
 * - The resolution is written by `mapResolucionToSql`, which NULLs the inactive
 *   branch.
 */
export function mapInspeccionToSql(inspeccion: InspeccionTela): InspeccionTelaSqlValues {
  return {
    id: inspeccion.id,
    orden_id: inspeccion.ordenId,
    operario: inspeccion.operatorName,
    lote: inspeccion.lote ?? null,
    absorcion: estadoDelItem(inspeccion.items, "absorcion"),
    tundido: estadoDelItem(inspeccion.items, "tundido"),
    manchas: estadoDelItem(inspeccion.items, "manchas"),
    dimensiones: estadoDelItem(inspeccion.items, "dimensiones"),
    estado_general: estadoDelItem(inspeccion.items, "estado_general"),
    otra_anomalia: inspeccion.otraAnomalia ?? null,
    timestamp: inspeccion.timestamp,
    observaciones: inspeccion.observaciones ?? null,
    ...mapResolucionToSql(inspeccion.resolucion),
  };
}

/**
 * The domain's explicit state for item `columna`, looked up BY ID.
 *
 * `null` if the checklist does not carry that item: the domain demands all five
 * before calling the port and this adapter does not re-validate, so the absence
 * is written as-is (a `NOT NULL` column) instead of inventing a state. See the
 * `InspeccionTelaSqlValues` note.
 */
function estadoDelItem(
  items: ItemChecklistEstado[],
  columna: ItemChecklistId
): EstadoItemChecklist | null {
  return items.find((item) => item.id === columna)?.estado ?? null;
}

/**
 * Domain → SQL: the six resolution columns, with the inactive branch at `null`.
 *
 * The branch-exclusivity comes from the shape of the code, not from a comment:
 * `resolucion === null` returns all six as NULL, `tipo === "devolucion"` writes
 * only its own three and NULLs the gerencia pair, and the trailing `return`
 * covers whatever remains — today exactly `autorizacion_gerencia`, because
 * `ResolucionInspeccion` has two branches and TypeScript narrows the survivor
 * there. There is no `switch`, no `default`, no `?? ""`, and no value of the
 * other branch surviving a previous resolution. That narrowing is load-bearing
 * rather than cosmetic: a third branch would carry no `autorizadoPor` to read, so
 * this file would stop compiling instead of quietly labelling it
 * `autorizacion_gerencia`.
 */
function mapResolucionToSql(
  resolucion: ResolucionInspeccion | null
): ColumnasResolucionSql {
  if (resolucion === null) {
    return {
      resolucion: null,
      motivo_devolucion: null,
      autorizado_por: null,
      registrada_por: null,
      resolucion_timestamp: null,
      autorizacion_observaciones: null,
    };
  }

  if (resolucion.tipo === "devolucion") {
    return {
      resolucion: "devolucion",
      motivo_devolucion: resolucion.motivo,
      // The gerencia branch does not exist for a `devolucion`: its two columns go
      // explicitly to NULL, not "left untouched".
      autorizado_por: null,
      registrada_por: resolucion.registradaPor,
      resolucion_timestamp: resolucion.timestamp,
      autorizacion_observaciones: null,
    };
  }

  return {
    resolucion: "autorizacion_gerencia",
    // Likewise for the `devolucion` branch: `motivo_devolucion` and
    // `registrada_por` go to NULL.
    motivo_devolucion: null,
    autorizado_por: resolucion.autorizadoPor,
    registrada_por: null,
    resolucion_timestamp: resolucion.timestamp,
    autorizacion_observaciones: resolucion.observaciones ?? null,
  };
}

/**
 * SQL → domain: the branch the discriminator declares, read from ITS OWN
 * columns.
 *
 * It fails loudly on a damaged row, with the concrete defect as `cause`:
 * - non-null discriminator with one of ITS OWN data columns NULL → descriptive
 *   mapping error. A fabricated `""` would yield an empty `devolucion` reason; a
 *   silent `null` would downgrade a real `devolucion` to `no_usable`.
 * - unrecognised discriminator → descriptive mapping error. Read as `null` it
 *   would be invisible: the `estado de tela` would fall to `no_usable` with
 *   nobody seeing it.
 *
 * The INACTIVE branch's columns are ignored: by the write contract they hold
 * `null`, and a row carrying a residual value there is not an ambiguous
 * resolution — the discriminator declares it — but garbage this adapter neither
 * reinterprets nor rewrites.
 */
function mapResolucionRow(row: InspeccionTelaRow): ResolucionInspeccion | null {
  if (row.resolucion === null) {
    return null;
  }

  if (row.resolucion === "devolucion") {
    const exigidas = ["motivo_devolucion", "registrada_por", "resolucion_timestamp"] as const;
    const nulas = exigidas.filter((columna) => row[columna] === null);
    if (nulas.length > 0) {
      throw errorDeMapeo(
        row.id,
        `la resolución "devolucion" no puede reconstruirse: ${nulas
          .map((columna) => `"${columna}"`)
          .join(", ")} ${nulas.length === 1 ? "es NULL" : "son NULL"}`,
        new Error(`columnas NULL inesperadas en la rama "devolucion": ${nulas.join(", ")}`)
      );
    }
    return {
      tipo: "devolucion",
      motivo: row.motivo_devolucion as string,
      registradaPor: row.registrada_por as string,
      timestamp: row.resolucion_timestamp as string,
    };
  }

  if (row.resolucion === "autorizacion_gerencia") {
    const exigidas = ["autorizado_por", "resolucion_timestamp"] as const;
    const nulas = exigidas.filter((columna) => row[columna] === null);
    if (nulas.length > 0) {
      throw errorDeMapeo(
        row.id,
        `la resolución "autorizacion_gerencia" no puede reconstruirse: ${nulas
          .map((columna) => `"${columna}"`)
          .join(", ")} ${nulas.length === 1 ? "es NULL" : "son NULL"}`,
        new Error(
          `columnas NULL inesperadas en la rama "autorizacion_gerencia": ${nulas.join(", ")}`
        )
      );
    }
    return {
      tipo: "autorizacion_gerencia",
      autorizadoPor: row.autorizado_por as string,
      timestamp: row.resolucion_timestamp as string,
      // The only OPTIONAL resolution column of the domain: absent → undefined,
      // never "" (a gerencia authorization is valid without notes).
      observaciones: row.autorizacion_observaciones ?? undefined,
    };
  }

  throw errorDeMapeo(
    row.id,
    `"resolucion" = "${row.resolucion}" no es una resolución conocida ("devolucion" | "autorizacion_gerencia")`,
    new Error(`valor inesperado en la columna "resolucion": "${row.resolucion}"`)
  );
}

/** Descriptive mapping error that preserves the concrete defect as its `cause`. */
function errorDeMapeo(inspeccionId: string, detalle: string, causa: Error): Error {
  return new Error(`no se pudo mapear la inspección "${inspeccionId}": ${detalle}`, {
    cause: causa,
  });
}

export class SqliteInspeccionTelaRepository implements IInspeccionRepository {
  constructor(private db: Database) {}

  /**
   * Inserts a new inspection. Rejects a duplicated id.
   * Order of operations: an `id` pre-check (SELECT) and, only if it does not
   * exist, ONE INSERT statement. The rejection happens BEFORE the write, so the
   * stored record stays intact.
   *
   * @throws `ya existe una inspección con el id <id>` (duplicate, in-memory
   *         adapter's message, unwrapped) or `no se pudo persistir la inspección
   *         "<id>"` with the original cause if the statement itself fails.
   */
  async insertInspeccion(inspeccion: InspeccionTela): Promise<void> {
    // 1. Duplicate pre-check. The table answers it by `id`.
    const existentes = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM inspeccion_tela WHERE id = $1",
      [inspeccion.id]
    );
    if (existentes.length > 0) {
      throw new Error(`ya existe una inspección con el id ${inspeccion.id}`);
    }

    // 2. ONE single explicit INSERT statement, with the 18 columns of 004 in the
    //    placeholder order. No upsert, no OR REPLACE, no transaction.
    const v = mapInspeccionToSql(inspeccion);
    try {
      await this.db.execute(
        "INSERT INTO inspeccion_tela (id, orden_id, operario, lote, absorcion, tundido, manchas, dimensiones, estado_general, otra_anomalia, timestamp, observaciones, resolucion, motivo_devolucion, autorizado_por, registrada_por, resolucion_timestamp, autorizacion_observaciones) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)",
        [
          v.id,
          v.orden_id,
          v.operario,
          v.lote,
          v.absorcion,
          v.tundido,
          v.manchas,
          v.dimensiones,
          v.estado_general,
          v.otra_anomalia,
          v.timestamp,
          v.observaciones,
          v.resolucion,
          v.motivo_devolucion,
          v.autorizado_por,
          v.registrada_por,
          v.resolucion_timestamp,
          v.autorizacion_observaciones,
        ]
      );
    } catch (error) {
      // Descriptive error with context, keeping the original cause (the 10.3/10.4
      // pattern). A failure is never swallowed nor turned into a success.
      throw new Error(`no se pudo persistir la inspección "${inspeccion.id}"`, {
        cause: error,
      });
    }
  }

  /**
   * Updates an existing inspection — the resolution flow — by id. Rejects an
   * unknown id and NEVER creates a record out of an update.
   *
   * The `UPDATE` sets the 17 non-PK columns: 004 has no `created_at` and no
   * `updated_at`, and `id` is the primary key, so `id` never appears in a `SET`
   * list (D2j). There is no branch on `rowsAffected`: the semantics of that value
   * through the plugin are unverified (R6), and the pre-check already guarantees
   * the row exists.
   *
   * Because the `SET` is complete, resolving an inspection REPLACES its row: no
   * trace of the unresolved state survives as a second row, and no column of the
   * previous branch survives either.
   *
   * @throws `no existe una inspección con el id <id>` (unknown, in-memory
   *         adapter's message, unwrapped) or `no se pudo persistir la inspección
   *         "<id>"` with the original cause if the statement itself fails.
   */
  async updateInspeccion(inspeccion: InspeccionTela): Promise<void> {
    // 1. Existence pre-check. If it is absent, the write is rejected BEFORE it
    //    happens: no row is created, partial nor complete.
    const existentes = await this.db.select<Array<{ id: string }>>(
      "SELECT id FROM inspeccion_tela WHERE id = $1",
      [inspeccion.id]
    );
    if (existentes.length === 0) {
      throw new Error(`no existe una inspección con el id ${inspeccion.id}`);
    }

    // 2. ONE single UPDATE statement, in the same spot: the same 17 non-PK
    //    columns, with the id bound to $1 and every other one shifted down.
    const v = mapInspeccionToSql(inspeccion);
    try {
      await this.db.execute(
        "UPDATE inspeccion_tela SET orden_id = $2, operario = $3, lote = $4, absorcion = $5, tundido = $6, manchas = $7, dimensiones = $8, estado_general = $9, otra_anomalia = $10, timestamp = $11, observaciones = $12, resolucion = $13, motivo_devolucion = $14, autorizado_por = $15, registrada_por = $16, resolucion_timestamp = $17, autorizacion_observaciones = $18 WHERE id = $1",
        [
          v.id,
          v.orden_id,
          v.operario,
          v.lote,
          v.absorcion,
          v.tundido,
          v.manchas,
          v.dimensiones,
          v.estado_general,
          v.otra_anomalia,
          v.timestamp,
          v.observaciones,
          v.resolucion,
          v.motivo_devolucion,
          v.autorizado_por,
          v.registrada_por,
          v.resolucion_timestamp,
          v.autorizacion_observaciones,
        ]
      );
    } catch (error) {
      throw new Error(`no se pudo persistir la inspección "${inspeccion.id}"`, {
        cause: error,
      });
    }
  }

  /**
   * Returns the inspection with the given id, or `undefined` if it does not
   * exist. `undefined` — never `null` — is the port's contract.
   * @throws The original SQLite/plugin error propagates (a failed read is not
   *         turned into "not found"), and so does the mapping error of a damaged
   *         row: `mapInspeccionRow` is pure and its failure is descriptive.
   */
  async obtenerPorId(id: string): Promise<InspeccionTela | undefined> {
    const rows = await this.db.select<InspeccionTelaRow[]>(
      "SELECT * FROM inspeccion_tela WHERE id = $1",
      [id]
    );
    if (rows.length === 0) {
      return undefined;
    }
    return mapInspeccionRow(rows[0]);
  }

  /**
   * Lists ALL inspections of an order, in chronological order by `timestamp`. The
   * query owns that order (`ORDER BY timestamp ASC`), not the caller: the adapter
   * does not re-sort the result.
   *
   * Returns all of them, unfiltered: the approved ticket 07 model has NO "one
   * inspection per order" — every new fabric lot produces an independent
   * inspection, with its own `lote`, its own `timestamp` and its own resolution.
   *
   * There is NO `listarPorMaquina`: an inspection is ALWAYS an order event, so the
   * table has no `machine_id` and the port does not expose that query.
   */
  async listarPorOrden(ordenId: string): Promise<InspeccionTela[]> {
    const rows = await this.db.select<InspeccionTelaRow[]>(
      "SELECT * FROM inspeccion_tela WHERE orden_id = $1 ORDER BY timestamp ASC",
      [ordenId]
    );
    return rows.map(mapInspeccionRow);
  }
}
