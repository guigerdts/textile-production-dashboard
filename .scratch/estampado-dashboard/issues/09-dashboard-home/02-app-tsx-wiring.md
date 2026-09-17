---
id: "09-dashboard-home/02-app-tsx-wiring"
status: closed
parent: "09-dashboard-home"
created: 2026-09-16T02:30:00.000Z
closed: 2026-09-17T02:45:00.000Z
---

# 09-02: App.tsx wiring — derive props and render DashboardHome

## Summary

Wire DashboardHome into App.tsx with correct prop derivation from domain data and integration tests.

## Files

- `src/App.tsx` — modified: imports, DashboardHome props derivation, renders DashboardHome
- `src/App.test.tsx` — modified: +7 integration tests

## Acceptance Criteria

- [x] App.tsx computes estadoMaquina from paradaAbierta and orden?.estado
- [x] App.tsx computes paradaAbierta prop with cause resolution and accumulated duration
- [x] App.tsx computes mantenimientoAbierto prop from domain data
- [x] App.tsx computes calidad prop from proyeccionSegundaDeOrden
- [x] App.tsx passes resumenTiempo from resumenTiempoTurno
- [x] DashboardHome rendered BEFORE conditional views
- [x] DashboardHome receives correct derived props in all 4 order states
- [x] Quality hidden when no order or order finished
- [x] Integration tests verify DashboardHome in all 4 states
- [x] 7 integration tests pass, typecheck clean
