# Proposal: Historical operational-day view — residual contract work

**Change name:** `historical-day-navigation`
**Artifact store:** openspec (`openspec/changes/historical-day-navigation/`)
**Baseline:** `origin/main` = `c076fda` (CHANGE 1 `operational-event-operative-date` published and archived;
CHANGE 2 `historical-day-navigation` published at `644b022` and archived)
**In-scope projects:** `.` (frontend — Vite 8 + React 19 + TypeScript 6). `src-tauri` is **not** touched:
this change adds no migration, edits no Rust file, and cannot move the
*"The persisted schema is unchanged"* requirement.

**Status:** DECIDED — D1-A (promoted-spec hygiene) is the only scope for this change. D1-B is deferred to a separate slice.

---

## Baseline — what the promoted contract already guarantees

The promoted specs are the normative contract and are **already satisfied on the baseline**. This proposal
therefore does **not** re-specify them, and no requirement here contradicts, replaces or re-states them.

| Promoted capability | Requirements | State on `c076fda` |
|---|---|---|
| `historical-day-navigation` | 12 | Satisfied — day-scoped view, read-only past days, exclusive `fechaOperativa` attribution, one day at a time, today's behaviour unchanged, zero diff in `src/domain/**` |
| `operational-repository-contracts` | 20 | Satisfied — `listarPorMaquinaYFecha` on the four machine-event ports; parity suite runs on a **real** SQLite engine via `abrirSqliteReal` with migrations 001–005 (`src/store/sqlite/__tests__/dayScopedListing.parity.test.ts:65,252`) |
| `operational-recovery-wiring` | 21 | Satisfied — recovery is day-scoped, sources-only, cancellation guard intact |
| `operational-event-operative-date` | 7 | Satisfied — required, persisted, caller-supplied `fechaOperativa` |
| `operational-events-schema` | 19 | Satisfied — migration 005 applied and immutable |

Enforcement artifacts already in the tree: `src/__tests__/noDomainDiff.test.ts` (the
*"a change to `src/domain/**` fails"* guard), and the `soloLectura` gates that keep a past day's
`dano` / `mantenimiento` open-state banners on the selected day (`src/App.tsx:991,1031`).

**Consequence for this change:** its only legitimate content is the *residual* spec-level work that the
promoted specs themselves leave open. That residual is what D1 selects.

---

## Intent

Close the last spec-level gap the promoted `historical-day-navigation` contract leaves behind, **without
touching the contract's behaviour** and without re-opening any closed decision.

The archive of CHANGE 2 closed with items still open. Three of them are *environmental or bookkeeping* and
are carried forward here as OPEN, never as PASS (§Open items below). Two are genuine **spec-level residuals**
that a change can own — and which one of them this change owns is decision **D1**.

---

## The one open decision (D1)

Both candidates below are evidenced in the tree, both are spec-level, and both are mutually independent.
Choosing wrong is not cosmetic: **D1-B alone is likely to exceed the 400 changed-line review budget** on its
own, so the answer changes the delivery shape (single slice vs. chained PRs).

| | **D1-A — promoted-spec hygiene** | **D1-B — selected-day prop rename** |
|---|---|---|
| Gap | `openspec/specs/operational-repository-contracts/spec.md:754-762` describes `openspec/changes/operational-event-operative-date/specs/...` as *"the pending delta"* and warns its superseded requirement must not be promoted as-is. That change is **archived** at `openspec/changes/archive/2026-10-05-operational-event-operative-date/`, and the requirement was **excluded** at its archive (`archive-report.md` §2.4). The promoted spec now points at a path that does not exist and describes an outcome that already happened. | `App`'s selected-day prop is still named `hoy` — 54 occurrences in `src/App.tsx`. The promoted `operational-recovery-wiring` spec names it at `:202, :214, :216, :523, :585, :726`. Deferred as **OQ-3** by the archived design's DD12 to avoid a ~40-call-site test diff. |
| Work | Correct that section to record the real outcome (archived, requirement excluded). ~9 lines of spec prose. | Rename `hoy` → `fechaOperativa` in `src/App.tsx`, `src/App.test.tsx`, `src/Raiz.tsx`, plus the six spec citations. Mechanical; zero behaviour change. |
| Capability touched | `operational-repository-contracts` (prose section, no requirement) | `operational-recovery-wiring` (requirement bodies reference the prop) |
| Review budget | Trivially inside 400 lines | High risk of exceeding it; chained PRs likely |
| Risk | Low — docs only, no code, no gate affected | Medium — mechanical but wide; a mistranslated name in a spec is a contract defect |

**Not a candidate:** **OQ-1** (*"on a historical day, show the open record attributed to that day"*). It is
waiting on an operational answer from the operario, not on engineering work; the implementation is identical
either way and only the recorded rationale would change. It stays an open question, not a change.

**Not decided here.** The orchestrator picks D1-A, D1-B, or both-in-two-slices. Neither is inferred.

---

## Scope

### In scope — core (determined, independent of D1)

1. Treat `openspec/specs/historical-day-navigation/spec.md` and its two dependency specs as the normative
   contract; introduce **no** requirement that re-states, weakens or contradicts any of the 12 + 20 + 21
   requirements already promoted.
2. Carry `G.3`, `R5`, `R6` and `A.1` forward as **OPEN**, stated as open in this change's artifacts, never
   converted to PASS by this proposal.
3. Preserve the boundaries the promoted contract fixes: zero diff in `src/domain/**` (guard:
   `src/__tests__/noDomainDiff.test.ts`), no migration, no change to migrations 001–005, no new persisted
   value, no write path on a non-selected day.
4. Keep the six unrelated local working-tree changes (`.atl/skill-registry.md`, `.gitignore`, `CONTEXT.md`,
   `.codegraph/*`, `.scratch/*`) untouched and out of this change.

### In scope — residual (pending D1)

5. **D1-A only:** Correct the prose section at `:754-762` in `openspec/specs/operational-repository-contracts/spec.md` to record the archived outcome; no code changes.

### Out of scope

- Any change to the day-scoped read, the read-only posture, day attribution, or the empty-day behaviour —
  all promoted and implemented.
- Any change to `src/domain/**` business rules, and any new derived value that is persisted.
- The Acabado official-quality feed and the real weekly-programming source (both unimplemented by design).
- Any migration, any schema rewrite, any index change that alters persisted data.
- R5/R6 runtime validation and `cargo check` — environmental, remain open (§Open items).
- Re-opening `Q1`/`Q2` from the archived CHANGE 2 proposal. Both are closed; `OQ-1` stays an open question.
- Reusing `openspec/changes/archive/2026-10-04-historical-day-navigation/` as an active change. It is an
  audit trail and is not modified.

---

## Capabilities

> This section is the contract with `sdd-spec`. Names below are the **existing** capability names in
> `openspec/specs/`; no new capability name is introduced.

### New Capabilities

**None.** `historical-day-navigation` is already a promoted capability
(`openspec/specs/historical-day-navigation/spec.md`, 12 requirements, capability header `historical-day-navigation (NEW)`).
It cannot be introduced again, and this change adds no capability of its own.

### Modified Capabilities

**None until D1 is answered.** Both evidenced residuals land on **existing** capabilities, so they are
MODIFIED, not ADDED:

| Capability | What the delta must contain |
|---|---|
| `operational-repository-contracts` | Correct the prose section at `:754-762`. It sits **outside** any `### Requirement:` block, so this is a documentation correction, not a requirement change — `sdd-spec` must confirm no requirement body is touched and that the requirement count stays at 20. |

**Unchanged by this change, and must not appear in a delta:** `historical-day-navigation`,
`operational-events-schema`, `operational-event-operative-date`.

---

## Approach

Strictly spec-first, following the existing layering (`src/domain` pure → `src/store` ports + adapters →
`src/ui` React):

1. **D1-A** — edit only the promoted spec's interaction section to record the real archive outcome
   (archived; superseded requirement excluded). No `src/` diff, no gate re-run beyond a read of
   `archive-report.md` §2.4 to confirm the wording.
2. **D1-B** — mechanical rename, one direction, no behaviour change: prop declaration and call sites in
   `src/App.tsx`, the injection seam in `src/Raiz.tsx`, the test call sites in `src/App.test.tsx`, then the
   six spec citations. Run `npm run test` (the authoritative command — `--isolate=false` is **not** valid
   evidence here, because five files mock `@tauri-apps/plugin-sql` and share a module registry) and
   `npx tsc --noEmit`.
3. **Both, in two slices** — D1-A as a standalone docs slice, D1-B as a separate code slice, so the
   400-line budget is never at risk in the slice that matters.

No design exploration is required for either candidate: D1-A is prose, D1-B is a rename with no
architectural choice. `sdd-design` is needed only if D1-B grows beyond a pure rename.

---

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/specs/operational-repository-contracts/spec.md` | Modified (D1-A only) | Section at `:754-762`; requirement count must stay 20 |
| `openspec/specs/operational-recovery-wiring/spec.md` | Modified (D1-B only) | Six requirements naming the `hoy` prop (`:202,214,216,523,585,726`) |
| `src/App.tsx` | Modified (D1-B only) | 54 `hoy` occurrences; prop declaration + call sites |
| `src/App.test.tsx` | Modified (D1-B only) | Test call sites and mount props |
| `src/Raiz.tsx` | Modified (D1-B only) | Injects the selected-day prop into `App` |
| `openspec/specs/historical-day-navigation/spec.md` | **Unchanged** | Normative contract; reference only |
| `src/domain/**`, `src-tauri/**` | **Unchanged** | Zero diff — enforced by `src/__tests__/noDomainDiff.test.ts` |

---

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| D1-B exceeds the 400 changed-line review budget | High | Deliver D1-B as its own slice; chain if the forecast in `sdd-tasks` is High |
| A rename mistranslates a *spec* citation, creating a contract defect | Medium | Treat `src/App.tsx` and the six spec lines as one atomic unit; `sdd-spec` re-reads the delta against the promoted bodies |
| D1-A is mistaken for a requirement change and re-promoted as one | Low | `sdd-spec` asserts the requirement count stays 20 and that no `### Requirement:` block is edited |
| An environmental limitation is quietly converted into a PASS | Medium | G.3 / R5 / R6 are listed as OPEN below and are not touched by either candidate |
| The archive is copied back into the active change | Low | Out of scope above; archive is an audit trail and stays unmodified |
| Proposal is read as re-specifying the capability | Low | Intent and the Baseline table state that the promoted contract is normative and already satisfied |

---

## Rollback Plan

Single revert, no data migration, no persisted state touched by either candidate:

- **D1-A** — `git revert` the one commit; the promoted spec returns to its current bytes. No code depends on
  the wording.
- **D1-B** — `git revert` the rename commit. The prop name is internal to `.`; nothing persisted records it,
  so no migration and no data repair is needed. If a chained PR was used, revert slice by slice.
- **Both** — the change directory `openspec/changes/historical-day-navigation/` can be removed entirely; the
  promoted specs are untouched by the change's own lifecycle unless a delta is composed, and composing a
  delta never mutates `openspec/specs/` (that happens only at `sdd-archive`).
- **Verification after revert:** `npm run test` and `npx tsc --noEmit` return to the baseline.

---

## Dependencies

- `openspec/specs/historical-day-navigation/spec.md` (12 reqs) — normative, and the reference for every
  boundary restated above.
- `openspec/specs/operational-repository-contracts/spec.md` (20 reqs) — normative; D1-A target.
- `openspec/specs/operational-recovery-wiring/spec.md` (21 reqs) — normative; D1-B target.
- `openspec/changes/archive/2026-10-04-historical-day-navigation/` and
  `openspec/changes/archive/2026-10-05-operational-event-operative-date/` — read-only historical reference
  (A.1 outcome in the latter's `archive-report.md` §2.4). Not modified, not reused as an active change.
- No external dependency. No new package. No new migration. `src-tauri` untouched.

---

## Success Criteria

- [ ] D1 is answered and recorded in this proposal; the chosen residual is the **only** content of the change.
- [ ] `sdd-spec` produces deltas whose capability names match §Capabilities exactly — `operational-repository-contracts`
      and/or `operational-recovery-wiring`, and **no** new capability.
- [ ] The requirement count of `historical-day-navigation` stays **12** and `operational-events-schema` stays **19**;
      no promoted requirement is re-stated, weakened or contradicted.
- [ ] D1-A only: `operational-repository-contracts` requirement count stays **20**, and the section at `:754-762`
      names the archived change and its exclusion accurately.
- [x] D1-B only: no production props/parameters/variables use `hoy` to represent the selected operational day; natural-language `hoy` in UI messages, test literals, comments or examples is not a violation, with **no** behaviour change.
- [ ] `git diff <baseline> -- src/domain src-tauri/migrations` is **empty**; `src/__tests__/noDomainDiff.test.ts` stays green.
- [ ] `npm run test` (default per-file isolation — never `--isolate=false`) and `npx tsc --noEmit` both pass.
- [ ] G.3, R5, R6 and A.1 are reported as **OPEN** in the change's artifacts. None is stated as PASS.

---

## Open items carried forward — OPEN, not PASS

These are inherited from the CHANGE 2 archive and are **not** resolved by this change. They stay open, in the
change's own words, so no later reader mistakes a limitation for a verification.

| Item | State | Why it stays open |
|---|---|---|
| **G.3** — `cargo check` in `src-tauri` | **OPEN** | Blocked by a missing Android NDK sysroot for the configured `aarch64-linux-android` target (`cargo 1.98.1` is installed; `ld: cannot find -llog`). `src-tauri` is untouched by this change, so no Rust gate is claimed. |
| **R5** — migrations 004/005 tracking (version row, checksum, `VersionMismatch` gate) | **OPEN / PARTIALLY VALIDATED** | Needs a real Tauri runtime. `src-tauri/migrations/validate_r56.py` gives real-engine DDL evidence against SQLite 3.46.1, which is **not** the R5 contract. |
| **R6** — `getForeignKeys()` returns and enforces the declared FKs | **OPEN / PARTIALLY VALIDATED** | Needs the concrete `@tauri-apps/plugin-sql` call through the webview layer. |
| **A.1** — superseded *"No port signature changes in this change"* | **OPEN as an archive-time checkbox; defect absent** | Excluded at the CHANGE 1 archive (`archive-report.md` §2.4) and never promoted — `rg` finds no such requirement in `openspec/specs/`. The archived checkbox is never repaired. D1-A, if selected, updates the *prose* that still describes that delta as pending. |
| **OQ-1** — open record on a historical day | **OPEN** | Awaits operational confirmation from the operario. Implementation is identical either way. |