# Exploration: Operational event operative date (CHANGE 1)

**Status:** Pre-spec, non-implementing. Explores adding an explicit `fechaOperativa`
to machine events so day-scoped queries are deterministic (Q1=(a)) and events never
cross day boundaries by overlap (Q2).

## Scope

Add `fechaOperativa: string` (YYYY-MM-DD, jornada) to:
- Parada (domain + SQL + ports + adapters)
- ActividadPlanificada
- Dano
- Mantenimiento

## Evidence (domain: who supplies inicio)

### Parada
- Domain input: `RegistrarParadaInput` has `inicio: string` (ISO) and `operatorName`, `causaId`, `camposEspecificos`, `ordenId|null`, `maquinaId="M1"`, `observaciones?` (`src/domain/paradas.ts:104-114`).
- Creation: `registrarParada()` validates `inicio` non-empty and trims operator; returns `ParadaAbierta` with `fin: null`, `id = crypto.randomUUID()` (`173-186`). No timestamp generation inside domain.
- Callers (App): `src/App.tsx` registers parada from UI actions (command handlers) — the UI passes `inicio` (likely from the machine/clock input or current time at registration). The domain is pure.

### ActividadPlanificada
- `comenzarActividad(actividadesExistentes, input)` takes `input: { maquinaId: "M1", tipo: ActividadPlanificadaTipo, inicio: string, operatorName: string, queSeLimpio?: string, observaciones?: string }` (`src/domain/actividades.ts:45-56, 72-132`). `fin` starts null. Callers in `App.tsx`.
- Domain does not set `inicio`.

### Dano
- `registrarDano(danosExistentes, paradasExistentes, obtenerParadaPorId, input)` — `RegistrarDanoInput` includes `inicio: string`, `causoParada`, `paradaId|null`, `posibleSegunda`, `unidadesSospechadas?`, `observaciones?` (`src/domain/danos.ts:67-88, 110+`). Callers App/UI.
- When linking parada (`causoParada && paradaId`), validation checks parada exists and is still open (`parada.fin === null`) and not already linked to another dano (`156-183`); linking sets `dano.paradaId = paradaId` and returns `DanoAbiertoConParadaVinculada` union branch (`186-226`).

### Mantenimiento
- `registrarMantenimiento(mantenimientosExistentes, danosExistentes, obtenerDanoPorId, input)` — `RegistrarMantenimientoInput` has `inicio: string`, optional `fin?`, `queSeRevisoReparo?`, `danoId|null`, `observaciones?` (`src/domain/mantenimiento.ts:63-78, 80+`). Domain validates `inicio` present and valid ISO; if `fin` provided, `fin >= inicio` (`109-140`). Callers App.
- Maintenance can be opened without closing immediately (`fin` omitted → stored as null). Can be linked to a dano (`danoId`) with existence/open checks (`142-185`).

### Who supplies the clock (inicio + fechaOperativa)
- Domain is pure (no `Date.now()`, no clock). Every `inicio` comes from the caller. **The real call sites are the four UI sections** — `src/ui/ParadasSection.tsx:100`, `src/ui/ActividadesSection.tsx:76`, `src/ui/DanoSection.tsx:127`, `src/ui/MantenimientoSection.tsx:112` — each building `inicio: new Date().toISOString()`. Only `ActividadesSection` receives `hoy` (`:17`); `App.tsx:113` holds `hoy = fechaOperativaHoy()` and passes it down. So three of the four sections need the day threaded in.
- Therefore: when registering any of these four events, the caller already knows (or can derive from the same clock context) the operative date of the jornada in which it is being registered. Adding `fechaOperativa` to the input types is the natural, explicit extension (no implicit derivation inside pure domain).

## Types (current state)

Entities (domain/types.ts excerpts by references):
- `Parada` (base) / `ParadaAbierta` alias `{ fin: null }` — fields include `id, maquinaId, ordenId|null, operatorName, causaId, camposEspecificos, observaciones?, inicio, fin` (no `fechaOperativa`) (`src/domain/paradas.ts:9-11`, types implied).
- `ActividadPlanificada` — `id, maquinaId, tipo, inicio, fin, queSeLimpio?, observaciones?, operatorName` (no `fechaOperativa`, no `ordenId`) (`src/domain/actividades.ts:1-44` types).
- `Dano` is a single `interface` (`src/domain/types.ts:196`) with `DanoAbierto = Dano & { fin: null }` (`:225`) as its only alias — there is no four-branch union. Its fields include `id, maquinaId, ordenId|null, operatorName, tipo, componente, inicio, fin|null, causoParada, paradaId|null, posibleSegunda, unidadesSospechadas?, observaciones?` (no `fechaOperativa`).
- `Mantenimiento` — `id, maquinaId, tipo, operatorName, motivo, inicio, fin|null, queSeRevisoReparo?, danoId|null, observaciones?` (no `fechaOperativa`; no `ordenId` per ADR 0006).

## Ports/repositories

- `IParadasRepository` (`src/store/paradasRepository.ts:26-55`): `listarPorMaquina(maquinaId)`, `agregar(parada)`, `actualizar(parada)`, `obtenerPorId(id)`.
- `IActividadesRepository`: `listarPorMaquina(maquinaId)`, `agregar(act)`, `actualizar(act)`, `obtenerPorId(id)`.
- `IDanosRepository`: `listarPorMaquina(maquinaId)`, `agregar(dano)`, `actualizar(dano)`, `obtenerPorId(id)`.
- `IMantenimientoRepository`: `listarPorMaquina(maquinaId)`, `agregar(m)`, `actualizar(m)`, `obtenerPorId(id)`, `obtenerAbierto(maquinaId)` (`src/store/mantenimientoRepository.ts:42-74`).
- All list methods return full machine history (no date filter today) — matches recovery seam.

## SQLite adapters (evidence)

- `sqliteParadaRepository.ts`: maps DB rows (machine_id, orden_id, operario, causa_id, campos_especificos JSON, observaciones, inicio, fin) to domain; INSERT/UPDATE include those columns (`src/store/sqlite/sqliteParadaRepository.ts` per earlier exploration). No `fecha_operativa` column.
- `sqliteActividadPlanificadaRepository.ts`: maps similar fields; no `fecha_operativa`.
- `sqliteDanoRepository.ts:133-148` shows row mapping (inicio/fin as TEXT ISO, no fecha_operativa).
- `sqliteMantenimientoRepository.ts:139-150` same.
- Migration 004 creates the four tables without `fecha_operativa` (`004_operational_events.sql` header shows schema).

## Recovery

`recoverPersistedState` (`src/store/sqlite/recovery.ts:30-32,82-91,99,126-129`) documents machine-event lists carry full machine history with no date predicate (intentional seam). Adding `fecha_operativa` to rows means recovery continues to load full history (ports unchanged in signature except internal mapping) and domain composition is unchanged until historical-day ports gain a filter — which is CHANGE 2.

## Design notes for CHANGE 1 (non-implementing)

### Schema/migration 005
- Add nullable? Or NOT NULL? Events already exist only going forward after migration, but existing rows: base is currently empty/no productive data to preserve (stated). Strategy: add column as `TEXT NOT NULL` with a safe default only if backfilling existing rows were required — but "no hay datos productivos que preservar". Prefer `TEXT NOT NULL` and ensure any INSERT in adapters supplies it. Do not create a data backfill that invents history; migration can be additive (add column). If SQLite requires default for NOT NULL on existing table in some cases, use `DEFAULT 'YYYY-MM-DD'` only as a transitional no-op default in the migration DDL and ensure adapters never rely on it (write explicit values). Better: add column nullable? Or ensure empty DB. Given empty/non-productive state, simplest explicit: add `fecha_operativa TEXT NOT NULL` (and adapters must always write it). Document that no production rows exist to backfill.
- Tables: `parada`, `actividad_planificada`, `dano`, `mantenimiento`. `inspeccion_tela` is not listed in Q1 — and confirmed unnecessary: it has `timestamp: string` (`types.ts:308`), not a day key, and always carries a mandatory `ordenId`, so its day is reachable through the order.
- FK/indexes unchanged.

### Domain model
- Add `fechaOperativa: string` to each entity type (Parada/ParadaAbierta, ActividadPlanificada, Dano branches, Mantenimiento). Field is required (NOT NULL). Represents jornada day (YYYY-MM-DD).
- Input types gain `fechaOperativa: string` (required). Domain validates presence/format? Domain already validates ISO timestamps; `fechaOperativa` is a simple date string (YYYY-MM-DD). Validate non-empty (and maybe basic format) to keep pure and fail fast.
- No behavioral change to existing rules except carrying the new field through construction.

### Ports/adapters
- Ports signatures unchanged for now (`listarPorMaquina` still returns full history). Adapters read/write the new column. InMemory mirrors.
- Recovery maps the new column.

### Parity & tests
- Contract tests must assert the new field roundtrips (InMemory==SQLite). 
- Cases: event with fechaOperativa; event without order but with fechaOperativa; crosses midnight (field unchanged); open crossing midnight (unchanged); two events same timestamps different fechaOperativa (roundtrip distinct); recovery preserves it exactly.

### Duplication check (Q1 note)
- InspeccionTela: `timestamp: string` only (`types.ts:308`); no `fecha` field. `src/domain/inspeccion.ts` does not exist — the module is `inspeccionTela.ts`. Since an inspection always has `ordenId`, its day comes from the order; adding a field would duplicate that. Mantenimiento/Parada/Dano/Actividad have no equivalent. No duplication found.
- Jornada exists as entity but events are not Jornada rows. No duplication.

## Risks
1. Blast radius moderate (4 domains + 4 repos + SQLite + InMemory + recovery + types + tests). All mechanical additions (new required field). 
2. App callers must pass `fechaOperativa`. Since they call with current time context, derive from `fechaOperativaHoy()` or the jornada being viewed at registration time (today == current jornada). For registrations happening while viewing "hoy", pass `fechaOperativaHoy()`.
3. Migration 005 additive; empty DB safe. If any test DB has seeded events without column (old fixtures), tests need updating. But project uses migrations on init.
4. Domain purity preserved (no clock). 

## Conclusion
Feasible as a standalone CHANGE 1 with mechanical changes. No navigation logic. Meets Q1=(a), Q2 enforced at write-time (caller sets it; historical query will filter by equality).