---
id: "09-dashboard-home"
status: closed
parent: null
created: 2026-09-15T00:00:00.000Z
closed: 2026-09-17T12:55:00.000Z
---

# 09: Dashboard Home — Machine Status, Stop, Time Picture, and Buena Racha

**Blocked by:** 02, 04, 06

**Status:** closed

---

## Problem Statement

The operator opens the dashboard and must reconstruct the machine's current state by scanning multiple sections: checking ParadasSection for an open stop, ResumenTiempoSection for the time picture, and CalidadSection for the 2da alert. There is no single view that answers the most immediate operational questions: Is the machine running? If not, why and for how long? How is the shift going? Is production at risk of generating segunda?

When the machine is stopped, the operator must scroll to ParadasSection to find the cause and mentally calculate how long it has been stopped. This delays awareness and slows reaction.

## Solution

A new `DashboardHome` section, rendered above all existing views in `App.tsx`, that answers the operator's five most critical questions at a glance using exclusively derived data:

1. Is the machine running, stopped, or idle?
2. If stopped, what is the cause and how long has it been stopped?
3. Is there an open maintenance record?
4. Is there a 2da alert or buena racha state? (only when an order exists)
5. How is the shift time picture? (four buckets: total available, planned non-productive, incidence, productive)

All values are derived from existing domain functions and persisted data. Nothing asks the operator to restate state. The section is read-only and always visible regardless of order state.

## Acceptance Criteria — Checklist

- [x] `DashboardHomeProps` interface defined in `src/ui/DashboardHome.tsx`
- [x] Machine state rendered with color + Unicode icon + text (ANDANDO, PARADA, OCIOSA)
- [x] Open stop shows cause (readable text) + formatted duration
- [x] Open maintenance shows type + motivo + formatted duration
- [x] Quality section shows estado + percentage when order exists; hidden when null
- [x] Time summary renders four buckets: total disponible, planificado, incidencias, productivo
- [x] Duration format matches ResumenTiempoSection (<60 min → "X min"; 60+ min → "X h Y min")
- [x] Accessibility: `role="status"`, `aria-label="Estado de la máquina"`, explicit text
- [x] No domain imports in DashboardHome (purely presentational)
- [x] 30-second timer with cleanup on unmount
- [x] "Causa desconocida" fallback when cause ID not in catalog
- [x] All 9 empty-state scenarios covered
- [x] DashboardHome renders BEFORE conditional views in App.tsx
- [x] Integration tests verify DashboardHome in all 4 order states
- [x] CSS uses existing design tokens, fixed 4-column grid layout
- [x] 38 tests pass, typecheck clean, build successful

## Sub-Tickets

| Sub-ticket | Description | Status |
|-----------|-------------|--------|
| 09-01 | DashboardHome component — presentational shell | closed |
| 09-02 | App.tsx wiring — derive props and render | closed |
| 09-03 | Timer, CSS, accessibility, and polish | closed |

## Implementation Decisions

### Component Architecture

- **DashboardHome** is a new presentational component in `src/ui/DashboardHome.tsx`
- It receives pre-derived props via `DashboardHomeProps` interface, defined in the same file
- It does NOT import domain functions, repositories, or any business logic
- It does NOT persist any state beyond the 30-second refresh timer
- `App.tsx` renders `DashboardHome` BEFORE the conditional that selects EmptyDay, OrderAvailable, OrderInProduction, or OrderFinished

### Machine State Derivation

Three machine states, derived at render time in `App.tsx`:

- **ANDANDO**: `orden?.estado === "in_production"` AND no open stop for M1
- **PARADA**: an open stop exists for M1 (with or without `ordenId`)
- **OCIOSA**: `orden?.estado !== "in_production"` AND no open stop for M1

The state is NOT persisted. It is recomputed on every render from existing domain data. A stop with `ordenId = null` also determines PARADA. The machine state and order state are independent dimensions.

### DashboardHomeProps Contract

```typescript
interface DashboardHomeProps {
  /** Derived machine state. Not persisted. */
  estadoMaquina: "andando" | "parada" | "ociosa";

  /** Open stop data, if one exists. null = no open stop. */
  paradaAbierta: {
    cause: string;         // readable catalog name, or "Causa desconocida"
    durationSeconds: number; // accumulated, refreshed every 30s
  } | null;

  /** Open maintenance data, if one exists. null = no open maintenance. */
  mantenimientoAbierto: {
    tipo: "reactivo" | "preventivo";
    motivo: string;
    durationSeconds: number; // accumulated, refreshed every 30s
  } | null;

  /** Quality projection. null when no order exists (section hidden). */
  calidad: {
    estado: "buena_racha" | "alerta";
    porcentaje: number; // decimal fraction, e.g. 0.042
  } | null;

  /** Shift time summary. Always present. */
  resumenTiempo: {
    totalDisponible: number;
    planificado: number;
    incidencias: number;
    productivo: number;
  };
}
```

### Props Location

- `DashboardHomeProps` is defined in `src/ui/DashboardHome.tsx`, NOT in `src/domain/types.ts`
- This is a presentation contract, not a domain type

### Visual Priority (Reading Order)

The component renders information in this vertical order:

1. Machine state (color + Unicode icon + text)
2. Open stop (if exists) — readable cause + duration
3. Open maintenance (if exists) — type + motivo + duration
4. Quality/second (only when order exists) — estado + percentage
5. Time summary (always) — four buckets

### State Display Format

- **ANDANDO**: green color + ▶ + "ANDANDO"
- **PARADA**: red color + ⏸ + "PARADA"
- **OCIOSA**: gray color + — + "OCIOSA"

Stop line format: `⏸ PARADA — [cause] · [duration]`
Maintenance line format: `🔧 Mantenimiento [tipo] — [motivo] · [duration]`
Quality format: `Buena racha · X.X%` or `Alerta · X.X%`

Colors reuse existing CSS semantic tokens from the project. Icons are Unicode characters (▶, ⏸, —). No icon library is added.

### Duration Format

- Less than 60 minutes: `X min`
- 60 minutes or more: `X h Y min`

Same format as existing `ResumenTiempoSection`. No alternative duration format is created.

### 30-Second Timer

- A `setInterval` inside `DashboardHome` refreshes duration displays every 30 seconds
- The timer is created in a `useEffect` and cleaned up on unmount
- The timer only affects presentation; it does not modify domain data, persisted state, or re-fetch from repositories
- Pattern follows `MantenimientoSection.tsx` existing implementation

### Unknown Cause Fallback

- When `getCausaParadaPorId(parada.causaId)` returns `undefined`, display "Causa desconocida"
- Never display `undefined`, `null`, or a raw technical ID as fallback
- The stop still determines PARADA state even if its cause cannot be resolved

### Empty States

| Scenario | Result |
|---|---|
| No order + no stop + no maintenance | OCIOSA + time summary |
| No order + open stop | PARADA + cause/duration + time summary |
| No order + open maintenance | OCIOSA + maintenance + time summary |
| No order + stop + maintenance | PARADA + stop + maintenance + time summary |
| Order available + no stop | OCIOSA + time summary |
| Order in production + no stop | ANDANDO + quality + time summary |
| Order in production + open stop | PARADA + stop + quality + time summary |
| Order finished + no stop | OCIOSA + time summary |
| Order finished + open stop | PARADA + stop + time summary (no quality) |

### Accessibility

- The component uses `<section role="status" aria-label="Estado de la máquina">`
- Text explicitly identifies the state (not relying solely on color or icon)
- No additional `aria-live` attribute is added (avoids repetitive announcements from the 30-second timer)

### First Render Behavior

- The first render shows OCIOSA because initial state arrays are empty before `useEffect` hydration
- This is NOT a loading state; it is the correct derived state for "no data yet"
- No skeleton, spinner, or loading indicator is added
- After hydration, the component re-renders with actual derived values
- No data is invented during the initial render

### CSS Layout Decision

- **Layout:** Fixed 4-column grid (`repeat(4, 1fr)`) for the time summary buckets
- **Responsive:** OUT OF SCOPE — no media queries, no `auto-fit`, no `minmax()` fluid behavior
- **Rationale:** The spec aapproved a fixed 4-bucket row. Responsive behavior is explicitly deferred to a future ticket.
- **Correction applied:** `auto-fit` + `minmax(120px, 1fr)` was initially added but removed during review (line 732 of App.css). Replaced with `repeat(4, 1fr)`.

## Testing Decisions

- DashboardHome is a presentational component: tests verify rendered output for each combination of props
- Tests cover all 9 empty-state scenarios from the table above
- Tests verify the 30-second timer refreshes duration values
- Tests verify cleanup on unmount (no lingering timers)
- Tests verify "Causa desconocida" fallback when cause ID is not in catalog
- Tests verify quality section is hidden when `calidad` is null
- Tests verify quality section shows estado + percentage when `calidad` is provided
- Tests verify the component renders in the correct DOM position (before order views)
- Tests follow the existing pattern: render with props, assert on DOM output
- App.tsx integration tests verify DashboardHome receives correct derived props in each order state

## Out of Scope

- **Responsive behavior / media queries** (may be addressed in a future ticket)
- Persisted `EstadoMaquina` type or machine state storage
- New domain functions to derive data that already exists
- Interaction: buttons, forms, actions, navigation from the Dashboard Home
- History of closed stops in the summary
- Planned activities in the summary
- Quality/second indicator when no order exists
- Alternative duration format
- Loading state, skeleton, or spinner
- New services, global hooks, stores, or unnecessary abstractions
- Modification of existing domain rules (paradas, tiempo, calidad, danos, inspeccion, mantenimiento)

## Evidence

### Test Results

- **DashboardHome.test.tsx:** 38 tests — all passing
- **App.test.tsx:** 7 integration tests for DashboardHome — all passing
- **Typecheck:** clean (no errors)
- **Build:** successful (dist/index.html, dist/assets/*)

### Files Modified

| File | Change |
|------|--------|
| `src/ui/DashboardHome.tsx` | New component (138 lines) |
| `src/ui/DashboardHome.test.tsx` | 38 tests |
| `src/App.tsx` | Imports, DashboardHome props derivation, renders DashboardHome |
| `src/App.test.tsx` | +7 integration tests |
| `src/App.css` | DashboardHome styles (lines 666–755) |

### CSS Correction Record

- **Issue:** `auto-fit` + `minmax(120px, 1fr)` was added on line 732, creating responsive behavior
- **Spec violation:** Responsive/media queries were explicitly out of scope
- **Resolution:** Replaced with `repeat(4, 1fr)` (fixed 4-column grid)
- **Verification:** 38 tests pass, typecheck clean, build successful
- **Decision:** Fixed layout matches approved design; responsive deferred to future ticket

## Further Notes

- The Dashboard Home is a summary panel, not a new data source
- All data it displays already exists in the domain and repositories
- The component's sole responsibility is presentation
- This ticket does NOT create new tickets or sub-tickets
