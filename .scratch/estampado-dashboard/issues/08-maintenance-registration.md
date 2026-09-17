# 08: Maintenance registration (reactivo and preventivo)

**What to build:** The operator registers maintenance applied to the machine (never per paint chemistry): reactivo — caused by a daño and linked to that daño event — or preventivo, scheduled by machine needs with no fixed periodicity. Fields: date, type, motivo, start/end or duration, what was checked/repaired, and observations.

**Blocked by:** 01

**Status:** closed

- [x] Two maintenance types exist: reactivo and preventivo.
- [x] Reactivo maintenance records a reference to the daño event that caused it **when that daño was registered**; the daño link is an optional integration, never a precondition for recording maintenance.
- [x] Preventivo maintenance can be registered with no prior daño and has no fixed periodicity.
- [x] All fields are present: date, type, motivo, start/end or duration, what was checked/repaired, observations.
- [x] Maintenance records target machine M1 and never branch by paint chemistry.
- [x] Maintenance records carry the operator's name.

## Functional model (approved)

### Problem Statement

The operator cannot record maintenance applied to the machine. When a daño damages the machine and a reactivo maintenance is performed, there is no system entry tying that intervention to the daño that caused it (when the daño was registered); when the machine is proactively serviced (preventivo), there is no place to register what was checked or repaired and when it happened. Maintenance events, which belong to the machine and not to any production order, currently have nowhere to live: they cannot be shown in the current shift/operative-day timeline, cannot be opened and closed as the work happens, and the shift summary gives no visibility into what was serviced. The operator needs a documentary, machine-level record of every maintenance intervention with its temporal window, its motivation, and what was actually checked or repaired.

### Solution

The operator registers maintenance applied to machine M1 (never per paint chemistry, per ADR 0006) as a **machine-level documentary event** (ADR 0007): reactivo (caused by a daño; optionally linked to that daño event when it was registered — the link is never a precondition) or preventivo (scheduled by machine needs, no fixed periodicity). Each maintenance has a start timestamp and an optional end (`null` = in progress); duration is always **derived** from start and end, never entered manually. The record captures motivo (free text, required), what was checked/repaired (`queSeRevisoReparo`, free text, optional while open but required at close), optional observations, and the name of the operator who registered it. Records are immutable after close. The **maintenance section** appears in the **current shift/operative-day timeline** in all four order states and in EmptyDay (machine-level, never order-level: the model has no `ordenId`), with a registration form that can open a maintenance in progress or register one complete in a single step. Maintenance is **documentary**: it never deducts productive time directly; if a reactivo maintenance's daño caused a parada, that parada remains the only temporal incidence, so there is no double counting.

### User Stories

1. As an operator (operario de estampado), I want to register a **reactivo maintenance** caused by a daño, so that the intervention is recorded with the machine's event history.
2. As an operator, I want to optionally link a reactivo maintenance to the daño that caused it when that daño was registered, so that the service history traces back to its cause.
3. As an operator, I want to register a reactivo maintenance **without** linking any daño when the daño was never registered, so that the maintenance is never blocked by missing damage data.
4. As an operator, I want the daño link to be optional even for reactivo maintenance, so that it never becomes a precondition for recording maintenance.
5. As an operator, I want to register a **preventivo maintenance** with no prior daño, so that scheduled servicing is recorded independently.
6. As an operator, I want preventivo maintenance to have no fixed periodicity, so that servicing is registered when it actually happens, not on an invented schedule.
7. As an operator, I want to choose the maintenance type from a closed catalog (`reactivo` / `preventivo`) with visible Spanish labels, so that I never type an arbitrary type.
8. As an operator, I want the maintenance type list to be rejected when it is empty or unknown, so that no record is created without a valid type.
9. As an operator, I want to open a maintenance in progress (start only, `fin = null`), so that I can record the intervention as it begins.
10. As an operator, I want to leave `queSeRevisoReparo` empty while a maintenance is open, so that I do not have to guess the outcome before the work starts.
11. As an operator, I want to close an open maintenance by providing the end timestamp and the description of what was checked/repaired, so that closed records always have sufficient traceability.
12. As an operator, I want the close to be rejected when `queSeRevisoReparo` is empty, so that no closed maintenance lacks its service description.
13. As an operator, I want to register a completed maintenance in a single step (start, end, and description together), so that short interventions need only one form submission.
14. As an operator, I want the system to reject an end timestamp that is not ISO-valid or is earlier than the start, so that temporal windows are always coherent.
15. As an operator, I want the duration to be derived from start and end (never entered manually), so that the window cannot contradict itself.
16. As an operator, I want the start timestamp to be the only temporal reference of the record (day derived from it), so that there is no separate date field that could disagree with the start.
17. As an operator, I want to write a required free-text motivo when registering maintenance, so that the reason for the intervention is always documented.
18. As an operator, I want to enter optional free-text observations, so that extra context can be captured without being mandatory.
19. As an operator, I want `observaciones` to be normalized (trimmed; empty becomes `undefined`) so that stores stay clean.
20. As an operator, I want my name recorded automatically as the operator of the maintenance (required, trimmed), so that every maintenance has an accountable registrar.
21. As an operator, I want the system to reject an empty operator name, so that no anonymous maintenance exists.
22. As an operator, I want there to be no separate "who physically executed" field, so that the domain stays with the operario de estampado identity; whoever intervened can be noted in `queSeRevisoReparo` or `observaciones`.
23. As an operator, I want no more than one open maintenance per machine, so that the machine's servicing state is unambiguous.
24. As an operator, I want the attempt to open a second maintenance for M1 while one is open to be rejected, so that the one-open rule is enforced.
25. As an operator, I want a closed maintenance never to block the registration of a new one, so that consecutive interventions are recorded normally.
26. As an operator, I want the one-open rule documented as a temporary operational restriction (not a general domain impossibility), so that a future flow needing concurrency can relax it.
27. As an operator, I want preventivo maintenance to require `danoId = null`, so that a preventivo can never be misleadingly linked to a daño.
28. As an operator, I want reactivo maintenance to allow `danoId` with a value or `null`, so that the link stays optional.
29. As an operator, I want the domain to validate, through an injected lookup, that a linked daño exists when `danoId` is provided, so that no maintenance references a nonexistent daño.
30. As an operator, I want one daño to be able to originate several reactivo maintenances, so that multiple interventions over the same root cause are all recorded.
31. As an operator, I want maintenance to be registerable during a production order or during an empty day, so that servicing on the machine is never blocked by order state.
32. As an operator, I want maintenance visible in the current shift/operative-day timeline in EmptyDay, OrderAvailable, OrderInProduction, and OrderFinished, so that the day's events are complete.
33. As an operator, I want the maintenance form to show the daño selector only for reactivo maintenance, so that the preventivo form stays simple.
34. As an operator, I want to see open maintenance as "in progress" in the current shift/operative-day timeline with its derived running duration, so that the current servicing state is visible.
35. As an operator, I want to close the open maintenance from the same section, so that the workflow stays in one place.
36. As an operator, I want maintenance never to change the shift summary, so that the derived time model (ADR 0004) stays untouched.
37. As an operator, I want a reactivo maintenance whose daño caused a parada to count the temporal incidence only through that parada, so that the time model has no double counting.
38. As an operator, I want a preventivo maintenance with no parada to generate no temporal incidence automatically, so that documentary maintenance does not invent downtime.
39. As an operator, I want completed maintenance records to be immutable (no edit, no delete), so that the service history cannot be altered after the fact.
40. As an operator, I want the only allowed update to be the close operation (completing `fin` and `queSeRevisoReparo`), so that the record's lifecycle is explicit.

### Implementation Decisions

#### Architecture

The feature follows the established three-seam pattern of the codebase (mirror of Ticket 05 — daños): pure domain → in-memory persistence → UI integration. Implementation order: **1. pure domain, 2. in-memory persistence, 3. UI and integration**.

#### Seam 1 — Pure domain

- **Types** (`src/domain/types.ts`, Ticket 08 section): `TipoMantenimiento = "reactivo" | "preventivo"`, `TipoMantenimientoDef` (id + nombre), `Mantenimiento`, `MantenimientoAbierto` (`Mantenimiento & { fin: null }`), and the injected lookup type `ObtenerDanoPorId`.
- **`Mantenimiento` fields** (ISO-8601 timestamps; `maquinaId: "M1"`):
  - `id` (generated by the domain), `maquinaId`, `operatorName` (required, trimmed)
  - `tipo` (`reactivo | preventivo`)
  - `danoId: string | null` — allowed only for reactivo; must be `null` for preventivo
  - `inicio` (ISO 8601, required — the **only** temporal reference; no separate date/fechaOperativa field)
  - `fin: string | null` (null = in progress)
  - `motivo` (required, free text, trimmed)
  - `queSeRevisoReparo?: string` — **only** while `fin === null` (in progress) may it be empty/omitted. When the record is closed (`fin !== null`), it must be present and non-empty after `trim`. A complete one-step registration includes `fin` and `queSeRevisoReparo`. The single field describes what was checked and/or repaired. Its absence is valid **exclusively** for in-progress maintenances — never for closed ones.
  - `observaciones?: string` — optional, trimmed; empty becomes `undefined`
- **Closed catalog** `TIPOS_MANTENIMIENTO` with `{ id: "reactivo", nombre: "Mantenimiento reactivo" }` and `{ id: "preventivo", nombre: "Mantenimiento preventivo" }`, plus `getTiposMantenimiento()` and `getTipoMantenimientoPorId(id)`.

**`RegistrarMantenimientoInput`**:
- `inicio` — required, ISO 8601.
- `fin` — **optional**. Omitted → the maintenance is created open (`fin = null`). Present → must be ISO-valid and satisfy `fin >= inicio`; **`queSeRevisoReparo` becomes required**.
- If `fin` is omitted, `queSeRevisoReparo` may be omitted (record stays open).
- One-step complete registration = `fin` present + `queSeRevisoReparo` present and non-empty after trim.

**Normalization**:
> Before storage, the domain normalizes: `operatorName`, `motivo`, and `queSeRevisoReparo` are trimmed; `operatorName` and `motivo` must not remain empty (rejected); `queSeRevisoReparo` must not remain empty at close or in a one-step complete registration; `observaciones` is trimmed and, if it becomes empty, normalized to `undefined`. **The normalized values are what the domain returns and what persistence receives** — persistence never re-normalizes.

- **`registrarMantenimiento`** (open or complete-in-one-step): enforces the **temporary operational restriction** — a single open maintenance per machine (reject when another `fin = null` maintenance exists for M1; "restricción operativa temporal, relaxable if the flow requires it", same documented framing as `registrarDano`).
- **Declarative daño relationship** (symmetry with `causoParada`/`paradaId`): preventivo → `danoId` must be exactly `null`; reactivo → `danoId` may be a value or `null`. When `danoId` is present on a reactivo maintenance, the domain **invokes the injected `ObtenerDanoPorId`**. If the lookup does not find the daño, the operation is **rejected with no mutation** — no record is created, nothing is persisted. The domain never imports nor knows any concrete repository; only the injected lookup type is used (same principle as `danos.ts:18-21`).
- **`cerrarMantenimiento`** returns a **new closed record**; it does **not** mutate the open record received. It completes exactly `fin` and `queSeRevisoReparo`; all other fields remain equal. After close there is no edit and no delete. The repository persists **only the closed record**, via `updateMantenimiento`.
- **`mantenimientoAbierto`**: structural query utility for the one-open restriction and the UI (same nature as `danoAbierto`).
- **Explicitly untouched**: `tiempo.ts`, `ResumenTiempoTurno`, `calidad.ts`, orders, readings, `porcentaje2da` (ADR 0007: maintenance is documentary).

#### Seam 2 — Persistence (in-memory)

- `IMantenimientoRepository` with explicit insert/update (no upsert): `insertMantenimiento(mantenimiento)`, `updateMantenimiento(mantenimiento)` (close path), `obtenerPorId(id)`, `listarPorMaquina(maquinaId)`, `getMantenimientoAbierto(maquinaId): MantenimientoAbierto | null`.
- In-memory implementation with `structuredClone` defensive copies on every persist/read (same contract as existing repositories).
- The repository persists already-validated records and **does not duplicate business rules** (no daño existence checks, no one-open rule enforcement, no normalization); `getMantenimientoAbierto` only queries.
- Fixtures for tests following the existing `*Fixtures.ts` convention.

#### Seam 3 — UI and integration

- `MantenimientoSection` (mirror of `DanoSection`): registration form (type from the catalog; daño selector **only** for reactivo; motivo; start; optional close-in-one-step fields), in-progress maintenance display with running derived duration, and the close action (end timestamp + `queSeRevisoReparo` required).
- Visible in the **current shift/operative-day timeline** in `EmptyDay`, `OrderAvailable`, `OrderInProduction`, and `OrderFinished`. The section represents **machine-level maintenance, never order-level**: the maintenance model has **no `ordenId`**. In `OrderFinished`, the section may show the event as part of the **current shift/operative-day timeline**, but creating or closing a maintenance associated with a finished order is **not allowed**. The section creates **no history navigation** and **does not promise exact historical reconstruction**.
- `operatorName` comes from the registered operator identity (same wiring as existing sections).
- Wiring in `App.tsx`: state + handlers, injecting the daño lookup as `(id) => danoRepository.obtenerPorId(id)` at the application layer; state refresh after persistence.
- Does not modify `tiempo.ts`, `ResumenTiempoTurno`, `calidad.ts`, or any existing repository.

### Testing Decisions

- **What makes a good test**: test external behavior only, never implementation details. Domain tests prove what the operator observes: accept/reject decisions, the resulting record shape, and the invariants (valid timestamps, `fin >= inicio`, one-open restriction, daño-link rules, close completeness, normalization). Repository tests prove persistence round-trips and defensive cloning. UI tests prove the operator flows (open, close, single-step, day-empty visibility, daño selector only for reactivo).
- **Modules to be tested**:
  - Pure domain: `src/domain/mantenimiento.test.ts` — catalog, `registrarMantenimiento` (open / one-step), `cerrarMantenimiento`, `mantenimientoAbierto`, every validation from the approved Q16 set, the one-open restriction, the declarative daño relationship with injected lookup, normalization.
  - Persistence: in-memory repository tests — insert/update/obtenerPorId/listarPorMaquina/getMantenimientoAbierto, duplicate-id rejection, defensive clone behavior, no re-normalization.
  - UI + integration: component and `App.test.tsx` tests — registration form behavior, daño selector visibility per type, timeline presence in the four states and EmptyDay, close flow.
- **Prior art**: `danos.test.ts` (42 domain tests), `danosRepository.test.ts` (13 store tests), `App.test.tsx` "ticket 05" describe block (10 UI/integration tests) — the maintenance suite follows the same shape and naming conventions.

### Out of Scope

- Dedicated maintenance history panel / historical navigation (current shift/operative-day timeline only) and exact historical reconstruction.
- Any association of maintenance to a production order (`ordenId` does not exist in the maintenance model).
- A separate "who physically executed the maintenance" identity field (only `operatorName` of the registrant; interveners go in `queSeRevisoReparo`/`observaciones`).
- Editing or deleting maintenance records (immutable after close; close is the only update).
- A catalog of motivos or invented maintenance categories (free text, per Q3; a future catalog is a later explicit decision).
- Fixed periodicity or scheduling of preventivo maintenance.
- Any direct effect on productive time, `ResumenTiempoTurno`, or `tiempo.ts` (ADR 0007).
- Multiple simultaneous open maintenances for the same machine (while the temporary operational restriction stands; relaxing it later is a new decision).
- Daño selector for preventivo maintenance.
- Auto-normalization or re-normalization in persistence (normalization belongs to the domain only).
- Official 1ra/2da classification (Acabado's domain), devolution flows, or any other existing ticket scope.
- Real SQLite/Tauri persistence (in-memory repositories, async annotated, same as existing tickets).

### Further Notes

- Vocabulary follows `CONTEXT.md` (Mantenimiento, reactivo/preventivo, daño, Parada, operario de estampado); ADR 0006 (maintenance is machine-level, never per paint chemistry) and ADR 0007 (maintenance is documentary, no productive-time deduction) are governing.
- The daño link is **optional integration, never a precondition** for reactivo maintenance; a daño can originate multiple reactivo maintenances (1:N).
- Temporal incidence remains exclusively via the linked parada, if one exists — no double counting (ADR 0004 + ADR 0007).
- Terms used consistently: current shift/operative-day timeline, derived duration, documentary maintenance.

## Cycle strategy

- **Ciclo 1 — pure domain (completed):** `TipoMantenimiento`/`TipoMantenimientoDef`/`Mantenimiento`/`MantenimientoAbierto` types, maintenance catalog, `registrarMantenimiento` (open/one-step), `cerrarMantenimiento`, `mantenimientoAbierto`, validations, declarative daño relationship via `ObtenerDanoPorId`, normalization, domain tests. No persistence, no UI, no changes to `tiempo.ts`, repositories, or UI.
- **Ciclo 2 — persistence (completed):** `IMantenimientoRepository` + in-memory implementation; wiring into the store.
- **Ciclo 3 — UI (completed):** `MantenimientoSection` across the four order states and EmptyDay; open/close flows; daño selector only for reactivo; event in the current shift/operative-day timeline.

## Closure evidence

### Ciclo 1 — Pure domain
- **Files:** `src/domain/mantenimiento.ts` (254 lines), `src/domain/mantenimiento.test.ts` (636 lines), types in `src/domain/types.ts` (lines 316–361)
- **Tests:** 44 passed ✅
- **Scope:** catalog closed (reactivo/preventivo), `registrarMantenimiento` (open/one-step), `cerrarMantenimiento` (new record, never mutates), `mantenimientoAbierto`, `fin >= inicio`, normalization (operatorName, motivo, queSeRevisoReparo, observaciones), declarative daño relationship with injected lookup, max one open per machine, documentary (no touch to tiempo.ts)

### Ciclo 2 — In-memory persistence
- **Files:** `src/store/mantenimientoRepository.ts`, `src/store/inMemoryMantenimientoRepository.ts`, `src/store/mantenimientoFixtures.ts`, `src/store/mantenimientoRepository.test.ts`
- **Tests:** 13 passed ✅
- **Scope:** `insertMantenimiento`/`updateMantenimiento`/`obtenerPorId`/`listarPorMaquina`/`getMantenimientoAbierto`, `structuredClone` defensive copying (3 scenarios), duplicate id rejection, no re-normalization, chronological order

### Ciclo 3 — UI and integration
- **Files:** `src/ui/MantenimientoSection.tsx`, modifications to `src/App.tsx`, `EmptyDay.tsx`, `OrderAvailable.tsx`, `OrderInProduction.tsx`, `OrderFinished.tsx`, tests in `src/App.test.tsx`
- **Tests:** 16 passed ✅
- **Scope:** section in 4 states + EmptyDay, open/one-step/close flows, reactivo-only daño selector with "Sin vínculo", preventivo without daño, un-abierto-per-machine rejection, close-requires-description, chronological timeline, OrderFinished without create/close

### Full validation
- **Full test suite:** 366 tests across 14 files, all passing ✅
- **Typecheck (`tsc --noEmit`):** clean (0 errors) ✅
- **Build (`vite build`):** succeeded (1.76s, 290.95 kB JS, 8.70 kB CSS) ✅

### Decisions implemented
- `insertMantenimiento` for both open and complete registration; `updateMantenimiento` only for persisting closed records
- Domain as single source of truth for validations, normalization, reactivo/preventivo link, max one open, dates, required description at close
- UI without duplicated business rules; only presentation-level validations for UX
- Daño selector only for reactivo with "Sin vínculo" option; absent for preventivo
- Machine-level section for M1; no `ordenId` in the maintenance model
- OrderFinished shows chronological documentary of current shift only; no create/close for finished orders
- No edit, delete, dedicated historical panel, or historical reconstruction
- ADR 0006 (machine-level, never per paint chemistry) and ADR 0007 (documentary, no productive-time deduction) governing

### Deviations
None. All three cycles implemented as specified.