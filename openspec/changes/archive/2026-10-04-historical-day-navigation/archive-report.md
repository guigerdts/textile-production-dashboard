# Archive Report — historical-day-navigation

**Archived**: 2026-10-04
**Change**: `historical-day-navigation`
**Artifact store**: openspec (repo-local `openspec/`)
**Archive location**: `openspec/changes/archive/2026-10-04-historical-day-navigation/`
**Report written**: 2026-10-05 (additive; written after the move and spec promotion)

---

## 1. Archive outcome

The change is archived **with open items**. 75 of 79 tasks are complete; four remain `[ ]` in
the archived `tasks.md` and are reported below as they stand. No checkbox was repaired, no
historical report was rewritten, and nothing unfinished is described here as finished.

The active change folder `openspec/changes/historical-day-navigation/` no longer exists
(confirmed absent). All eight artifacts it contained are preserved in the archive folder.

### Specs synced

| Domain | Action | Delta reqs | Promoted reqs | Path |
|---|---|---|---|---|
| `historical-day-navigation` | Created (main spec did not exist; full spec) | 12 | 12 | `openspec/specs/historical-day-navigation/spec.md` |
| `operational-recovery-wiring` | Updated (delta composed into existing) | 6 | 18 | `openspec/specs/operational-recovery-wiring/spec.md` |
| `operational-repository-contracts` | Updated (delta composed into existing) | 5 | 16 | `openspec/specs/operational-repository-contracts/spec.md` |

**No destructive merge occurred.** All three delta files carry a single `## ADDED Requirements`
block and no `MODIFIED` / `REMOVED` / `RENAMED` section, so no requirement was deleted or
replaced, and the `rules.archive` warning ("Warn before merging destructive deltas") was not
triggered. The two pre-existing specs gained requirements (12 → 18 and 11 → 16) rather than
losing any.

### Archive contents

| Artifact | Observed | Notes |
|---|---|---|
| `proposal.md` | present | — |
| `exploration.md` | present | from `sdd-explore` |
| `design.md` | present | — |
| `spec-report.md` | present | intermediate snapshot from `sdd-spec`; see §7 for a count drift |
| `specs/historical-day-navigation/spec.md` | present | full spec, 12 requirements |
| `specs/operational-recovery-wiring/spec.md` | present | delta, 6 requirements |
| `specs/operational-repository-contracts/spec.md` | present | delta, 5 requirements |
| `tasks.md` | present | **79 tasks, 75 `[x]`, 4 `[ ]`** |
| `apply-progress.md` | **missing** | never produced for this change |
| `verify-report.md` | **missing** | verification is optional in this workflow; none is claimed |
| `research.md` | missing | never produced for this change |
| `state.yaml` | missing | optional recovery hint, never needed |

---

## 2. Implementation state at close

The frontend change is implemented and green: **75/79 tasks complete**, with the four open
items being one unverifiable build gate and three archive-time bookkeeping concerns (§5, §6).

What shipped, per the change's own records:

- A day-scoped operational-day view: the operator selects one `fechaOperativa`, and the
  dashboard renders from the same pure domain functions over that day's persisted sources.
- **Read-only for any day that is not today**; no event registration, edit or closure is
  reachable on a past day. Today's view is unchanged.
- Four machine-event ports gain a day-scoped listing (`listarPorMaquinaYFecha`), with both
  the in-memory and SQLite adapter families and a cross-adapter parity suite.
- `IParadaRepository` gains `getParadaAbiertaDeMaquina(maquinaId)` (OQ-4, alternative B).
- `src/domain/**` is untouched — the B1/B2 boundary never moved (task G.4, empty diff).

### Task ledger at close

| Bucket | Count |
|---|---|
| Total tasks | 79 |
| Complete `[x]` | 75 |
| Unfinished `[ ]` | 4 (`G.3`, `A.1`, `A.2`, `A.3`) |

The four open items, verbatim from the archived `tasks.md`:

- `tasks.md:976` — `- [ ] G.3 \`cargo check\` in \`src-tauri\`.`
- `tasks.md:1054` — `- [ ] A.1 **Superseded text — carry the \`spec-report.md\` observation forward.** …`
- `tasks.md:1062` — `- [ ] A.2 A stray method name survives inside this change's own recovery-wiring spec: …`
- `tasks.md:1067` — `- [ ] A.3 At archive time, confirm no task of this change promoted design §12's \`Q1\`/\`Q2\` labels into the promoted specs …`

---

## 3. The mechanical-archive command did not exist — merge proven structurally instead

**This is a real gap in the toolchain, not a skipped step, and no native-composition claim is
made for this archive.**

`sdd-archive`'s Step 2 requires composition through the native command, on the reasoning that
a model-driven Read/Edit merge silently drops unrelated requirements while reporting success:

```
$ gentle-ai sdd-archive-compose --help
Error: unknown command "sdd-archive-compose" — run 'gentle-ai help' for available commands
```

The installed CLI is **`gentle-ai 4.0.0`**, and it ships no `sdd-archive-compose` subcommand. The
mandatory command therefore could not be invoked, and — per the skill's own instruction — a
manual Read/Edit merge was **not** used to compensate.

What was done instead, verified independently against the files on disk rather than asserted:

```
$ comm -23 <(grep -E '^### Requirement:' <delta>/spec.md | sort) \
           <(grep -E '^### Requirement:' openspec/specs/<domain>/spec.md | sort)
```

For each of the three domains the output is **empty** — every requirement name in each delta is
present in its promoted spec. Requirement counts confirm nothing was dropped:

| Domain | Delta | Promoted | Reading |
|---|---|---|---|
| `historical-day-navigation` | 12 | 12 | complete; new spec |
| `operational-recovery-wiring` | 6 | 18 | 6 added, 12 pre-existing preserved |
| `operational-repository-contracts` | 5 | 16 | 5 added, 11 pre-existing preserved |

**Residual risk, stated plainly:** name-presence plus a rising requirement count is strong but
not byte-level evidence. It does not prove that the *bodies* of the 12 and 11 pre-existing
requirements are unchanged, only that they survive and that no delta requirement is missing.
A future change should treat the missing compose command as the thing to fix first.

---

## 4. Verification state

Recorded from the final-state facts confirmed this session. **No verification certificate
(`verify-report.md`) exists for this change and none is claimed.**

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | exit 0 |
| Build | `npm run build` (`tsc && vite build`) | exit 0 |
| Full suite | `npm run test` (`vitest run`) | **39 files / 1140 tests green** (731.03s) |
| R5/R6 partial harness | `python3 src-tauri/migrations/validate_r56.py` | exit 0 |

### `npm run test` is the authoritative command — `--isolate=false` is NOT valid evidence here

Any run using `--isolate=false` must not be cited as a green-suite result for this change.
Five test files mock `@tauri-apps/plugin-sql` (verified: `database.test.ts`,
`migration003.test.ts`, `sqliteJornadaRepository.test.ts`, `sqliteLecturaGolpeRepository.test.ts`,
`sqliteOrderRepository.test.ts`). The flag shares one module registry across a worker's files,
so those mocks contaminate each other across files. The suite is valid only under the default
per-file isolation that `npm run test` provides.

---

## 5. Open follow-ups at close

### 5.1 G.3 — `cargo check` in `src-tauri`: OPEN (not a code failure, and not a missing toolchain)

`cargo` **is** installed and runs: `cargo 1.98.1 (797e8a9bc 2026-08-05)`. The gap is the
**linker**, not the toolchain. Linking for the configured `aarch64-linux-android` target fails
with `ld: cannot find -llog` and `ld: cannot find -lunwind` — Android/Bionic libraries that are
not present on this host. **The cause is a missing Android NDK sysroot for the configured
target**, not a missing Rust toolchain, and the distinction is recorded so the next agent does
not go looking for a toolchain that is already present.

This gate **cannot** be caused by this change, and that is provable rather than asserted: the
change touches **zero Rust files and zero migrations** (`git diff 851172c -- src-tauri` is
empty), so nothing in this change is even compiled by `cargo check`.

The honest state: the TypeScript side is fully verified, and the Rust side is unchanged from
its baseline and therefore **unverified in this environment**. `G.3` is left `[ ]` on purpose —
ticking it would make the plan claim Rust verification that does not exist. Re-running it needs
an Android NDK sysroot, or a host Rust toolchain.

### 5.2 R5 / R6: still OPEN — no Tauri-runtime validation is claimed

`src-tauri/migrations/VALIDATION.md` records R5 and R6 as **`PARTIALLY VALIDATED`**, and
explicitly open. The Python harness applies the real migration files against a real SQLite
engine (SQLite 3.46.1), which is genuine and reproducible engine evidence — but it is **not**
the R5/R6 contracts:

| Contract | Still requires |
|---|---|
| **R5** — migrations 004/005 applied (checksum + DDL) | The sqlx `_sqlx_migrations` **tracking** (version row, checksum record, `VersionMismatch` gate) and the real Tauri binary. |
| **R6** — `getForeignKeys()` returns the declared FKs and FK is enforced | The concrete `getForeignKeys()` TypeScript call through `@tauri-apps/plugin-sql` (webview layer). |

The Rust side cannot be built or run in this environment at all (same `aarch64-linux-android`
linker limitation as G.3; `pkg` is unavailable as root), and no webview/GTK runtime exists
here. Per the archived change's own rules, that limitation is **not** converted into a pass.
**No statement in this report may be read as R5/R6 validation on a real Tauri runtime.**

---

## 6. Archive-time concerns `A.1`–`A.3`

These three checkboxes remain `[ ]` because **archived tasks retain their original bytes as an
audit trail and checkboxes are never repaired during archive**. For `A.2` and `A.3` the
underlying defect is *already absent from the promoted specs* — that is stated as a fact about
the specs, not as a reason to tick a box that the archive leaves unticked.

### A.2 — stray method name: defect NOT present in either the delta or the promoted spec

The archived task text (written when the defect was live) describes `specs/operational-recovery-wiring/spec.md:186`
as reading `paradaRepository.listarPorMaquina` — the day-free name. Read today, **that is no
longer what either file says**:

- Archived delta `spec.md:186` reads `paradaRepository.listarPorMaquinaYFecha` with the
  day-scoped listing for `(machineId="M1", fechaOperativa=D)`. A grep for the day-free name
  across that delta returns **no matches**.
- Promoted `openspec/specs/operational-recovery-wiring/spec.md:642` reads the same
  `listarPorMaquinaYFecha` wording.

So the contract is correct in both the archived delta and the promoted spec today. One honest
refinement to the account this archive was handed: because the archived delta already carried
the corrected name, the correction is **not attributable to the promotion step** — the name was
already correct in the delta file that was moved. Either way, no stray day-free name survives
in the promoted spec. The checkbox stays `[ ]`; the observation the task asks for is satisfied
in the artifacts.

### A.3 — no `Q1`/`Q2` design labels were promoted: confirmed, no matches

Defect **D3** in the archived `tasks.md` records that design §12 reuses the labels `Q1` / `Q2`
for *different* questions from the proposal's already-closed `Q1` / `Q2`, so a reader following
"see §12, Q1" could wrongly conclude a closed decision had been reopened. Confirmed clean:

```
$ grep -nE '\bQ[12]\b' openspec/specs/*/spec.md
(no matches)
```

No `Q1` / `Q2` label reached any promoted spec. The four carried questions live as `OQ-1`…`OQ-4`
in `tasks.md` only — `grep -nE 'OQ-[0-9]' openspec/specs/*/spec.md` also returns no matches, so
no unresolved question leaked into the source of truth either.

### A.1 — superseded text in the other change: GENUINELY OPEN

`A.1` is the one archive-time concern that is not satisfied. The pending
`operational-event-operative-date` delta still asserts, at
`openspec/changes/operational-event-operative-date/specs/operational-repository-contracts/spec.md:108`,
a requirement titled *"No port signature changes in this change"*, whose scenario claims
`listarPorMaquina` accepts only `maquinaId`.

That was correct for its own change and is **superseded** by this change's *"Exactly four
machine-event ports gain a day-scoped listing"*. It must **not** be promoted as-is when
`operational-event-operative-date` is archived; the promoted state is the day-scoped contract.

This change deliberately did **not** touch the other change's files — the interaction is
recorded and the other change is left alone, exactly as
`specs/operational-repository-contracts/spec.md:213-221` states. Verified: that file is
unmodified in the working tree. **A.1 stays `[ ]` and is carried forward as an open
follow-up.**

### Open-question accounting (final state)

| ID | Status at close |
|---|---|
| **OQ-1** | **OPEN** — is "on a historical day, show the open record attributed to that day" the intended reading? The design decided it and awaits operational confirmation. The implementation is identical either way; only the rationale recorded in code comments depends on the answer. Carried to a later phase. |
| **OQ-2** | **CLOSED by the specs** — no lower bound on navigation depth. "Nothing in the specs requires one", so unbounded past is the specified behaviour. Implemented without inventing a bound. |
| **OQ-3** | **DEFERRED / out of scope** — rename `App`'s `hoy` prop to `fechaOperativa`. Kept as `hoy` per DD12 to avoid a ~40-call-site test diff. A mechanical follow-up belonging to a different change. |
| **OQ-4** | **CLOSED on alternative B** — the machine-level open state *is* reachable after day-scoping, via the new day-free `getParadaAbiertaDeMaquina(maquinaId)`. Port + both adapters + parity landed with the decision. |

---

## 7. Stale intermediate snapshot: the requirement counts in `spec-report.md`

Recorded because a future reader will hit the contradiction. `spec-report.md` (written by
`sdd-spec`, preserved verbatim) reports **11 / 4 / 4** requirements. The delta files and their
promoted specs actually carry **12 / 5 / 6**. The delta files are the artifact of record; the
`spec-report.md` counts are a snapshot taken before the specs were finalised, and its absolute
artifact paths (`openspec/changes/historical-day-navigation/…`) no longer resolve because the
change has been archived. **The files win.** No historical report was rewritten to hide this.

---

## 8. Process finding: the SDD preflight gate has three groups, not four

The preflight gate was invoked once this cycle with **four** question groups and the plugin
**rejected** it.

The canonical plugin, `/root/.config/opencode/plugins/sdd-task-result-artifacts.ts`, defines
exactly **three** groups in `SDD_PREFLIGHT_GROUPS` — `Pace`, `Artifacts`, `PR strategy` — and
its canonical answer marker is `/^Gentle AI SDD preflight \d\/3:\s*/`, i.e. the runtime owns
three numbered questions (`Gentle AI SDD preflight 1/3:`, `2/3:`, `3/3:`). A fourth
review-budget question does **not** exist in that gate: **400 changed lines is this project's
default review policy**, not a preflight choice. Recorded so the discrepancy is not repeated.

---

## 9. Mechanical-archive evidence

Steps 2–4 were performed and independently verified before this report was written. What is
recorded here is what can be attested, and by what means.

- **Spec sync**: no `gentle-ai sdd-archive-compose` invocation was possible — the subcommand does
  not exist in `gentle-ai 4.0.0` (see §3). The merge was **not** redone by hand to compensate.
  Evidence is the structural name-presence check plus requirement counts, reproduced in §3.
- **Archive move**: the active folder is confirmed absent and the archive folder holds all eight
  source artifacts. Note for the orchestrator: the move is **not staged as a git rename** —
  `git status` shows the eight old paths as unstaged deletions and
  `openspec/changes/archive/2026-10-04-historical-day-navigation/` as untracked. The rename must
  be staged before committing, and `openspec/specs/historical-day-navigation/` is untracked too.
- **This report is additive.** It did not exist in the source change folder, so it is excluded
  from any source/destination byte comparison. The readback below proves it is the only change:
  the other eight files compare **empty**, and the full comparison reports exactly one addition.
- **No commit and no push** were performed. The orchestrator commits.

---

## 10. Summary of what is not done

1. **G.3** — `cargo check` in `src-tauri`: open, blocked by a missing Android NDK sysroot for
   the configured `aarch64-linux-android` target (`cargo 1.98.1` itself is installed). Rust side
   unchanged and unverified in this environment.
2. **R5 / R6** — open, `PARTIALLY VALIDATED`; need a real Tauri runtime. Not claimed anywhere.
3. **A.1** — the superseded *"No port signature changes in this change"* requirement still sits in
   the pending `operational-event-operative-date` delta and must not be promoted as-is.
4. **OQ-1** — open, awaiting operational confirmation; carried to a later phase.
5. **`apply-progress.md` / `verify-report.md`** — do not exist for this change. The §4 evidence
   lives in this report, not in a verification certificate.