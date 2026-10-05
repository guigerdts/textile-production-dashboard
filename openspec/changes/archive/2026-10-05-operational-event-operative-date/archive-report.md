# Archive Report — operational-event-operative-date

**Archived**: 2026-10-05
**Change**: `operational-event-operative-date`
**Artifact store**: openspec (repo-local `openspec/`)
**Archive location**: `openspec/changes/archive/2026-10-05-operational-event-operative-date/`
**Baseline**: `644b02294a4e3fe910c1b5df6c282c73ec0e4fe4` (= `origin/main`), branch
`chore/archive-operational-event-operative-date`

This is a **re-archive**. A previous attempt produced a contract regression and was reverted; the
delta was repaired before composition. See §2.

---

## 1. Archive outcome

The change is archived **with open items**. 42 of 43 tasks are complete; one remains `[ ]` in the
archived `tasks.md` and is reported as it stands. No checkbox was repaired and no historical report
was rewritten.

The active folder `openspec/changes/operational-event-operative-date/` no longer exists (confirmed
absent). All eight artifacts it contained are preserved in the archive folder.

### Specs synced

| Domain | Action | Reqs before → after | Scenarios before → after | Path |
|---|---|---|---|---|
| `operational-event-operative-date` | Created (main spec did not exist; full spec promoted) | 0 → **7** | 0 → **18** | `openspec/specs/operational-event-operative-date/spec.md` |
| `operational-events-schema` | Updated (3 substituted, 7 added) | 12 → **19** | 32 → **49** | `openspec/specs/operational-events-schema/spec.md` |
| `operational-recovery-wiring` | Updated (0 substituted, 3 added) | 18 → **21** | 62 → **71** | `openspec/specs/operational-recovery-wiring/spec.md` |
| `operational-repository-contracts` | Updated (0 substituted, 4 added, **1 excluded**) | 16 → **20** | 59 → **70** | `openspec/specs/operational-repository-contracts/spec.md` |

**No canonical requirement was lost and none was duplicated.** The one requirement deliberately not
promoted is A.1, §5.1. The only content removed anywhere is the **stale bodies of the three
MODIFIED requirements**, which is exactly what a MODIFIED section means: the canonical bodies held
the version-4 contract and were replaced, in place and by name, with the version-5 contract that
carries all of their clauses forward.

### Archive contents

| Artifact | Observed | Notes |
|---|---|---|
| `proposal.md` | present | — |
| `exploration.md` | present | from `sdd-explore` |
| `design.md` | present | — |
| `tasks.md` | present | **43 tasks, 42 `[x]`, 1 `[ ]`** |
| `specs/operational-event-operative-date/spec.md` | present | full spec, 7 requirements / 18 scenarios |
| `specs/operational-events-schema/spec.md` | present | delta, 10 requirements / 26 scenarios (repaired) |
| `specs/operational-recovery-wiring/spec.md` | present | delta, 3 requirements / 9 scenarios |
| `specs/operational-repository-contracts/spec.md` | present | delta, 5 requirements / 13 scenarios |
| `spec-report.md` | **missing** | never produced for this change |
| `apply-progress.md` | **missing** | never produced for this change |
| `verify-report.md` | **missing** | verification is optional in this workflow; none is claimed |

---

## 2. The delta repair, and why it was needed

### 2.1 The regression

The delta's `## MODIFIED Requirements` preamble states its own governing rule:

> Only the enumerated counts and the version registration move; every other clause of those
> requirements is unchanged and remains in force.

The three MODIFIED bodies **violated that rule**. Each was a truncated restatement rather than the
complete canonical requirement, so composing them over the canonical text deleted canonical content.
In `operational-events-schema` alone the systematic audit found **8 lost scenarios** and the entire
11-row index table. A fourth defect compounded it: the third MODIFIED heading read
`The migration is registered in both projects and the frontend metadata matches`, which does not
match the canonical heading `The migration is registered canonically, mirrored, and versioned`. The
heading mismatch made composition promote that requirement as **new** instead of modifying the
canonical one, and its body weakened the canonical **byte-identical** mirror MUST down to merely "a
mirror SQL file".

### 2.2 What the repair did

Each MODIFIED body is now the **complete canonical requirement with only the 005 change applied**.

| MODIFIED requirement | Restored from canonical | 005 change applied |
|---|---|---|
| `Migration 004 creates exactly the five operational tables` | full body incl. the `campos_especificos` cross-reference; all 4 canonical scenarios incl. the 59-column enumeration, the no-CHECK/no-DEFAULT scenario and `No Down migration is registered` | added the version-5 63-column scenario |
| `Exactly eleven indexes exist, one per query the ports issue` | full body incl. **the entire 11-row index table**, `The migration creates exactly the eleven listed indexes` and `No speculative index is created` | added the version-5 15-index scenario and the 004-persistence scenario |
| `The migration is registered canonically, mirrored, and versioned` | canonical heading restored **exactly**; body retains the **byte-identical** mirror MUST; 3 canonical scenarios | generalised 4 → the full version range 1–5 |

The canonical prose was **extracted mechanically from the canonical spec by script, never retyped**,
so no canonical clause could be truncated by hand. Every substitution was asserted to match exactly
once or the script aborted.

Delta requirement count is unchanged at **10** (7 ADDED + 3 MODIFIED). Delta scenarios: **21 → 26**.
The 7 ADDED requirements are **byte-identical to their pre-repair state** (verified by diffing lines
1–180 against `HEAD`, empty diff) — including `The migration is registered in Rust, mirrored in the
frontend, and its version is reflected`. Its overlap with the reconstructed MODIFIED 3 is the change
author's choice and was preserved faithfully, not "fixed".

### 2.3 Two deliberate deviations from a literal reading of the instructions

1. **`all four are MigrationKind::Up` → `all five are MigrationKind::Up, one per registered version`**
   (`No Down migration is registered`, relocated into the first MODIFIED body per instruction). The
   canonical scenario asserted a count of four migrations, which this change itself moves to five.
   The delta's own preamble mandates the move — "Only the enumerated counts … move" — so keeping
   "four" would have written a self-contradictory clause into the source of truth. The scenario's
   point, that **every** registered migration is `Up`, is preserved.
2. **Three redundant delta scenarios were dropped, not restored**: the delta's own truncated
   `The migration script creates the five tables and nothing else` and
   `The enumerated column sets describe migration 004`, and its weakened registration scenarios.
   Each is a strict subset of the canonical scenario that replaces it; keeping both would have
   duplicated the heading in one promoted spec. Verified: **no duplicated `#### Scenario:` heading**
   in any of the three updated specs.

### 2.4 `No port signature changes in this change` was NOT promoted as a requirement

The phrase still appears once in `openspec/specs/operational-repository-contracts/spec.md:757`, as
**prose only**, inside the pre-existing `## Interaction with the pending
operational-event-operative-date delta` section, where it explains that the requirement is
superseded. That prose is canonical and was preserved. It is **not** an active `### Requirement:`
heading anywhere. See §5.1.

---

## 3. The mechanical-archive command does not exist — composition proven structurally instead

**This is a real gap in the toolchain, not a skipped step. No native-composition claim is made.**

`sdd-archive`'s Step 2 mandates composition through the native command, precisely because a
model-driven Read/Edit merge is how archive previously dropped unrelated requirements while
reporting success:

```
$ gentle-ai --version
gentle-ai 4.0.0
$ gentle-ai sdd-archive-compose --help
Error: unknown command "sdd-archive-compose" — run 'gentle-ai help' for available commands
```

No substitute native tool was invented. The merge was performed by a deterministic script and then
**proven against the written files**, not self-reported. The proof, per domain:

- every canonical requirement name is still present in the promoted spec (**nothing lost**);
- every preserved canonical requirement's body is **byte-identical** to its baseline source;
- each substituted requirement is byte-identical to its repaired delta block;
- each ADDED requirement is byte-identical to its delta block;
- the excluded requirement is absent;
- no duplicated requirement heading, and no duplicated scenario heading introduced by composition.

Independently confirmed by a separate audit: across the three updated specs, **0 canonical
requirements were lost** and **0 canonical scenarios were lost**. The only two canonical scenario
*titles* absent from the promoted spec are `The Rust side registers version 4` and
`The frontend migration metadata reflects version 4`, both replaced on purpose by their generalised
forms (`…the full version range`, `…the highest version`), which carry every canonical clause.

**Two implementation defects were caught by these assertions before anything was accepted** — both
were section-bounding bugs in the extraction step, not content errors: the last requirement block of
a section absorbed the document's trailing sections, and the last ADDED block absorbed the MODIFIED
section. Had the composition not been asserted block-by-block, either would have been written into
the source of truth.

**Residual risk, stated plainly:** byte-identity of *preserved* requirements is now proven. The three
**substituted** requirements are byte-identical to the repaired delta, which means their correctness
still rests on the repair in §2 being right. That is a judgement about content, and it is a judgement
a reviewer should re-read, not one this archive can prove mechanically.

### Archive move

The skill prefers `git mv` when the change folder is tracked. It is tracked. `git mv` was **not**
used: it stages the rename, and the parent instruction for this unit forbids any git
state-changing command. Plain `mv` was used instead, with the full pre-move snapshot and mandatory
`diff -r` readback the skill requires — the same precedent as the 2026-10-04
`historical-day-navigation` archive.

**Note for the orchestrator: the move is not staged as a git rename.** `git status` shows the eight
old paths as unstaged deletions and `openspec/changes/archive/2026-10-05-operational-event-operative-date/`
as untracked. The rename must be staged before committing. `openspec/specs/operational-event-operative-date/`
is untracked too. **No commit and no push were performed.**

---

## 4. Verification state

**No verification certificate (`verify-report.md`) exists for this change and none is claimed.** This
archive was a documentation-only unit: **no code and no test was changed**, and no test suite,
type-check, build or migration harness was executed in this session. Nothing below is a pass claim
for this archive's own work.

The counts this archive asserts about the migrations are those established from the migration files
and the change's own records, as recorded in §5 and in the archived `tasks.md`: migration 004 creates
11 indexes and 59 columns, migration 005 adds 4 indexes and 4 columns (15 indexes, 63 columns at
version 5), and the 005 mirror is byte-identical to its canonical file. Read from the files:
`EXPECTED_COLUMNS_AFTER_005 = 63` in `validate_r56.py`, and a `diff` of the 005 canonical file against
its mirror. The 11 → 15 index total is **not** asserted anywhere in the harness (§5.4). **No statement
here may be read as runtime validation of those migrations on a real Tauri binary.**

### 4.1 The migration counts were re-derived directly from the migration files

Because the delta's numeric claims are content rather than bytes, they were re-checked against the
migration files themselves rather than trusted from the harness. All eleven index names in the
restored canonical table appear in `004_operational_events.sql`, in the same order:

| Index in the restored canonical table | Location in migration 004 |
|---|---|
| `idx_parada_maquina_inicio` | 004 line 114 |
| `idx_actividad_maquina_inicio` | 004 line 115 |
| `idx_dano_maquina_inicio` | 004 line 116 |
| `idx_mantenimiento_maquina_inicio` | 004 line 117 |
| `idx_parada_abierta` | 004 line 120 |
| `idx_actividad_abierta` | 004 line 121 |
| `idx_dano_abierta` | 004 line 122 |
| `idx_mantenimiento_abierta` | 004 line 123 |
| `idx_parada_orden` | 004 line 126 |
| `idx_dano_orden` | 004 line 127 |
| `idx_inspeccion_orden` | 004 line 128 |

Derived totals, counted from the SQL:

- `004_operational_events.sql` — **11** `CREATE INDEX` statements → matches the canonical table.
- `005_event_fecha_operativa.sql` — **4** `CREATE INDEX` statements: `idx_parada_maquina_fecha`,
  `idx_actividad_maquina_fecha`, `idx_dano_maquina_fecha`, `idx_mantenimiento_maquina_fecha`
  → exactly `INDICES_FECHA_OPERATIVA` in `validate_r56.py`.
- `005_event_fecha_operativa.sql` — **4** `ALTER TABLE … ADD COLUMN fecha_operativa`, on `parada`,
  `actividad_planificada`, `dano` and `mantenimiento`. **`inspeccion_tela` is not touched**, matching
  the constraint the canonical spec states.
- Index total: **11 → 15**. Column total after 005: **63**.

So the 11 → 15 and 59 → 63 claims now rest on the migration files, not only on
`validate_r56.py`. What remains unproven by any check is still §5.2–§5.4: `inspeccion_tela`
inherits its day from the `orden` is a *design* statement with no runtime check behind it here, and
G.3 remains blocked by the missing Android NDK sysroot.

---

## 5. Open follow-ups at close

### 5.1 A.1 — superseded *"No port signature changes in this change"*: EXCLUDED, and still open as a task

A.1 was raised by the `2026-10-04-historical-day-navigation` archive, which left it `[ ]` precisely
because it could not touch this change's files. It could now be closed by this archive, and it was
handled as instructed: the delta's requirement

```
### Requirement: No port signature changes in this change
```

was **not promoted** as an active `### Requirement:` heading. Its scenario — that `listarPorMaquina`
accepts only `maquinaId` and still returns the machine's full history — is **superseded** by
`Exactly four machine-event ports gain a day-scoped listing`, promoted by that earlier archive. The
canonical spec already documents the supersession in prose, and that prose was preserved.

**A.1 therefore remains `[ ]` in the archived `tasks.md` and is reported as open.** It was not
ticked here because archived tasks retain their original bytes as an audit trail. The requirement it
warned about is excluded from the promoted state; the checkbox is a separate bookkeeping item for the
maintainer.

### 5.2 G.3 — `cargo check` in `src-tauri`: OPEN

Recorded in the archived `tasks.md` and inherited from the `historical-day-navigation` change.
`cargo` is installed and runs (`cargo 1.98.1`); the gap is the **linker**, not the toolchain —
linking for the configured `aarch64-linux-android` target fails with `cannot find -llog` and
`cannot find -lunwind`. The cause is a **missing Android NDK sysroot** for the configured target. Per
that change's own verified finding, nothing in this change can be the cause. The Rust side is
therefore **unverified in this environment**, and no Rust gate is claimed.

### 5.3 R5 / R6 — OPEN, no Tauri-runtime validation claimed

Recorded as `PARTIALLY VALIDATED` in `src-tauri/migrations/VALIDATION.md`. R5 (migrations 004/005
applied: sqlx `_sqlx_migrations` tracking, checksum record, `VersionMismatch` gate) and R6
(`getForeignKeys()` returning the declared foreign keys through `@tauri-apps/plugin-sql`) both
require the real Tauri binary and a webview runtime, neither of which exists here. The Python harness
applies the real migration files against a real SQLite engine, which is genuine engine evidence but
**is not** the R5/R6 contracts. Per the archived `tasks.md`: "R5/R6 remain **OPEN**; no Tauri-runtime
claim is made."

### 5.4 The single unfinished task — and this archive's role in it

The one `[ ]` in `tasks.md` is a Definition-of-Done item:

> The 005 mirror file is byte-identical to the canonical file; 59 → 63 columns and 11 → 15 indexes are
> reflected in the promoted spec's MODIFIED requirements and in `validate_r56.py`.

Its three claims are each checkable, with one correction worth recording:

- The 005 mirror **is** byte-identical to its canonical file (read this session with `diff`).
- `validate_r56.py` asserts `EXPECTED_COLUMNS_AFTER_005 = 63`, so **63 columns is asserted**. It does
  **not** assert a total of 15 indexes: section 4c iterates only `INDICES_FECHA_OPERATIVA`, the four
  day-scoped indexes of 005, and the harness contains **no assertion at all** about the 11 indexes
  of migration 004. So the 11 → 15 total is specified in the promoted spec and **enforced nowhere in
  the harness** — a real gap in the executable contract, recorded rather than glossed.
- The promoted spec's MODIFIED requirements now carry 59/11 as what migration 004 itself declares plus
  the version-5 63/15 scenarios.

**The promotion half of this item is what this archive did.** The checkbox is still `[ ]` because it
was not repaired, and no `validate_r56.py` run was executed in this session.

### 5.5 Contradiction between the archived `tasks.md` and the delta it describes

The archived `tasks.md` (the "Still open" section, written before archive) states that "the delta
spec's MODIFIED requirements correctly keep 59/11 as what migration 004 itself declares while adding
the version-5 scenario". **That claim was wrong.** The MODIFIED requirements kept the *counts* but
were truncated restatements that dropped 8 canonical scenarios and the whole 11-row index table; only
their counting was right. The `tasks.md` claim is **ranked below** the canonical spec and the repaired
delta, both of which are the artifact of record. Recorded so a future reader who trusts `tasks.md`
does not conclude the delta was already sound.

### 5.6 Resolved finding — duplicate scenario title in `operational-recovery-wiring`

Promoting the delta produced one scenario title that occurred **twice** in
`openspec/specs/operational-recovery-wiring/spec.md`:

| Scenario title | Owning requirement | Origin |
|---|---|---|
| `A rejected insert reports the error and changes nothing` | `A persistence failure surfaces the error and leaves the visible state untouched` | canonical |
| `A rejected insert reports the error and changes nothing` | `Persistence round-trips the operative date before the UI reflects the event` | delta ADDED |

The two were **not** duplicates in content. The canonical scenario asserts the error-list shape, an
unchanged `parada` list, and that the operario is not told the `parada` was recorded. The delta's adds
a distinct assertion: no event exists in storage without a `fechaOperativa`.

It was promoted verbatim at first, because silently renaming the change author's ADDED scenario is
not archive's job, and it was reported as an open finding rather than fixed during archiving.

**Resolution — applied after this archive, on the maintainer's decision.** The collision was resolved
by renaming **only the delta's ADDED** scenario, because the canonical requirement is pre-existing
contract and must be preserved verbatim. It is now titled:

`A rejected insert leaves no event without a fechaOperativa`

Its assertions are unchanged; only the title moved, and the new title names the assertion that
actually distinguishes it from the canonical scenario. Scenario titles are unique in that spec now.

### 5.7 Resolved conflict — two `### Requirement:` headings contain "registered"

The orchestrator's launch instructions contained a direct contradiction, recorded here rather than
resolved silently in either direction:

- **Task 2** required: "Leave all 7 ADDED requirements in the delta untouched, **including
  `The migration is registered in Rust, mirrored in the frontend, and its version is reflected`**",
  and stated that overlap with the reconstructed MODIFIED 3 "is the change author's choice; preserve
  it faithfully rather than 'fixing' it".
- **Verification 6** required: "The promoted `operational-events-schema` has **exactly ONE**
  `### Requirement:` heading containing 'registered'".

The contradiction was in those instructions, not in the change. The promoted spec briefly carried two
registration requirements at the **same scope**:

| Heading | Origin |
|---|---|
| `The migration is registered canonically, mirrored, and versioned` | repaired MODIFIED 3 (canonical name) |
| `The migration is registered in Rust, mirrored in the frontend, and its version is reflected` | change author's ADDED requirement |

Both asserted the same contract at version 5: the repaired MODIFIED 3 had been over-pinned to
`version: 5` and to `CURRENT_MIGRATION_VERSION` MUST be `5`, while the delta's own MODIFIED text had
said MUST **equal the highest registered version**.

**Resolution — applied after this archive, on the maintainer's decision: the general rule plus the v5
instance.**

- The canonical requirement now states the **rule that holds for every migration**: canonical
  location, `kind: MigrationKind::Up`, a `description` in `snake_case`, embedded via `include_str!`, a
  **byte-identical** mirror, `CURRENT_MIGRATION_VERSION` **equal to the highest registered version**,
  `TABLES` listing all eight tables, and no `Down` migration. It is **no longer pinned to v5**.
- The author's ADDED requirement is unchanged and remains the **concrete v5 instance** the change
  introduced. The general rule cross-references it.

The two are therefore not duplicates: one is the rule, the other is its specific case. The
requirement count stays at **19**; it was not reduced to tidy a number. The **byte-identical** mirror
MUST survives under both.

---

## 6. Summary of what is not done

1. **A.1** — the superseded *"No port signature changes in this change"* requirement was **excluded**
   from promotion, but the task checkbox remains `[ ]` in the archived `tasks.md`.
2. **G.3** — `cargo check` in `src-tauri`: open, blocked by a missing Android NDK sysroot for the
   configured `aarch64-linux-android` target (`cargo 1.98.1` itself is installed). Rust side
   unverified in this environment.
3. **R5 / R6** — open, `PARTIALLY VALIDATED`; need a real Tauri runtime. Not claimed anywhere.
4. **No verification was executed** in this archive: no `npm run test`, no `npx tsc --noEmit`, no
   `npm run build`, no `cargo`, no `python3 src-tauri/migrations/validate_r56.py`. This unit changed
   documentation only.
5. **`spec-report.md` / `apply-progress.md` / `verify-report.md`** — do not exist for this change.
6. **The duplicate scenario title** in `operational-recovery-wiring` (§5.6) and the **two
   `registered` requirement headings** (§5.7) were open findings at the moment of archiving. Both were
   resolved on the maintainer's decision immediately afterwards, before this archive was committed;
   neither was papered over. See §5.6 and §5.7 for the resolution and its reasoning.
7. **Nothing was pushed.** The archive exists as a single local commit on
   `chore/archive-operational-event-operative-date`; `origin/main` remains at the published baseline
   `644b022`. Publication is a separate, explicit maintainer decision.
