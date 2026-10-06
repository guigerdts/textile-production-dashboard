# Design: D1-B — canonical naming for the selected day

**Change:** `historical-day-navigation-d1b`
**Parent slice:** `historical-day-navigation` (D1-A closed at `8be1877`)
**Type:** mechanical rename + one prop deduplication. **Zero behavior change.**

## 1. Naming decision (resolved, do not reopen)

| Symbol | Meaning | Target |
| --- | --- | --- |
| `AppProps.hoy` | selected operational day | **`fechaOperativa`** |
| `SelectorDiaOperativaProps.hoy` | real today; navigator upper bound | **`fechaOperativaHoy`** |
| `ActividadesProps.hoy` | duplicate of the selected day | **removed** |

Rules:

- `fechaOperativa` is reserved for the selected operational day.
- `fechaOperativaHoy` is only the UI limit / real today. It is **not** a domain concept: never derived,
  never persisted, never used to attribute an event.
- `fechaOperativaReal` must not be introduced; `fechaOperativaHoy` already names that concept
  (`AppProps`, `src/App.tsx:125`).
- This is **not** a textual global replacement. Every occurrence is classified first.

## 2. Occurrence classification

### 2.1 Class 1 — selected operational day → `fechaOperativa`

`src/App.tsx`:

| Line | Role |
| --- | --- |
| 119 | `AppProps.hoy` declaration |
| 149 | destructuring default `hoy = fechaOperativaHoy()` |
| 165 | `soloLectura = hoy !== hoyReal` |
| 188, 258, 276, 288, 301, 316, 332, 337, 344, 353, 366, 374, 385, 415, 428, 443, 454 | mount/reload loaders reading the selected day |
| 683, 686 | jornada write (`finIso`, `guardarJornada`) |
| 955, 958 | `propsActividades`: the duplicate key and `fechaOperativa: hoy` |
| 996, 1036, 1163 | `fechaOperativa: hoy` in `danosProps`/`mantenimientoProps`, and the navigator's selected day |
| 1151 | header display `{hoy}` |

`src/Raiz.tsx:97` — `hoy={vista.fechaOperativa}` → `fechaOperativa={vista.fechaOperativa}`.

`src/App.test.tsx`, `src/__tests__/persistence-integration.test.ts`,
`src/store/sqlite/__tests__/lecturaWiring.test.ts` — mount sites and harnesses passing `hoy=` to `App`.

`src/ui/ActividadesSection.tsx:150` — `esMartes(hoy)` reads the **selected** day, so it becomes
`esMartes(fechaOperativa)` after the dedup.

### 2.2 Class 2 — real today / navigator upper bound → `fechaOperativaHoy`

`src/ui/SelectorDiaOperativa.tsx` lines 33 (declaration), 42 (destructured), 48 (`esHoy` comparison),
65 (`max`), plus the JSDoc at 12 and 20 that names `max={hoy}`.

`src/App.tsx:1164` — `hoy={hoyReal}` becomes `fechaOperativaHoy={hoyReal}`.
`src/App.tsx:1156-1157` — the block comment that explains the two props.
`src/App.tsx:163` — the comment `hoy !== fechaOperativaHoy()` becomes
`fechaOperativa !== fechaOperativaHoy()`.

### 2.3 Class 3 — duplicate selected-day prop → removed

`src/ui/ActividadesSection.tsx`:

- line 17 `hoy: string;` (and its JSDoc at 16) → **delete**,
- line 61 `hoy,` in the destructuring → **delete**,
- line 150 `esMartes(hoy)` → `esMartes(fechaOperativa)`,
- line 22 `fechaOperativa` keeps its own JSDoc.

`src/App.tsx:955` — the `hoy,` shorthand key in `propsActividades` → **delete**, so `App` stops passing
the second copy.

**Value-preservation proof:** `App` currently passes `hoy` and `fechaOperativa: hoy` from the same
binding (`src/App.tsx:955-958`), so both props were always identical. `esMartes` therefore sees the same
value before and after. No behavior change.

### 2.4 Class 4 — Spanish prose / user-facing text → untouched

`src/ui/EmptyDay.tsx:14` (`No hay orden asignada para hoy.`), the recurring
`no se puede registrar en un día que no es hoy` error strings in `App`, all JSDoc prose containing
"hoy", `src/main.tsx:77`, `src/store/**`, and `src/ui/*Section` JSDoc lines about "día de hoy".
These are not identifiers and are out of scope.

## 3. Load-bearing code that must not be "simplified"

`src/App.tsx:149-156`: the destructuring rename
`fechaOperativaHoy: hoyReal = fechaOperativaHoy()` is load-bearing. With the same identifier on both
sides, V8 throws `ReferenceError: Cannot access 'f' before initialization` on every `App` mount. After
the rename the default on line 149 reads `fechaOperativa = fechaOperativaHoy()`, which must keep
resolving to the **module import**, not to a local. Verify this stays true — the module import is named
`fechaOperativaHoy`, and the local is `fechaOperativa`, so the two remain distinct. No change to the
pattern, only to the selected-day binding name.

`soloLectura` stays derived exactly once, at `src/App.tsx:165`, as
`fechaOperativa !== hoyReal`. Nothing else may recompute it.

## 4. Spec alignment

`openspec/specs/operational-recovery-wiring/spec.md` has 6 lines naming `hoy`:
202, 214, 216, 523, 585, 726.

- 202/214/216 → `fechaOperativa` (the injected selected day).
- 523 → `fechaOperativa`, dropping the "(or equivalent selected-day prop)" escape now that the name is
  canonical.
- 585 → `fechaOperativa`, so the requirement no longer presents two names for one concept.
- 726 → describes the deduplicated prop instead of `hoy`.

Line-accuracy note: the four call-site line numbers quoted at 724 are stale in the baseline
(`c076fda`) as well; they are pre-existing and out of D1-B scope.

## 5. Out of scope

No date logic, navigation, persistence, recovery, derivation, or `soloLectura` change. No edit to
`src/domain/**` or `src-tauri/migrations/**`. No archived CHANGE 1/CHANGE 2 artifact, no `G.3`,
`R5/R6`, `A.1`.
