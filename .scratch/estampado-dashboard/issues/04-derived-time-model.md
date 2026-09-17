# 04: Derived time model

**What to build:** Productive time is computed as tiempo total disponible minus planned non-productive time (almuerzo, pausas, cambio de diseño, limpieza) minus incidence time (registered paradas). The operator never types a productive time; the two deduction buckets are mutually exclusive so nothing is double-counted; overtime extends the available window. The dashboard shows the shift time picture: total available, planned non-productive, incidence, and derived productive.

**Blocked by:** 02, 03

**Status:** closed

- [x] Tiempo total disponible comes from the workday window (default 7:00–17:00) and overtime extends it.
- [x] Productive time = total available − planned non-productive − incidence time.
- [x] A period registered as both planned activity and parada is counted exactly once (no double counting).
- [x] The dashboard shows the four time buckets for the shift.
- [x] No UI field asks the operator to enter a productive time.

## Contexto y decisiones aprobadas (2026-09-12)

### Decisiones

1. **Ampliar catálogo de actividades planificadas** — agregar `"almuerzo"` y `"pausa"` a `TipoActividadPlanificada`. Se reutiliza `ActividadPlanificada` íntegramente; no se crea modelo nuevo ni repositorio. `queSeLimpio` no aplica a estos tipos (ya validado por `tipo === "limpieza"`). `observaciones` sigue siendo opcional. Los campos `operatorName`, `inicio`, `fin` y duración mantienen las reglas existentes.

2. **Overtime = fin real del turno (editable)** — Jornada base por defecto: 07:00–17:00. El fin real puede extenderse manualmente (ej. hasta 19:00 si hay overtime). No se crea un registro separado de overtime todavía. Se valida `fin > inicio`. El cálculo vive en dominio puro; no se pide al operario que introduzca "tiempo productivo".

3. **Panel reutilizable de 4 buckets** — `ResumenTiempoSection` visible en los 4 estados del día (vacío, disponible, en producción, finalizada). El Ticket 09 (dashboard home) la reutilizará después. No se convierte en dashboard general todavía.

### Modelo funcional aprobado

**Buckets del turno (derivados, nunca entrada manual):**
- `totalDisponible`: ventana de jornada (`inicio`→`fin`). Default 07:00–17:00, extensible si el operario cambia el fin real.
- `planificado`: unión de intervalos de actividades cerradas (cambio_diseno + limpieza + almuerzo + pausa), recortados a la ventana de jornada. Actividades abiertas se computan hasta el `instanteConsulta` (misma regla que `duracionAcumulada` en paradas).
- `incidencias`: unión de intervalos de paradas cerradas, recortados a la ventana de jornada. Paradas abiertas se computan hasta el `instanteConsulta`.
- `productivo`: `max(0, totalDisponible − unión(planificado, incidencias))`. Nunca negativo. Nunca se escribe manualmente.

**Resolución de solapamiento (no doble conteo):**
- Un tramo cubierto por actividad planificada Y parada se cuenta una sola vez en el total no productivo. Las uniones de cada bucket (`planificado`, `incidencias`) se calculan independientemente; la resta de `productivo` usa la **unión** de ambas (cada minuto contado una vez exacta).
- Ejemplo: actividad 08:00–09:00 y parada 08:30–10:00 → unión no productivo = 08:00–10:00 = 2 h.
- Los registros originales **nunca se modifican** durante el cálculo; es una función pura.

**Regla de recorte a jornada:** intervalos que empiezan antes del inicio de jornada o terminan después del fin se recortan a la ventana.

**Sección UI (`ResumenTiempoSection`):** muestra los 4 campos del turno + un reloj/miniatura del horario de jornada (07:00–17:00 o fin real). La UI **no calcula duraciones ni duplica reglas del dominio** (patrón de ActividadesSection Ticket 03).

**Para el día vacío:** la sección es visible sin orden; el bucket `incidencias` refleja paradas registradas sin `ordenId` (máquina ociosa) si las hubiera.

**Fuera de alcance:** persistir la configuración de jornada (hoy es estado de sesión UI); modificaciones a paradas o actividades; SQLite/Tauri; Ticket 09 dashboard general.

### Reglas del dominio (claras y auditables)

| Regla | Fuente |
|---|---|
| Actividades y paradas abiertas se calculan hasta `instanteConsulta` | Ticket 04 regla adicional |
| Intervalos recortados a la ventana de jornada | Ticket 04 regla adicional |
| Unión de actividades entre sí (no doble conteo intra-bucket) | Ticket 04 regla adicional |
| Unión de paradas entre sí (no doble conteo intra-bucket) | Ticket 04 regla adicional |
| Unión de actividades y paradas (no doble conteo inter-bucket) | Ticket 04 regla adicional |
| `productivo = max(0, disponible − unión(planificado, incidencias))` | Ticket 04 regla adicional |
| No modificar registros originales durante el cálculo | Ticket 04 regla adicional |
| UI no calcula duraciones, delega al dominio | Ticket 04 regla adicional + patrón Ticket 03 |

## Cierre (2026-09-12)

**Ciclos 1–3 completos:** dominio puro (jornada + catálogo ampliado + resumen derivado + 30 tests), persistencia de jornada en repositorio en memoria (interfaz + in-memory + 15 tests), UI e integración (ResumenTiempoSection reutilizable en los 4 estados + handlers en App + 8 tests UI ticket 04).

**sdd-verify Ticket 04: PASS WITH WARNINGS.** 5/5 checklist items y 8/8 reglas del modelo funcional aprobado verificadas contra el código con evidencia file:line y test pasando en runtime. 0 CRITICAL, 0 SUGGESTION. 1 WARNING corregido antes del cierre (ver observación de timezone).

### Cobertura por archivo

| Archivo | Rol | Tests |
|---|---|---|
| `src/domain/types.ts` (sección Ticket 04) | Tipos: `JornadaTurno`, `ResumenTiempoTurno`, catálogo `TipoActividadPlanificada` ampliado con `almuerzo`/`pausa` | — |
| `src/domain/tiempo.ts` | Seam puro: `jornadaDefault`, `HORA_INICIO/FIN_DEFAULT`, `validarJornada` (fin > inicio), `resumenTiempoTurno` (buckets derivados, unión sin doble conteo, recorte a jornada, abiertas hasta `instanteConsulta`, `productivo = max(0, …)`) | `src/domain/tiempo.test.ts` — 30 tests |
| `src/domain/actividades.ts` | Catálogo ampliado (sin modelo ni repo nuevos) | `src/domain/actividades.test.ts` — 29 tests |
| `src/store/jornadaRepository.ts` | `IJornadaRepository` (`obtenerParaFecha`, `guardarJornada` con `structuredClone` defensivo) | `src/store/jornadaRepository.test.ts` — 9 tests |
| `src/store/inMemoryJornadaRepository.ts` | Implementación en memoria; delega `validarJornada` al dominio | `src/store/inMemoryJornadaRepository.test.ts` — 6 tests |
| `src/ui/ResumenTiempoSection.tsx` | Sección reutilizable: jornada visible con fin editable (overtime), 4 buckets (NO `noProductivoTotal`), errores de dominio, solo formatea duraciones | `src/App.test.tsx` — describe "ticket 04" 8 tests |
| `src/ui/EmptyDay.tsx`, `OrderAvailable.tsx`, `OrderInProduction.tsx`, `OrderFinished.tsx` | Integración de la sección en los 4 estados (interfaces extienden `ActividadesProps & ResumenTiempoProps`) | — |
| `src/App.tsx` | Estado `jornada` + `jornadaRepository` (useMemo default vacío) + `handleCambiarFinJornada` (`"HH:MM"` → ISO con `hoy`, valida en repo, setJornada solo si pasa) + resumen con `instanteConsulta: now` | — |
| `src/main.tsx` | Inyección `InMemoryJornadaRepository([])` | — |
| `src/App.css` | Estilos `.resumen-tiempo__*` | — |

### Evidencia de tests/build

- Suite completa: **261/261 tests en 9 archivos** — UI 50/50 (`npx vitest run --pool=threads --isolate=false --maxWorkers=1 src/App.test.tsx`) + dominio/store 211/211 (`npx vitest run --pool=threads --isolate=false --maxWorkers=2 src/domain src/store`). Se corre por partes por la observación Vitest del entorno.
- Build: **OK** — `npm run build` (tsc + vite, dist 254.55 kB js / 5.71 kB css).

### Observación registrada (acuerdo con usuario)

El modelo de tiempo asume **jornada del día operativo actual**: la jornada mostrada corresponde al día operativo actual; NO hay navegación histórica ni cambio de fecha; el cálculo NO debe interpretarse como reconstrucción histórica exacta; el fin de jornada editable representa la **ventana disponible** (anthropomorphic: window), no trabajo efectivamente realizado. Persistencia de configuración de jornada y navegación histórica quedan fuera de alcance (futuros tickets).

### Observación no bloqueante — timezone (WARNING corregido en el cierre)

`horaParaInput` usaba `toLocaleTimeString("es-AR")` sin `timeZone`, lo que desplazaría la jornada 07:00–17:00 a 04:00–14:00 en un navegador en Argentina (UTC−3) aunque el dominio persiste todo en UTC. Corregido en `src/ui/ResumenTiempoSection.tsx`: se fuerza `timeZone: "UTC"` en la conversión a `"HH:MM"`. Evidencia: 50/50 tests UI + build OK post-fix.