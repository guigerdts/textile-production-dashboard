# Textile Production Dashboard

A production and quality monitoring dashboard for the printing (estampado) area of a textile company. It records and controls the execution of production orders on the facility's single flatbed printing machine.

> Status: active development — SQLite persistence for orders, jornada, golpe readings and all five operational events is in place. Outstanding work is runtime validation of the Tauri SQL transport and connecting the real programming feed (see [Development Status](#development-status)).

## Overview

The printing area operates one flatbed printing machine with a conveyor belt that prints designs onto towels. Production orders arrive from the weekly programming, which is created outside the system; the dashboard records and controls their execution.

The primary user is the printing operator (operario de estampado); management participates by authorizing operational exceptions when applicable. The application tracks the machine's golpe counter, requested vs produced units, first/second quality, stops (paradas), planned activities, fabric inspections, damages (daños), maintenance, and the derived productive-time model of the workday.

## Key Features

- **Production orders** — orders follow `available → in_production → finished`; finishing is explicit and allowed with zero golpes; a finished order rejects new readings.
- **Golpe counter** — cumulative readings: the first reading is mandatory, a higher reading increments produced units, an equal reading warns without adding units, and a lower reading is rejected (no state mutation).
- **Quality tracking** — records first/second quality and the planned second-quality percentage of an order; an alert fires strictly above 3% of 2da for a production; 5% is the monthly reference; "buena racha" reflects the current quality state. Official classification is owned by the finishing area (Acabado); Estampado records suspicions only.
- **Stops (paradas)** — unexpected stops registered with one of 10 predefined causes plus free-text observations; independent from damages; at most one open stop per machine and order; an open stop blocks reading and finishing of that order.
- **Planned activities** — authorized planned time (design change, cleaning, lunch, pause) that deducts from productive time without counting as incidents.
- **Time model** — default workday 07:00–17:00 with overtime; productive time is derived from total available time minus planned outages minus incidents, and is never entered manually.
- **Damages (daños)** — independent events (electrical, mechanical, operational) with affected component, repair duration and applied solution; may be related to a stop and may record suspected 2da units; a damage alone does not deduct productive time.
- **Fabric inspection** — recurrent checklist each time a new fabric lot arrives (absorption, shearing, stains, dimensions, general state); an anomaly leads to a stop, a report, and either devolution or management authorization to use the fabric.
- **Maintenance** — machine-level records, preventive or reactive; a reactive record may reference the damage that caused it; maintenance is documentary and never deducts productive time.
- **Persistence** — SQLite source of truth with numbered migrations 001–005; startup restores the eight persisted sources for the operative day and never mounts with partial state.
- **Operative day and historical navigation** — the operative day is an explicit field on the events that require it; the operator can move between days, a historical day is read-only, and today behaves exactly as it did before.

## Domain

The domain model follows the vocabulary of the printing area. The project keeps a living glossary in [`CONTEXT.md`](CONTEXT.md); the core terms:

| Term | Meaning |
| --- | --- |
| Orden de producción | An instruction to print a design onto a fabric reference in a requested quantity; arrives from the weekly programming, created outside the system. |
| Diseño | The print design applied to the towel, paired with a fabric reference to define an order. |
| Máquina de estampado | The single flatbed printing machine (M1) with conveyor belt, 7 numbered carros (1–7) and a drying oven; 1 golpe prints 3 towels. |
| Golpe | One press cycle of the flatbed table; the machine counts golpes automatically — nothing else is automatic. |
| Carro | One of the 7 numbered printing units on the table that carries and moves the cuadro. |
| Cuadro | The frame/screen that carries the print design and applies the ink to the fabric. |
| Tela | The raw fabric consumed by an order; a material with its own lot-level inspection. |
| Unidades | The count of finished towels: solicitadas (requested), producidas (produced), primera, segunda. |
| Pintura reactiva | Reactive ink: requires an initial oven drying during printing plus a later, separate termofijado pass. |
| Pintura pigmento | Pigment ink: single drying pass through the oven; machine speed controls drying (reference ~16 s per golpe). |
| Segunda (2da) | Towels that fail quality; the operational alert fires above 3% and the monthly target keeps 2da below 5%. Official classification is owned by Acabado. |

## Architecture

The application is a React (TypeScript) single-page application running inside a Tauri shell. The design is layered: a pure, synchronous domain layer; repository contracts with in-memory and SQLite adapters; and an asynchronous persistence/UI boundary. The composition root in `src/main.tsx` boots SQLite, materializes the weekly programming, recovers the persisted state, and renders the app only with fully resolved state.

```
┌───────────────────────────────────────────────────────────┐
│ Tauri shell (WebView)                                     │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ UI layer (src/ui) — React components               │  │
│  └─────────────────────────┬───────────────────────────┘  │
│                            │                             │
│  ┌─────────────────────────▼───────────────────────────┐  │
│  │ Store layer (src/store)                            │  │
│  │ Repository contracts (domain-facing)               │  │
│  │ ├─ In-memory adapters (tests / not yet persisted)  │  │
│  │ └─ SQLite adapters (tauri-plugin-sql)              │  │
│  └─────────────────────────┬───────────────────────────┘  │
│                            │                             │
│  ┌─────────────────────────▼───────────────────────────┐  │
│  │ Domain layer (src/domain) — pure and synchronous   │  │
│  │ state machines, rules, calculations, time model    │  │
│  └─────────────────────────────────────────────────────┘  │
└────────────────────────────┬──────────────────────────────┘
                             │ async SQL (tauri-plugin-sql)
                     ┌───────▼────────┐
                     │ SQLite database │
                     │ (estampado.db)   │
                     └──────────────────┘
```

Guiding principles:

- The domain layer is **pure and synchronous**: business rules, projections, and the time model live there and are unit-tested without mocks.
- Persistence and the UI are **asynchronous**; the domain never issues SQL.
- Derived values (golpe deltas, progress, productive time) are **never persisted** — they are recomputed by the domain layer.
- The database starts **empty** on first run (no seeds); the weekly programming feed is materialized idempotently on startup (currently from fixtures, designed for the future external source).

## Technology Stack

| Layer | Technology | Version |
| --- | --- | --- |
| Desktop shell | Tauri (Rust) | 2.x |
| Frontend | React | ^19.1.0 |
| Language | TypeScript | ~6.0.3 |
| Build tool | Vite | ^8.0.16 |
| Testing | Vitest · jsdom · Testing Library | ^5.0.0 · ^30.0.1 · 16.x / 10.x / 14.x |
| Persistence | SQLite via `tauri-plugin-sql` (`@tauri-apps/plugin-sql`) | ^2.4.1 |
| Rust crates | tauri · tauri-plugin-sql (sqlite) · tauri-plugin-opener · serde / serde_json | 2.x · 2.4.1 · 2.x · 1.x |

Versions as declared in `package.json` and `src-tauri/Cargo.toml`.

## Project Structure

```
src/
├── domain/              # Pure sync domain: rules, state machines, time model (+ unit tests)
│   ├── types.ts
│   ├── calculations.ts  # golpe deltas, progress, projections
│   ├── calidad.ts       # 2da alerts, buena racha
│   ├── paradas.ts · actividades.ts · tiempo.ts
│   ├── danos.ts · inspeccionTela.ts · mantenimiento.ts
├── store/               # Repository contracts + adapters
│   ├── inMemory*.ts     # In-memory adapters (tests / not yet persisted)
│   ├── sqlite/          # SQLite adapters, migrations, materialize, recovery
│   └── fixtures.ts      # Programmatic fixtures (operative-day programming)
├── ui/                  # React components (one section per area)
└── App.tsx · main.tsx   # Composition root
src-tauri/
├── src/lib.rs           # Tauri setup + SQLite migration registry
├── migrations/          # Numbered SQL migrations (001–005)
└── tauri.conf.json
docs/adr/                # Architecture Decision Records (0001–0007)
openspec/                # SDD change artifacts (specs, design, tasks)
```

## Getting Started

Prerequisites: Node.js with npm; for the desktop app, the Rust toolchain and Tauri system dependencies.

```bash
npm install          # install dependencies
npm run dev          # Vite dev server (port 1420, strict)
npm run tauri dev    # desktop app in development (requires Rust toolchain)
npm run build        # typecheck + production build (tsc && vite build)
npm run preview      # preview the production build
npm run tauri build  # desktop app bundle (requires Rust toolchain)
```

`npm run tauri dev` and `npm run tauri build` were not executed in the environment used to prepare this README (no Rust/Cargo toolchain available there). This is a verification limitation of that environment, not an indication that the scripts are broken — they correspond to the project's defined scripts.

The dashboard expects to start against an empty database: the startup sequence materializes the operative-day programming (fixtures), recovers persisted state, and renders the app. If initialization fails, the app shows an explicit error screen and never mounts with partial data.
## From zero

### 1. Prerequisites

- **Frontend/tests (development)**: Node.js with npm. Versions validated in this environment: Node v22.23.3 / npm 10.9.9. Check against `package.json` for any constraints.
- **Tauri desktop development**: Rust toolchain (`rustc`/`cargo`) and Tauri system dependencies. Validated in this environment: rustc 1.98.1 / cargo 1.98.1 / tauri-cli 2.11.4. Install per platform as per Tauri docs; Tauri 2.x.
- **Desktop build/distribution**: Same as Tauri desktop development.

### 2. Clone and install

```bash
git clone https://github.com/guigerdts/textile-production-dashboard
cd textile-production-dashboard
npm install
```

### 3. Run the project

- `npm run dev` — Frontend only (Vite dev server). Opens at `http://localhost:1420`. Use for UI/component iteration without spawning the Tauri shell.
- `npm run tauri dev` — Full Tauri desktop application in development. Requires Rust toolchain and Tauri system dependencies. Use this to test the complete desktop app.

### 4. First startup

On first run with an empty database:
1. `initDatabase()` — sets up SQLite infrastructure and applies migrations 001–005 (registered in `src-tauri/src/lib.rs`).
2. Create/initialize the eight SQLite repositories (orders, jornada, golpe readings, stops, planned activities, damages, inspections, maintenance).
3. `materializarPrograma(...)` — idempotent materialization of the programming feed using **programmatic fixtures** (current implementation). No external weekly programming source is connected yet.
4. `recoverPersistedState(...)` — recovers the eight persisted sources for the operative day.
5. React app mounts **only** when all of the above resolve successfully. If initialization fails, an explicit error screen is shown and the app never mounts with partial state.

Notes: `inspeccion_tela` does not carry `fecha_operativa` (derived via its order). `fecha_operativa` is explicit for `parada`, `actividad_planificada`, `dano` and `mantenimiento`.

### 5. What to expect in the application

- **Programming**: Operative-day programming materialized from fixtures.
- **Orders**: Available → in_production → finished; finishing allowed with zero golpes; finished orders reject new readings.
- **Workday/jornada**: Tracks workday boundaries and state.
- **Golpe readings**: First reading mandatory; higher increments produced units; equal warns; lower rejected.
- **Production/quality**: Tracks produced units, first/second quality; operational alert above 3% 2da (monthly < 5%). Official 2da classification belongs to Acabado; Estampado records suspicions only.
- **Stops (paradas)** and **Planned activities (actividades planificadas)**: Separate concepts; stops are incidents, planned activities deduct from productive time without counting as incidents.
- **Damages (daños), fabric inspections (inspección de tela), maintenance (mantenimiento)**: Full tracking per domain rules.
- **Day navigation / historical**: Operator can navigate between days. A historical day is **read-only**; today behaves normally. Open damage/maintenance banners are scoped to the selected day.

### 6. Test and verify

```bash
npm test            # Run all tests (vitest run)
npm run test:watch  # Watch mode
npx tsc --noEmit    # TypeScript typecheck
```

For resource-constrained environments (few CPU cores), prefer serial mode:
```bash
npx vitest run --pool=threads --maxWorkers=1
```

Recommended verification after clone: install deps → typecheck → run tests.

### 7. Desktop build

```bash
npm run tauri build
```

Prerequisites: Rust toolchain + Tauri system dependencies. Successful generation means the bundle artifacts were produced; platform-specific validation is not assumed by this repo. The `npm run tauri dev`/`tauri build` paths use `tauri-cli` (validated: 2.11.4).

### 8. SQLite / reset during development

- **Location**: `sqlite:estampado.db` is resolved by `tauri-plugin-sql` (Tauri) depending on the OS/app data directory. The repository does **not** hardcode a physical filesystem path for the dev database.
- **Initialization**: Migrations 001–005 run on startup via `initDatabase()` (registered in `src-tauri/src/lib.rs`). The app starts empty; programming is materialized from fixtures.
- **Clean reset**: To return to a clean state, delete the `estampado.db` file from the app's data directory **for your platform**. The exact path is OS/Tauri-specific and not determined by the repo — consult your platform's Tauri app data location. Do not run destructive global commands unless you know the target path.
- **Note on tests**: SQLite adapter parity uses `node:sqlite` (real SQLite engine) with real migrations — this validates adapters, **not** the Tauri SQL transport/runtime.

### 9. Troubleshooting mínimo

- **Port 1420**: `npm run dev` uses http://localhost:1420 (strict). Ensure it's free.
- **Rust/Tauri**: If `npm run tauri dev`/`build` fail, verify `rustc --version`, `cargo --version`, and platform Tauri deps.
- **Node/npm**: Use compatible Node (v22.x tested). If `npm install` fails, clear cache and retry.
- **Tests timeout on few cores**: Use `--maxWorkers=1` as above.
- **Empty DB / migrations**: If startup fails, check DB state — migration 005 is NOT NULL with no backfill; existing non-empty DBs may need clean reset as above.
- **dev vs tauri dev**: `npm run dev` is frontend-only; `npm run tauri dev` is the full desktop app.

### 10. Development workflow

1. Read `CONTEXT.md` (domain vocabulary and rules).
2. Review ADRs in `docs/adr/`.
3. Review specs in `openspec/` before changing behavior.
4. Implement changes.
5. Run tests, typecheck, and build as applicable.
6. Keep specs in sync with implementation.


## Testing

The suite runs with Vitest:

```bash
npm test            # single run (vitest run)
npm run test:watch  # watch mode
npx tsc --noEmit    # typecheck
```

- **Domain tests** — the pure business rules (golpe state machine, 2da projections, time model, stop/activity rules) are unit-tested directly.
- **Store tests** — repository contracts are tested through in-memory adapters; the SQLite adapters are exercised against a fake with the same shape as `Database` from `@tauri-apps/plugin-sql`, plus a persistence integration test over a fake persistent store.
- **SQLite adapter parity** — a second harness runs the real, unmodified SQLite adapter classes against a real SQLite engine carrying the real migrations 001–005, injecting only the database handle; the adapters' own SQL and mappers are never re-implemented. That engine is `node:sqlite`, **not** the Tauri plugin, so a passing parity run is evidence about the adapters and is not runtime validation of the production transport (see [Known Limitations](#known-limitations--technical-debt)).
- **UI tests** — components are tested with Testing Library + jsdom.

On machines with few CPU cores, the full suite runs reliably in serial mode:

```bash
npx vitest run --pool=threads --maxWorkers=1
```

A few UI tests are timeout-sensitive on machines with limited resources or cores; this is a consideration of the current test environment, not a product feature or defect. The serial run above is the mitigation currently used.

## Persistence

SQLite is the source of truth (`sqlite:estampado.db`, resolved by the Tauri plugin). Schema evolution is applied through numbered migrations registered in `src-tauri/src/lib.rs`:

| Migration | Purpose |
| --- | --- |
| 001 — initial schema | `jornada`, `orden`, `lectura_golpe` tables |
| 002 — unique order sequence | unique constraint for the order/golpe sequence |
| 003 — order persistence | Phase-1 order persistence support |
| 004 — operational events | `parada`, `actividad_planificada`, `dano`, `inspeccion_tela`, `mantenimiento` tables |
| 005 — operative date on events | `fecha_operativa` on `parada`, `actividad_planificada`, `dano` and `mantenimiento`, plus day-scoped indexes. `inspeccion_tela` intentionally keeps deriving its day from its order |

Startup order (`src/main.tsx`): `initDatabase()` → the eight SQLite repositories (orders, jornada, golpe readings, stops, planned activities, damages, inspections, maintenance) → idempotent materialization of the programming feed → `recoverPersistedState()` (reconstructs the persisted sources for the operative day; derived state is computed afterwards by the domain layer).

Current coverage: all eight sources — orders, jornada, golpe readings and the five operational events (stops, planned activities, damages, inspections, maintenance) — are wired through SQLite adapters at startup. Derived state is computed by the domain layer and is not persisted.

## Operative Day & Historical Navigation

Every record belongs to an **operative day** — the shift it was worked — which is a distinct concept from the calendar instant an event was written.

- **The operative date belongs explicitly to the events that require it.** `parada`, `actividad_planificada`, `dano` and `mantenimiento` each carry a `fecha_operativa` column (migration 005). `inspeccion_tela` deliberately does not: an inspection is always an event of an order and reaches its day through that order. Orders, jornada and golpe readings were already day-bound.
- **`fecha_operativa` is the only determinant of the day** and is never derived from the start instant. Start times remain real instants, so an event registered on the night of the 11th keeps the 11th even if it closes on the 12th. An event belongs to exactly one day.
- **Navigation** — the operator can move between days (`desplazarDia`), and the default shift is derived from an operative date (`jornadaDefault`).
- **A historical day is read-only.** The application derives `soloLectura` once, from whether the selected day differs from today, propagates it to the sections to gate their write controls, and rejects registrations before they reach a repository. Today behaves exactly as it did before: selecting the current day is the only difference.
- **Records belong to their own day.** Open damage and open maintenance are resolved from the events of the selected day, so a historical day shows the state that day actually had and never the state still open today. A historical day with no open records of its own shows no banner — the record is still open today, it simply is not this day's record.

## Development Status

**Implemented**

- Complete domain layer for orders/golpes, stops, planned activities, time model, damages, fabric inspection, maintenance and quality, all unit-tested.
- Full dashboard UI sections: order states, golpe entry, stops, planned activities, time summary, quality, damages, inspection, maintenance.
- SQLite persistence: schema migrations 001–005; startup materialization + recovery; all eight repositories (orders, jornada, readings and the five operational events) are wired at startup.
- Operative day and historical navigation: an explicit operative date on the events that need one, day navigation, and read-only historical days (see [Operative Day & Historical Navigation](#operative-day--historical-navigation)).

**In progress**

- Persistence rollout for operational events is complete: the SDD change `sqlite-persistence-phase-2` finished all 63 of its tasks and is archived under `openspec/changes/archive/`.
- `operational-event-operative-date` and `historical-day-navigation` are implemented and on `main`, but their SDD artifacts are not yet archived under `openspec/changes/`. `historical-day-navigation` still carries open gates G.3 (`cargo check` in `src-tauri`) and R5/R6 (Tauri runtime validation), which are unverified in the environment used to write this README.

**Planned**

- Official second-quality classification feed from Acabado (interface not yet defined).
- Replace the fixture-based programming feed with the real external weekly programming source.

## Architecture Decisions

Significant decisions are recorded in [`docs/adr/`](docs/adr/):

| ADR | Decision |
| --- | --- |
| 0001 | Production orders arrive from external weekly programming; no order creation is built in. |
| 0002 | Official 2da classification is owned by Acabado; Estampado records suspicions only. |
| 0003 | Single-machine scope; the machine is always M1. |
| 0004 | Productive time is derived, never entered manually. |
| 0005 | Planned activities are distinct from stops (paradas). |
| 0006 | Maintenance is recorded per machine, never per paint chemistry. |
| 0007 | Maintenance is documentary and never deducts productive time. |

## Known Limitations & Technical Debt

- **Tauri SQL transport unvalidated** — the SQLite adapters are exercised in tests against a real SQLite engine through `node:sqlite`, but the production path speaks `@tauri-apps/plugin-sql`. That the plugin enforces the same predicates over its own transport has not been verified here; gates R5/R6 and the `cargo check` gate G.3 remain open. No claim in this repository treats SQLite as runtime-validated.
- **Rebuild on schema change** — migration 005 adds a `NOT NULL` column with no default and no backfill, so applying it to a database that already holds machine events fails loudly by design rather than inventing an operative day. Such a database must be rebuilt from a fresh schema, which the app does when its store is empty.
- **Single-machine scope** — the dashboard models exactly one flatbed machine (M1) by design (ADR 0003).
- **No official 2da feed** — Estampado records suspicions; the mechanism by which Acabado's official data reaches the dashboard is not yet defined (ADR 0002).
- **Fixture programming feed** — the weekly programming is currently materialized from fixtures until the external source is connected.
- **Domain glossary** — `CONTEXT.md` holds the full domain vocabulary; keep it in sync whenever the model changes.

## Contributing

The project is developed with Spec-Driven Development (SDD): changes are planned in `openspec/` and implemented through specs, design and tasks before code. Before touching domain behavior, read `CONTEXT.md` (domain vocabulary and rules) and the decisions in `docs/adr/`. Run the test suite before finishing a change.

## License

No license has been defined yet. A license must be chosen before public distribution.

## Repository

Source: <https://github.com/guigerdts/textile-production-dashboard>
