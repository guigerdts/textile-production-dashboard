# 01: Order execution and progress

**What to build:** The operator opens today's view, sees the current production order (design, fabric reference, requested units, required golpes, and any design-implied 2da percentage shown as a projection), starts and finishes producing it, records golpes produced (source: the machine's golpe counter), and sees produced units (1 golpe = 3 toallas) and remaining units/golpes. An empty day is shown clearly, never as an error. Every record carries the operator's name. Persistence keys production to machine identity M1 (single machine; no fleet features).

**Blocked by:** None (can start immediately).

**Status:** closed

- [x] Operator sees today's order: design, fabric reference, requested units, required golpes, and optional design 2da percentage expressed as a projection.
- [x] Operator starts the order, records produced golpes, and finishes the order.
- [x] Produced units derived from golpes (1 golpe = 3 toallas).
- [x] Remaining units and remaining golpes shown against the requested target.
- [x] Required golpes computation includes the optional design 2da percentage as an operational projection, never as a quality classification.
- [x] Empty day (no order assigned) renders clearly without errors.
- [x] Each record carries the operator's name.
- [x] All production data persists under machine identity M1; no multi-machine or fleet behavior exists.

**Closed:** 2026-09-11 — Ciclos 1–3 completos (shell/día vacío/orden disponible, ciclo de producción con lecturas absolutas y finalización, persistencia en repositorio en memoria con machineId M1). sdd-verify ticket 01: CUMPLE, 0 CRITICAL, 1 WARNING no bloqueante y 2 SUGGESTION (ver nota). Evidencia de tests/build: 149/149 tests pasan (5 archivos; `calculations.test.ts`, `repository.test.ts` y ciclos 1–4 de `App.test.tsx` cubren el ticket 01) y `npm run build` OK (tsc + vite).

Nota (deuda técnica, no bloqueante — se reporta, no se corrige en este cierre por no refactorizar el ticket 01): `src/ui/OrderDatos.tsx:24-25` recalcula localmente `Math.ceil(unidadesSolicitadas*(1+porcentaje2da))` y `Math.ceil(objetivo/3)` en vez de usar las funciones del seam de dominio (`unidadesObjetivoCon2da`/`golpesRequeridosOrden` en `src/domain/calculations.ts`). Hoy coinciden numéricamente; un cambio futuro del seam quedaría oculto en esta vista. SUGGESTION adicional: `operatorName` vive a nivel de orden (lecturas/finalización no llevan campo propio — cumple CONTEXT.md: un operario por día/máquina); comentario en `calculations.ts:89` usa snake_case `operator_name` (doc interna).