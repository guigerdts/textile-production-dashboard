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
- [x] T9 Commit locally with evidence. No push. Confirm the 6 foreign changes intact.

## Evidence

- Commit: `fb55447` `refactor(d1-b): canonical naming for the selected day` (local, not pushed).
  Branch `chore/archive-operational-event-operative-date`; `origin/main` still `c076fda`.
- Size: 12 files, 469 insertions / 137 deletions across the commit (includes the CHANGE
  artifacts); the code+spec portion is **133 insertions / 137 deletions** — one slice, under the
  400-line budget.
- `tsc --noEmit`: exit 0, no diagnostics.
- Tests: full `vitest run` reported 36 files / 985 tests passed, but 3 workers hit
  `Timeout waiting for worker to respond` (environment throughput, not a test failure):
  `src/App.test.tsx`, `src/store/sqlite/__tests__/lecturaWiring.test.ts`,
  `src/store/sqlite/__tests__/database.test.ts`. Re-ran those three isolated:
  `App.test.tsx` 129/129, the two SQLite files 26/26. All green.
- `npm run build` (`tsc && vite build`): exit 0, built in 1.59s.
- Audit: no `AppProps.hoy`, no `hoy=` JSX attribute anywhere in `src/`, no orphaned JSDoc,
  destructure still `{ fechaOperativa = fechaOperativaHoy(), ..., fechaOperativaHoy: hoyReal }`,
  `soloLectura` derived exactly once, `src/domain` and `src-tauri/migrations` untouched.
- Remaining `hoy` occurrences are prose only (Spanish UI strings, comments, regex assertions).
- Foreign working-tree entries left unstaged and unmodified by this change:
  `.atl/skill-registry.md`, `.gitignore`, `CONTEXT.md` (modified, pre-existing) and
  `.codegraph/`, `.scratch/estampado-dashboard/issues/10-sqlite-persistence*`,
  `openspec/changes/historical-day-navigation/` (untracked, pre-existing).

## Review outcome

`gentle-ai review assess` → `risk: high`, `review_due_reason: high_risk`, `changed_paths: 0`,
`reasons: unassessable` (runtime not eligible for immutable receipt review).
Preflight `gentle-ai review status` → typed stop `immutable_review_transport_unsupported`
(`next_action: stop`). No START was issued, no review authority was created or consumed.
Delivery stays with ordinary repository policy; receipt-driven development was not toggled.
