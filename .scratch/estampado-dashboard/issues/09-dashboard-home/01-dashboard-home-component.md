---
id: "09-dashboard-home/01-dashboard-home-component"
status: closed
parent: "09-dashboard-home"
created: 2026-09-16T02:30:00.000Z
closed: 2026-09-17T02:45:00.000Z
---

# 09-01: DashboardHome component — presentational shell with props type

## Summary

Create the DashboardHome component with DashboardHomeProps interface and all 9 empty-state scenarios.

## Files

- `src/ui/DashboardHome.tsx` — component + interface
- `src/ui/DashboardHome.test.tsx` — 28 tests (all passing)

## Acceptance Criteria

- [x] `DashboardHomeProps` interface defined in `src/ui/DashboardHome.tsx`
- [x] Machine state rendered with color + Unicode icon + text
- [x] Open stop shows cause + formatted duration
- [x] Open maintenance shows type + motivo + formatted duration
- [x] Quality section shows estado + percentage; hidden when null
- [x] Time summary renders four buckets
- [x] Duration format matches ResumenTiempoSection
- [x] Accessibility: role="status", aria-label
- [x] No domain imports (purely presentational)
- [x] 28 tests pass, typecheck clean
