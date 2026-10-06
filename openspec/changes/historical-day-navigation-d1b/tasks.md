# Tasks: D1-B — canonical naming for the selected day

**Delivery:** single slice. Forecast ≈ 140 changed lines (< 400 budget), so no split required.
**Route:** delegated direct writer, one writer, mechanical-but-classified edit.

- [x] T1 `src/ui/SelectorDiaOperativa.tsx` — class 2: `hoy` → `fechaOperativaHoy` (declaration, destructuring, `esHoy`, `max`, JSDoc).
- [x] T2 `src/ui/ActividadesSection.tsx` — class 3: drop `hoy` prop (line 16-17 JSDoc + declaration, line 61 destructuring); `esMartes(hoy)` → `esMartes(fechaOperativa)`; keep `fechaOperativa` JSDoc.
- [x] T3 `src/App.tsx` — class 1: `AppProps.hoy` → `fechaOperativa`, destructuring default, `soloLectura`, all 17 loader/writer reads, header render. Class 3: drop the `hoy,` shorthand in `propsActividades`. Class 2: line 1164 `hoy={hoyReal}` → `fechaOperativaHoy={hoyReal}`; refresh lines 1156-1157 and 163 comments.
- [x] T4 `src/Raiz.tsx:97` — `hoy=` → `fechaOperativa=`.
- [x] T5 Tests — `src/App.test.tsx`, `src/__tests__/persistence-integration.test.ts`, `src/store/sqlite/__tests__/lecturaWiring.test.ts`: rename the `App`/`Arnés` mount prop only. Prose assertions (`No hay orden asignada para hoy`) stay.
- [x] T6 `openspec/specs/operational-recovery-wiring/spec.md` — lines 202/214/216/523/585/726 per design §4.
- [x] T7 Verify: `tsc --noEmit` clean; full test suite; build clean.
- [x] T8 Audit: no `AppProps.hoy`; no remaining selected-day `hoy` identifier; navigator bound uses `fechaOperativaHoy`; no orphaned JSDoc, no duplicate destructuring; `src/domain` and `src-tauri/migrations` untouched.
- [ ] T9 Commit locally with evidence. No push. Confirm the 6 foreign changes intact.
