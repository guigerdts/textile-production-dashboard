# Delta for `operational-recovery-wiring`

Canonical name for the selected operational day: `fechaOperativa`.
Canonical name for the real current day (navigator upper bound): `fechaOperativaHoy`.

## MODIFIED Requirements

### Requirement: App seeds from the recovered state and keeps its mount loaders

`App` MUST seed its `paradas`, `actividades`, `danos`, `mantenimientos` and `inspecciones` state from
`estadoInicial` for the first paint, exactly as it already seeds `orden` and `jornada`. It MUST **also
keep** its mount loaders, converted to the `cancelled`-flag asynchronous pattern already used for the
order and jornada loaders, because `App` accepts an injectable `fechaOperativa` that the startup
recovery does not know about: a test injecting a different date must not display stale recovered data.

#### Scenario: The first paint shows the recovered operational state

- GIVEN a recovered state containing paradas and daños
- WHEN `App` mounts for the first time
- THEN its parada and daño lists are already populated from `estadoInicial`
- AND no intermediate empty flash of machine events is shown

#### Scenario: The mount loaders re-read the same repositories for the injected date

- GIVEN `App` is mounted with a `fechaOperativa` different from the one used to produce `estadoInicial`
- WHEN the mount loaders run
- THEN each operational domain is re-read through its repository contract for `fechaOperativa` / the machine
- AND the state is replaced with the re-read values
- AND a loader that resolves after unmount does not call a state setter

#### Scenario: A repository prop change re-runs the loader

- GIVEN the repository prop identity changes
- WHEN the effect re-runs
- THEN the domain is re-read and the state refreshed
- AND a stable repository identity does not re-trigger the loader on every render

### Requirement: Startup passes the selected day to recovery, and the app seeds from it

When the application is started with a selected day, `main.tsx` (or the startup composition path) MUST
pass that selected day to `recoverPersistedState`. The `App` component MUST receive that selected day as
its `fechaOperativa` prop and MUST seed its state from the recovered state that
belongs to that day. The first paint MUST show the recovered day, with no intermediate "today" shown.

#### Scenario: Startup passes the selected day to recovery

- GIVEN the application starts with selected day `D`
- WHEN recovery runs
- THEN `recoverPersistedState` receives `fechaOperativa = D`
- AND the recovered state contains only records of `D`

#### Scenario: The app uses the same selected day as its view

- GIVEN recovery was called for day `D`
- WHEN `App` mounts with `estadoInicial` from that recovery
- THEN `App`'s selected day is `D`
- AND the header shows `D` as the displayed day

#### Scenario: The first paint matches the recovered day

- GIVEN a recovered state for day `D` with an `orden` and some events
- WHEN `App` renders its first paint
- THEN the order and events shown are those of day `D`
- AND no state was seeded from a different day

### Requirement: Registration handlers pass the selected day, never recompute it

Every handler that registers a record MUST pass `fechaOperativa` in its domain input, and that value
MUST be the **selected operational day** of the app (its `fechaOperativa` prop), not `fechaOperativaHoy()`
recomputed inside the handler. The four sections (`ParadasSection`, `ActividadesSection`,
`DanoSection`, `MantenimientoSection`) and every call site that builds a registration input MUST receive
the selected day as a prop and use it verbatim.

`InspeccionTelaSection` also passes `fechaOperativa` where its registration inputs require it, using the
same selected day. No call site may derive the day from `new Date()` or call `fechaOperativaHoy()`.

#### Scenario: Each section receives and uses the selected day

- GIVEN the four sections are rendered while the selected day is `D`
- WHEN each builds a `Registrar*Input`
- THEN each passes `fechaOperativa = D`
- AND the prop that carries `D` is the selected day, not recomputed inside the section

#### Scenario: No section computes the day independently

- GIVEN the section components
- WHEN their registration handler bodies are inspected
- THEN none of them call `fechaOperativaHoy()` or compute a date
- AND each reads `fechaOperativa` from its props or from the closure that received the selected day

#### Scenario: The handler passes the selected day to the domain

- GIVEN a registration input is built for day `D`
- WHEN it is passed to the domain registration function
- THEN the domain receives `fechaOperativa = D`
- AND that value is written verbatim into the persisted entity

#### Scenario: The selected day is stable while the view is active

- GIVEN the operario registered a record while viewing day `D`
- WHEN the persisted entity is read back
- THEN its `fechaOperativa` is `D`
- AND it was not rewritten to `fechaOperativaHoy()` by the handler

### Requirement: Registration handlers supply the operative date explicitly

Every registration call site MUST pass `fechaOperativa` in its input, taken from the app's single
source of the current operational day. No call site may rely on the domain to infer it, and none may
omit it and expect a default.

The four call sites are `src/ui/ParadasSection.tsx:100`, `src/ui/ActividadesSection.tsx:76`,
`src/ui/DanoSection.tsx:127` and `src/ui/MantenimientoSection.tsx:112` — each already builds its own
`inicio: new Date().toISOString()`. The four sections receive the selected day as the same
`fechaOperativa` prop, taken from one source rather than computed independently. A section MUST NOT
carry a second, differently-named copy of the selected day: `fechaOperativa` is the only prop that
represents it.

#### Scenario: Each registration call site passes the current day

- GIVEN the four registration call sites in `src/ui/*Section.tsx`
- WHEN each builds its domain input
- THEN each passes `fechaOperativa` explicitly, from the same source the app uses for the active
  jornada

#### Scenario: No section derives its own date

- GIVEN the four section components
- WHEN their registration handlers are inspected
- THEN each reads the operative date from a prop or seam, not from a date it computes itself

#### Scenario: A call site cannot omit the field

- GIVEN the domain input types after this change
- WHEN a call site is type-checked without `fechaOperativa`
- THEN compilation fails, so an omission cannot reach runtime
