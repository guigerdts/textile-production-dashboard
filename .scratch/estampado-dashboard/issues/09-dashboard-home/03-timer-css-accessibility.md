---
id: "09-dashboard-home/03-timer-css-accessibility"
status: closed
parent: "09-dashboard-home"
created: 2026-09-16T02:30:00.000Z
closed: 2026-09-17T12:50:00.000Z
---

# 03 — Timer, CSS, and Accessibility

## Summary

Add a periodic refresh timer, visual styling, and accessibility attributes to the DashboardHome component, completing the last sub-ticket of the dashboard home feature.

## Files

- `src/ui/DashboardHome.tsx` — timer with 30-second interval and cleanup
- `src/ui/DashboardHome.test.tsx` — timer, cleanup, accessibility, edge case tests
- `src/App.css` — DashboardHome styles (dashboard-home, estado, parada, mantenimiento, calidad, tiempo buckets)

## Acceptance Criteria

- [x] Timer refreshes duration displays every 30 seconds
- [x] Timer cleans up on unmount (no lingering intervals)
- [x] CSS uses existing design tokens (colors, borders, border-radius)
- [x] `role="status"` on container
- [x] `aria-label="Estado de la máquina"` on container
- [x] Explicit text for machine state (not relying on color/icon alone)
- [x] 38 tests pass, typecheck clean, build successful

## Technical Decisions

- **Timer pattern:** Reuse MantenimientoSection's `useState(0)` + `setInterval` + `useEffect` cleanup pattern
- **CSS approach:** BEM naming (`dashboard-home__element`), existing tokens (#15803d for andando, #b91c1c for parada, #6b7280 for ociosa)
- **Accessibility:** `role="status"` for live region, explicit text alongside icons

## Test Results

- 38 tests in DashboardHome.test.tsx: all passing
- Typecheck: clean
- Build: successful (dist/index.html, dist/assets/*)
