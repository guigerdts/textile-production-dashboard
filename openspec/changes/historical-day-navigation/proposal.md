# Proposal: Historical operational-day view

**Change name:** `historical-day-navigation`
**Status:** blocked on two domain decisions (see §Open questions). No spec, design
or tasks are written until they are answered.

## Problem

Every operational record the machine produces is persisted, and `recoverPersistedState`
reloads the machine's **full history** on startup — but the app clock is hard-bound to
today (`src/App.tsx:113`, `fechaOperativaHoy()`). The operator therefore sees one day
and can never look back at the previous shift, even though the data is already on disk
in SQLite.

The four machine-event ports carry no day filter (`listarPorMaquina(maquinaId)`), so
the historical view cannot be built in the UI layer without loading the entire history
and discarding most of it — the cost grows with the archive, and it contradicts the
boundary the archived change established (`proposal.md:329` R10: the predicate belongs
in the ports).

## Intent

Let the operator view a **specific operational day**, read-only, with the same
dashboard they see today — computed from the same pure domain functions over a
different set of persisted sources.

## Decisions adopted in this proposal

These are compatible with the current model and are settled:

- **D1 — Historical view is read-only.** No event registration, edit, or closure is
  reachable while a past day is displayed.
- **D2 — One specific operational day at a time.** The selector yields exactly one
  `fechaOperativa`; the view is never a merged range or a multi-day aggregate.
- **D3 — No writes to historical records.** Writing stays on today's day only, exactly
  as today.
- **D4 — Today's view is unchanged.** A day equal to `fechaOperativaHoy()` renders
  byte-for-byte the current behaviour, including all write paths.
- **D5 — Zero diff in `src/domain/**`.** No business rule changes. Every derived value
  (progreso, tiempo productivo, machine state, projected 2da, alert, buena racha,
  inspection estado) is recomputed by the existing pure functions over the selected
  day's sources.
- **D6 — Filter in origin, never in the UI.** The day predicate lives in the ports:
  a `WHERE` clause in SQLite, a filter in the in-memory adapter. The UI never receives
  another day's rows.
- **D7 — The date predicate is explicit on the ports**, per the archived proposal's
  prediction, not derived by the UI or by recovery.
- **D8 — In-memory and SQLite must be observably equivalent.** The same contract suite
  runs against both, so the day filter cannot drift between them.

## Scope

**In scope**

1. An operational-day selector in the app, replacing the hard-bound clock.
2. A `fechaOperativa`-scoped read on the four machine-event ports, implemented in both
   adapter families.
3. Day-scoped recovery composition that filters in origin and does not load other
   days' events.
4. Read-only historical mode: current-day writes hidden, never silently failing.
5. Day-to-day navigation.
6. Empty-day behaviour: a day with no order and no events renders the existing
   no-order state.
7. Contract tests (both adapters, one suite) and UI tests covering today, a past day
   with activity, an empty day, navigation, and a rejected historical write.

**Out of scope**

- Any registration, edit or deletion of historical events.
- Persisting derived values (forbidden by the promoted specs).
- The Acabado official-quality feed and the real weekly-programming source.
- Any change to `src/domain/**` business rules, or to migrations 001–004.
- R5/R6 runtime validation, which remains open on a Tauri-capable host.

## Open questions — these block the spec

Both are **domain** decisions. Neither can be inferred from `CONTEXT.md`, the promoted
specs or the ADRs, and both were found by cross-checking the provisional decisions
against the actual model.

### Q1 — How is a machine event attributed to an operational day?

`Parada`, `ActividadPlanificada`, `Dano` and `Mantenimiento` have **no
`fechaOperativa` field** — only `inicio`/`fin` timestamps (`src/domain/types.ts:125-139`,
`:196-222`, `:335-353`; SQL mirrors it in `sqliteDanoRepository.ts:133-148`). The
instruction *"filter by the jornada's `fechaOperativa`, not by each event's UTC
timestamp"* cannot be applied literally to them, and the order-link workaround does not
exist for events recorded on an empty day — precisely the case this feature must show.

- **(a) Persist `fechaOperativa` on the four events.** New domain field + migration 005
  (004 stays immutable). Widest blast radius; arguably its own change, and it would
  make historical rows immutable-by-construction. Costs a domain change, which D5
  currently forbids.
- **(b) Derive the day from the `inicio` timestamp.** No model or schema change. But
  this is precisely the UTC-timestamp filtering the provisional decision rejected, and
  it raises which timezone owns the day boundary (a 07:00 shift start is not a UTC
  midnight anywhere useful).
- **(c) Attribute by the jornada window.** Keep `fechaOperativa` as the *selector*;
  an event belongs to the selected day when its `inicio` falls inside that day's
  persisted jornada (07:00–17:00, extended by overtime). No model or schema change, no
  UTC-boundary question — but it depends on Q2, and an event registered outside the
  jornada window (late registration) would not surface on any day.

### Q2 — Which day owns an event that crosses midnight or is still open?

The model encodes `fin: null` as "open" and nothing else about day ownership. For a
viewing day `D`:

- a closed event with `inicio` `D-1 23:50` and `fin` `D 00:30` — shown on D-1, on D, or both?
- an open event with `inicio` `D-1 09:00` and `fin` null, still unresolved on D — is it
  visible on D?

"Day of start" and "overlaps the jornada" are both implementable and produce different
dashboards. Neither is recorded anywhere in the model, so choosing one is a new domain
rule, which the brief forbids inventing.

## Dependency order

Once Q1 and Q2 are answered, the work is strictly: port predicate (InMemory) → port
predicate (SQLite) → contract tests → day-scoped recovery → selector UI → read-only
mode → UI tests. No step depends on another feature.