# 07: Fabric inspection, devolución, and authorized use

**What to build:** The operator inspects each new fabric lot during production using the checklist (absorción, tundido, manchas, dimensiones/medidas, estado general, plus any other anomaly), with each inspection linked to its order. An anomaly stops the process and is reported; the fabric is not used automatically. The operator can then register a devolución de tela (pre-printing only) or record that the fabric is used anyway with gerencia authorization noted. Observations are recorded; no permission workflow or integration is invented.

**Blocked by:** 01

**Status:** closed (2026-09-13) — Ciclos 1-3 completados y aprobados por el usuario; sin hallazgos bloqueantes.

- [x] Each new fabric lot has an inspection record with the full checklist plus an "other anomaly" field.
- [x] Every inspection is associated with its production order.
- [x] An anomaly stops the process, is reported, and leaves the fabric not automatically usable.
- [x] Devolución de tela is registrable only before printing; towel returns do not exist.
- [x] Use of anomalous fabric with gerencia authorization is recorded as data (who/when noted), not as a workflow.
- [x] Inspection and devolución records carry the operator's name.

## Modelo funcional aprobado (2026-09-13)

### Inspección de tela (evento asociado a la orden)

- `ordenId` OBLIGATORIO: la inspección es un evento de la orden, nunca un evento general de máquina. No existe inspección desde `EmptyDay`.
- Contextos válidos: `OrderAvailable` (registro, pre-impresión), `OrderInProduction` (registro recurrente), `OrderFinished` (solo consulta/historial, sin registros nuevos).
- Pueden existir MÚLTIPLES inspecciones independientes para la misma orden (una por lote nuevo), sin restricción de "una abierta por orden" ni "una por orden". Cada una con su lote opcional, su checklist y su resolución propia.
- Sin entidad persistente de lote: identificador de lote opcional (texto libre) por inspección.

### Checklist y anomalía derivada

- 5 ítems fijos SIEMPRE explícitos: `absorcion`, `tundido`, `manchas`, `dimensiones`, `estado_general` — cada uno `conforme` o `anomalia`.
- `otraAnomalia`: texto opcional que cubre cualquier otro defecto.
- `conAnomalia` DERIVADO de los 5 ítems + `otraAnomalia`; nunca es un booleano editable desde la UI.
- Sin anomalía ⇒ inspección conforme y sin resolución (no puede devolverse ni autorizarse).
- Con anomalía ⇒ tela informativamente "no usable" hasta devolución o autorización.

### Resolución (mutuamente excluyente, sobre la misma inspección)

- `sin_resolucion` | `devolucion` | `autorizacion_gerencia` — tres estados EXCLUSIVOS, no tres acciones coexistibles.
- Sin anomalía ⇒ no puede tener resolución.
- Con anomalía ⇒ puede quedar sin resolución.
- Con anomalía ⇒ se resuelve con devolución O autorización, nunca ambas.
- Inspección resuelta ⇒ no recibe la resolución opuesta ni una segunda igual.

### Devolución de tela (solo pre-impresión)

- Permitida ÚNICAMENTE si `golpesProducidosDesdeLecturas(orden.lecturas) === 0` (no basta con "no hay lectura": Ticket 01 permite lectura base con cero golpes).
- Requiere: motivo OBLIGATORIO, quién la registra, cuándo.
- NO crea parada, NO modifica lecturas, progreso, estado de la orden ni resumen de tiempo.
- Sin devoluciones post-impresión. La UI impide devolver desde `OrderFinished`.

### Autorización de gerencia (registro documental, sin workflow)

- Requiere: `autorizadoPor`, fecha/hora de autorización, `observaciones` OPCIONALES.
- NO crea estados pendientes, tareas, notificaciones ni aprobaciones posteriores.

### Estado de tela (derivado por inspección, sin estado global de orden)

```
conforme           — sin anomalía, sin resolución
no_usable          — anomalía sin resolución
devuelta           — anomalía + devolución
uso_autorizado     — anomalía + autorización de gerencia
```

- Es estado de CADA inspección, no de la orden. La UI muestra cada estado sin bloquear producción automáticamente (no hay workflow de bloqueo en el ticket). Bloquear uso de tela no autorizada sería una regla adicional explícita, fuera de este ticket.

### Sin impacto en paradas ni tiempo

- La inspección NO crea ni cierra paradas, NO aporta minutos al Ticket 04, NO modifica el estado operativo de la máquina.
- Si el operario detiene la máquina, registra la parada por separado con Ticket 02.

### Fuera de alcance (explícito)

Workflow/integraciones de aprobación; vinculación automática con paradas (Ticket 02); modelo de lotes persistente; devoluciones post-impresión; integración con Acabado; impacto en el resumen de tiempo; estado global de inspección para la orden; bloqueo automático de producción por tela no usable; inspecciones desde `EmptyDay` o `OrderFinished`.

## Cycle strategy

- **Ciclo 1 — pure domain (done, aprobado):** tipos + catálogo de checklist; `registrarInspeccion` (orden obligatoria, 5 ítems explícitos, múltiples por orden, `conAnomalia` derivado); `registrarDevolucion` (solo pre-impresión con producción derivada 0, motivo obligatorio, quién/cuándo); `registrarAutorizacionGerencia` (quién/cuándo, observaciones opcionales); resoluciones exclusivas; `estadoInspeccion` derivado; tests de validaciones, transiciones, múltiples inspecciones, límites y no mutación. Sin UI, repositorios ni persistencia.
- **Ciclo 2 — repository (done, aprobado):** `IInspeccionRepository`; insert/update explícitos sin upsert; `obtenerPorId`; `listarPorOrden`; orden cronológico; copias defensivas; sin mezclar órdenes; sin lógica de negocio en el repositorio.
- **Ciclo 3 — UI (done, aprobado):** `InspeccionTelaSection` reutilizable (registro + historial + resolución); integrada en `OrderAvailable`/`OrderInProduction` (registro y resolución) y `OrderFinished` (historial SOLO, sin registrar ni resolver); NO en `EmptyDay`; operario precargado/bloqueado en producción; checklist con radios «Conforme»/«Anomalía» (explícito siempre); devolución ofrecida solo con producción derivada 0; autorización con `autorizadoPor` obligatorio; estado derivado visible (`conforme`/`no_usable`/`devuelta`/`uso_autorizado`); una sola resolución; errores del dominio en `role="alert"`; no bloquea lecturas ni finalización; `App.tsx` conecta `IInspeccionRepository` (default en memoria) y refresca tras registrar/resolver.

## Cierre formal (2026-09-13)

### Decisiones finales

- Las inspecciones pertenecen SIEMPRE a órdenes (`ordenId` obligatorio); no existe inspección general de máquina ni desde `EmptyDay`.
- Pueden existir MÚLTIPLES inspecciones independientes por orden (una por lote nuevo), sin restricción de "una abierta por orden".
- El estado de tela es POR INSPECCIÓN (`conforme` / `no_usable` / `devuelta` / `uso_autorizado`), derivado por el dominio; NO existe estado global de tela para la orden.
- Devolución y autorización de gerencia son RESOLUCIONES EXCLUSIVAS sobre la misma inspección; una inspección resuelta no recibe una segunda resolución.
- La devolución SOLO procede con producción derivada cero (`golpesProducidosDesdeLecturas === 0`); la UI la ofrece únicamente en ese caso y el dominio la valida de forma definitiva en el submit.
- La autorización exige `autorizadoPor` (registro documental quién/cuándo, observaciones opcionales).
- NO se crean ni modifican paradas; NO se aporta tiempo al resumen (Ticket 04); NO se tocan lecturas, progreso, calidad ni estado de la orden.
- NO se agregan entidad de lote persistente, estado global, workflow de aprobación, SQLite, Tauri ni asincronía.
- `OrderFinished` es HISTORIAL PURO (solo consulta): sin registros nuevos ni resolución desde esa vista.
- La UI delega TODAS las reglas al dominio (`src/domain/inspeccionTela.ts`) y muestra los errores que este devuelve.

### Desviaciones revisadas y aprobadas por el usuario

1. **«Registrada por» en devolución precargado con el operario de la orden**: aprobado — consistente con el flujo actual; no altera la regla de negocio; el dominio sigue validando el valor recibido.
2. **En `OrderFinished` se ocultan también los controles de resolución** (no solo el registro): aprobado — coherente con el criterio de historial cerrado de `DanoSection`; evita modificar registros de una orden finalizada desde esa vista.

### Evidencia de cierre

- 436/436 tests PASS (14 archivos; +10 tests de UI del Ticket 07 en `src/App.test.tsx`).
- `tsc --noEmit` sin errores.
- `npm run build` correcto (280.46 kB JS / 8.70 kB CSS).
- Sin modificaciones fuera del alcance del ticket.

### Post-cierre

El Ticket 07 queda cerrado. NO agregar más cambios a este ticket: el siguiente trabajo debe tratarse como un ticket NUEVO y no como extensión implícita de este.