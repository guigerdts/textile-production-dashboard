# Design: Historical day navigation (CHANGE 2)

**Change:** `historical-day-navigation`
**Status:** Designed. No implementation in this change.
**Precondition:** `operational-event-operative-date` (CHANGE 1) is implemented in `851172c`: `fechaOperativa` is a required, persisted field on `Parada`, `ActividadPlanificada`, `Dano` and `Mantenimiento`, and migration 005 is applied.

---

## 1. Design decisions

| # | Decision | Rationale |
|---|---|---|
| DD1 | A **new** method `listarPorMaquinaYFecha(maquinaId, fechaOperativa)` on exactly four ports | The spec leaves the shape open. A separate name makes the day a compile-time-required input (a day-free call cannot reach the day-scoped read) and keeps one name = one meaning. Adding the day to the existing `listarPorMaquina` would give one name two meanings — "full history" and "one day" — and every existing caller would silently change behaviour |
| DD2 | `listarPorMaquina(maquinaId)` **survives, unchanged and complete** | The spec permits it and requires it to stay full-history. Its per-adapter assertions are existing coverage; deleting the method would delete assertions to make the new predicate pass. It becomes the seam for a future full-history view |
| DD3 | The day predicate is applied **in the adapter**, never by the caller filtering | The spec forbids the day-scoped read from being built on the day-free read. Both families filter in origin, so a caller cannot forget |
| DD4 | The composition root (`main.tsx`) owns the selected day, exactly as it already owns recovery | Recovery is the single composer of the eight sources. If `App` owned the day it would have to re-run that orchestration, duplicating it and breaking the existing contract *"App NUNCA recibe promesas ni calcula recovery"* (`App.tsx:96`) |
| DD5 | A day change is applied as **one atomic state pair plus a React `key`** on `App` | `{ fechaOperativa, estadoInicial }` is a single `useState` value, so there is no window where the day and the data disagree. `key={fechaOperativa}` unmounts `App`, wiping all ten `useState` values — the only way to guarantee *"The UI state never holds another day's rows"* without hand-clearing ten setters and hoping |
| DD6 | `App`'s four mount loaders and four `recargar*()` helpers gain the day in both the call **and** the dependency array | Found during investigation: `cargarParadas`, `cargarActividades`, `cargarDanos` and `cargarMantenimientos` (`App.tsx:203-278`) depend on the repository only, **not** on `hoy`. Day-scoping recovery alone would leave those loaders re-reading full history and overwriting the day-scoped seed. This is the stale path the spec calls out |
| DD7 | `soloLectura = hoy !== hoyReal` — comparing the **selected day** against the **injected** read-only reference — defined **once** in `App` and consumed everywhere else as a prop; enforced in **UI reachability and in every handler** | A prop alone is bypassable by one stale render, and the spec requires *"A read-only day can never produce a write"*. Two layers: the control is not reachable, and the handler refuses. Comparing against the injected prop (not against a fresh clock read) is what keeps the 44 fixture-injected test mounts writable — see §5.3 and §5.4 |
| DD7a | The read-only gate and the `finished` gate are carried by **two different prop names**, `soloLectura` and `permitirRegistrar`, and are never merged into one value | `App`'s call sites are flat JSX spreads (`App.tsx:897-939`) where *later wins*. One name cannot carry two different gates through them: whichever gate is written last silences the other (§6.1) |
 | DD8 | Open-record lookups (`getDanoAbierto`, `getMantenimientoAbierto`, `getParadaAbierta`, `getActividadAbierta`) **stay day-free**, and on a historical day the open-record state is derived from the day's own list with the existing pure functions | An open record legitimately spans days (a `Dano` opened on the 11th, closed on the 12th). Making those lookups day-scoped would hide a genuinely open record from **today's** dashboard — a violation of *"today behaves exactly as today"*. The same argument runs in reverse for the four places `App` derives open state by filtering a *list*, which day-scoping narrows: §6.3 and §6.4 |
| DD9 | Navigation is a native `<input type="date">` with `max`, plus two native `<button type="button">` (previous / next day), in the app header | Native input brings keyboard support, locale formatting and accessibility without a custom widget to test. `max` blocks future days; disabling "next" at today makes the one-day limit structural — no range can be entered |
| DD10 | **One** shared contract factory runs the day-scoped listing cases against **both** adapter families; the SQLite side runs on a real engine via `node:sqlite` with migrations 001–005 | The spec requires parity proved on a real connection, not only the modelled double. Verified empirically in this session — see §8 |
| DD11 | No migration, no `src/domain/**` diff, no change to `IInspeccionRepository` / `ILecturaGolpeRepository` | The schema already carries `fecha_operativa` with one index per table over `(machine_id, fecha_operativa)`; the order-reached ports are day-scoped transitively through `Orden.fechaOperativa` |
| DD12 | `App`'s `hoy` prop is **kept** (not renamed) and its JSDoc updated to "selected operational day" | Renaming touches ~40 call sites in `App.test.tsx` for zero behavioural gain. The prop already means the operative day; only its JSDoc says "today" |

---

## 2. Port contracts

Four ports gain one method. `fechaOperativa` is a **required positional parameter** in all four — a call that omits it does not type-check (DD1).

```ts
// src/store/paradasRepository.ts — IParadaRepository
listarPorMaquina(maquinaId: string): Promise<Parada[]>;                       // unchanged, full history
listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Parada[]>;

// src/store/actividadesRepository.ts — IActividadPlanificadaRepository
listarPorMaquina(maquinaId: string): Promise<ActividadPlanificada[]>;
listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<ActividadPlanificada[]>;

// src/store/danosRepository.ts — IDanoRepository
listarPorMaquina(maquinaId: string): Promise<Dano[]>;
listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Dano[]>;

// src/store/mantenimientoRepository.ts — IMantenimientoRepository
listarPorMaquina(maquinaId: string): Promise<Mantenimiento[]>;
listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Mantenimiento[]>;
```

Unchanged by this change, and explicitly **not** given a day predicate (spec: *"No fifth operational port may gain one"*):

- `IInspeccionRepository` — order-reached only (`listarPorOrden`).
- `ILecturaGolpeRepository` — order-reached only (`getLecturasByOrden`).
- `IOrderRepository.getOrderByFechaOperativa` — already day-scoped (001, `idx_orden_fecha`).
- `IJornadaRepository.obtenerParaFecha` — already day-scoped.
- The four `get*Abierta` machine-level lookups — see DD8.

Every day-scoped read of `paradas`, `actividades`, `danos` and `mantenimientos` goes through `listarPorMaquinaYFecha`. After this change there is **no production caller** of `listarPorMaquina`. Its survivors are all test code:

- the per-adapter suites — `src/store/{paradas,actividades,danos,mantenimiento}Repository.test.ts` (in-memory family) and `src/store/sqlite/__tests__/sqlite*Repository.test.ts` (SQLite family) — which assert full history and must keep asserting it (DD2);
- `recovery.test.ts`'s `I4` full-history case (`src/store/sqlite/__tests__/recovery.test.ts:654-689`), re-pointed by this change (§10.2);
- `App.test.tsx`'s **direct repository reads**, used to assert that a write really landed in the store — `App.test.tsx:947`, `:1087`, `:1799`, `:2215`, `:2258`, … These are read-side assertions about *today's* writes, not day-scoped UI reads, so they stay day-free.

No fixtures suite calls it: `src/store/fixtures.ts` and the `*Fixtures.ts` modules only *build* records, they never list them.

---

## 3. Adapter implementations

Both families keep their established idiom: the family owns the ordering, the caller never re-sorts.

### 3.1 In-memory

Follows the exact shape already used at `inMemoryParadasRepository.ts:46-51`:

```ts
async listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Parada[]> {
  return [...this.porId.values()]
    .filter((p) => p.maquinaId === maquinaId && p.fechaOperativa === fechaOperativa)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .map((p) => structuredClone(p));
}
```

- Predicate: `p.fechaOperativa === fechaOperativa` — the exact attributed day (DD3).
- Ordering: `a.inicio.localeCompare(b.inicio)`, matching the day-free method's order.
- Defensive copies preserved (`structuredClone`), so a caller cannot mutate the store.
- Empty day → `[]`, never an error.

**Ordering caveat, carried over unchanged:** `inicio.localeCompare` is not a total order when two records of the *same* day share an `inicio`. The day-free listing has the same property today; this change adds no determinism claim and removes none.

### 3.2 SQLite

One added `WHERE` conjunct, no other change to the SQL:

```ts
async listarPorMaquinaYFecha(maquinaId: string, fechaOperativa: string): Promise<Parada[]> {
  const rows = await this.db.select<ParadaRow[]>(
    "SELECT * FROM parada WHERE machine_id = $1 AND fecha_operativa = $2 ORDER BY inicio ASC",
    [maquinaId, fechaOperativa]
  );
  return rows.map(mapParadaRow);
}
```

- The predicate reads the **existing** `fecha_operativa` column. No new column, no new index, no schema change (DD11).
- `ORDER BY inicio ASC` is preserved, so the day-scoped result is ordered exactly as the full-history result was.
- The mapper is reused unchanged — row → entity mapping is identical, only the row set narrows.

### 3.3 The index already serves this predicate

Migration 005 (`src-tauri/migrations/005_event_fecha_operativa.sql:36-39`) declared one index per machine-event table, precisely so this change would need no migration:

| Table | Index | Columns |
|---|---|---|
| `parada` | `idx_parada_maquina_fecha` | `(machine_id, fecha_operativa)` |
| `actividad_planificada` | `idx_actividad_maquina_fecha` | `(machine_id, fecha_operativa)` |
| `dano` | `idx_dano_maquina_fecha` | `(machine_id, fecha_operativa)` |
| `mantenimiento` | `idx_mantenimiento_maquina_fecha` | `(machine_id, fecha_operativa)` |

Column order matches the predicate order (`machine_id` equality, then `fecha_operativa` equality), so the whole `WHERE` is index-covered. **Verified in this session** against a real SQLite engine with migrations 001–005 applied:

```
EXPLAIN QUERY PLAN SELECT * FROM parada WHERE machine_id = ? AND fecha_operativa = ?
→ SEARCH parada USING INDEX idx_parada_maquina_fecha (machine_id=? AND fecha_operativa=?)
```

The superseded `(machine_id, inicio)` indexes from migration 004 (`:114-117`) remain and are not narrowed — they still serve `get*Abierta` and any `inicio`-range query.

---

## 4. Recovery becomes day-scoped

`recoverPersistedState` already receives `fechaOperativa` as its ninth parameter (`recovery.ts:108`) and already uses it for `jornada` and `orden`. Today it ignores it for the four machine-event lists — and says so in two places inside its own file. Three comments must move with the code:

- `recovery.ts:30-32` (the file header) — *"The four machine-event lists carry the machine's FULL history: recovery applies NO date predicate (a future 'read a past day' feature adds it to the ports, never to recovery)."* — **contradicted outright**, and the parenthetical is now actively misleading: this IS the "read a past day" feature and it does go to the ports. Rewritten to state that the four lists are scoped to the requested day.
- `recovery.ts:51-52` — *"No new columns, no new repository methods; `IOrderRepository` never queries `lectura_golpe`."* — the first clause becomes false (four ports gain a method), the second stays true. Reworded so the claim is scoped: no new **columns**, and `IOrderRepository` still gains nothing; the four machine-event ports gain `listarPorMaquinaYFecha`.
- `recovery.ts:126-127` (inline, above the parada read) — *"…máquina, SIN predicado de fecha (D2e)…"* — the third place the old contract is written down, and the one a reader actually sees next to the call. Rewritten to *"…máquina, acotada a `fechaOperativa` (D2e)…"*.
- `recovery.ts:86-89` (the `RecoveryState` field comments) — each names the method it comes from (`// vía IParadaRepository.listarPorMaquina (historial completo)` and the three plain `…listarPorMaquina`), so all four rename and `paradas`'s *"(historial completo)"* goes with them. The fields' types and the interface's shape do not change.

One stale comment survives in `startup.test.ts:531` (*"…se recuperan (historial completo de la máquina, vacío en día vacío)"*): the assertions around it still hold — an empty day yields `[]` either way — but the comment no longer describes the read, so it is reworded in §10.2 rather than left to mislead the next reader.

The four production call sites are `recovery.ts:129`, `:131`, `:133` and `:135-137`:

```diff
-const paradas = await paradaRepository.listarPorMaquina(maquinaId);
+const paradas = await paradaRepository.listarPorMaquinaYFecha(maquinaId, fechaOperativa);

-const actividades = await actividadRepository.listarPorMaquina(maquinaId);
+const actividades = await actividadRepository.listarPorMaquinaYFecha(maquinaId, fechaOperativa);

-const danos = await danoRepository.listarPorMaquina(maquinaId);
+const danos = await danoRepository.listarPorMaquinaYFecha(maquinaId, fechaOperativa);

-const mantenimientos = await mantenimientoRepository.listarPorMaquina(maquinaId);
+const mantenimientos = await mantenimientoRepository.listarPorMaquinaYFecha(maquinaId, fechaOperativa);
```

Everything else in recovery is deliberately untouched:

- **Read order** stays sequential and fixed (D2e): jornada → orden → lecturas → paradas → actividades → daños → mantenimientos → inspecciones. No `Promise.all`.
- **Failure propagation** unchanged: a read failure propagates **out of `recoverPersistedState`**, never downgraded to an empty list. Recovery gains no `catch`. What *is* new is the second caller — `Raiz.seleccionarDia` — and its visible failure behaviour is specified in §5.2: it catches, reports, and leaves the previous day on screen. It must never let the rejection escape as an unhandled promise rejection, and it must never advance the selection on a failed read.
- **Sources only**: no derived value is computed in recovery. `progreso`, the time summary, machine state, projected 2da, the alert and inspection `estado` are recomputed by the existing pure domain functions over whatever source set the selected day produced.
- **The one declared dependency on `orden`** is unchanged: lecturas and inspecciones stay guarded by it.
- **`IInspeccionRepository` still receives no day** — inspections are reached through `orden.id` (`recovery.ts:141-143`).

---

## 5. Composition root and selected-day ownership

### 5.1 Why the composition root

`main.tsx` already owns the two things a day change needs: the repository instances and `recoverPersistedState`. It only lacks the ability to re-run them on demand. Extracting its render step into a component is the smallest change that adds that ability without duplicating orchestration (DD4).

`main()` keeps steps 1–4 exactly as they are — `initDatabase` → eight repositories → `materializarPrograma` → `recoverPersistedState(..., fechaOperativaHoy(), "M1")` — inside the same `try`, with the same `InicializacionFallida` fallback. Only step 5 changes: instead of `createRoot().render(<App …/>)` with a resolved state, it renders `<Raiz …/>`, which owns the day from then on.

### 5.2 `Raiz` — a new module, not a local function

`Raiz` lives in its own file, `src/Raiz.tsx`, and is **exported**. It cannot live inside `main.tsx`: that module calls `void main()` at import time (`main.tsx:126`), so a test importing `Raiz` from it would re-run the whole startup. Exporting it is also what lets `startup.test.ts` assert on it by name.

```tsx
// src/Raiz.tsx (new)
export interface LosOchoRepositorios {
  repository: IOrderRepository;
  jornadaRepository: IJornadaRepository;
  lecturaRepository: ILecturaGolpeRepository;
  paradaRepository: IParadaRepository;
  actividadRepository: IActividadPlanificadaRepository;
  danoRepository: IDanoRepository;
  mantenimientoRepository: IMantenimientoRepository;
  inspeccionRepository: IInspeccionRepository;
}

export interface RaizProps {
  repos: LosOchoRepositorios;              // built once in main()
  estadoInicial: RecoveryState;            // today's recovery, already resolved
  fechaOperativaInicial: string;           // fechaOperativaHoy() at startup
}

export function Raiz({ repos, estadoInicial, fechaOperativaInicial }: RaizProps) {
  // ONE state value: the day and the data for that day can never disagree.
  const [vista, setVista] = useState<{ fechaOperativa: string; estado: RecoveryState }>(
    () => ({ fechaOperativa: fechaOperativaInicial, estado: estadoInicial }),
  );
  const [cargando, setCargando] = useState(false);
  const [errorDia, setErrorDia] = useState<string | null>(null);

  async function seleccionarDia(fechaOperativa: string): Promise<void> {
    if (fechaOperativa === vista.fechaOperativa || cargando) return;
    setCargando(true);
    setErrorDia(null);
    try {
      const estado = await recoverPersistedState(
        repos.jornadaRepository, repos.repository, repos.lecturaRepository,
        repos.paradaRepository, repos.actividadRepository, repos.danoRepository,
        repos.mantenimientoRepository, repos.inspeccionRepository,
        fechaOperativa,                      // the day asked for
        "M1",                                // ADR 0003, explicit as main() passes it today
      );
      // Atomic: the day and its data flip together, only after recovery resolved.
      setVista({ fechaOperativa, estado });
    } catch (error) {
      // VISIBLE FAILURE (§4): the rejection is caught here, never left to escape
      // as an unhandled rejection, and `vista` is NOT updated — the operario keeps
      // the day that is already on screen, with its data intact.
      setErrorDia(error instanceof Error ? error.message : String(error));
    } finally {
      setCargando(false);
    }
  }

  return (
    <App
      /* key: a day change UNMOUNTS App, so no previous-day row can survive in state */
      key={vista.fechaOperativa}
      {...repos}
      estadoInicial={vista.estado}
      hoy={vista.fechaOperativa}
      fechaOperativaHoy={fechaOperativaInicial}
      onSeleccionarDia={seleccionarDia}
      cargandoDia={cargando}
      errorCambioDia={errorDia}
    />
  );
}
```

**Failure behaviour of a day change, stated once.** `seleccionarDia` has a `catch`, not only a `finally`. Three things happen on a rejected read: (1) the rejection is consumed, so no unhandled promise rejection is produced; (2) `vista` is left untouched, so the selection and the rendered data still agree — DD5's atomicity holds in the failure direction too; (3) `errorDia` is set and rendered by `App` as `<p className="selector-dia__error" role="alert">` inside the header, next to the navigator (§5.4). The controls are re-enabled by the `finally`. The selection attempt is retryable: the next call clears `errorDia` first. Nothing about recovery itself changes — it still rejects (§4).

The navigator renders **inside `App`'s own header** (`App.tsx:884-887`), not as a sibling above it — so `Raiz` owns the day, `App` owns where the control appears, and there is no stray element outside `<main class="app">`.

Why the `key` is the load-bearing part (DD5): `App` holds ten `useState` values seeded from `estadoInicial` (`App.tsx:120-151`). Without a remount, changing `hoy` leaves yesterday's rows mounted until the asynchronous loaders resolve — a visible wrong-day window on a dashboard whose entire job is showing the right day. The remount makes the guarantee structural rather than something each loader has to remember.

**Consequence for `startup.test.ts`.** `Raiz` — not `App` — is now the element `main()` renders, so `elemento.props.children` in that suite is `<Raiz>`. Its root-type assertions (`startup.test.ts:485`, `:526`) must assert `Raiz`, its eight repository-identity assertions (`startup.test.ts:502-509`) must move from `props.*Repository` to `props.repos.*Repository`, and its three failure-screen negatives (`:554`, `:570`, `:590`) must swap `AppDelArranque` for `RaizDelArranque` — otherwise they pass for the wrong reason. The intent of all three is preserved (same instances, built once, success screen instead of `InicializacionFallida`); only the addressing changes. `props.estadoInicial` keeps its name and every assertion on it (`startup.test.ts:487-499`, `:527`) is unaffected. The full list is §10.2.

Re-selecting the day already displayed is idempotent: the early return in `seleccionarDia` skips recovery entirely (spec: *"Re-reading the same day is idempotent"*).

### 5.3 The clock must be injectable — `fechaOperativaHoy` as a prop

`App` cannot compute `soloLectura` from the real clock. `App.test.tsx` mounts `App` 37 times with fixture days (`hoy={FECHA_CON_ORDEN}` 33 times, plus `FECHA_SIN_ORDEN` and `"2026-09-15"` passed through helpers), and the real `fechaOperativaHoy()` is the wall-clock day, so every one of those mounts would compute `soloLectura === true` and the whole existing write suite would go read-only.

So `App` gains one optional prop, declared in `AppProps` immediately after `hoy` (`App.tsx:99-100`):

```ts
/** Fecha operativa de HOY (YYYY-MM-DD): the read-only reference and the navigator's
 *  upper bound. Defaults to the local-calendar clock. Tests inject it so a fixture
 *  day can be declared "today" without depending on the wall clock. */
fechaOperativaHoy?: string;
```

```tsx
function App({
  …,
  hoy = fechaOperativaHoy(),                              // App.tsx:113 today
  fechaOperativaHoy: hoyReal = fechaOperativaHoy(),       // NEW — renamed on destructure
  onSeleccionarDia,
  cargandoDia = false,
  errorCambioDia = null,
}: AppProps) {
  const soloLectura = hoy !== hoyReal;
```

The destructured binding is renamed to `hoyReal` (`fechaOperativaHoy: hoyReal = fechaOperativaHoy()`), which is what keeps the default expression working: the pattern's *key* is `fechaOperativaHoy` but its *binding* is `hoyReal`, so the pattern introduces no local named `fechaOperativaHoy` and the call inside it resolves to the module import (`fechaOperativaHoy` from `./store/fixtures`, `App.tsx:30` → `fixtures.ts:27-29` → `clock.ts:37-39`). **Verified, not assumed** — with the same name on both sides (`{ a = f(), f = f() }`) V8 throws `ReferenceError: Cannot access 'f' before initialization` at parameter-evaluation time, so the rename is load-bearing, not cosmetic; it is the difference between a compiling file and a ReferenceError on every `App` mount. Both props stay optional with clock defaults, so a caller that knows nothing about the day owns today's exact previous behaviour.

**This section owns the single definition of `soloLectura`.** The destructuring block above is the only place in the whole change where the value is computed: `const soloLectura = hoy !== hoyReal;`, where `hoyReal` is the **injected** prop. Nothing else re-derives it — not a loader, not a handler, not a section, not `Raiz`. Every other consumer receives it as a prop (§6.1). In particular, no code in this change writes `hoy !== fechaOperativaHoy()`; that expression would read the module import and ignore the injected prop, turning every fixture-injected mount read-only.

Consequence, and it is the honest one: **every `App` mount that injects `hoy` must add `fechaOperativaHoy` with the same value** — *"for this test, that fixture day IS today"*. There are 44 such mounts across three files:

| File | Sites | Where |
|---|---|---|
| `src/App.test.tsx` | 37 `<App …>` | 33 direct JSX mounts, plus four behind the helpers `renderApp` (`:54`), `renderAppConActividades` (`:62`), `renderAppConTiempo` (`:796`), `renderAppConMantenimiento` (`:1653`) — each helper is edited once and covers all its callers |
| `src/__tests__/persistence-integration.test.ts` | 4 | `hoy: FECHA_CON_ORDEN` at `:228` (inside the `appDe` helper `:223-230`), `:486`, `:703`, `:792` |
| `src/store/sqlite/__tests__/lecturaWiring.test.ts` | 3 | `createElement(App, { … hoy: FECHA_CON_ORDEN })` at `:176-181`, `:231-236`, `:269-274` |

It is a mechanical edit and it makes those tests state their assumption explicitly instead of depending on the machine's clock. Nothing else in the repository mounts `App` — only `main.tsx`, which goes through `Raiz` and therefore always passes both props (§5.2).

`startup.test.ts` is **not** unaffected at the props level, for a different reason: `Raiz` replaces `<App/>` as `main()`'s rendered root, so `elemento.props.children` is `<Raiz>`. Its root-type assertions (`startup.test.ts:485`, `:526`) and its eight repository-identity assertions (`startup.test.ts:502-509`) must be re-pointed (§5.2); `props.estadoInicial` keeps its name and all its assertions stand.

### 5.4 `App` — surgical changes only

1. **`hoy` is now the selected day.** Its JSDoc (`App.tsx:99`) changes from *"En runtime se usa el día de hoy"* to *"the selected operational day; the navigator owns it"*. The prop name is kept (DD12).
2. **`soloLectura` is derived exactly once**, in the destructuring block of §5.3: `const soloLectura = hoy !== hoyReal;`. This item exists only to forbid a second definition — no other function, loader, handler, section or module may compute it, and no other code may call `fechaOperativaHoy()` for this purpose. Everything downstream reads the prop.
3. **Four mount loaders and four `recargar*()` helpers gain the day** (DD6):

| Call site | Current | After |
|---|---|---|
| `App.tsx:203-213` `cargarParadas` | `listarPorMaquina("M1")`, deps `[paradaRepository]` | `listarPorMaquinaYFecha("M1", hoy)`, deps `[paradaRepository, hoy]` |
| `App.tsx:215-225` `cargarActividades` | `listarPorMaquina("M1")`, deps `[actividadRepository]` | `listarPorMaquinaYFecha("M1", hoy)`, deps `[actividadRepository, hoy]` |
| `App.tsx:239-259` `cargarDanos` | `listarPorMaquina("M1")`, deps `[danoRepository, orden?.id]` | `listarPorMaquinaYFecha("M1", hoy)`, deps `[danoRepository, orden?.id, hoy]` |
| `App.tsx:261-278` `cargarMantenimientos` | `listarPorMaquina("M1")`, deps `[mantenimientoRepository]` | `listarPorMaquinaYFecha("M1", hoy)`, deps `[mantenimientoRepository, hoy]` |
| `App.tsx:304-306` `recargarParadas` | `listarPorMaquina("M1")` | `listarPorMaquinaYFecha("M1", hoy)` |
| `App.tsx:308-310` `recargarActividades` | `listarPorMaquina("M1")` | `listarPorMaquinaYFecha("M1", hoy)` |
| `App.tsx:312-321` `recargarDanos` | `listarPorMaquina("M1")` | `listarPorMaquinaYFecha("M1", hoy)` |
| `App.tsx:323-330` `recargarMantenimientos` | `listarPorMaquina("M1")` | `listarPorMaquinaYFecha("M1", hoy)` |

`cargarOrden` and `cargarJornada` already depend on `hoy` and already pass it — unchanged. `cargarInspecciones` stays keyed on `orden?.id` with no day, because the order already carries the day.

4. **`fechaOperativa: hoy`** already flows to the four sections (`App.tsx:765, 784, 809` — `propsActividades`, `danosProps`, `mantenimientoProps`; `inspeccionProps` deliberately has none, see below). Unchanged — that was CHANGE 1's work, and its JSDoc already anticipates this change (`src/ui/ParadasSection.tsx:14-17`, anticipation sentence at `:16-17`; the same text is on `ActividadesProps.fechaOperativa`, `src/ui/ActividadesSection.tsx:18-21`).

   `InspeccionTelaSection` is the one section the recovery-wiring spec names that needs **no** wiring: `RegistrarInspeccionInput` (`src/domain/inspeccionTela.ts:142`), `RegistrarDevolucionInput` (`:220`) and `RegistrarAutorizacionInput` (`:304`) declare **no `fechaOperativa` field** — an inspection is attributed exclusively through its `ordenId`, and the order carries the day. `InspeccionTelaSectionProps` (`src/ui/InspeccionTelaSection.tsx:58-76`) correspondingly declares no `fechaOperativa` prop. The requirement *"InspeccionTelaSection also passes `fechaOperativa` where its registration inputs require it"* is therefore **vacuously satisfied**: there is no field to pass and no call site that could derive one.
5. **`AppProps` gains the navigator seam** — three optional props, all defaulted so a direct `App` mount is unaffected: `onSeleccionarDia?: (fechaOperativa: string) => void`, `cargandoDia?: boolean` (default `false`) and `errorCambioDia?: string | null` (default `null`, §5.2). The header (`App.tsx:884-887`) renders the navigator `<SelectorDiaOperativa fechaOperativa={hoy} hoy={hoyReal} disabled={cargandoDia} onSeleccionar={onSeleccionarDia} />` and, right after it, the `role="alert"` message — **both inside one `{onSeleccionarDia && (…)}` block**. `Raiz` always defines `onSeleccionarDia`; every `App` mount in the existing suite does not, so their DOM is byte-identical to today's — which §10.4 asserts.
6. **Every write handler opens with the read-only guard** (DD7), so a stale render cannot write. The guard reads the *already computed* prop — it does not recompute anything (§5.4 item 2):

```ts
async function handleRegistrarParada(input: RegistrarParadaInput): Promise<string[]> {
  if (soloLectura) return ["no se puede registrar en un día que no es hoy"];
  /* …unchanged… */
}
```

Applied to `handleIniciar`, `handleRegistrarLectura`, `handleFinalizar`, `handleRegistrarParada`, `handleCerrarParada`, `handleRegistrarActividad`, `handleCerrarActividad`, `handleRegistrarDano`, `handleCerrarDano`, `handleRegistrarMantenimiento`, `handleCerrarMantenimiento`, `handleRegistrarInspeccion`, `handleDevolverInspeccion`, `handleAutorizarInspeccion`, `handleCambiarFinJornada`.
7. **`soloLectura` is added to `propsActividades` (the object every child spreads) and defensively to `propsResumenTiempo`, and folded into `permitirRegistrar` on the three props objects that already carry it** — plus one explicit pass-through: `ParadasSection` is the only child App never spreads into directly; `OrderInProduction.tsx:177-185` lists its props by hand right next to `fechaOperativa={actividadesProps.fechaOperativa}` (`:178`), so `soloLectura` is written there the same way (B2). The full composition and its three-case proof are in §6.1.

---

## 6. Read-only enforcement

Two layers, because one is not enough.

### 6.1 Reachability (UI)

There are **two distinct gates**, declared on different interfaces, composed differently at the composition root. They are never merged into one prop, because JSX spread is order-sensitive (DD7a).

**Gate A — `soloLectura: boolean` (new, required).** A plain read-only flag meaning "this is not today's day". Declared on the three sections that were previously ungated, and inherited from `ActividadesProps` by the order views that already `extends` it:

```ts
// src/ui/ActividadesSection.tsx — inside ActividadesProps (line 16)
  /** true when the selected day is not today: every write control is hidden. */
  soloLectura: boolean;
```

```ts
// src/ui/ResumenTiempoSection.tsx — inside ResumenTiempoProps (line 10)   — same member, same text
// src/ui/ParadasSection.tsx     — inside ParadasSectionProps (line 12)    — same member, same text
```

Required, never optional: a call site that forgets it does not compile. Because `OrderAvailableProps` (`OrderAvailable.tsx:22-35`), `OrderInProductionProps` (`OrderInProduction.tsx:35-56`), `OrderFinishedProps` (`OrderFinished.tsx:21-30`) and the inline intersection `EmptyDay` takes (`EmptyDay.tsx:11`) all `extends`/`&` `ActividadesProps`, all four order views receive it for free and pass it down through their existing `{...actividadesProps}` rest spreads. `ParadasSection` is the exception: it is spread by hand at `OrderInProduction.tsx:177-185`, so its `soloLectura` must be written out explicitly (B2, §5.4 item 7).

**Gate B — `permitirRegistrar: boolean` (existing).** Keeps its current meaning ("is registration allowed here at all — i.e. not a finished order") on `DanoSectionProps` (`DanoSection.tsx:7-30`, member at `:25`), `InspeccionTelaSectionProps` (`InspeccionTelaSection.tsx:58-76`, member at `:66`) and `MantenimientoSectionProps` (`MantenimientoSection.tsx:16-33`, member at `:27`). Those three sections change **zero** behaviour; only their JSDoc gains a sentence pointing at the composition rule below. Two *field* comments do stop being true, though, and are reworded in the same pass — `DanoSection.tsx:18` (*"Todos los daños de la máquina: historial (cerrados) + abiertos"*) and `ActividadesSection.tsx:25` (*"Todas las actividades de la máquina (abiertas y cerradas)…"*) both describe a full-history list that is now the selected day's list. Documentation only.

**Composition, at `App` only.** `propsActividades` (`App.tsx:761-771`) gains one member, `soloLectura`, holding the value already computed in §5.3 — and it is the object that reaches every child, because all four order views spread it. `propsResumenTiempo` (`App.tsx:814-818`) carries its own copy even though `ResumenTiempoSection` always renders next to `{...propsActividades}` and would receive the value anyway: a required member must not be satisfied by an accident of spread order. `danosProps` (`App.tsx:774-787`, member at `:783`), `inspeccionProps` (`App.tsx:790-797`, member at `:793`) and `mantenimientoProps` (`App.tsx:800-812`, member at `:808`) change one line each:

```ts
permitirRegistrar: !soloLectura && orden?.estado !== "finished",
```

The result on today (`soloLectura === false`) reduces to `true && orden?.estado !== "finished"` — **byte-identical to today's expression**, which is why no existing assertion moves.

Why two gates instead of one: `propsActividades` and `danosProps` are distinct objects, so no ordering hazard exists *between* them — but the four order views at `App.tsx:897-939` flatten them into one element with `{...propsActividades} {...propsResumenTiempo} {...danosProps} …`, and within one element the later spread wins. Composing `permitirRegistrar` as a single AND expression at the root — instead of letting two members race — means no future reordering of a `…algo` spread can silently drop a gate. This is DD7a's whole content.

**Order sections.** `OrderAvailable`, `OrderInProduction`, `OrderFinished` and `EmptyDay` already `extends`/`&` `ActividadesProps`, so they receive `soloLectura` as one of their own props and hand it down through their existing rest spreads. `OrderAvailable` and `OrderInProduction` additionally destructure it locally:

```tsx
const { soloLectura } = actividadesProps;   // after OrderAvailable.tsx:42 / OrderInProduction.tsx:69
```

Their `onIniciar` / `onRegistrarLectura` / `onFinalizar` **stay required and are always passed** — no `undefined`, no optional-prop widening. The guard is on the *rendered form*, not on the prop:

- `OrderAvailable.tsx` — wrap lines 61–92 (the whole `start-form`) in `{!soloLectura && (…)}`.
- `OrderInProduction.tsx` — wrap lines 146–175 (the `Registrar lectura` form) and lines 193–214 (`.finish-section`) in the same `{!soloLectura && (…)}`.
- `OrderFinished` and `EmptyDay` need **no** change: they already render no write controls of their own.

**The proof.** The five props objects that carry a gate (`propsActividades`, `propsResumenTiempo`, `danosProps`, `inspeccionProps`, `mantenimientoProps`) plus the order views they feed, in every state the selected day and order can put them in — with the exact values that reach the components:

| # | Selected day / order state | `soloLectura` → Act, Res, Par, OrderAvailable, OrderInProduction | `permitirRegistrar` → Dano, Insp, Mant | write controls reachable |
|---|---|---|---|---|
| (a) | **today**, order open (`available` or `in_production`) | `false` | `!false && orden.estado !== "finished"` → **`true`** | all — **identical to today** |
| (b) | **today**, order `finished` | `false` | `!false && false` → **`false`** | Act / Res / Par still writable (today's behaviour, and what `App.test.tsx:608` depends on); Dano / Insp / Mant hidden — as today |
| (c) | **any past day**, order in any state (incl. `available`, `in_production`, `finished`, or no order at all) | `true` | `!true && …` → **`false`** | **none**: Gate A hides the start/lectura/finalizar forms, Gate B hides the registration blocks, and every handler in §5.4 item 6 refuses on top |

Three cases, three stable answers; (a) and (b) reduce arithmetically to today's exact expressions. The `hoy`/`hoyReal` pair that produces `soloLectura` is defined once, in §5.3, and nowhere else.

### 6.2 Refusal (handlers)

§5.4 item 6. Defence in depth: the UI layer prevents the click, the handler prevents the write.

### 6.3 Open records — the honest edge

`getDanoAbierto("M1")`, `getMantenimientoAbierto("M1")`, `getParadaAbierta("M1", ordenId)` and `getActividadAbierta("M1", tipo)` remain **day-free** (DD8), because they express a *machine-level invariant* — "one open damage for the machine" — and an open record legitimately spans days.

Consequence on a historical day: those lookups would return the record that is open **now**, which belongs to another day. To honour *"A record is never shown on two days"*, on a historical day the open-record state is derived from the day's own list with the **existing** pure functions:

```ts
// historical day — existing pure functions, existing source set
const danoAbiertoDeMaquina = soloLectura
  ? danoAbierto(danos, "M1")
  : (await loadDanoAbierto());       // today: the day-free lookup, unchanged
```

`danoAbierto` and `mantenimientoAbierto` are already called this way in `App`'s seeds (`App.tsx:142-148`), so the historical path uses no new derivation. The spec's own rule covers it: *"The same functions run for today and for a past day … the only difference between the two invocations is the source set they receive."*

**Where the day-free lookups actually sit, and why it is safe.** There are exactly four read-path call sites — the two mount loaders (`App.tsx:247` and `:268`) and the two `recargar*` helpers (`App.tsx:315` and `:326`) — and those four are the ones the conditional above replaces. The other four (`App.tsx:474` `getParadaAbierta`, `:518` `getActividadAbierta`, `:584` `getDanoAbierto`, `:716` `getMantenimientoAbierto`) sit **inside write handlers**, after a successful `insert*`/`update*`. They are unreachable on a historical day: every one of those handlers opens with the §5.4 item 6 guard, so no read of a day-free open record can be triggered by a day that is not today.

Four further derivations read open state **out of a list** rather than out of a lookup, and they are the reason §6.4 exists: narrowing the list narrows them too.

**This is the one judgement call the specs do not fully settle** — see §12, Q1. It is a deliberate trade: today's behaviour is byte-identical (the spec's hard requirement) at the cost of a small conditional in two loaders, and §6.4 is what makes that sentence true for the list-derived cases as well.

### 6.4 Four list-derived open-state reads — today's real exposure

DD8's argument ("hiding a genuinely open record from **today's** dashboard violates *today behaves exactly as today*") applies with equal force to every place `App` derives "is something open" by filtering a list. A record opened yesterday and still open carries `fechaOperativa` = yesterday, so `listarPorMaquinaYFecha("M1", hoy)` excludes it — on today. Four derivations do exactly that:

| # | Derivation | Where | What breaks on today |
|---|---|---|---|
| 1 | `actividadesAbiertas = actividades.filter(a => a.fin === null)` | `App.tsx:757-759` | The open-activity cards disappear, **and** `handleRegistrarActividad` passes this same list to `comenzarActividad(actividades, input)` (`App.tsx:498`), whose guard *"ya hay una actividad abierta de tipo …"* (`actividades.ts:127-134`) filters `fin === null` over its argument — so a `limpieza` left open overnight no longer blocks a second one. A **domain-level** regression, not just a display one |
| 2 | `paradaActivaDeOrden = paradaAbierta(paradas, "M1", orden.id)` | `App.tsx:755` | The active-parada card vanishes for an order that spans midnight |
| 3 | `paradaAbiertaMaquina = paradas.find(p => p.fin === null && p.maquinaId === "M1")` | `App.tsx:836-839` | `estadoMaquina` (`:842`) reports `andando`/`ociosa` while the machine is actually stopped — the dashboard's machine-state alert is wrong |
| 4 | `danoAbierto(estadoInicial?.danos ?? [], "M1")` and `mantenimientoAbierto(estadoInicial?.mantenimientos ?? [], "M1")` | `App.tsx:142-147` | The `useState` **seed** reads the (now day-scoped) recovery payload, so the open card is absent from the first paint and appears only when `cargarDanos` / `cargarMantenimientos` return. Not observable through Testing Library — `render()` flushes effects — but it is a real difference in principle, and §10.4 says so rather than claiming more |

The fix follows §6.3's own rule, extended to these four — **on today the day-free source wins; on a historical day the day's list wins** (and on a historical day the handlers are unreachable anyway, so case 1's guard never runs):

1. **`actividadesAbiertas`** becomes state, not a filter: `cargarActividades` (`App.tsx:215-225`) and `recargarActividades` (`:308-310`) additionally read `getActividadAbierta("M1", tipo)` for the two values of `TipoActividadPlanificada` (`src/domain/types.ts:112`) — the port method already exists (`actividadesRepository.ts:58`) and is already called in the write path (`App.tsx:518`), so nothing new is invented. The card list and `comenzarActividad`'s argument both use `soloLectura ? actividades.filter(abierto) : the day-free set`; today the guard therefore sees yesterday's open activity, and the union is passed so the day's own open records are never dropped either.
2. **`paradaActivaDeOrden`** reads `getParadaAbierta("M1", orden.id)` fetched alongside the day-scoped list in `cargarParadas` (`:203-213`) and `recargarParadas` (`:304-306`) — the same call `handleRegistrarParada` already makes at `:474`, so the guard and the card now read one source instead of two.
3. **`paradaAbiertaMaquina`** becomes `paradaAbiertaDeMaquina ?? paradaAbierta(paradas, "M1", null)`, where `paradaAbiertaDeMaquina` is fetched day-free (`getParadaAbierta` for the current order and for `ordenId = null`) in the same two places. An open parada belonging to a *different* order is not reachable through either — see **Q4**.
4. **The two seeds** at `App.tsx:142-147` keep their expression: they are an optimisation the loaders immediately supersede (they already re-read `:247`/`:268` on mount), and changing them would require `RecoveryState` to grow four open-record fields — a contract change to a module this design otherwise leaves alone. Stated as a known, bounded one-paint difference rather than hidden.

This adds two `useState` values to `App` and four lookups split across four functions. It is the price of DD8 applied consistently: **the day's list answers "what happened on this day"; a day-free lookup answers "what is open now". Mixing them — in either direction — is what breaks attribution (§6.3) or today's behaviour (here).**

---

## 7. Navigation control

```tsx
// src/ui/SelectorDiaOperativa.tsx (new)
export interface SelectorDiaOperativaProps {
  /** Día operativo seleccionado (YYYY-MM-DD). */
  fechaOperativa: string;
  /** The read-only reference — `App`'s injected `hoyReal` (§5.3), not a fresh clock read.
   *  Upper bound for the picker and the point where "next" stops. */
  hoy: string;
  /** True while a day change is in flight; disables every control. */
  disabled: boolean;
  onSeleccionar(fechaOperativa: string): void;
}

export function SelectorDiaOperativa({ fechaOperativa, hoy, disabled, onSeleccionar }: SelectorDiaOperativaProps) {
  const anterior = desplazarDia(fechaOperativa, -1);
  const siguiente = desplazarDia(fechaOperativa, +1);
  const esHoy = fechaOperativa === hoy;
  return (
    <nav className="selector-dia" aria-label="Día operativo">
      <button type="button" onClick={() => onSeleccionar(anterior)} disabled={disabled}
              aria-label="Día operativo anterior">
        <span aria-hidden="true">←</span>
      </button>

      <label className="selector-dia__campo">
        <span>Fecha operativa</span>
        <input type="date" value={fechaOperativa} max={hoy} disabled={disabled}
               onChange={(e) => e.target.value && onSeleccionar(e.target.value)} />
      </label>

      <button type="button" onClick={() => onSeleccionar(siguiente)}
              disabled={disabled || esHoy} aria-label="Día operativo siguiente">
        <span aria-hidden="true">→</span>
      </button>
    </nav>
  );
}
```

`desplazarDia` is a new pure helper, exported next to the clock so the convention lives in one module (`src/store/clock.ts`, alongside `fechaOperativaDe` at `clock.ts:32-34` and the `en-CA` constant at `:24`): `Date.setDate(getDate() + n)` on a `YYYY-MM-DD` string parsed as local midnight, formatted back with that same `en-CA` shape. No UTC arithmetic, no `toISOString()` — the project already rejected UTC for this field (CHANGE 1, DD9).

The navigator is rendered by `App` **only when `onSeleccionarDia` is defined** (§5.4 item 5), immediately after the existing `Fecha operativa: {hoy}` span (`App.tsx:886`), which stays. The failure alert sits directly after the `<nav>`, inside that same `{onSeleccionarDia && (…)}` block, so it too cannot appear on a direct `App` mount:

```tsx
{errorCambioDia && (
  <p className="selector-dia__error" role="alert">No se pudo cargar ese día: {errorCambioDia}</p>
)}
```

`role="alert"` makes the failure announce itself; `cargandoDia` disables both arrows and the input for the whole in-flight window, so a second click cannot queue a second `seleccionarDia`.

Why these three native elements (DD9):

- `<input type="date">` — keyboard and screen-reader support, locale formatting, and a picker, all free. A hand-rolled widget would need its own focus, keyboard and formatting tests for no user-visible gain.
- `max={hoy}` — a future day is out of scope and has no data; this makes it unreachable rather than merely empty.
- "Next" disabled at today — makes "exactly one day, never a range" structural. The spec forbids any control that accepts a start and an end date; `<input type="date">` has no such affordance.
- `<button type="button">`, not `<a>` — no href, no navigation semantics.
- `aria-label` on each arrow plus a labelled `<label>` for the field.

---

## 8. Parity contract suite (spec D8)

One factory, two families, six attribution shapes.

```ts
// src/store/__tests__/dayScopedListingContract.ts (new)
export function describeDayScopedListingContract<T>(
  familia: string,
  crearCaso: (datos: FixtureDia) => { listar(m: string, f: string): Promise<T[]> },
): void { /* six cases × both families */ }
```

The six shapes the spec enumerates, run for each of the four event types:

1. a record **with** an order;
2. a record **with no** order (order-less, must still be visible on its day);
3. a **midnight-crossing** record (`inicio` 23:50 → `fin` 00:10 the next day);
4. an **open** record that spans midnight (`fin: null`, `inicio` the previous day);
5. **two records with identical `inicio`** but different `fechaOperativa` — each day returns only its own;
6. a day with **no records** → `[]`, not an error.

Plus, for every case: chronological order preserved, and the day-free `listarPorMaquina` still returning the machine's full history (DD2).

```ts
// src/store/sqlite/__tests__/dayScopedListing.parity.test.ts (new)
describeDayScopedListingContract("in-memory", crearCasoInMemory);
describeDayScopedListingContract("sqlite", crearCasoSqliteReal);
```

### The real SQLite side

**Verified experimentally in this session**, not assumed:

| Question | Result |
|---|---|
| Is a real SQLite engine reachable? | Yes — Node `v22.23.3`, `node:sqlite` `DatabaseSync` (bundled SQLite; one `ExperimentalWarning`) |
| Do migrations 001–005 apply in-process? | Yes — applied via `?raw` imports, the exact pattern `migration005.test.ts:36-41` already uses (`005_…sql?raw` for both the `src-tauri` copy and the mirror, plus `lib.rs?raw`) |
| Do the adapters' `$1`-style binds work? | **Not** positionally — `node:sqlite` treats `$1` as a *named* parameter. A 12-line shim rewrites `$N` → `?` before preparing, or binds `{'1': …, '2': …}` |
| Does it run under Vitest 5 (jsdom default)? | **Not** directly — the environment container refuses to bundle the builtin. `// @vitest-environment node` at the top of the file fixes it |
| Does TypeScript accept the import without `@types/node`? | Yes, with the project's existing convention: `// @ts-expect-error type error without @types/node package`, exactly as `vite.config.ts:4-5` already does. `npx tsc --noEmit` passes |
| Does the index get used? | Yes — `EXPLAIN QUERY PLAN` reports `SEARCH parada USING INDEX idx_parada_maquina_fecha (machine_id=? AND fecha_operativa=?)` |

The shim (`src/store/sqlite/__tests__/realSqlite.ts`, new) implements only the two methods the adapters use — `select<T>(sql, binds)` and `execute(sql, binds)` — over `DatabaseSync`, plus `close()`. The **SQLite adapter classes run unmodified**; only their injected `Database` changes. That is what makes the run evidence about the adapter rather than about a re-implementation of it.

The existing double-based per-adapter suites are **kept and still pass** — the real-engine cases are added, never substituted (spec: *"added to the real-engine run rather than replacing it"*).

### Honesty note

This proves the **SQL and the predicate are enforced by a real SQLite engine against the real migrations 005 shipped**. It does **not** prove the Tauri plugin transport (`@tauri-apps/plugin-sql`) enforces them — that remains PENDING runtime validation, exactly as the existing honesty notes in `recovery.test.ts:26-31` and `startup.test.ts:20-25` state. Those notes stay in place, unedited.

It also deliberately follows the precedent `migration005.test.ts:14-33` already sets: a *"WHAT THIS SUITE IS NOT"* block that says the suite does not run the Tauri migration, and a *"SEPARATE EVIDENCE, NOT CLAIMED HERE"* block pointing at `src-tauri/migrations/validate_r56.py` with its own caveat (a Python `sqlite3` script, `executescript` autocommit vs sqlx's per-migration transaction — not equivalent to the runtime). The new parity suite gets the same two-block treatment: it claims real-engine enforcement of the predicate, and explicitly claims nothing about the Tauri transport.

---

## 9. Files touched

| File | Action | Change |
|---|---|---|
| `src/store/paradasRepository.ts` | Modify | +`listarPorMaquinaYFecha` on the port (DD1) |
| `src/store/actividadesRepository.ts` | Modify | +`listarPorMaquinaYFecha` |
| `src/store/danosRepository.ts` | Modify | +`listarPorMaquinaYFecha` |
| `src/store/mantenimientoRepository.ts` | Modify | +`listarPorMaquinaYFecha` |
| `src/store/inMemoryParadasRepository.ts` | Modify | +day-filtered listing |
| `src/store/inMemoryActividadesRepository.ts` | Modify | +day-filtered listing |
| `src/store/inMemoryDanosRepository.ts` | Modify | +day-filtered listing |
| `src/store/inMemoryMantenimientoRepository.ts` | Modify | +day-filtered listing |
| `src/store/sqlite/sqliteParadaRepository.ts` | Modify | +`AND fecha_operativa = $2` |
| `src/store/sqlite/sqliteActividadPlanificadaRepository.ts` | Modify | +`AND fecha_operativa = $2` |
| `src/store/sqlite/sqliteDanoRepository.ts` | Modify | +`AND fecha_operativa = $2` |
| `src/store/sqlite/sqliteMantenimientoRepository.ts` | Modify | +`AND fecha_operativa = $2` |
| `src/store/sqlite/recovery.ts` | Modify | 4 calls day-scoped; rewrite comments at `:30-32`, `:51-52`, `:86-89`, `:126-127` (§4) |
| `src/main.tsx` | Modify | extract `Raiz`; steps 1–4 and the failure screen unchanged |
| `src/Raiz.tsx` | **Create** | day state + `seleccionarDia` + the `<App key>` mount (§5.2) |
| `src/App.tsx` | Modify | `soloLectura`/`hoyReal`; day in 8 call sites + dep arrays; 15 handler guards; `AppProps` seam; reachability props; two `useState` for day-free open parada / open activities (§6.4) |
| `src/ui/SelectorDiaOperativa.tsx` | **Create** | native date input + two buttons (§7) |
| `src/store/clock.ts` | Modify | +`desplazarDia(fecha, delta)` — local-calendar day shift, no UTC (§7) |
| `src/ui/ParadasSection.tsx` | Modify | +`soloLectura`, gate both controls |
| `src/ui/ActividadesSection.tsx` | Modify | +`soloLectura`, gate both controls |
| `src/ui/ResumenTiempoSection.tsx` | Modify | +`soloLectura`, hide the fin control |
| `src/ui/OrderAvailable.tsx` | Modify | destructure `soloLectura`; wrap the start form (§6.1) |
| `src/ui/OrderInProduction.tsx` | Modify | destructure `soloLectura`; wrap the lectura form + `.finish-section`; pass `soloLectura` to `ParadasSection` (B2) |
| `src/App.css` | Modify | `.selector-dia*` layout |
| `src/store/__tests__/dayScopedListingContract.ts` | **Create** | the shared factory (§8) |
| `src/store/sqlite/__tests__/realSqlite.ts` | **Create** | `DatabaseSync` shim over migrations 001–005 |
| `src/store/sqlite/__tests__/dayScopedListing.parity.test.ts` | **Create** | runs the factory against both families |
| `src/__tests__/noDomainDiff.test.ts` | **Create** | the boundary guard, §10.3 |
| `src/store/sqlite/__tests__/recovery.test.ts` | Modify | 4 fakes gain the method; failure injection moves; `H1`/`I1`/`I2`/`I6` re-point; `I4` re-titled and extended (§10.2) |
| `src/store/sqlite/__tests__/startup.test.ts` | Modify | 4 fakes gain the method; bitacora tag + failure-injection spy rename; assert `Raiz` (root type, `props.repos.*`, 3 negatives) (§5.2, §10.2) |
| `src/App.test.tsx` | Modify | new cases: nav, read-only, day-scoped loaders; every `hoy=` mount gains `fechaOperativaHoy` |
| `src/__tests__/persistence-integration.test.ts` | Modify | the four `listarPorMaquina` fakes gain the method; day-change flow through the real recovery seam; its 4 `hoy:` mounts gain `fechaOperativaHoy` |
| `src/store/sqlite/__tests__/lecturaWiring.test.ts` | Modify | its 3 `hoy:` mounts gain `fechaOperativaHoy`; no other change |
| `src/store/{paradas,actividades,danos,mantenimiento}Repository.test.ts` | Modify | +day cases per family, existing cases untouched |
| `src/store/sqlite/__tests__/sqlite*Repository.test.ts` | Modify | +day cases, existing assertions kept |

No new fixture file is needed: two days already exist end to end — `ord-101` on `2026-09-11` and `ord-102` on `2026-09-15` (`fixtures.ts:48-71`), `FECHA_SIN_ORDEN = "2026-09-12"` (`:18`), and the four `*Fixtures.ts` modules already carry records on 09-11, 09-12 and 09-15. `src/store/fixtures.ts` is therefore **not** touched unless a case turns out to need a shape that is missing.

**Behaviourally untouched:** `src/domain/**` (zero diff, guarded — §10.3), `src-tauri/migrations/**` (001–005 byte-identical), `src/store/repository.ts`, `src/store/inspeccionRepository.ts`, `src/store/jornadaRepository.ts`, `src/ui/OrderFinished.tsx`, `src/ui/EmptyDay.tsx`, `src/ui/DashboardHome.tsx`, `src/ui/CalidadSection.tsx`.

**JSDoc-only:** `src/ui/DanoSection.tsx`, `src/ui/InspeccionTelaSection.tsx`, `src/ui/MantenimientoSection.tsx` — one comment line each pointing at the composition rule of §6.1. No statement, no prop, no condition.

---

## 10. Test strategy

### 10.1 Ports and adapters

Every case runs against both families through the shared factory (§8), so no shape can pass in one family and fail in the other. The existing per-adapter suites keep every current assertion — the day predicate is added, not substituted.

### 10.2 Recovery and composition

- **`recovery.test.ts`** — everything that names the day-free method is re-pointed, nothing else changes:
  1. header white-box line *"routes the four machine-event lists through `listarPorMaquina(maquinaId)` with NO date predicate"* (`recovery.test.ts:16`) → names `listarPorMaquinaYFecha(maquinaId, fechaOperativa)`;
  2. the four fakes (`:216`, `:225`, `:233`, `:245`) gain `listarPorMaquinaYFecha: vi.fn(…)` (they are `satisfies I…Repository`, so the build fails until they do) and keep `listarPorMaquina` for DD2;
  3. the failure-injection option `fallaLecturaDano` moves from `listarPorMaquina` to `listarPorMaquinaYFecha` (`:186-187`, `:233-235`), otherwise `I6` (`:732-749`) would stop injecting at all and start passing vacuously;
  4. the assertions re-point to the new method — `H1` (`:518-521`), `I1` (`:591-594`), `I6` (`:746-748`), and the sequential-order array in `I2` (`:615-618`);
  5. `I4` *"los cuatro listados de máquina traen el historial COMPLETO, sin predicado de fecha"* (`:654-689`) needs a **precise** rewrite, not a blanket inversion. Its four records deliberately set `inicio` to Jan / Feb / Mar / Dec while `create*` defaults `fechaOperativa: FECHA` (`:94-152`) — so after day-scoping **all four are still returned**, and the body's `toEqual(paradas)` stays. What must change: the title and premise comment (`:654-657`, *"el recovery no filtra por fecha"*), and the eight method assertions (`:682-688`) become `listarPorMaquinaYFecha` with `(MAQUINA, FECHA)`. Then one record gains `fechaOperativa: "2026-12-31"` and is asserted **absent** — that is the new property. The surviving half of the original case (a `inicio` outside the day is still returned when `fechaOperativa` matches) is exactly the spec's *"a midnight-crossing record stays on its registered day"* / *"`inicio` and `fin` are untouched by day scoping"* (`spec.md:210-242`) and must be kept, not deleted.

  Read order (D2e), failure propagation (I6), sources-only (I5) and the `I3` order-less case keep their structure and must still pass. The `listarPorMaquina` full-history guarantee that `I4` used to carry moves to the per-adapter suites (DD2).
- **`startup.test.ts`** — two independent groups of edits:
  1. *The fakes.* Its four port objects (`startup.test.ts:140`, `:152`, `:163`, `:175`) are annotated `: IParadaRepository` etc., so each gains `listarPorMaquinaYFecha`. Their `bitacora.push("<dom>:listarPorMaquina")` tags (`:145`, `:157`, `:168`, `:180`) rename with them, the failure-injection spy at `:361-365` targets `listarPorMaquinaYFecha` and pushes `parada:listarPorMaquinaYFecha:error`, and the two assertions on those tags (`:581`, `:582`) rename to match — otherwise the failure case passes for the wrong reason (the tag simply never appears). One comment also needs rewording: `startup.test.ts:531` says the machine domains are recovered as *"historial completo de la máquina, vacío en día vacío"* — the four `toEqual([])` assertions above it still hold, but the reason is now "empty day, day-scoped read", not "full history happens to be empty".
  2. *The root.* `Raiz` becomes what `main()` renders, so `elemento.props.children` is `<Raiz>`: `app.type` at `:485` and `:526` asserts `RaizDelArranque` (imported next to `AppDelArranque` at `:399`), and the eight repository-identity assertions at `:502-509` become `props.repos.repository` … `props.repos.mantenimientoRepository`. `props.estadoInicial` keeps its name, so `:487-499` and `:527` stand. The three failure-screen negatives at `:554`, `:570` and `:590` must also swap `AppDelArranque` → `RaizDelArranque`: as written they would *pass by accident*, because `InicializacionFallida` is neither `App` nor `Raiz` — leaving them would mean the suite no longer asserts the success screen is what is absent.
- **`persistence-integration.test.ts`** — the four repository fakes (`:173`, `:181`, `:188`, `:196`) gain `listarPorMaquinaYFecha`; then the real day-change flow: materialise two days of orders and events, navigate, assert each view shows only its own rows, and assert no write reaches the store from a historical day.

### 10.3 Domain regression guard

The spec requires it (*"GIVEN a regression guard over `src/domain/**` … THEN the guard fails"*). The guard is a **git** guard, not a content grep, because "zero diff" is a git fact and any string-based approximation either misses real diffs or fires on files that are legitimately unchanged.

```ts
// src/__tests__/noDomainDiff.test.ts (new) — runs from the repository root
// @vitest-environment node
// @ts-expect-error type error without @types/node package
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const BASE = "851172c"; // the declared precondition commit — the same one §10.5 uses

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

describe("src/domain has zero diff caused by this change", () => {
  it("no committed, staged or unstaged change against the precondition", () => {
    // `git diff <commit> -- path` compares BASE with the WORKING TREE, so it
    // already folds committed + staged + unstaged edits together.
    const diff = git(["diff", "--name-only", BASE, "--", "src/domain"]);
    expect(diff).toBe("");
  });

  it("no new file anywhere under src/domain", () => {
    // Untracked files are invisible to `git diff`; they are the other half of "zero diff".
    const nuevos = git(["ls-files", "--others", "--exclude-standard", "--", "src/domain"]);
    expect(nuevos).toBe("");
  });
});
```

Two calls, both name-based, both read-only, no checkout needed. `rev-parse --show-toplevel` is unnecessary because Vitest's root is already the repository root.

**Why a content grep was rejected.** The obvious alternative — scan `src/domain/**` for `fechaOperativaHoy`, `new Date(`, `getFullYear`, `toISOString()`, a repository port — fails on this codebase today, before a single line of this change exists: `new Date(` already appears at `actividades.ts:177,198`, `danos.ts:64,185,186,257`, `inspeccionTela.ts:63`, `mantenimiento.ts:56,160,242`, `paradas.ts:228,248,263,264`, `tiempo.ts:53,54,89,93,168,169`; the domain suites are **co-located** `src/domain/*.test.ts` (there is no `src/domain/__tests__/` directory to hang a `?raw` reader on); and `src/domain/calidad.test.ts` legitimately imports `InMemoryDanoRepository`. A guard that is red on the precondition commit guards nothing. The git guard is red only when the boundary is actually crossed.

Same guard covers `src-tauri/migrations/**` in §10.5's gate command; keeping the test scoped to `src/domain` mirrors the spec's own requirement text.

### 10.4 UI

**Empty days** — the four scenarios the spec enumerates at `spec.md:249-277`, each asserted through the navigator, not only at startup:

1. *A fully empty day renders the no-order state* — navigate to a day with no `orden`; `EmptyDay` renders, no error, no failure screen.
2. *An empty day fabricates nothing* — same day: no `orden`, `lectura`, `parada`, `actividad`, `Dano` or `mantenimiento` appears, and the fake store's write methods have zero calls after the render.
3. *A day with events but no order* — two activities and one `parada` on `D`: `EmptyDay` renders **and** those three rows are visible, with no row from another day.
4. *The jornada of the selected day is used* — `D` has no persisted jornada → the existing default reads, and `jornadaRepository` gained no write call.

**Navigation and read-only** — `App.test.tsx` gains: default selection is today; `←`, `→` and the date input each load the right day; `→` at today is disabled and `max` is today; a change remounts (`key`) and shows no previous-day row; every write control is **absent** on a past day (absent, never present-and-failing); every handler refuses when called directly on a past day; returning to today restores every control and the writes succeed (spec `:359-377`); a rejected day change keeps the previous day on screen and shows the `role="alert"` message (§5.2).

**Open records across midnight** — `App.test.tsx` gains the case §6.4 exists for: seed a `dano`, a `mantenimiento`, a `parada` and a `limpieza` on day *D* with `fin: null`, inject `fechaOperativaHoy = D + 1`, mount on `D + 1`, and assert that (a) each open card is visible, (b) `estadoMaquina` still reads `parada`, (c) registering a second `limpieza` is refused by `comenzarActividad`'s guard, and (d) after navigating to *D*, the same records are visible there and *not* on `D + 1` — the day-scoped list and the day-free lookup each answer their own question (§6.3, §6.4).

**Today's DOM unchanged** — for every direct `<App hoy={…} fechaOperativaHoy={…}/>` mount, the rendered output is byte-identical to the pre-change rendering: no `SelectorDiaOperativa`, no alert, no extra element in the header, because `onSeleccionarDia` is `undefined` (§5.4 item 5). This is what makes *"A selected day equal to today behaves exactly as today"* (`spec.md:353-357`) checkable rather than a claim. One honest qualification: with an open record carried over from a previous day, the two `useState` seeds at `App.tsx:142-147` are one paint behind their loaders — stated in §6.4 rather than papered over, and not observable through Testing Library.

### 10.5 Gate

`npm run test` (which now includes `src/__tests__/noDomainDiff.test.ts`), `npx tsc --noEmit`, and `cargo check` in `src-tauri` — all three must pass, and `git diff 851172c -- src/domain src-tauri/migrations` must be empty (verified against the precondition commit: both paths are already empty, so the gate starts green rather than needing a baseline exception).

---

## 11. Risks and rollback

| Risk | Mitigation |
|---|---|
| A loader's dependency array is forgotten, so it re-reads full history and overwrites the day-scoped seed | DD6 enumerates all eight call sites with line numbers; the mount-loader cases assert the day reaches every call |
| An order view forgets to gate one form, so a write control is reachable on a past day | One gate per props object, composed at a single root (DD7a) and proved case by case in §6.1; §10.4 asserts the control is *absent*, not disabled |
| A second `soloLectura` is derived somewhere and reads the clock instead of the injected prop | §5.3 owns the only definition; §5.4 item 2 forbids a second one, and the 44 fixture-injected App mounts (§5.3) turn red the moment a clock read leaks in |
| A stale render reaches a write handler on a historical day | Two enforcement layers (§6); handler-guard cases call the handlers directly, not through the DOM |
| A record opened yesterday is still open and today stops seeing it | §6.4: four list-derived open-state reads are moved onto the day-free lookups; the cross-midnight case has its own test (§10.4) and one bounded residual (the two seeds) is stated, not hidden |
| A day change rejects and the operario sees a blank or half-loaded day | §5.2: `vista` is untouched on failure, `errorCambioDia` renders as `role="alert"`, and the previous day stays on screen |
| The parity suite drifts because the SQLite side reimplements the adapter | The shim injects a `Database` only — the adapter class under test is the real one |
| `node:sqlite` is experimental and may change | Only `DatabaseSync`, `prepare`, `all`, `run`, `exec` are used, all long-stable; the double-based suites remain as the fallback layer |
| Open records shown on the wrong day | DD8 + §6.3: historical days derive from the day's list; flagged as open question Q1 |
| Index assumptions wrong | Verified against a real engine with 001–005 applied (§3.3); `EXPLAIN QUERY PLAN` is asserted in the parity suite |

**Rollback:** revert the commit. No migration, no schema change, no persisted-data change — the schema and the data are exactly as `851172c` left them. `listarPorMaquina` survives untouched, so reverting leaves the pre-change read path intact.

---

## 12. Open questions

- [ ] **Q1 — historical open records.** Is "on a historical day, show the open record *attributed to that day*" the intended reading? The alternative — keep the machine-level `get*Abierta` lookup on every day — would show today's open record on a past day, which contradicts exclusive attribution. The design picks the first (§6.3) because the alternative contradicts *"today behaves exactly as today"* in the other direction. Needs Gerencia-level confirmation of which is operationally expected.
- [ ] **Q2 — how far back navigation goes.** The bounds are today (upper) and unbounded past. If the program only ever materialises a week ahead, a lower bound may be wanted; nothing in the specs requires one.
- [ ] **Q3 — `hoy` prop rename.** Kept (DD12) to avoid a 40-call-site test diff. If the team prefers `fechaOperativa` for honesty, it is a mechanical follow-up but belongs to a different change.
- [ ] **Q4 — an open parada under a *different* order.** `getParadaAbierta(maquinaId, ordenId)` is bound to one order (or to `ordenId = null`), so after day-scoping there is no reachable read that finds "a parada opened under order X while order Y is today's order". Pre-change `paradaAbiertaMaquina` (`App.tsx:836`) found it by scanning the full history; §6.4's two lookups do not. It is a narrow state (order switched while a parada stayed open), the specs do not name it, and the two options are a third day-free lookup or accepting `estadoMaquina` to be order-relative. Needs an operational answer before the parity suite is written for it.

---

## 13. Explicit non-goals

- No migration, no change to migrations 001–005, no new index (DD11).
- No diff in `src/domain/**`. No derived value is stored, cached or persisted; no derivation gains a day input.
- No `fechaOperativa` on `IInspeccionRepository` or `ILecturaGolpeRepository` — both stay order-reached.
- No date range, no multi-day view, no aggregate across days.
- No future-day viewing (no retroactive pre-registration, no planning view).
- No change to the machine-level `get*Abierta` invariants.
- No rework of the duplicated timestamp validators or the four private `esFechaOperativaValida` helpers noted in CHANGE 1 §8.
- No runtime (Tauri) validation: the plugin transport stays PENDING, as the existing honesty notes already declare.