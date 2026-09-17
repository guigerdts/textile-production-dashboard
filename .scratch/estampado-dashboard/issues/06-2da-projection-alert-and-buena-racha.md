# 06: 2da projection, operational alert, and buena racha

**What to build:** From Estampado's suspicion data and produced units, the system computes the 2da percentage as an operational projection, fires the alert when it exceeds 3% of the production, exposes the 5% monthly target as a monitoring value, and shows the buena racha state (2da within thresholds). None of these values is presented or persisted as an official quality classification — that belongs to Acabado and its synchronization remains pending.

**Blocked by:** 01, 05

**Status:** closed (2026-09-13, aprobado por el usuario — los 3 ciclos)

- [x] 2da percentage is computed as a projection from suspected 2da units ÷ produced units.
- [x] The operational alert fires when the projection strictly exceeds 3% of the production.
- [x] The 5% monthly target is exposed as a monitoring threshold only.
- [x] Buena racha state reflects 2da within thresholds; it is not an uptime/continuity metric.
- [x] No UI or persistence presents any of these values as an official 1ra/2da classification.
- [x] No Acabado data ingestion exists (source/sync is pending; deliberately outside this ticket).
- [x] No UI or persistence modifies the planned percentage, the operative objective, or Ticket 04 rules.

## Modelo funcional aprobado (2026-09-13)

### Separación de conceptos (nunca mezclar)

| Concepto | Fuente | Rol |
|---|---|---|
| **Segunda planificada** | `orden.aplicaSegunda` + `orden.porcentaje2da` (Ticket 01) | Calcula el objetivo operativo (`unidadesObjetivo`). NO se toca en este ticket. |
| **Segunda sospechada** | Daños con `posibleSegunda = true` + `unidadesSospechadas` (Ticket 05) | Entrada de la proyección operativa. |
| **Segunda oficial** | Acabado | No existe en el sistema; sincronización pendiente. Nada lo simula ni lo persiste. |

### Proyección operativa (derivada, nunca persistida)

- `pct2daProyectado = unidadesSospechadas ÷ unidadesProducidas`, donde `unidadesProducidas = golpes × 3` y `unidadesSospechadas` = suma de `unidadesSospechadas` de los daños de la orden con `posibleSegunda = true`.
- **Derivada siempre**: no se persiste, no se edita, no toca `porcentaje2da`, `unidadesObjetivo`, `golpesRequeridos`, lecturas, progreso ni estado de la orden.
- **Daños sin orden (`ordenId: null`) NO alimentan la proyección** (no tienen producción asociada). *(Decisión aprobada D)*
- Daños con `posibleSegunda = true` sin `unidadesSospechadas` quedan visibles como sospecha sin unidades, pero **no aportan número** a la proyección.
- Caso límite: `unidadesProducidas = 0` → **sin_datos** (sin división por cero, sin alerta, sin buena racha). Orden con producción pero sin daños → proyección **0 %**.

### Estados y resultado del dominio

```
estado: "sin_datos" | "buena_racha" | "alerta"
resultado: { pct: number | null; estado; dentroUmbral: boolean | null }
```

- `sin_datos`: no hay unidades producidas (`pct: null`, `dentroUmbral: null`).
- `buena_racha`: hay producción y `pct <= 0.03` (exactamente 3 % NO genera alerta).
- `alerta`: hay producción y `pct > 0.03` (estrictamente superior).

### Alerta operativa

- Dispara con `pct > UMBRAL_ALERTA_2DA` (0.03). Informativa, **nunca bloqueante**: no impide lecturas, finalización ni acciones; no modifica el estado de la orden.
- Visible en `OrderInProduction` (alerta viva) y `OrderFinished` (información histórica que permanece, sin acciones). *(Decisión aprobada C)*
- Umbral fijo como constante de dominio, no configurable en este ticket. *(Decisión aprobada B)*

### Meta mensual (referencia de comparación)

- `META_MENSUAL_2DA = 0.05` (5 %) mostrada como referencia junto al % proyectado. **No es un agregado mensual real** (solo hay datos del día operativo; no se presenta como histórico). *(Decisión aprobada E)*

### Buena racha (estado, no métrica temporal)

- Significa: **riesgo operativo dentro del umbral durante la producción actual** (sospecha ≤ 3 %). NO demuestra racha histórica, continuidad, uptime ni acumulado entre órdenes. *(Decisión aprobada F)*
- Sin datos ⇒ sin estado.

### Fuera de alcance (explícito)

Clasificación oficial / sincronización con Acabado; agregado mensual real; configuración de umbrales; modificar `porcentaje2da` planificado u objetivo operativo; Ticket 09 (dashboard home); persistencia adicional de la proyección (siempre derivada, nunca persistida). Bloque de calidad NO en `EmptyDay` ni `OrderAvailable`.

### Condiciones de integración (Ciclo 2, verificadas explícitamente)

Solo se consultan daños de la orden actual; solo `posibleSegunda === true`; solo se suman `unidadesSospechadas` definidas; se ignoran daños sin orden; daños sin unidades visibles pero sin aportar número; no se mutan registros del repositorio; no se modifica progreso ni porcentaje planificado; orden sin daños con producción → 0 %; orden sin producción → `sin_datos`.

### Condiciones de UI (Ciclo 3)

Bloque en `OrderInProduction` y `OrderFinished`: % proyectado, meta 5 %, estado; alerta en ambas; buena racha cuando corresponda; `—` para sin_datos. NO en `EmptyDay`/`OrderAvailable`. No bloquea acciones. La UI no duplica reglas del dominio (solo formatea).

### Ciclo 3 — implementado y aprobado (2026-09-13)

**Evidencia de la integración:**
- `src/ui/CalidadSection.tsx` — componente de PRESENTACIÓN PURA: recibe `ResultadoIntegracion2da` del dominio y solo formatea (`pct` fracción → %, `META_MENSUAL_2DA` como meta de referencia, etiqueta de estado). No calcula, no filtra, no decide umbrales; nota informativa cuando `danosConSospechaSinUnidades > 0`; `role="status"` y `aria-label` para accesibilidad.
- `src/App.tsx:360-362` — deriva `integracion2da = proyeccionSegundaDeOrden(orden, danoRepository.listarPorOrden(orden.id))` solo cuando hay orden; se pasa únicamente a `OrderInProduction` (línea 384) y `OrderFinished` (línea 398). EmptyDay y OrderAvailable NO lo reciben ni lo muestran (test dedicado).
- `src/ui/OrderInProduction.tsx` — prop `integracion2da`, bloque entre los datos de la orden y el form de lectura (alerta viva: se recalcula en cada render con lecturas/daños actuales).
- `src/ui/OrderFinished.tsx` — prop `integracion2da`, bloque como información histórica con los datos de cierre.
- `src/App.css` — estilos `.calidad` / `calidad__*` y estados `--buena_racha` / `--alerta` (verde/rojo), consistente con el tema BEM.

**Decisiones visuales:** bloque en tarjeta `calidad` con 3 celdas (2da proyectada, meta, estado); alerta viva en producción (cambia al registrar lecturas/daños sin recargar); en finalizada permanece como dato de cierre; porcentaje formateado según locale (`4%` sin espacio en Node/es-AR) con la fracción exacta calculada en el dominio.

## Cycle strategy

- **Ciclo 1 — pure domain (approved):** constantes `UMBRAL_ALERTA_2DA`/`META_MENSUAL_2DA`, función pura `proyeccionSegundaProducida` con estados `sin_datos | buena_racha | alerta` y tests (0 producidas, 3 % exacto, > 3 %, cero sospechas, decimales). Sin UI, repositorios ni persistencia.
- **Ciclo 2 — integration (approved):** seam puro `proyeccionSegundaDeOrden(orden, danosDeOrden)` + `ResultadoIntegracion2da` en `src/domain/calidad.ts`; filtra por `orden.id` y `posibleSegunda === true`; suma solo `unidadesSospechadas` definidas; conserva conteo de sospechas sin unidades; consulta real `InMemoryDanoRepository.listarPorOrden`; 12 tests nuevos. Sin UI.
- **Ciclo 3 — UI (approved):** bloque de calidad en `OrderInProduction`/`OrderFinished`; alerta, buena racha, meta 5 %, sin_datos; tests UI. Componente `CalidadSection` presentación pura.

## Cierre formal (2026-09-13)

Aprobado por el usuario con las 16 validaciones del Ciclo 2 y las 14 del Ciclo 3, más las decisiones de los 3 ciclos:
- **Ciclo 1:** umbral fijo como constante de dominio (B), alerta informativa no bloqueante (C), no configuración en este ticket, buena racha = estado de la producción actual, no continuidad histórica (F), meta 5 % referencia no agregado mensual (E).
- **Ciclo 2:** seam puro en el dominio que consulta el repositorio de daños; la UI nunca duplica filtros/fórmulas/umbrales; daños sin orden no alimentan la proyección (D); sospechas sin unidades visibles sin inventar número; producción 0 → `sin_datos`.
- **Ciclo 3:** `CalidadSection` presentación pura; proyección derivada en `App.tsx` con `danoRepository.listarPorOrden(orden.id)` + seam; bloque solo en `OrderInProduction` (alerta viva) y `OrderFinished` (histórico); alerta se actualiza con nuevas lecturas sin recargar; daños de otras órdenes/sin orden no se mezclan; meta 5 % presentada como referencia; accesible (`role="status"`, `aria-label`); tarjeta compacta con proyectada/meta/estado y color reservado al estado operativo. Posición y estilo refinables en una revisión visual futura, sin afectar funcionalidad.

**Evidencia final:**
- Suite completa: **360/360 tests PASS** en 12 archivos (350 previos + 10 nuevos del Ciclo 3).
- `tsc --noEmit`: OK.
- `npm run build`: OK — aumento razonable de bundle (267.53 kB JS / 6.40 kB CSS) por el nuevo bloque.