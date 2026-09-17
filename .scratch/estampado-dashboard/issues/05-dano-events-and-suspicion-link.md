# 05: Daño events with simultaneous consequences and suspicion link

**What to build:** The operator registers an independent daño event (type eléctrico, mecánico, or operacional; affected component; start time; repair duration; solution applied; observations) whose consequences are independent and may occur simultaneously: whether it caused a stop and/or whether it may have produced 2da. A daño-caused stop links to the corresponding parada; suspected 2da units can be linked to the daño as their origin — recorded as suspicion/projection, never as official classification.

**Blocked by:** 01, 02

**Status:** closed

- [x] Daño records all fields: type, affected component, start time, repair duration, solution applied, observations.
- [x] "Caused a stop" and "may have produced 2da" are independent flags; both can be set simultaneously.
- [x] A daño that caused a stop links to the corresponding parada.
- [x] Suspected 2da units link to the daño as origin and are stored as suspicion/projection data.
- [x] Daño records carry the operator's name.

## Functional model (approved)

The daño is an **independent event**, never a parada synonym: registering a daño does not create, close, or modify paradas, and a daño does not add time to the Ticket 04 summary — only a linked parada counts as an incidence. Estampado records suspicion and origin; Acabado owns the official 1ra/2da classification. The daño does not touch `porcentaje2da`, produced unit counts, readings, or order states.

**`Dano` fields:** id, maquinaId ("M1"), ordenId (`string | null`; null = daño without order, machine idle), operatorName (required), tipo (`electrico | mecanico | operacional`), componente (required, free text), inicio (ISO 8601, required), fin (`string | null`; null = open daño), solucionAplicada (required **only at close**), causoParada, paradaId (`string | null`), posibleSegunda, unidadesSospechadas (optional), observaciones (optional).

**Declarative parada relationship (approved):**
- `causoParada = true` → `paradaId` is required. The linked parada must exist, belong to the same machine (M1), correspond to the same order (including the null case), and satisfy the temporal relation `parada.inicio >= daño.inicio`.
- `causoParada = false` → `paradaId` must be exactly `null`.
- The pure domain **must not import a repository interface** (`IParadaRepository`). Existence/coherence verification is injected as an explicit dependency: a lookup function `ObtenerParadaPorId` provided by the application/consumption layer. Structural validation stays in the domain; existence checking stays out.

**Suspicion of 2da (recorded, never classified):**
- `posibleSegunda = false` → `unidadesSospechadas` must be `undefined`.
- `posibleSegunda = true` → optional; when provided, an integer ≥ 0.

**Approved scenarios:**
- Daños **without order** (`ordenId: null`) are allowed (EmptyDay / machine idle).
- The daño section may appear in all four order states; in OrderFinished it shows history plus open pending daños but does **not** allow creating a new daño linked to a finished order.
- A single open daño per machine is accepted as a **temporary operational restriction** of this ticket — documented explicitly in the code, never presented as a general domain impossibility.

## Cycle strategy

- **Ciclo 1 — pure domain (done):** `TipoDano`/`TipoDanoDef`/`Dano`/`DanoAbierto` types, daño catalog, `registrarDano` (open), `cerrarDano`, validations, declarative parada relationship via `ObtenerParadaPorId`, domain tests. No persistence, no UI, no changes to `tiempo.ts`, repositories, or UI.
- **Ciclo 2 — persistence (done):** `IDanoRepository` + in-memory implementation; wiring into the store.
- **Ciclo 3 — UI (done):** daño section across the four order states; registration and closure flows; suspicion origin display.

## Cierre (2026-09-12)

**Ciclos 1–3 completos:** dominio puro (`src/domain/danos.ts` + 42 tests), persistencia (`IDanoRepository`/`InMemoryDanoRepository` + fixtures + 13 tests), UI e integración (`DanoSection` en los 4 estados + handlers en App + 10 tests UI ticket 05). Suite completa 326/326 en 11 archivos y build OK.

**sdd-verify Ticket 05: PASS.** 5/5 checklist items y las 8/8 reglas del modelo funcional aprobado verificadas contra el código con evidencia `file:line` y test pasando en runtime. 0 CRITICAL, 0 WARNING, 0 SUGGESTION.

### Verificación del checklist (5/5)

| # | Item del checklist | Evidencia |
|---|---|---|
| 1 | Daño registra todos los campos (tipo, componente, inicio, fin, solución, observaciones) | `src/domain/danos.ts:67-88` (interfaz de entrada), `:197-211` (construcción del daño), `:220-247` (`cerrarDano` exige fin + solución); pruebas `src/domain/danos.test.ts:448-484` |
| 2 | "Causó parada" y "puede haber producido 2da" son flags independientes; ambos simultáneos | `src/domain/danos.ts:79-84` (declaración independiente), `:141-180` (validaciones por separado, sin exclusión mutua); prueba `src/domain/danos.test.ts:137-163` (vínculo con parada Y sospecha en el mismo daño) |
| 3 | Un daño que causó parada vincula a la parada correspondiente | `src/domain/danos.ts:142-167` (paradaId obligatoria, existe vía `ObtenerParadaPorId`, misma máquina/orden, `parada.inicio >= daño.inicio`); inyección real en `src/App.tsx:269` (`(id) => paradaRepository.obtenerPorId(id)`); pruebas `src/domain/danos.test.ts:262-315`, `src/App.test.tsx:915-961` |
| 4 | Unidades sospechadas de 2da van vinculadas al daño como origen; registro, nunca clasificación | `src/domain/danos.ts:172-180` y `:209` (solo con `posibleSegunda`, entero ≥ 0); `src/domain/types.ts:218`; pruebas `src/domain/danos.test.ts:333-359`, `src/App.test.tsx:980-996` |
| 5 | Los daños llevan el nombre del operario | `src/domain/danos.ts:136-139` (obligatorio) y `:201` (recorte en persistencia); prueba `src/domain/danos.test.ts:212-214` |

### Verificación de reglas (8/8)

| Regla | Evidencia |
|---|---|
| Daño independiente: registrar no crea/cierra/modifica paradas ni aporta tiempo al turno | Docstring `src/domain/danos.ts:5-7`; código de registro no toca repositorio de paradas ni `tiempo.ts`; handlers en `src/App.tsx:266-295` solo persisten el daño |
| Dominio puro sin importar repositorios; verificación inyectada | `src/domain/danos.ts:23` (solo importa tipos), `:53` (tipo `ObtenerParadaPorId`), `:110-114` (parámetro inyectado); App aporta el lookup en `src/App.tsx:269` |
| `causoParada=true` → paradaId obligatoria y coherente | `src/domain/danos.ts:142-167`; pruebas `:262,271,280,289,309` |
| `causoParada=false` → paradaId exactamente null | `src/domain/danos.ts:168-170`; prueba `danos.test.ts:262-315` (bloqueo) |
| Sospecha 2da: `false` → unidades undefined; `true` → opcional entero ≥ 0 | `src/domain/danos.ts:173-180`, `:209`; pruebas `:333-359` |
| Cierre: fin válido, `>= inicio`, solución obligatoria solo al cerrar | `src/domain/danos.ts:227-237`; pruebas `:459-481` |
| Un solo daño abierto por máquina (restricción operativa temporal, no imposibilidad general) | `src/domain/danos.ts:13-16`, `:182-188`; pruebas `:385-388`, `src/App.test.tsx:1064-1080` |
| Daños sin orden permitidos (`ordenId: null`, día vacío) | `src/domain/danos.ts:69-70`; fixture `src/store/danosFixtures.ts` (DANO_4); `src/App.tsx:336` (`orden?.id ?? null`) y `:340` filtro de paradas por coincidencia exacta; prueba `src/store/danosRepository.test.ts:84-89` |

### Decisiones del Ciclo 3 (aprobadas)

1. **Sección de daños en los 4 estados de orden** — `DanoSection` se renderiza en `EmptyDay`, `OrderAvailable`, `OrderInProduction` y `OrderFinished` (patrón de `ActividadesSection`). El registro está permitido en todos salvo `OrderFinished` (`permitirRegistrar: false`): la finalizada muestra historial y daños abiertos pendientes, pero no permite crear un daño nuevo asociado a una orden finalizada.
2. **Daños sin orden (`ordenId: null`) permitidos en día vacío** — coherente con el modelo: un daño es un evento de máquina, no necesariamente de una orden. En `EmptyDay`, `danosProps.ordenId = null` y el registro guarda el daño sin orden.
3. **`operatorNameInicial` opcional con normalización `?? ""`** — detalle de integración para extender `ActividadesProps` (que lo declara opcional). No permite saltar la validación: el dominio sigue rechazando `operatorName` vacío en `registrarDano` ("operatorName es obligatorio").
4. **Fin de cierre precargado con "ahora" y editable** — el input `datetime-local` precarga el instante actual al montar; el operario puede ajustarlo. El dominio valida `fin >= inicio`; un fin que quedara anterior al inicio es rechazado (nunca se "autocorrige" el timestamp).
5. **Cierre por `getDanoAbierto("M1")`** — bajo la restricción operativa de un único daño abierto por máquina, cerrar siempre apunta al abierto de la máquina; no se introduce un selector de daño para cerrar (fuera de alcance mientras la restricción temporal rija).

### Separación de capas (verificada)

- **UI** (`DanoSection.tsx`): reúne inputs, muestra errores del dominio y formatea horas/duraciones; NO calcula ni valida reglas.
- **Dominio** (`src/domain/danos.ts`): `registrarDano` (validaciones + relación declarativa con parada vía `ObtenerParadaPorId` inyectada), `cerrarDano` (fin >= inicio + solución obligatoria), `danoAbierto`, catálogo tipificado.
- **Repositorio** (`src/store/danosRepository.ts` / `inMemoryDanosRepository.ts`): solo persiste daños ya validados; `insertDano`/`updateDano` explícitos, `structuredClone` defensivo, sin validación de paradas.
- **Orquestación** (`App.tsx`): estado `danos` + handlers `handleRegistrarDano` (inyecta `(id) => paradaRepository.obtenerPorId(id)`) y `handleCerrarDano` (consulta `getDanoAbierto("M1")`); refresco de estado tras persistencia.

La relación daño↔parada permanece **declarativa**: el dominio NO crea, cierra ni modifica paradas; registrar un daño nunca genera incidencia en el resumen del turno (Ticket 04) — solo la parada vinculada cuenta como tal, y el daño no aporta tiempo.

### Catálogo de reglas (resumen operable)

| Regla | Fuente |
|---|---|
| Un solo daño abierto por máquina (restricción operativa temporal, no imposibilidad general) | `registrarDano` — "ya hay un daño abierto para la máquina. Cierre el daño actual antes de registrar otro" |
| Daño sin orden permitido (`ordenId: null`) | `registrarDano` + fixture `DANO_4_SIN_ORDEN_CERRADO` |
| `causoParada = true` → `paradaId` obligatorio, existente, misma máquina, misma orden, `parada.inicio >= daño.inicio` | `registrarDano` (relación inyectada por `ObtenerParadaPorId`) |
| `causoParada = false` → `paradaId === null` | `registrarDano` |
| `posibleSegunda = false` → `unidadesSospechadas === undefined`; `true` → opcional entero ≥ 0 | `registrarDano` |
| Cierre: `fin` requerido, válido y `>= inicio`; `solucionAplicada` requerida solo al cerrar | `cerrarDano` |
| Dominio puro sin imports de repositorios | `src/domain/danos.ts` (dependencia inyectada) |
| Sin tocar lecturas, progreso, `porcentaje2da` ni `tiempo.ts` | invariante de capas verificado |

### Cobertura por archivo

| Archivo | Rol | Tests |
|---|---|---|
| `src/domain/types.ts` (sección Ticket 05) | Tipos: `Dano`, `DanoAbierto` (`Dano & { fin: null }`), `TipoDano`, `TipoDanoDef`, `ObtenerParadaPorId` | — |
| `src/domain/danos.ts` | Seam puro: catálogo tipificado, `registrarDano`, `cerrarDano`, `danoAbierto`, relación declarativa con parada | `src/domain/danos.test.ts` — 42 tests |
| `src/store/danosRepository.ts` | `IDanoRepository` (`insertDano`, `updateDano`, `obtenerPorId`, `listarPorMaquina`, `listarPorOrden`, `getDanoAbierto`) | — |
| `src/store/inMemoryDanosRepository.ts` | Implementación en memoria con `structuredClone` defensivo | `src/store/danosRepository.test.ts` — 13 tests |
| `src/store/danosFixtures.ts` | `DANO_1_CERRADO_CON_PARADA`, `DANO_2_CERRADO_SIN_PARADA`, `DANO_3_ABIERTO`, `DANO_4_SIN_ORDEN_CERRADO` | — |
| `src/ui/DanoSection.tsx` | Sección reutilizable: registro (tipo, componente, flags independientes causoParada/posibleSegunda), vínculo de parada, cierre con fin+solución, historial, duración abierta con reloj de 30 s | `src/App.test.tsx` — describe "ticket 05" 10 tests |
| `src/ui/EmptyDay.tsx`, `OrderAvailable.tsx`, `OrderInProduction.tsx`, `OrderFinished.tsx` | Integración en los 4 estados (interfaces extienden `DanoSectionProps` y renderizan `<DanoSection {...danosProps}/>`) | — |
| `src/App.tsx` | Estado `danos` + `danoRepository` (useMemo default vacío) + `handleRegistrarDano` (inyecta lookup de parada) + `handleCerrarDano` (getDanoAbierto) + `danosProps` combinado | — |
| `src/App.css` | Estilos `.danos__*` | — |

### Evidencia de tests/build

- Suite completa: **326/326 tests en 11 archivos** — UI 60/60 (`src/App.test.tsx`, incluye 10 tests del Ticket 05), dominio 204/204 (calculations 55, danos 42, paradas 43, actividades 34, tiempo 30), store 62/62 (danos 13, paradas 14, actividades 13, jornada 15, repository 7). Corrida final: `npx vitest run --pool=vmThreads --reporter=json` con 326 passing, 0 failing.
- Typecheck: **OK** — `npx tsc --noEmit` sin errores.
- Build: **OK** — `npm run build` (tsc + vite, dist 265.68 kB js / 5.71 kB css).

### Alcance explícitamente fuera de Ticket 05

- **Clasificación oficial de 1ra/2da** — pertenece a Acabado; Estampado solo registra sospecha/origen. El canal por el que la clasificación oficial llega a Estampado no está definido (pendiente futuro).
- **Alertas de 2da / buena racha** — ticket 06.
- **Inspección y devolución de tela** — ticket 07.
- **Mantenimiento (reactivo/preventivo)** — ticket 08.
- **Dashboard home** — ticket 09.
- **Persistencia real (SQLite/Tauri)** — repositorios en memoria; el acceso async queda anotado en `IParadaRepository` y se replica en `IDanoRepository`.
- **Selector de daño para cerrar / varios daños abiertos simultáneos** — mientras rija la restricción temporal de un daño abierto por máquina, `getDanoAbierto("M1")` basta; si el flujo operativo lo requiere, se relaja la restricción y se introduce el selector.