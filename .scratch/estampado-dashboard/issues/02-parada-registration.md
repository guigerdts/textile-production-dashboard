# 02: Parada registration with the 10 predefined causes

**What to build:** The operator registers an unexpected stop with one of the 10 predefined parada causes, each cause asking for its own specific data (carro number 1–7 for "daño en el carro", missing color(s) or "all" for "falta de pintura", repair time where required) plus free-text observations. Once stopped, the dashboard shows the current stop's cause and accumulated duration, so the operator can answer "how long have we been stopped and why" at a glance.

**Blocked by:** 01

**Status:** closed

- [x] The 10 predefined causes are available; no free-text-only cause exists.
- [x] Each cause validates its specific data: carro in 1–7; color for falta_color; carro+componente for danio_mecanico; carrosAfectados 1–7 for ajuste_registro.
- [x] Free-text observations are accepted on every parada.
- [x] When a stop is open, the dashboard shows its cause and accumulated duration.
- [x] Parada records carry the operator's name.

**Closed:** 2026-09-11 — Ciclos 1–3 completos (dominio, repositorio en memoria, UI). 149/149 tests pasan; build OK. Verify ticket 02: 0 CRITICAL restantes tras corregir: (1) duración acumulada visible en el banner de parada abierta (refresco 30 s), (2) operatorName en el registro de parada (se propaga desde la orden en producción). Cobertura por archivo: `src/domain/paradas.ts` (+tests), `src/store/paradasRepository.ts`/`inMemoryParadasRepository.ts`/`paradasFixtures.ts` (+tests), `src/ui/ParadasSection.tsx`, `src/ui/OrderInProduction.tsx`, `src/App.tsx`, `src/App.test.tsx`.

Observación (deuda técnica, no bloqueante): el wording original del ticket mencionaba "at least one color or 'all'" y "repair time where required"; el modelo funcional aprobado usa `falta_color` con un único campo `color` (sin "all") y sin repair time — resuelto a favor del modelo aprobado, documentado aquí para el registro.