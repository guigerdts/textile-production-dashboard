# 03: Planned activities (cambio de diseño, limpieza)

**What to build:** The operator registers planned, authorized non-productive activities: cambio de diseño (start/end, occurring between orders) and limpieza (start/end, what was cleaned). Tuesday 7:00–8:00 is the known default for limpieza; other cleanings remain recordable with their authorization noted. These activities are stored in the planned non-productive bucket and are never counted as paradas or incidences.

**Blocked by:** 01

**Status:** closed

- [x] Cambio de diseño records start and end times.
- [x] Limpieza records start, end, and what was cleaned.
- [x] The Tuesday 7:00–8:00 limpieza is offered as the default; non-Tuesday cleanings are still recordable.
- [x] Planned activities persist as planned non-productive records, not as paradas or incidences.
- [x] Planned activity records carry the operator's name.

## Modelo funcional aprobado (2026-09-11)

**Registro en UI — todos los estados:** día vacío, orden disponible, orden en producción, orden finalizada. Las actividades son independientes de la orden y pueden existir sin `ordenId` (no bloquean lecturas ni finalización de órdenes).

**Modelo de datos (camelCase):**
- `ActividadPlanificada`: `id`, `maquinaId` ("M1" valor actual), `tipo` (`cambio_diseno` | `limpieza`), `inicio`, `fin` (null = abierta), `queSeLimpio` (obligatorio solo para `limpieza`), `observaciones` (opcional en ambos tipos), `operatorName` (obligatorio).
- Período real `inicio`/`fin` ≠ momento de registro. Si el timestamp de creación no aporta valor, se omite; si se incluye, se nombra explícitamente `registradaEn`. (Decisión: omitir `registradaEn` salvo necesidad real.)
- Invariantes: una sola actividad abierta por `maquinaId + tipo`; permitida simultáneamente una limpieza abierta Y un cambio de diseño abierto.
- Fuera de alcance: diseño anterior/siguiente, órdenes relacionadas, Pantone, fórmula de tiempos.

**Regla de prellenado (solo UI):** la sugerencia "martes 7:00–8:00" para limpieza es únicamente de UI, editable, no crea automáticamente una actividad, no restringe otros días ni horarios, y NO se convierte en validación obligatoria.

**Regla al finalizar una orden:** las actividades abiertas no bloquean la finalización; finalizar la orden NO cierra automáticamente una actividad; la actividad puede cerrarse después.

**Mismo patrón que paradas (Ticket 02):** seam de dominio puro, repositorio en memoria con INSERT/UPDATE explícitos, `structuredClone` defensivo, UI delega reglas al dominio.

## Cierre (2026-09-12)

**Ciclos 1–3 completos:** dominio puro (tipos + operaciones + 29 tests), persistencia en repositorio en memoria (interfaz + in-memory + fixtures + 13 tests), UI e integración (sección reutilizable en los 4 estados + handlers en App + 12 tests UI).

**sdd-verify Ticket 03: CUMPLE.** 18/18 reglas verificadas contra el modelo funcional aprobado con evidencia file:line o test. 0 CRITICAL, 0 WARNING, 0 SUGGESTION.

### Cobertura por archivo

| Archivo | Rol | Tests |
|---|---|---|
| `src/domain/types.ts` (sección Ticket 03) | Tipos: `TipoActividadPlanificada`, `TipoActividadDef`, `ActividadPlanificada`, `ActividadAbierta` | — |
| `src/domain/actividades.ts` | Seam puro: `getTiposActividad`, `getTipoActividadPorId`, `comenzarActividad`, `finalizarActividad`, `duracionActividad`, `actividadAbierta` | `src/domain/actividades.test.ts` — 29 tests |
| `src/store/actividadesRepository.ts` | `IActividadPlanificadaRepository` (INSERT/UPDATE explícitos, síncrono, `structuredClone`) | `src/store/actividadesRepository.test.ts` — 13 tests |
| `src/store/inMemoryActividadesRepository.ts` | Implementación en memoria + [fixtures] `src/store/actividadesFixtures.ts` | — |
| `src/ui/ActividadesSection.tsx` | Sección reutilizable (form, banner abierta, cierre, historial, sugerencia martes solo UI) | `src/App.test.tsx` — describe "ticket 03" 12 tests |
| `src/ui/EmptyDay.tsx`, `OrderAvailable.tsx`, `OrderInProduction.tsx`, `OrderFinished.tsx` | Integración de la sección en los 4 estados | — |
| `src/App.tsx` | Estado + `actividadRepository` (useMemo default vacío) + `handleRegistrarActividad` / `handleCerrarActividad` + type guard | — |
| `src/main.tsx` | Inyección `InMemoryActividadPlanificadaRepository([])` | — |
| `src/App.css` | Estilos `.actividades__*` | — |

### Evidencia de tests/build

- Suite completa: **203/203 tests en 7 archivos** — `npx vitest run --pool=threads --isolate=false` (ver observación Vitest).
- Build: **OK** — `npm run build` (tsc + vite, dist 249.60 kB js / 4.96 kB css).

### Observación no bloqueante — Vitest en este entorno

- La suite completa es estable con `--pool=threads --isolate=false` (reutiliza workers entre archivos; ~90 s).
- Con el pool fork por defecto, los workers hacen timeout solo en runs completos (`[vitest-pool-runner]: Timeout waiting for worker to respond`); cada archivo pasa individualmente con el pool por defecto. Es una característica del entorno (ARM, jsdom lento al crearse por archivo), no un defecto de implementación.