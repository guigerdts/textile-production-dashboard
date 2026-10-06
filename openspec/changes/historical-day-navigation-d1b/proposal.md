# Proposal: Historical day navigation — D1-B (selected-day prop naming)

**Change id:** `historical-day-navigation-d1b`
**Parent slice plan:** `historical-day-navigation` (D1-A closed at commit `8be1877`)
**Artifact store:** openspec
**Nature:** mechanical naming change, zero behavior change.

## Why

`hoy` is overloaded in the codebase. It is used for at least three different meanings, which makes the
historical-day navigation contract hard to read and makes the next reader guess which day a symbol
carries:

1. the **selected operational day** (the day being consulted and navigated),
2. the **real current date**, used only as the upper bound of the day navigator,
3. a **duplicate prop** that already carries the selected day under another name.

The promoted spec already anticipates this cleanup: `operational-recovery-wiring` says `App` must
receive the selected day as its `hoy` *"(or equivalent selected-day prop)"* and that only
`ActividadesSection` currently receives `hoy`. D1-B makes that contract canonical.

## What (decision, already resolved)

Naming decision **D1-B-N1 (resolved, do not re-open):**

| Current symbol | Meaning | Target |
| --- | --- | --- |
| `AppProps.hoy` | selected operational day | `fechaOperativa` |
| `SelectorDiaOperativaProps.hoy` | real today, navigator upper bound | `fechaOperativaHoy` |
| `ActividadesProps.hoy` | duplicate of the selected day already exposed as `fechaOperativa` | **remove**; use the existing `fechaOperativa` |

Rules that follow from that decision:

- `fechaOperativa` is reserved for the **selected operational day** everywhere.
- `fechaOperativaHoy` names the **real today / navigator upper bound**. It is a UI limit, not a new
  domain concept, and must never be derived, persisted, or used to attribute events.
- Do **not** introduce `fechaOperativaReal`; `fechaOperativaHoy` already names that concept (`App`
  uses it at `src/App.tsx:125`) and a second name would duplicate it.
- `ActividadesSection` loses the duplicate prop by deduplication, not by renaming a second concept.

## Scope

In scope:

- `src/App.tsx` — `AppProps.hoy` → `fechaOperativa`, its destructuring, every read of the selected
  day, and the JSX prop passed to `SelectorDiaOperativa`.
- `src/Raiz.tsx` — pass `fechaOperativa` to `App`.
- `src/ui/SelectorDiaOperativa.tsx` — `hoy` → `fechaOperativaHoy` (the real-today bound).
- `src/ui/ActividadesSection.tsx` — drop the duplicate `hoy` prop, keep using `fechaOperativa`.
- Tests that mount `App` with `hoy=` or that wrap it in a harness (`src/App.test.tsx`,
  `src/__tests__/persistence-integration.test.ts`, `src/store/sqlite/__tests__/lecturaWiring.test.ts`).
- `openspec/specs/operational-recovery-wiring/spec.md` — the 6 lines that name `hoy`.

Out of scope:

- Spanish prose containing "hoy" (UI copy such as `src/ui/EmptyDay.tsx:14`, JSDoc prose, user-facing
  error strings). Those are not identifiers and are left untouched.
- `src/store/**`, `src/domain/**`, `src-tauri/**` — no date, persistence, recovery, or derivation logic
  changes. `hoy` occurrences there are prose or unrelated names.
- Any behavior, date logic, navigation, persistence, recovery, or `soloLectura` derivation.

## Non-goals

- No refactor of `SelectorDiaOperativa` beyond the prop name.
- No change to the `hoy = fechaOperativaHoy()` / `fechaOperativaHoy: hoyReal` destructuring trick in
  `App` (the `hoyReal` binding rename stays load-bearing; see `src/App.tsx:150-155`).

## Risks

- Blind textual replacement would collide two distinct symbols (`SelectorDiaOperativaProps.hoy` and
  `AppProps.hoy`). Mitigation: classify every occurrence before editing, file by file.
- Removing `ActividadesProps.hoy` could silently change the martes/limpieza suggestion if the two
  props ever diverged. Mitigation: verify `App` passes the same value to both today
  (`src/App.tsx:955-958`), so deduplication is value-preserving.
