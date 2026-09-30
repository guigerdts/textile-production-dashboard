# Design: SQLite Persistence — Phase 2 (Operational Domains)

Change: `sqlite-persistence-phase-2`
Artifact store: `openspec`
In-scope projects: `.` (frontend, TypeScript) and `src-tauri` (Rust shell)

## Technical Approach

Persist the five operational domains — **parada**, **actividad planificada**, **daño**,
**inspección de tela**, **mantenimiento** — behind the existing repository ports, using the
Phase 1 SQLite adapter pattern verbatim: one `Row` interface, two exported pure mappers
(`mapXRow` / `mapXToSql`) and one class holding `private db: Database` per table.

The change is **persistence-only**. `src/domain/**` gets zero diff. The five ports go from
synchronous to `Promise`-returning (26 methods), the five in-memory adapters keep identical
observable behaviour behind `async`, and the five new SQLite adapters are the durable
implementation. The composition root (`src/main.tsx`) builds all eight adapters once over one
`initDatabase()` handle, recovery returns **eight** source fields, and `App` consumes them by
seeding state, awaiting persistence before mutating React state, and re-reading afterwards.

The structural consequence of async repositories is three seams, resolved as follows:

| Seam | Resolution |
|---|---|
| The domain's entity lookups are synchronous by contract (`ObtenerParadaPorId`, `ObtenerDanoPorId`) | **Approach A** (already approved): pre-resolve with `await` in `App`, inject a synchronous closure over the record just read plus the refreshed state. Zero domain diff. |
| Repository reads in the render body (`App.tsx:583`, `:605`, `:626`) | Lift to `useState` — `danoAbiertoDeMaquina`, `mantenimientoAbiertoDeMaquina`, `danosDeOrden` — seeded by the mount loaders, refreshed by one re-seed helper per domain. |
| 6 UI files declare `(): string[]` and consume synchronously | Evolve the prop declarations **in place** to `Promise<string[]>` and `await` in the section handlers, following the Phase 1 precedent already in `OrderInProduction.tsx:45,47,86,100`. Two further files (`OrderAvailable`, `OrderFinished`) are in the blast radius but need **no edit** — they inherit the type through `import type` + `extends`. See D2c. |

Nothing derived is ever written: `tiempo productivo`, durations, projected `2da`, the >3% alert,
`buena racha`, `conAnomalia`, `estado de tela`, `deltaGolpes`, production progress and machine
state stay in the domain, recomputed on every read.

Capability mapping (no new requirement is invented; the design only realises what the three
approved specs require):

- `operational-events-schema` → §"Schema" below + slice **A**.
- `operational-repository-contracts` → §"SQLite adapters", §"Interfaces / Contracts" + slices **B–F**.
- `operational-recovery-wiring` → §"Recovery", §"Application wiring", §"UI contract" + slice **G**.

---

## Architecture Decisions

### D1 — One column vocabulary per database: keep `machine_id` / `operario`

**Choice**: the five new tables of migration 004 use migration 001's vocabulary —
`machine_id`, `operario` — **not** the domain vocabulary `maquina_id` / `operator_name`.

**Materialised impact**: **zero**. The three approved specs already name these columns
(`operational-events-schema/spec.md:67,70,72,75,79`), so **the specs stay exactly as written**
and no rename is executed anywhere. The only visible consequence is inside the mappers, where
`Row` / `SqlValues` interfaces speak `machine_id` / `operario` while the domain objects speak
`maquinaId` / `operatorName`. That translation is precisely what `mapXRow` / `mapXToSql` exist
for — Phase 1 already does it (`machine_id: orden.machineId` at
`sqliteOrderRepository.ts:175`, `machineId: row.machine_id as "M1"` at `:141`).

**Alternatives considered**:

- *`maquina_id` / `operator_name` (domain vocabulary)* — more legible at the SQL level, but it
  requires a mechanical rename of ~20 column references across the three approved specs, and it
  would create **two conventions inside one SQLite file**: `orden.machine_id` next to
  `dano.maquina_id`, `jornada`-era columns next to 004 columns. Every future query, index,
  migration and reviewer pays that tax permanently.
- *Renaming 001 to `maquina_id`* — forbidden twice over: decision 9 makes 001/002/003 immutable,
  and sqlx validates the checksum of every applied migration, so editing 001 fails startup with
  `VersionMismatch` (`sqliteOrderRepository.ts:7-8`, `003_d1_orden_persistence.sql:2-4`).

**Rationale**: one database speaks one vocabulary. 004 is new and never applied, so this is free
today and expensive later; the approved spec already encodes the answer, and the domain↔SQL
boundary is a structural seam that already exists in the code. Legibility is not lost — it lives
in the domain types and the mapper names.

**Consistency note carried into implementation**: every other column of 004 is the ASCII
snake_case transliteration of the domain field (`que_se_limpio` ← `queSeLimpio`,
`unidades_sospechadas` ← `unidadesSospechadas`, `causa_id` ← `causaId`). The two D1 columns are
not exceptions to a rule — they are the rule inherited from 001. `machine_id` is the *column*
name chosen in 001; `maquinaId` is the *domain* name. There is exactly one convention per layer.

---

### D2a — Rename `recoverPhase1State` to `recoverPersistedState`

**Choice**: replace `recoverPhase1State` with **`recoverPersistedState`** in
`src/store/sqlite/recovery.ts`. The `RecoveryState` interface name is **kept unchanged**.

**Alternatives considered**:

- *`recoverOperationalState`* — rejected on accuracy. The function returns `jornada`, `orden`
  and `lecturas`, which are **not** operational events: they are the program and the shift
  window. The name would be as wrong as the one it replaces.
- *Keep `recoverPhase1State`* — rejected because the name becomes a lie in the same file that
  documents eight recovered fields. A reader would reasonably assume the five operational
  domains are recovered elsewhere.
- *Split into `recoverPhase1State` + `recoverOperationalState`* — rejected on structure. The
  inspection read depends on the recovered `orden`, so splitting would push the read-order rule
  out of the composition and into the caller, giving `main.tsx` two failure points to sequence
  and two partial states to reason about. One function, one read order, one failure surface.

**Rationale**: the function's real, already-documented promise (`recovery.ts:7-8`) is *"returns
SOURCES only; derived states are computed AFTER recovery"*. The name should name the promise,
not a project-plan phase. `recoverPersistedState` stays accurate as migrations 005+ add more
persisted sources, which a phase-numbered name cannot. It is also consistent with the stack's
English verb-noun naming (`materializarPrograma`, `componerOrdenConLecturas`,
`SqliteOrderRepository`).

**Rename footprint — the only rename this change makes** (no domain file, no spec, no
migration): `src/main.tsx:8,24,70`; `src/store/sqlite/__tests__/recovery.test.ts:4,30,107,117`;
`src/store/sqlite/__tests__/startup.test.ts:7,13,30,142,163,188`;
`src/__tests__/persistence-integration.test.ts:8,23,230,266,303,332`, plus the
`RecoveryState` doc comments in both. `main.tsx`'s numbered startup comment (step 4) is
rewritten to name the eight recovered sources.

---

### D2b — The FK-capable fake store, and what makes the R2 regression test non-vacuous

**Choice**: one shared, FK-enforcing store double —
`src/store/sqlite/__tests__/fakeSqliteStore.ts`, exporting
`createFakeSqliteStore({ foreignKeys: true })` — used by the five new SQLite adapter suites and
by the restart-survival suite. It is a **statement-shape-matching fake**, not a SQL engine, and
it enforces exactly the five declared foreign keys.

**Contract of the double** (this is the design requirement, not an implementation detail):

1. **Shape matching.** `execute(query, binds)` / `select(query, binds)` dispatch on substrings
   of the exact statements the adapters emit, following the established pattern
   (`sqliteOrderRepository.test.ts:65`). Any unmodelled statement throws
   `execute: unsupported query in mock: <query>` — so an adapter that drifts from its declared
   statement shape **fails loudly** instead of silently no-op'ing. That throw is itself part of
   the anti-vacuity contract.
2. **Tables as row arrays.** One array per table (`parada`, `actividad_planificada`, `dano`,
   `inspeccion_tela`, `mantenimiento`, plus `orden` so FK targets can be primed), keyed by `id`.
   A pre-check `SELECT id FROM t WHERE id = $1` answers from the array; the adapter's own
   duplicate / unknown-id rejection is what the suite asserts, so the fake must **not**
   duplicate it.
3. **Foreign keys.** Before applying an `INSERT` or an `UPDATE` that writes a link column, the
   store resolves it against the target table's rows and, when unresolvable, rejects with an
   error whose message contains `FOREIGN KEY constraint failed` and whose `cause` is a
   synthetic `SqliteFkError` naming table, column and value. Enforced pairs:
   `parada.orden_id → orden.id`, `dano.orden_id → orden.id`, `dano.parada_id → parada.id`,
   `inspeccion_tela.orden_id → orden.id`, `mantenimiento.dano_id → dano.id`. A `null` link is
   always accepted.
4. **Ordering.** `ORDER BY inicio ASC` / `ORDER BY timestamp ASC` is applied by the fake from
   the row's own value, so "the repository owns the ordering" is a real assertion and not an
   accident of insertion order.
5. **`LIMIT 1`** on the open-record queries is honoured literally.

**Why R2 cannot pass vacuously.** The regression scenario
(`operational-recovery-wiring/spec.md:342-348`) is only meaningful if the store would reject a
dangling link *and* the domain path is genuinely reached. The design prescribes a
**three-assertion test** for the `parada` link (mirrored for `dano`):

| # | Assertion | Degenerate world it rules out |
|---|---|---|
| A1 (control) | `await danoRepository.insertDano({...paradaId: "no-existe"})` **directly**, bypassing `App` → rejects with `FOREIGN KEY constraint failed`. | A fake that rejects everything. If the store could not resolve a *known* parada, A1 with a **valid** `paradaId` (A1b) would fail. |
| A1b (control) | The same direct insert with a **primed, valid** `paradaId` → resolves. | A store whose FK check never passes, i.e. a store that would mask every write. |
| A2 (subject) | Drive `App`'s damage registration with `causoParada: true, paradaId: "no-existe"` → the returned error list contains `la parada vinculada no existe: no-existe` and does **not** contain `FOREIGN KEY`. | A `Promise` injected as the lookup: `if (!parada)` never fires, the domain accepts, `insertDano` is attempted, and the store now rejects with `FOREIGN KEY constraint failed` — so A2 sees the FK message and fails. |

A1/A1b prove the fake's FK is real; A2 proves the domain pre-check still fires. A `Promise`
injection can only pass if it makes A2 return the domain message without A1 showing a working FK
— impossible. The test therefore fails in every degenerate world: fake-rejects-everything,
fake-never-rejects, and lookup-re-promised.

**Reconciling a tension between two approved specs.** `operational-repository-contracts`
(`spec.md:384-391`) requires a `Dano` with a dangling `paradaId` to be persisted "without
raising a domain-rule error", while `operational-events-schema` (`spec.md:180-186`) requires the
insert to fail "when foreign key enforcement is active on the connection". Both hold, and the
design resolves the reading: **the adapter contains no validation of its own**. That scenario is
asserted as a **white-box statement assertion** — the `INSERT` the adapter emits binds the
dangling `parada_id` verbatim and the adapter performs no lookup — and the storage-level
rejection is asserted separately as a **store-level** test (A1). No FK-off mode is introduced;
one store configuration, no toggle, no second truth.

**Alternatives considered**: a per-suite inline `vi.hoisted` fake (the Phase 1 convention) would
duplicate ~80 lines across 6 suites and, worse, define the FK behaviour 6 times so the R2 guard
would be a property of one file rather than of the suite. A no-FK fake would make A1 impossible
and would let every other FK assertion pass vacuously. Both rejected.

---

### D2c — UI callbacks become `Promise<string[]>` in place; no wrapper, no adaptation layer

**Choice**: change the prop declarations to `Promise<string[]>` in the **6 files that actually
declare them**, make each section's submit/close handler `async`, and `await` the callback before
reading `.length` or calling a setter.

```ts
// src/ui/DanoSection.tsx
onRegistrarDano(input: RegistrarDanoInput): Promise<string[]>;
onCerrarDano(fin: string, solucionAplicada: string): Promise<string[]>;

async function handleCerrar(e: FormEvent) {
  e.preventDefault();                      // SIEMPRE antes del primer await
  setErroresCierre([]);
  const finIso = finInput ? new Date(finInput).toISOString() : "";
  setErroresCierre(await onCerrarDano(finIso, solucionAplicada));
}
```

**Exact edit surface — 6 files, 15 declaration sites, 12 consumption sites** (verified against
`src/ui/**` on 2026-09-26):

| File | Declaration sites | Consumption sites needing `await` |
|---|---|---|
| `src/ui/ParadasSection.tsx` | `:21`, `:23` | `:93`, `:111` |
| `src/ui/ActividadesSection.tsx` | `:25`, `:27` | `:73`, `:90` |
| `src/ui/DanoSection.tsx` | `:22`, `:24` | `:139`, `:159` |
| `src/ui/MantenimientoSection.tsx` | `:23`, `:24` | `:119`, `:136` |
| `src/ui/InspeccionTelaSection.tsx` | `:68`, `:70`, `:72` (`InspeccionTelaSectionProps`) **and** `:85`, `:86` (`InspeccionItemProps`) | `:117`, `:131`, `:329` |
| `src/ui/OrderInProduction.tsx` | `:53`, `:55` (re-declares the parada pair to forward to `ParadasSection` at `:182`, `:183`) | none — pure forwarding |

`InspeccionTelaSection.tsx` is the one file that declares the resolution callbacks **twice**: the
container props interface and the per-item child props interface. Both must change or the item
handler will `await` a `string[]` it thinks is a `Promise` — a TypeScript error, so it cannot ship
silently, but it is an easy miss when slicing the work.

**Correction to the proposal.** `proposal.md:272-278` states *"Five UI sections and three order
views"* and enumerates `InspeccionTelaSection.tsx:131,146,159`. Both figures are wrong against the
code. The section viewports are 5 sections, and the third order view count is 3 — but:

- `OrderAvailable.tsx:23-25` and `OrderFinished.tsx:5-13` do **not** re-declare any callback. They
  `import type` the section props interfaces (`ActividadesProps`, `DanoSectionProps`,
  `InspeccionTelaSectionProps`, `MantenimientoSectionProps`, `ResumenTiempoProps`) and
  `extends` them. The `Promise<string[]>` change therefore propagates through the type system with
  **zero edits** in those two files.
- The real `InspeccionTelaSection` consumption sites are `:117` (devolución), `:131`
  (autorización) and `:329` (registro) — not `:131`, `:146`, `:159`.

The design keeps the conservative 8-file figure as the **blast radius** — a `npx tsc --noEmit` run
must prove those two files still compile against the new section props — but the **edit surface is
6 files**, which is what `sdd-tasks` should schedule and what the slice budget should be computed
from.

**Alternatives considered**:

- *A wrapper that keeps the section signature synchronous* — impossible without blocking; a
  synchronous wrapper over a `Promise` is a lie.
- *An adaptation layer (a `useAsyncCallback` hook, or a second callback prop such as
  `onRegistrarDanoAsync` alongside the sync one)* — rejected. It introduces a second vocabulary
  for one concept, it would have exactly one consumer, and it contradicts the sections' existing
  shape (they receive **values**, not hooks or adapters).
- *Moving the `await` into the App handler and returning a resolved array by keeping a cache* —
  rejected: that is the memoized second read path already excluded by decision 11.

**Rationale**: this is **already the project's pattern**, not a new one. Phase 1 did exactly
this for the order flow: `OrderInProduction.tsx:45,47` declares
`onRegistrarLectura(...): Promise<ResultadoRegistroLectura>` and `onFinalizar(): Promise<string[]>`
with the comment *"Async desde el ticket 10.4"*, consumed at `:86`
(`const res = await onRegistrarLectura(...)`) and `:100` (`setErroresFin(await onFinalizar())`).
`openspec/config.yaml` `apply` requires following existing code patterns; a new abstraction would
be the deviation.

Two consequences the implementation must honour:

- **`e.preventDefault()` is the first statement**, before any `await`. React 19 does not pool
  events, so a post-`await` `preventDefault()` would not throw today, but the ordering is
  prescribed so the handlers stay correct if reused.
- **No shared callback type module exists to update.** Each file re-declares the signature it
  needs, so the type change is a per-file edit in 6 files rather than one edit plus 6 consumers.

---

### D2d — `PRAGMA foreign_keys` per-connection: honest note, no unverifiable workaround

**Choice**: change **nothing** in `src/store/sqlite/database.ts`. Carry R5 as an explicit honesty
note and name the existing runtime probe as the verification entry point.

**Rationale**: `applyPragmas` (`database.ts:37-48`) sets `PRAGMA foreign_keys = ON` once on the
handle returned by `Database.load()`. SQLite treats `foreign_keys` as a **per-connection** setting
and tauri-plugin-sql may serve `execute` / `select` from a pool, so enforcement could be
inconsistent. This cannot be proven in this environment, and the approved specs already hedge
correctly (`operational-events-schema/spec.md:182` — *"WHEN foreign key enforcement is active on
the connection"*).

**Alternatives considered**: re-assert `PRAGMA foreign_keys = ON` per statement; add a startup
verification step that reads `getForeignKeys()` and fails loudly; branch the adapters' behaviour
on the enforcement result. All three rejected — each adds a code path whose behaviour on the real
plugin cannot be verified in this environment, which is a larger unknown than the one it would
close.

An unverifiable workaround would be worse than an honest note: re-asserting the pragma per
statement, adding a verification step, or branching on `rowsAffected` would each add a code path
whose behaviour on the real plugin is unknown. Instead, the design designates the **existing**
`getForeignKeys()` (`database.ts:136-140`) as the concrete runtime probe to run on the real Tauri
binary **before any FK guarantee is claimed**, so `sdd-verify` and later runtime validation have a
named entry point instead of a vague risk. Every new suite header repeats the project's honesty
note. Consequence for the test design: the FK behaviour of the fake store (D2b) is a *model* of
the declared schema, never a proof that the real connection enforces it.

---

### D2e — Recovery read order: sequential, fixed, with one declared dependency

**Choice**: read sequentially in this exact order, each `await`ed:

```
jornada → orden → lecturas → paradas → actividades → daños → mantenimientos → inspecciones
```

with `inspecciones = orden ? await inspeccionRepository.listarPorOrden(orden.id) : []` — the same
guard shape as the existing `lecturas` read (`recovery.ts:67-69`).

**Alternatives considered**: `Promise.all` over the four machine-event lists. Rejected — the
first failing read must abort startup at a *named* domain, and sequential awaits keep the function
a linear sequence that matches its own doc comment, so the single real dependency (`orden` before
`inspecciones`) is visible rather than buried in a fan-out. The cost is four local reads in
sequence on a single-operator desktop dashboard — microseconds, against a database that is a file
on the same machine.

**Rationale**: the four machine-event domains have no interdependency; the ordering rule exists
solely so a partial failure is diagnosable and so the inspection dependency is explicit. A future
"read a past day" feature adds a date predicate to the **ports**, not to recovery
(approved: no date scoping, full machine history).

---

### D2f — Recovery takes `maquinaId` as an explicit parameter

**Choice**: `recoverPersistedState(jornadaRepository, orderRepository, lecturaRepository,
paradaRepository, actividadRepository, danoRepository, mantenimientoRepository,
inspeccionRepository, fechaOperativa, maquinaId)`. `main.tsx` passes `"M1"`.

**Alternatives considered**: hardcoding `"M1"` inside recovery (rejected — a hidden coupling to
the single-machine scope of ADR 0003 inside a function whose contract is "receives repository
interfaces, emits no SQL"); creating a machine-constants module (rejected — one literal does not
justify a new file in a change already over budget); an options object instead of positional
parameters (rejected below).

**Arity tradeoff, stated openly**: ten positional parameters is a lot. It is kept positional
because (a) the spec scenario *"they are the eight repository interfaces, never a `Database`
instance"* reads directly as an eight-repository positional list, (b) the existing
`recoverPhase1State` is already called positionally in 9 places including 3 test files, and an
options object would rewrite all of them for no consumer benefit, and (c) the config rule is to
follow existing patterns. The mitigation is the existing convention: the doc comment enumerates
each parameter in order with its source, exactly as `recovery.ts:56-70` does today. Grouping is
fixed: **8 repositories first, then the two scalars** (`fechaOperativa`, `maquinaId`) last.

---

### D2g — Persistence errors: one uniform handler template, no error taxonomy

**Choice**: every operational handler uses the same shape, and the persistence `catch` returns
the error message in the `string[]` error list the UI already renders:

```ts
async function handleRegistrarParada(input: RegistrarParadaInput): Promise<string[]> {
  if (!orden || orden.estado !== "in_production") {
    return ["solo se registran paradas en una orden en producción"];
  }
  const resultado = registrarParada(paradas, input);
  if (resultado.errores.length > 0) return resultado.errores;
  if (!resultado.parada) return ["no se pudo registrar la parada"];
  try {
    await paradaRepository.insertParada(resultado.parada);
  } catch (error) {
    return [error instanceof Error ? error.message : "no se pudo guardar la parada"];
  }
  await recargarParadas();
  return [];
}
```

Domain errors and persistence errors share the channel; **no** distinguishing class, code, or
prefix is introduced. Each fallback string is Spanish and specific to the domain, matching
`App.tsx:254`, `:318` and `:403`.

**Alternatives considered**: a `PersistenciaError` type or an error-code prefix so the UI could
differentiate. Rejected — the sections render a `string[]` and nothing more, and a store concept
surfacing in the UI layer would violate `openspec/config.yaml` `design` (*"Never let domain logic
leak into src/ui or into repository adapters"*). The operario needs to know *the record was not
saved*, not which layer refused; the message already carries the detail, because the adapters
throw descriptive errors naming the record id and preserving the original `cause`.

**Mandatory invariant**: a failed write must never return an empty error list. The template
above makes that structurally true (the `catch` is the only other exit and it always returns one
message), and the test suite asserts the returned list is non-empty for every rejection path.

---

### D2h — Seeding: seed from `estadoInicial` unconditionally, then let the mount loaders re-read

**Choice**: seed `paradas`, `actividades`, `danos`, `mantenimientos` and `inspecciones` from
`estadoInicial` with no conditional logic, and **keep** the mount loaders, converted to the
`cancelled`-flag async pattern already used at `App.tsx:156-177` and `:187-197`. The loaders
re-read every operational domain for the injected `hoy` / machine and replace the state.

**Alternatives considered**: conditional seeding ("use the seed only when the recovered date
matches `hoy`") — rejected, because it introduces a new precedence rule between two sources that
the specs already settled the other way. Dropping the mount loaders entirely and treating the
seed as final — rejected, because `App` accepts an injectable `hoy` that startup recovery does not
know about, so an injected-date session would render recovered data from the wrong day.

**Rationale**: recovery's `inspecciones` are by construction `listarPorOrden(estadoInicial.orden.id)`,
so the seed is coherent for the first paint; and the loader always re-reads, so no stale window
survives the first effect. Adding conditional seed logic ("use the seed only when the date
matches") would be a *new* rule about which source wins — a decision the specs already settled
the other way. The loaders exist because `App` accepts an injectable `hoy` that startup recovery
does not know about; dropping them would make an injected-date test show stale recovered data.

**Loader dependency arrays** (each names the repository, and `hoy` / `orden?.id` where relevant):
paradas `[paradaRepository]`; actividades `[actividadRepository]`; danos + open damage +
per-order damages `[danoRepository, orden?.id]`; mantenimientos + open maintenance
`[mantenimientoRepository]`; inspecciones `[inspeccionRepository, orden?.id]`. `danosDeOrden`
shares the `danoRepository` / `orden?.id` effect because it is keyed by the order.

---

### D2i — One re-seed helper per domain, not ad-hoc refresh sites

**Choice**: two internal async helpers own every operational refresh:

```ts
async function recargarDanos(): Promise<void> {
  const [danosDeMaquina, abierto, deOrden] = await Promise.all([
    danoRepository.listarPorMaquina(MAQUINA),
    danoRepository.getDanoAbierto(MAQUINA),
    orden ? danoRepository.listarPorOrden(orden.id) : Promise.resolve([]),
  ]);
  setDanos(danosDeMaquina);
  setDanoAbiertoDeMaquina(abierto);
  setDanosDeOrden(deOrden);
}

async function recargarMantenimientos(): Promise<void> {
  const [deMaquina, abierto] = await Promise.all([
    mantenimientoRepository.listarPorMaquina(MAQUINA),
    mantenimientoRepository.getMantenimientoAbierto(MAQUINA),
  ]);
  setMantenimientos(deMaquina);
  setMantenimientoAbiertoDeMaquina(abierto);
}
```

plus the single-domain `recargarParadas()`, `recargarActividades()`, `recargarInspecciones()`.
Every handler calls the relevant helper **after** its awaited write. `Promise.all` *inside* a
helper is fine — it is one logical read-set with no ordering dependency, unlike recovery (D2e).

**Alternatives considered**: inline `await` + `setX` calls at each refresh site (the Phase 1
shape) — rejected, because it makes "refreshed after every mutation" a property of reviewer
vigilance and lets a new handler forget a domain. One bulk helper that reloads all five
domains after every write — rejected, because it couples unrelated domains and re-renders state
the operario did not change.

**Rationale**: "refreshed after every mutation" (approved requirement) must be true **by
construction**, not by reviewer vigilance. Three separate ad-hoc refresh sites per domain is
exactly how `danoAbiertoDeMaquina` silently goes stale while `danos` is fresh — and a stale open
damage is precisely the bug this change exists to fix (US4). The helpers also make the "state is
re-seeded from the repository, not from the local object" requirement observable: a handler never
splices the domain object it just wrote into state.

---

### D2j — Insert/update mechanics: pre-check `SELECT`, then one statement; no `rowsAffected` branch

**Choice**: every `insertX` issues `SELECT id FROM <t> WHERE id = $1` first and rejects a
duplicate with the **same message the in-memory adapter uses**; every `updateX` issues the same
pre-check and rejects an unknown id with the in-memory message. The write is then a single
explicit `INSERT` or `UPDATE`. **No upsert, no `INSERT OR REPLACE`, no branch on
`rowsAffected`.**

**Alternatives considered**: an upsert (`INSERT ... ON CONFLICT DO UPDATE` or
`INSERT OR REPLACE`) — rejected, because it collapses two distinct contract outcomes (duplicate
insert vs unknown-id update) into one silent overwrite, and the port requires a descriptive
rejection for each. A branch on `rowsAffected` — rejected below, since its semantics across the
plugin are unverified (R6).

**Rationale**: the pre-check is the established in-repo pattern (`sqliteOrderRepository.ts:216-222`)
and it produces the port contract's descriptive message without matching error strings. A branch
on `rowsAffected` would be a second, unverifiable failure mechanism (R6) whose semantics across
the plugin are unknown. The pre-check uses `select`, already proven by Phase 1.

**Honest limitation, inherited from Phase 1**: tauri-plugin-sql exposes no transaction API
(`database.ts:7-13`), so pre-check + write is two statements and is not atomic against a
concurrent writer. Accepted for the same reason Phase 1 accepted it: the app is single-operator
and every id is domain-generated `crypto.randomUUID()`, so no two writes contend for the same
primary key.

**Simplification 004 buys over 001**: none of the five new tables has a `created_at` /
`updated_at` (no DEFAULTs, 59 columns enumerated in the spec). So an `UPDATE` sets **all
non-PK columns** — an exact behavioural match for the in-memory `map.set(record)`, with no
"preserve the creation timestamp" wrinkle, and `id` never appears in a `SET` list.

---

### D3 — Ratify the five adapter filenames from `§Affected Areas`

**Choice**: `sqliteParadaRepository.ts`, `sqliteActividadPlanificadaRepository.ts`,
`sqliteDanoRepository.ts`, `sqliteInspeccionTelaRepository.ts`,
`sqliteMantenimientoRepository.ts`, exporting `SqliteParadaRepository`,
`SqliteActividadPlanificadaRepository`, `SqliteDanoRepository`,
`SqliteInspeccionTelaRepository`, `SqliteMantenimientoRepository`. The `§Open Decisions` row D3
is **retired** and points at this design.

**Alternatives considered**: plural adapter names (`sqliteParadasRepository.ts`,
`sqliteActividadesRepository.ts`, …). Rejected — the Phase 1 precedent is unanimous in the
singular domain entity: `SqliteOrderRepository` for `IOrderRepository`, `SqliteJornadaRepository`
for `IJornadaRepository`, `SqliteLecturaGolpeRepository` for `ILecturaGolpeRepository`. The port
interface is plural because a port offers a *collection*; the adapter persists one row of the
entity the port's domain type names. `SqliteActividadPlanificadaRepository` /
`sqliteActividadPlanificadaRepository` also mirrors `IActividadPlanificadaRepository` /
`InMemoryActividadPlanificadaRepository` name-for-name, which is the strongest available signal.

**Rationale**: the adapter name is the seam between the port and the SQL table, and the port names
are already decided (`IParadaRepository`, `IActividadPlanificadaRepository`, …). Matching the
singular domain entity that each port's methods speak — `Parada`, `Dano`, `InspeccionTela` — makes
the five files discoverable by the same rule a reader already uses for Phase 1, and it keeps the
adapter/table relationship one-to-one: one adapter, one table, one domain type. A plural name
would also collide with the in-memory naming, making the only structural difference between the
two implementations of the same port read as a naming inconsistency.

**Resolution of the contradiction**: `§Affected Areas` is the concrete file table that
`sdd-tasks` is derived from; `§Open Decisions` is a list of *questions*. When they conflict, the
concrete commitment wins and the question row is retired. This is the only correction the
proposal needs — one row deleted from `§Open Decisions` D3, plus the same retirement of its D2
row, since D2a is now decided here.

**One non-decision stated for the record**: the `§Affected Areas` shell
`src/store/inMemory{Paradas,Actividades,Danos,Inspeccion,Mantenimiento}Repository.ts` is
brace-expansion listing five **existing** filenames, not a naming claim. Those files keep their
names; only their method bodies change.

---

## Data Flow

### Startup

```
main.tsx
  └─ await initDatabase()                     singleton Database, PRAGMAs applied once
  └─ new Sqlite{Jornada,Order,LecturaGolpe,
                Parada,ActividadPlanificada,Dano,
                InspeccionTela,Mantenimiento}Repository(db)   ← 8 instances, ONCE
  └─ await materializarPrograma(orderRepo, fixtures)           external source → SQLite, idempotent
  └─ await recoverPersistedState(8 repos, fechaOperativa, "M1") → RecoveryState (8 fields)
  └─ render(<App ... 8 repositories estadoInicial={...} />)
        failure in any step → render(<InicializacionFallida/>); App NEVER mounts
```

### Recovery read order

```
jornada ─┐
orden ────┼─→ (orden is undefined) ──→ lecturas=[] , inspecciones=[]
lecturas ─┤
paradas ──┤  4 machine-event lists: full machine history, NO date predicate
actividades┤
danos ────┤
mantenimientos┘
inspecciones ← requires orden.id ; [] when there is no orden
                    ⇒ SOURCES ONLY: no tiempo, no 2da, no estado de tela, no machine state
```

### Mutation handler (uniform, 11 handlers)

```
UI submit (preventDefault)
  → await App handler
      → pure domain call (SYNC, no Promise in src/domain)
      → if errores.length > 0 → return errores           [no write, state untouched]
      → await repository.insertX / updateX                [the ONLY awaited write]
      → on rejection → return [error.message]             [state untouched, non-empty list]
      → await recargar<Domain>()                          [re-read from the repository]
      → return []                                         [UI resets its form]
```

### Approach A — the synchronous lookup that stays synchronous

```
registrarDano(input)  with SQLite adapters
  1. await paradaRepository.obtenerPorId(input.paradaId)      ← ONE await, from the DB
  2. const vinculada = <that record>                          ← the freshest possible entity
  3. registrarDano(danos, input,
       (id) => (id === vinculada?.id ? vinculada
                                   : paradas.find(p => p.id === id)))   ← SYNCHRONOUS closure
  4. if errores → return errores            [no insertDano: the FK is never touched]
  5. await danoRepository.insertDano(dano) → await recargarDanos()
```

The domain receives `Parada | undefined` — never a `Promise`. A dangling `paradaId` therefore
fails at step 3 with the domain's own `la parada vinculada no existe: <id>`, and **no write is
attempted**, so the FK error never appears. `handleRegistrarMantenimiento` is identical with
`danoRepository.obtenerPorId` / `el daño vinculado no existe: <id>`. The domain calls each lookup
exactly once (`danos.ts:147`, `mantenimiento.ts:159`), so one await per handler.

---

## Schema

Migration `004_operational_events.sql`: 5 tables, 59 columns, 5 FKs, 11 indexes; no `CHECK`, no
`DEFAULT`, no `CREATE TABLE` beyond the five. Canonical at
`src-tauri/migrations/004_operational_events.sql`, byte-identical mirror at
`src/store/sqlite/migrations/004_operational_events.sql`; `CURRENT_MIGRATION_VERSION = 4`;
`TABLES` gains `PARADA`, `ACTIVIDAD_PLANIFICADA`, `DANO`, `INSPECCION_TELA`, `MANTENIMIENTO`
(8 total); `Migration { version: 4, description: "operational_events", kind: MigrationKind::Up }`
in `lib.rs`. Migrations 001/002/003 byte-unchanged. `CREATE TABLE IF NOT EXISTS` and
`CREATE INDEX IF NOT EXISTS` are used, matching 001/002/003.

`parada` — the reference table for adapter shape; the other four mirror it.

| # | Column | Type | Domain source |
|---|---|---|---|
| 1 | `id` | TEXT PK | `Parada.id` (domain `crypto.randomUUID()`) |
| 2 | `machine_id` | TEXT NOT NULL | `maquinaId` — **D1** |
| 3 | `orden_id` | TEXT NULL **FK → orden(id)** | `ordenId` (`null` = stop on an empty day) |
| 4 | `operario` | TEXT NOT NULL | `operatorName` — **D1** |
| 5 | `causa_id` | TEXT NOT NULL | `causaId` (one of 10; domain validates) |
| 6 | `campos_especificos` | TEXT NOT NULL | `camposEspecificos` — **JSON TEXT** |
| 7 | `observaciones` | TEXT NULL | `observaciones?` |
| 8 | `inicio` | TEXT NOT NULL | `inicio` |
| 9 | `fin` | TEXT NULL | `fin` (NULL = open; `ParadaAbierta` is a type alias, never stored) |

Column sets and nullability for the other four tables are exactly those enumerated in
`operational-events-schema/spec.md:70-79` and `:99-116`; the design adds nothing and removes
nothing. Index set: the 11 of `spec.md:198-212`, four of them partial with `WHERE fin IS NULL`.

**Derived state has no column, by construction**: no `con_anomalia`, no `estado_inspeccion`, no
`duracion`, no `tiempo_productivo`, no `porcentaje_2da_proyectado`, no `alerta_2da`, no
`buena_racha`, no `delta_golpes`, no `progreso`, no `estado_maquina`. The SQL-contract suite
asserts their absence by name, so a column added later fails the suite.

---

## SQLite adapters

All five follow `sqliteOrderRepository.ts`: exported `Row`, exported pure `mapXRow` /
`mapXToSql`, `class … implements I…Repository { constructor(private db: Database) {} }`, `$1`
placeholders, no `BEGIN`/`COMMIT`, one statement per write, errors wrapped with `{ cause }`.
Every module header states that the repository does **not** validate business rules, and
`IDanoRepository` / `IMantenimientoRepository` keep stating that linked-entity existence is a
domain rule supplied through an injected lookup.

### Statement shapes (the contract the fake store must model)

| Method | Statement |
|---|---|
| `obtenerPorId(id)` | `SELECT * FROM <t> WHERE id = $1` → `rows[0]` → `mapXRow`, else `undefined` |
| `listarPorMaquina(m)` | `SELECT * FROM <t> WHERE machine_id = $1 ORDER BY inicio ASC` |
| `listarPorMaquina` (inspecciones) | **does not exist** — the port exposes no machine query |
| `listarPorOrden(o)` | `SELECT * FROM <t> WHERE orden_id = $1 ORDER BY inicio ASC` (inspecciones: `ORDER BY timestamp ASC`) |
| `getParadaAbierta(m, o)` | `SELECT * FROM parada WHERE machine_id = $1 AND orden_id IS $2 AND fin IS NULL ORDER BY inicio ASC LIMIT 1` |
| `getActividadAbierta(m, t)` | `SELECT * FROM actividad_planificada WHERE machine_id = $1 AND tipo = $2 AND fin IS NULL ORDER BY inicio ASC LIMIT 1` |
| `getDanoAbierto(m)` | `SELECT * FROM dano WHERE machine_id = $1 AND fin IS NULL ORDER BY inicio ASC LIMIT 1` |
| `getMantenimientoAbierto(m)` | `SELECT * FROM mantenimiento WHERE machine_id = $1 AND fin IS NULL ORDER BY inicio ASC LIMIT 1` |
| `insertX(x)` | `SELECT id FROM <t> WHERE id = $1` → reject duplicate → `INSERT INTO <t> (9 cols) VALUES ($1..$9)` |
| `updateX(x)` | `SELECT id FROM <t> WHERE id = $1` → reject unknown → `UPDATE <t> SET <all non-PK cols> WHERE id = $1` |

Three details that are easy to get wrong and are therefore prescribed:

1. **`orden_id IS $2`, not `= $2`.** The open-parada query takes `ordenId: string | null`. In SQL,
   `orden_id = NULL` never matches, so the unlinked-open-stop case would silently return `null`.
   `IS $2` is the correct null-safe form. For `listarPorOrden(ordenId)`, plain `= $1` is correct
   **and** already excludes the `null` links by three-valued logic — no extra `IS NOT NULL`
   predicate is needed, and adding one would be noise.
2. **Null → `undefined`, never `""` and never `0`.** `observaciones`, `solucion_aplicada`,
   `lote`, `otra_anomalia`, `que_se_limpio`, `que_se_reviso_reparo` read back with `?? undefined`;
   `orden_id` reads back as `null` (the domain type is `string | null`, not optional);
   `unidades_sospechadas` reads back `?? undefined` so the domain invariant *"without
   `posibleSegunda`, `unidadesSospechadas` is undefined"* survives the round trip.
3. **`ORDER BY inicio ASC` + `LIMIT 1` on the open-record queries** matches the in-memory
   "first match" whenever the domain invariant (at most one open record per query shape) holds,
   and is *deterministic* when it does not — insertion order is not.

### Domain-specific mapping

- **`parada` — JSON TEXT.** Write `JSON.stringify(camposEspecificos)`; `{}` round-trips as `{}`.
  Read: `JSON.parse` inside a `try`, then a shape check that rejects non-objects (`typeof !== "object"`,
  `null`, arrays). Any failure throws a descriptive mapping error whose `cause` is the original
  `SyntaxError` — never `{}`, never a partial record, never a skipped row.
- **`dano` — independent 0/1 flags.** `causo_parada = causoParada ? 1 : 0`, read `=== 1` (the
  exact convention of `aplica_segunda`, `sqliteOrderRepository.ts:138,178`). No `CHECK` ties
  `causo_parada`, `posible_segunda`, `parada_id` or `unidades_sospechadas` together — that
  coupling is a domain rule.
- **`inspeccion_tela` — flat checklist and the full resolution union.** `mapInspeccionToSql`
  writes the five checklist states verbatim and sets **only** the branch columns belonging to the
  active `resolucion`:
  - `resolucion = null` → all five resolution columns `NULL`.
  - `devolucion` → `resolucion='devolucion'`, `motivo_devolucion`, `registrada_por`,
    `resolucion_timestamp`; `autorizado_por` and `autorizacion_observaciones` `NULL`.
  - `autorizacion_gerencia` → `resolucion='autorizacion_gerencia'`, `autorizado_por`,
    `resolucion_timestamp`, `autorizacion_observaciones`; `motivo_devolucion` and
    `registrada_por` `NULL`.
  `mapInspeccionRow` rebuilds `items` by iterating a **literal ordered tuple** of the five
  column names — `["absorcion", "tundido", "manchas", "dimensiones", "estado_general"]` — and
  rebuilding the matching `ResolucionInspeccion` branch. A non-null discriminator with a null
  data column, or an unrecognised discriminator string, is a **descriptive mapping error with
  `cause`** — never a fabricated `""` and never a silent `null`.
  *Why a literal tuple rather than `getItemsChecklist()`:* the column set is fixed by migration
  004, so the mapping is a storage fact. A catalog-driven zip would silently yield a 5-item
  array if the domain ever grew a sixth item, instead of failing loudly; and a mapper that must
  fail loudly on schema drift is worth more here than the drift itself. A suite assertion pins
  the tuple to `getItemsChecklist().map(i => i.id)`, so catalogue order drift fails the build.
  `conAnomalia` and `estadoInspeccion` are **never read from a column** and never cached — the
  domain's own `conAnomalia()` / `estadoInspeccion()` recompute them from the rebuilt record.
- **`actividad_planificada` / `mantenimiento`** — no `orden_id` column, so the mapper never
  produces one and the port has no `listarPorOrden`. `mantenimiento` has no `duracion` column
  (ADR 0007: documentary only).

---

## Recovery

`src/store/sqlite/recovery.ts` — `recoverPhase1State` → **`recoverPersistedState`**
(8 repositories + `fechaOperativa` + `maquinaId`; D2f). `RecoveryState` grows 3 → 8 fields:

```ts
export interface RecoveryState {
  jornada: JornadaTurno;
  orden: Orden | undefined;
  lecturas: LecturaContador[];
  paradas: Parada[];
  actividades: ActividadPlanificada[];
  danos: Dano[];
  mantenimientos: Mantenimiento[];
  inspecciones: InspeccionTela[];
}
```

It receives repository interfaces only, never a `Database`, and contains no SQL. It performs no
arithmetic over the records beyond assembling the lists. `componerOrdenConLecturas` is unchanged.
A read failure propagates — it is never downgraded to an empty list — so `main.tsx` renders
`InicializacionFallida` and `App` never mounts.

---

## Application wiring

### `src/main.tsx`

Step 2 becomes eight repository constructions; the two hard-wired in-memory lines
(`main.tsx:85-86`) are **removed**; step 4 calls `recoverPersistedState` and step 5 passes all
five operational repositories to `<App>` as props. The numbered header comment is updated to
describe the eight recovered sources. The `try`/`catch` discipline, `mensajeDeError` and
`InicializacionFallida` are untouched.

### `src/App.tsx` (highest-risk file)

| Change | Detail |
|---|---|
| Props | five operational repository props already exist; only their types become async ports (no new prop) |
| State | seed the 5 arrays from `estadoInicial`; **add** `danoAbiertoDeMaquina`, `mantenimientoAbiertoDeMaquina`, `danosDeOrden` |
| `useMemo` defaults | **kept** — a test that injects no repository still gets an in-memory adapter, and no per-render `new Sqlite…(db)` is introduced |
| Mount loaders | converted to the `cancelled`-flag async pattern (`App.tsx:156-177`); deps per D2h |
| Render-body reads | `danoRepository.getDanoAbierto("M1")` (`:583`), `mantenimientoRepository.getMantenimientoAbierto("M1")` (`:605`) and `danoRepository.listarPorOrden(orden.id)` (`:626`) replaced by the three state values — no repository call remains in the render body |
| 11 handlers | `async … Promise<string[]>`; template per D2g; `await` write → `await recargar…()` |
| Approach A | `handleRegistrarDano` / `handleRegistrarMantenimiento` per the Data Flow diagram |
| Derivation stays | `resumenTiempoTurno`, `paradaAbierta`, `proyeccionSegundaDeOrden`, `duracionAcumulada`, `mantenimientoAbierto`, machine state — all still computed in the render body **from state**; the `MAQUINA` literal `"M1"` is left as-is (D1 is about *columns*, not this) |

---

## File Changes

| File | Action | Description |
|---|---|---|
| `src-tauri/migrations/004_operational_events.sql` | Create | Canonical DDL: 5 tables, 59 columns, 5 FKs, 11 indexes |
| `src/store/sqlite/migrations/004_operational_events.sql` | Create | Byte-identical mirror |
| `src/store/sqlite/migrations/index.ts` | Modify | `CURRENT_MIGRATION_VERSION` 3 → 4; `TABLES` gains 5 names (8 total) |
| `src-tauri/src/lib.rs` | Modify | Register `Migration { version: 4, description: "operational_events", kind: Up }`; versions 1–3 untouched |
| `src/store/paradasRepository.ts` | Modify | 6 methods → `Promise`; doc comment updated (the "métodos son síncronos" note is now false) |
| `src/store/actividadesRepository.ts` | Modify | 5 methods → `Promise`; same doc update |
| `src/store/danosRepository.ts` | Modify | 6 methods → `Promise`; same doc update |
| `src/store/inspeccionRepository.ts` | Modify | 4 methods → `Promise`; same doc update |
| `src/store/mantenimientoRepository.ts` | Modify | 5 methods → `Promise`; same doc update |
| `src/store/inMemoryParadasRepository.ts` | Modify | `async` bodies, identical messages/semantics |
| `src/store/inMemoryActividadesRepository.ts` | Modify | same |
| `src/store/inMemoryDanosRepository.ts` | Modify | same |
| `src/store/inMemoryInspeccionRepository.ts` | Modify | same (`validarId` preserved) |
| `src/store/inMemoryMantenimientoRepository.ts` | Modify | same |
| `src/store/sqlite/sqliteParadaRepository.ts` | Create | `ParadaRow`/`ParadaSqlValues`, `mapParadaRow`/`mapParadaToSql`, `SqliteParadaRepository`, JSON TEXT handling |
| `src/store/sqlite/sqliteActividadPlanificadaRepository.ts` | Create | Same pattern, 8 columns, no `orden_id` |
| `src/store/sqlite/sqliteDanoRepository.ts` | Create | Same pattern, 14 columns, 0/1 flags |
| `src/store/sqlite/sqliteInspeccionTelaRepository.ts` | Create | Flat checklist + full resolution union, derived state recomputed |
| `src/store/sqlite/sqliteMantenimientoRepository.ts` | Create | Same pattern, 10 columns, no `orden_id`, no `duracion` |
| `src/store/sqlite/recovery.ts` | Modify | Rename to `recoverPersistedState`; 8 repos + 2 scalars; `RecoveryState` 3 → 8 fields; D2e read order |
| `src/main.tsx` | Modify | 8 adapters, drop in-memory paradas/actividades, call `recoverPersistedState`, pass 5 props |
| `src/App.tsx` | Modify | Seed + loaders + 3 new state values + 11 async handlers + Approach A + re-seed helpers |
| `src/ui/ParadasSection.tsx` | Modify | 2 callbacks → `Promise<string[]>`; `async` handlers, `await` |
| `src/ui/ActividadesSection.tsx` | Modify | 2 callbacks → `Promise<string[]>`; `async` handlers, `await` |
| `src/ui/DanoSection.tsx` | Modify | 2 callbacks → `Promise<string[]>`; `async` handlers, `await` |
| `src/ui/MantenimientoSection.tsx` | Modify | 2 callbacks → `Promise<string[]>`; `async` handlers, `await` |
| `src/ui/InspeccionTelaSection.tsx` | Modify | 5 declaration sites (`:68,70,72` + `:85,86`); 3 consumption sites (`:117,131,329`); `async` handlers, `await` |
| `src/ui/OrderInProduction.tsx` | Modify | Re-declares the 2 parada callbacks as `Promise<string[]>` (`:53,55`); forwards to `ParadasSection` at `:182,183` |
| `src/ui/OrderAvailable.tsx` | **Unchanged** | Verified: inherits the section props via `import type` + `extends` (`:23-25`); no callback is re-declared. Must still compile — part of slice G's type check |
| `src/ui/OrderFinished.tsx` | **Unchanged** | Verified: same inheritance (`:5-13`); no callback is re-declared. Must still compile |
| `src/store/paradasRepository.test.ts` | Modify | 6 awaits added; assertions unchanged |
| `src/store/actividadesRepository.test.ts` | Modify | 5 awaits added; assertions unchanged |
| `src/store/danosRepository.test.ts` | Modify | 6 awaits added; assertions unchanged |
| `src/store/inMemoryInspeccionRepository.test.ts` | Modify | 4 awaits added; assertions unchanged |
| `src/store/mantenimientoRepository.test.ts` | Modify | 5 awaits added; assertions unchanged |
| `src/store/sqlite/__tests__/fakeSqliteStore.ts` | Create | Shared FK-enforcing store double (D2b) |
| `src/store/sqlite/__tests__/migration004.test.ts` | Create | SQL contract, modelled on `migration003.test.ts` (569 lines) |
| `src/store/sqlite/__tests__/sqliteParadaRepository.test.ts` | Create | Mapper round trip, JSON + invalid-JSON, duplicate/unknown, ordering, open query |
| `src/store/sqlite/__tests__/sqliteActividadPlanificadaRepository.test.ts` | Create | Same shape for activities |
| `src/store/sqlite/__tests__/sqliteDanoRepository.test.ts` | Create | 0/1 flags, `unidades_sospechadas` null→undefined, per-order filtering |
| `src/store/sqlite/__tests__/sqliteInspeccionTelaRepository.test.ts` | Create | 5-item rebuild, both resolution branches, checklist tuple pinned to the catalogue, derived state |
| `src/store/sqlite/__tests__/sqliteMantenimientoRepository.test.ts` | Create | Update in place, no extra row, no `duracion` |
| `src/store/sqlite/__tests__/recovery.test.ts` | Modify | Rename, 8 fields, orden-before-inspections, absent orden → `[]`, failure not swallowed |
| `src/store/sqlite/__tests__/startup.test.ts` | Modify | Rename, 8 adapters, no in-memory operational wiring, failure screen |
| `src/__tests__/persistence-integration.test.ts` | Modify | Restart survival across all 5 domains + derived values identical; **plus the A1/A1b/A2 D2b triple** |
| `src/App.test.tsx` | Modify | Affected tests get `await act(...)`; new coverage for failure-leaves-state-untouched and Approach A; the file is not rewritten (2062 lines) |
| `src/domain/**` | **Unchanged** | Zero diff — enforced as an acceptance criterion |
| `src/store/sqlite/database.ts` | **Unchanged** | D2d: no unverifiable workaround |
| `openspec/changes/sqlite-persistence-phase-2/proposal.md` | Modify | Retire the D2 and D3 rows of `§Open Decisions`, pointing at this design |

Nothing is deleted.

---

## Interfaces / Contracts

### Ports (all 26 methods, names and semantics unchanged, only delivery becomes async)

```ts
export interface IParadaRepository {
  insertParada(parada: Parada): Promise<void>;
  updateParada(parada: Parada): Promise<void>;
  obtenerPorId(id: string): Promise<Parada | undefined>;
  listarPorMaquina(maquinaId: string): Promise<Parada[]>;
  listarPorOrden(ordenId: string): Promise<Parada[]>;
  getParadaAbierta(maquinaId: string, ordenId: string | null): Promise<ParadaAbierta | null>;
}

export interface IActividadPlanificadaRepository {
  insertActividad(actividad: ActividadPlanificada): Promise<void>;
  updateActividad(actividad: ActividadPlanificada): Promise<void>;
  obtenerPorId(id: string): Promise<ActividadPlanificada | undefined>;
  listarPorMaquina(maquinaId: string): Promise<ActividadPlanificada[]>;
  getActividadAbierta(maquinaId: string, tipo: TipoActividadPlanificada): Promise<ActividadAbierta | null>;
}

export interface IDanoRepository {
  insertDano(dano: Dano): Promise<void>;
  updateDano(dano: Dano): Promise<void>;
  obtenerPorId(id: string): Promise<Dano | undefined>;
  listarPorMaquina(maquinaId: string): Promise<Dano[]>;
  listarPorOrden(ordenId: string): Promise<Dano[]>;
  getDanoAbierto(maquinaId: string): Promise<DanoAbierto | null>;
}

export interface IInspeccionRepository {
  insertInspeccion(inspeccion: InspeccionTela): Promise<void>;
  updateInspeccion(inspeccion: InspeccionTela): Promise<void>;
  obtenerPorId(id: string): Promise<InspeccionTela | undefined>;
  listarPorOrden(ordenId: string): Promise<InspeccionTela[]>;
}

export interface IMantenimientoRepository {
  insertMantenimiento(mantenimiento: Mantenimiento): Promise<void>;
  updateMantenimiento(mantenimiento: Mantenimiento): Promise<void>;
  obtenerPorId(id: string): Promise<Mantenimiento | undefined>;
  listarPorMaquina(maquinaId: string): Promise<Mantenimiento[]>;
  getMantenimientoAbierto(maquinaId: string): Promise<MantenimientoAbierto | null>;
}
```

`obtenerPorId` resolves `undefined` (never `null`); the four `get*Abierta` queries resolve
`null` when there is none. `IInspeccionRepository` gains **no** `listarPorMaquina`.

### Rejection messages — one vocabulary, identical in both adapters

| Case | Message |
|---|---|
| duplicate insert | `ya existe una <entidad> con el id <id>` (verbatim from the in-memory adapter) |
| unknown-id update | `no existe una <entidad> con el id <id>` (verbatim) |
| storage failure | `no se pudo persistir la <entidad> "<id>"` with `{ cause }` |
| invalid JSON / corrupt resolution | descriptive mapping error with `{ cause }` |

### UI callback contract

```ts
onRegistrarParada(input: RegistrarParadaInput): Promise<string[]>;
onCerrarParada(): Promise<string[]>;
onRegistrarActividad(input: RegistrarActividadInput): Promise<string[]>;
onCerrarActividad(tipo: TipoActividadPlanificada): Promise<string[]>;
onRegistrarDano(input: RegistrarDanoInput): Promise<string[]>;
onCerrarDano(fin: string, solucionAplicada: string): Promise<string[]>;
onRegistrarMantenimiento(input: RegistrarMantenimientoInput): Promise<string[]>;
onCerrarMantenimiento(fin: string, queSeRevisoReparo: string): Promise<string[]>;
onRegistrarInspeccion(input: RegistrarInspeccionInput): Promise<string[]>;
onDevolverInspeccion(inspeccionId: string, input: RegistrarDevolucionInput): Promise<string[]>;
onAutorizarInspeccion(inspeccionId: string, input: RegistrarAutorizacionInput): Promise<string[]>;
```

Empty array = success. Non-empty = the errors the operario sees, whether they came from the
domain or from persistence.

### Fake store double

```ts
export interface FakeSqliteStoreOptions { foreignKeys: boolean }
export function createFakeSqliteStore(options?: FakeSqliteStoreOptions): Database & { /* row accessors */ };
```

---

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Unit — ports | The 5 in-memory adapters keep **identical** observable behaviour under async | Existing 5 suites (155/149/176/338/184 lines): add `await`, delete no assertion |
| Unit — mappers | `mapXRow` / `mapXToSql` round trips with **no `Database` in scope** | Per-adapter suite; 5-item checklist tuple pinned to `getItemsChecklist()`; both resolution branches; `unidades_sospechadas` null→`undefined`; invalid JSON with `cause` |
| Unit — SQL contract | 004: exactly 5 tables, 59 columns, 5 FKs, 11 indexes, 4 partial, no `CHECK`/`DEFAULT`, canonical ≡ mirror, 001–003 byte-unchanged, no derived column by name | `migration004.test.ts`, modelled on `migration003.test.ts` (569 lines) |
| Unit — adapters | insert vs update, duplicate/unknown rejection, chronological ordering owned by the repo, per-order exclusion of `null`, open-record queries, error propagation with `cause` | 5 suites over `fakeSqliteStore.ts` |
| Unit — recovery | 8 fields, orden-before-inspections, absent orden → `[]`, full machine history without date filtering, **no** derived value, failure propagates | `recovery.test.ts` extended |
| Unit — startup | 8 adapters constructed once, no in-memory operational wiring, failure → `InicializacionFallida`, `App` never mounts | `startup.test.ts` extended, only the plugin boundary faked |
| Integration | **Restart survival**: record in all 5 domains through the real handlers → fresh adapters over the same store → recover → field-for-field identical; derived values identical before/after; plus the **A1/A1b/A2** triple (D2b) and the `mantenimiento` mirror | `persistence-integration.test.ts` |
| Component (App) | Persistence failure leaves visible state untouched and returns a non-empty list; Approach A yields the domain error; no `Promise` reaches a React child; mount loaders re-read for an injected `hoy` | `App.test.tsx` extended with `await act(...)`; the file is not rewritten |
| E2E | **None** — no Playwright / Cypress / Selenium in this project (`openspec/config.yaml`) | not applicable |
| Guardrails | `npm run test` + `npx tsc --noEmit` in `.`; `cargo check` in `src-tauri` | run per project; no workspace-level command exists |

Every new suite header carries the project's honesty note: the double **models** SQLite
semantics, it does not execute the real engine; migration 004's actual application on the real
Tauri binary (checksum recording, DDL execution) and `PRAGMA foreign_keys` enforcement per
connection remain PENDING runtime validation, exactly as for 001–003.

---

## Threat Matrix

**N/A** — this design changes no routing, no shell command, no subprocess, no VCS/PR automation,
no executable-file classification and no process-integration boundary. The only process boundary
in the change is the existing Tauri SQL plugin call already established by Phase 1, which this
design reuses unchanged; D2d explicitly declines to add new work at that boundary. No
manufactured rows.

---

## Migration / Rollout

- **One migration, applied once**: 004, Up-only (the project registers no `Down`), canonical in
  `src-tauri/migrations/`, mirrored byte-identical for the frontend. 001/002/003 are immutable;
  editing an applied migration fails startup with `VersionMismatch`.
- **No data migration**: the five tables are new and start empty. There is no backfill, because
  the pre-change in-memory data is per-process and is gone by definition — the change cannot
  recover historical events that were never persisted, and it does not pretend to.
- **Feature flag: none, deliberately.** Two adapters for the same port is already the project's
  mechanism (in-memory for tests, SQLite for runtime), selected by which instance `main.tsx`
  injects. A runtime flag would add a state the operario could be in the middle of.
- **Rollout is slice-ordered** — see below. Each slice is independently revertible; no slice
  depends on a later one, and the only ordering constraint is A → (B..F) → G.
- **Rollback**: before 004 is applied, drop the slice — the migration is additive and no existing
  table is altered, so 001–003 stay valid. If 004 is applied and must be undone, the documented
  table-rebuild precedent from ticket 10.9 applies (stop the app, drop the five tables, reset the
  `_sqlx_migrations` bookkeeping for version 4) and **every** operational row is lost. If 004 is
  reverted in code while still applied, the extra tables are inert and the app falls back to
  Phase 1 behaviour, which remains fully functional.

---

## Slice structure for chained delivery

The 400-line review budget **will** be exceeded (~30 source files across 4 layers plus ~15 test
files). This design fixes the **boundaries**; the chain shape (chained vs stacked vs
`size:exception`) is decided in `sdd-tasks` under the `ask-on-risk` strategy. Each slice below is
autonomous: clear start, clear finish, its own verification, its own rollback.

| Slice | Content | Depends on | Verification | Rollback |
|---|---|---|---|---|
| **A** — schema | `004` canonical + mirror, `migrations/index.ts`, `lib.rs`, `migration004.test.ts` | — | `migration004.test.ts`; `cargo check`; mirror byte-equality; 001–003 unchanged | drop the slice; nothing consumed it yet |
| **B** — ports (parada) | `paradasRepository.ts` async, `inMemoryParadasRepository.ts` async, its suite | A | `paradasRepository.test.ts`; `npx tsc --noEmit` | revert; the port is still sync and nothing else moved |
| **C** — ports + adapter (actividad) | `actividadesRepository.ts`, in-memory, `sqliteActividadPlanificadaRepository.ts` + suite | A | its 2 suites | revert both |
| **D** — ports + adapter (daño) | `danosRepository.ts`, in-memory, `sqliteDanoRepository.ts` + suite | A | its 2 suites | revert both |
| **E** — ports + adapter (inspección) | `inspeccionRepository.ts`, in-memory, `sqliteInspeccionTelaRepository.ts` + suite | A | its 2 suites; checklist tuple pinned to the catalogue | revert both |
| **F** — ports + adapter (mantenimiento) | `mantenimientoRepository.ts`, in-memory, `sqliteMantenimientoRepository.ts` + suite | A | its 2 suites | revert both |
| **G** — recovery + wiring + UI | `fakeSqliteStore.ts`, `recovery.ts` rename + 8 fields, `main.tsx`, `App.tsx`, the **6** UI files of D2c, `recovery.test.ts`, `startup.test.ts`, `persistence-integration.test.ts` (restart survival + the A1/A1b/A2 triple), `App.test.tsx` | B, C, D, E, F | full `npm run test`; `npx tsc --noEmit` | revert; falls back to the in-memory wiring, which is the pre-change state |

**Sequencing rationale**: the ports must be async before an adapter can implement them, so each
domain's port + in-memory + SQLite adapter travel together as one slice (B, C, D, E, F) — that
keeps every intermediate state compiling and green, which a "all ports first, then all adapters"
split would not. Slice G is last because it is the only one that depends on all five domains
being async simultaneously, and it is the highest-risk file (`App.tsx`).

**Risk concentration**: slice G holds the review budget problem. It is the slice most likely to
need splitting further, and `sdd-tasks` should consider splitting it into **G1** (recovery +
`main.tsx` + startup/recovery suites — no UI) and **G2** (`App.tsx` + the 6 UI files of D2c +
`App.test.tsx` + the integration suite). The design's D2c/D2g/D2h/D2i decisions make that split
safe: G1 has no UI dependency, and G2's UI work is confined to 6 files whose only change is
`async` + `await`.

---

## Verification record

Every structural claim in this design was checked against the working tree on 2026-09-26 before
being committed here. Claims that did **not** survive that check were corrected in place.

| Claim | Check | Result |
|---|---|---|
| 004 columns use `machine_id` / `operario` | `grep` over the 3 specs + `src-tauri/migrations/001*.sql` | **Confirmed** — 16 `machine_id` and 0 `maquina_id` in the schema spec; 001 declares `machine_id` + `operario` |
| 26 port methods (6/5/6/4/5) | method count per port file | **Confirmed** |
| Phase 1 adapters are singular | `ls src/store/sqlite/` | **Confirmed** — `sqliteOrderRepository.ts`, `sqliteJornadaRepository.ts`, `sqliteLecturaGolpeRepository.ts` |
| `recoverPhase1State` is the current name | `grep` across `src/` | **Confirmed** at `recovery.ts:50`; 3 repos + `fechaOperativa` today |
| The insert pre-check is the established pattern | `sqliteOrderRepository.ts:216-222` | **Confirmed** — `SELECT id FROM orden WHERE id = $1`. Note it is followed by an UPSERT, because `saveOrder` is a single create-or-update method; the operational ports have **separate** insert/update methods, which is why D2j prescribes explicit statements |
| Test doubles match on statement shape and throw on drift | `grep "unsupported"` in the 5 Phase 1 suites | **Confirmed** — `execute: unsupported query in mock: ${query}` |
| Domain lookup types are synchronous | `domain/danos.ts:53`, `domain/types.ts:362` | **Confirmed** — `(id: string) => Parada \| undefined` |
| The two domain error messages | `domain/danos.ts:148`, `domain/mantenimiento.ts:160` | **Confirmed** — `la parada vinculada no existe: …` / `el daño vinculado no existe: …` |
| The FK tension between two approved specs | `repository-contracts` §"An adapter persists a record the domain would have rejected" vs `events-schema` §"A dangling order link is rejected at the storage layer" | **Confirmed** — both exist; D2b's reconciliation is required |
| Render-body repository reads | `App.tsx:583,605,626` | **Confirmed** — `getDanoAbierto`, `getMantenimientoAbierto`, `listarPorOrden` |
| `App.test.tsx` is 2062 lines; `migration003.test.ts` is 569 | `wc -l` | **Confirmed** |
| **8 UI files must be edited** | `grep` for every callback name across `src/ui/**` | **REJECTED → corrected in D2c.** 6 files declare the callbacks. `OrderAvailable` / `OrderFinished` import the section props types and `extends` them, so they need no edit. The `InspeccionTelaSection` consumption lines are `:117,131,329`, not `:131,146,159` |

Not verifiable in this environment, and therefore not claimed: real-runtime application of 004 on
the Tauri binary, and per-connection `PRAGMA foreign_keys` enforcement. Both carry the same honesty
note as migrations 001–003.

---

## Risks and Mitigations

| # | Risk | Design mitigation |
|---|---|---|
| R1 | **Review budget exceeded** (certain) | Slice structure above, 7 autonomous slices, with G1/G2 called out as the likely further split; chain shape deferred to `sdd-tasks` under `ask-on-risk` |
| R2 | **Silent domain-validation bypass** (high) | Approach A (D2 + Data Flow) plus the **A1/A1b/A2** triple, so the guard holds against a re-promised lookup, an always-rejecting fake and a never-rejecting fake |
| R3 | **UI blast radius** (high) | D2c: in-place `Promise<string[]>` on the **6 files that declare** the callbacks, following the Phase 1 precedent already in `OrderInProduction.tsx`; `OrderAvailable` / `OrderFinished` inherit the type and are compile-checked only. The failure mode is loud (a TypeScript error, or a `Promise` reaching a React child), never silent |
| R4 | **`App.test.tsx` is 2062 lines** (medium) | Not rewritten; affected tests get `await act(...)` using the existing pattern at `App.test.tsx:48`; G2 owns it alone |
| R5 | **`PRAGMA foreign_keys` is per-connection** (medium, unverified) | D2d: no unverifiable workaround, no change to `database.ts`; `getForeignKeys()` named as the runtime probe; honesty note in every new suite |
| R6 | **No real-runtime validation** (medium, established) | Suite honesty notes; the FK double is documented as a *model* of the declared schema, never as proof of enforcement |
| R7 | **Resolution-column gap** (low) | Full `ResolucionInspeccion` union mapped in both directions, branch-exclusive columns, corrupt-row mapping errors — §"SQLite adapters" |
| R8 | **Column-naming duality** (low) | **Closed by D1.** `machine_id` / `operario`; specs unchanged; zero renames |
| R9 | **Adapter lifecycle** (low) | Adapters constructed once in `main.tsx`; `useMemo` defaults kept in `App` for tests; a per-render `new Sqlite…(db)` is forbidden by the approved startup requirement |
| R10 | **No date scoping on machine events** (low, by design) | Recovery returns the machine's full history; a future "view a past day" feature adds a predicate to the **ports** |
| R11 | **Two recovery functions vs one** (low) | D2a: one function, one read order, one failure surface; inspections stay inside the composition that owns the `orden` dependency |
| R12 | **`orden_id = $2` null trap in `getParadaAbierta`** (low, easy to get wrong) | Prescribed `orden_id IS $2` in the statement contract, with the three-valued-logic note for `listarPorOrden` |
| R13 | **Stale `danoAbiertoDeMaquina` / `mantenimientoAbiertoDeMaquina`** (low) | D2i: one re-seed helper per domain, invoked by every mutation and by the mount loaders — true by construction, not by review |
| R14 | **Stale state silently hides a failed write** (low) | D2g: persistence failures return a non-empty list before any state mutation; no optimistic UI anywhere |

---

## Open Questions

- [ ] **Runtime verification of `PRAGMA foreign_keys` per connection and of 004's actual
      application on the real Tauri binary** — unavailable in this environment, exactly as for
      001–003. Deferred to `sdd-verify` / a runtime session, with `getForeignKeys()` as the named
      probe. Not a blocker for this design: the approved specs already hedge every FK scenario
      with *"when enforcement is active on the connection"*.
- [ ] **Chain shape for slice G (G1 vs G2, and chained vs stacked vs `size:exception`)** — the
      design fixes the boundaries and the recommendation; the decision belongs to `sdd-tasks`
      under the `ask-on-risk` strategy, which must emit
      `Decision needed before apply: Yes|No`, `Chained PRs recommended: Yes|No` and
      `400-line budget risk: Low|Medium|High`.
- [ ] Nothing else blocks implementation. D1, D2a–D2i and D3 are definitively decided here, so
      `sdd-tasks` does not need to re-open any of them.
