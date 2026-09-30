# Archive Report — sqlite-persistence-phase-2

**Archived**: 2026-09-30
**Change**: `sqlite-persistence-phase-2`
**Artifact store**: openspec (repo-local `openspec/`)
**Archive location**: `openspec/changes/archive/2026-09-30-sqlite-persistence-phase-2/`

---

## 1. Archive outcome

The change is archived. Delta specs were promoted into the main specs, the change folder
was moved mechanically, and every artifact was preserved byte-for-byte.

**No destructive merge occurred.** `openspec/specs/` was empty before this archive (only
`.gitkeep`), so no main spec existed for any of the three domains. Each delta was therefore
a complete specification rather than a delta, and the copy path applied instead of the
composition path — no `MODIFIED`/`REMOVED` block was ever resolved against a canonical file,
so the `rules.archive` warning ("Warn before merging destructive deltas") was not triggered.
All three files also carry `## Requirements` with `### Requirement:` headings and no
`## ADDED|MODIFIED|REMOVED|RENAMED Requirements` markers, confirming they are full specs.

### Specs synced

| Domain | Action | Requirements | Path |
|---|---|---|---|
| `operational-events-schema` | Created (main spec did not exist) | 12 | `openspec/specs/operational-events-schema/spec.md` |
| `operational-recovery-wiring` | Created (main spec did not exist) | 12 | `openspec/specs/operational-recovery-wiring/spec.md` |
| `operational-repository-contracts` | Created (main spec did not exist) | 11 | `openspec/specs/operational-repository-contracts/spec.md` |

Total: 35 requirements promoted. Mechanical-copy evidence: `cp` to a temp file inside the
target directory, `diff -r` readback (empty), then `mv`. Post-`mv` `diff -r` re-check was
also empty for all three.

### Archive contents

| Artifact | Observed | Notes |
|---|---|---|
| `proposal.md` | present | — |
| `exploration.md` | present | from `sdd-explore`; not listed in the dispatcher's `artifactPaths` but preserved |
| `design.md` | present | — |
| `tasks.md` | present | 63/63 checked, 0 unchecked |
| `specs/operational-events-schema/spec.md` | present | — |
| `specs/operational-recovery-wiring/spec.md` | present | — |
| `specs/operational-repository-contracts/spec.md` | present | — |
| `apply-progress.md` | present | historical evidence, preserved verbatim |
| `verify-report.md` | **missing** | verification was optional; see §4 |
| `research.md` | missing | never produced for this change |
| `state.yaml` | missing | optional recovery hint, never needed |

Byte-integrity of the archived folder was confirmed twice, independently: a recursive
`diff -r` against a pre-move snapshot of the source (empty), and a `sha256` comparison of
each archived file against its blob in `HEAD` (8/8 identical).

---

## 2. Implementation state at close

Phase 2 is **complete**: 63/63 tasks, all boxes `[x]` in the archived `tasks.md`.

- **Gate G2 is CLOSED** — the 14.1–14.9 Phase 14 unit.
- Full suite: **34 files / 936 tests, 936/936 green** (`vitest run --testTimeout=30000`,
  2026-09-30 14:26, `EXIT=0`).
- `npx tsc --noEmit` clean; `git diff --check` clean.
- `src/domain/` carries **no changes from G2** — the working-tree diff for `src/domain/` is
  empty, honouring the 14.9 guardrail.
- G2-specific test evidence: store suites 77/77 (3 files); `persistence-integration.test.ts`
  6/6; App + materialize + fake-SQLite-store regressions 141/141 (3 files).
- Commits (local `main`, **not pushed**): `dff0cf1` `refactor(sqlite): derive deltaGolpes at
  composition, closing phase-14 G2` (11 files) and `c47d9c8` `docs(openspec): record the G2
  commit hash in apply-progress`.

---

## 3. The contradiction that G2 resolved (CORRECTION 11)

**Recorded here because it is the most consequential decision in this change's history.**

Acceptance criterion 14.8 required the ">3% 2da" operational alert to be recomputed
identically before and after a restart. It could not hold. `componerOrdenConLecturas` (10.8)
fed the domain layer with `getLecturasByOrden`'s read projection, in which every persisted
lectura carries `deltaGolpes: 0` — the documented 10.8 placeholder. Because
`proyeccionSegundaDeOrden` computes production as the sum of deltas, a recovered counter of
`[100, 150]` (50 real golpes × 3 = 150 uds) could never materialize production after a
restart: `estado = "alerta"` was unreachable, and the assertion could only pass masked as a
double "Buena racha".

The prior test-G expectation ("deltaGolpes stays in the repository's 0 placeholder; the
domain derives") was a **false acceptance**. The domain derives deltas only *while
registering* a lectura; it has no pure recompute-over-a-series function, and 14.9 forbids
touching `src/domain/**`.

**User decision (2026-09-30, Option 2)**: fix the root cause at the composition seam rather
than document the alert-after-restart as an accepted divergence.

**Resolution (G2 / CORRECTION 11).** A new pure store-layer `derivarDeltaGolpes` in
`src/store/sqlite/sqliteOrderRepository.ts` encodes the domain's closed rules: first (base)
= 0; greater = `valor - anterior`; equal = 0 (`sinIncremento`); smaller = **throw**
`el contador no puede retroceder`, so a corrupt source propagates rather than inventing
production. Both `mapOrdenRow(row, lecturas)` and recovery's `componerOrdenConLecturas`
share it, so the documented "misma derivación" claim stays true and the placeholder is
consumed at composition, never propagated to the domain layer. `recoverPersistedState` still
returns sources — `state.lecturas` keeps the read projection, and `startup.test.ts` plus the
10.6 read contract are unchanged.

No assertion was weakened. The old test-G absurdity (feeding the last absolute value 106 as
golpes to `calcularProgreso`) was replaced by the real derivation path
(`golpesProducidosDesdeLecturas` over reconstructed deltas).

### Restart-survival tests

- `src/__tests__/persistence-integration.test.ts` (14.8a) now pins the alert explicitly:
  `calidadAntes` and `calidadDespues` both contain **"Alerta"** — no silent
  "Buena racha"-vs-"Buena racha" — with the projection at `pct ≈ 5/150`.
- `src/store/sqlite/__tests__/recovery.test.ts` test **G** asserts the composition contract:
  values preserved, deltas rebuilt as `[0, 6]`, `golpesProducidosDesdeLecturas` = 6,
  `calcularProgreso` 18 uds, no writes, deterministic, non-mutating.
- `src/store/sqlite/__tests__/sqliteOrderRepository.test.ts` carries a `derivarDeltaGolpes`
  unit suite (empty / single / monotonic / equal / retroceso / idempotence) plus a
  raw-input recompute case in the mapping test.

### Correction history preserved

The archived `tasks.md` holds the complete correction ledger: **CORRECTIONS 1–11**, with
CORRECTION 11 as the final entry. This is historical evidence and was preserved verbatim; no
checkbox was repaired and no historical report was rewritten during archive.

---

## 4. Verification: no certificate existed

**There is no `verify-report.md` for this change, and none is claimed.** Verification is an
optional diagnostic in this workflow, and the dispatcher reported
`verifyReport: [missing]`. The orchestrator did not fabricate a pass to enable archive.

What exists instead is the **14.9 verification cycle** recorded in `apply-progress.md`:
`tsc --noEmit` green, store suites 77/77, `persistence-integration.test.ts` 6/6,
App/materialize/fake 141/141, full suite 936/936 `EXIT=0`, `git diff --check` clean, and an
orchestrator gatekeeper PASS. That is a real, reproducible evidence trail — but it is
recorded inside `apply-progress.md`, **not** issued as a formal verification certificate.

Two further disclosures carried forward verbatim from that cycle:

- One **latent** assertion was fixed, not weakened:
  `persistence-integration.test.ts:738-740` asserted the combined regex
  `/Uso autorizado por gerencia: Gerencia turno mañana/`, which can never match —
  `InspeccionTelaSection.tsx:193` renders the label in a `<strong>` node and the value in a
  sibling text node, and `getByText` matches direct text nodes only. It was replaced with the
  strong-node selector, the same pattern `App.test.tsx:1534` uses; the intent (resolution
  survives restart) is preserved. The assertion had been latent because the projection
  assertion failed first.
- Two latent 14.8b type errors surfaced only through `tsc` (vitest transpiles without
  typechecking) and were fixed with `as HTMLSelectElement` in the A2 `selectParada` block.
- **Process deviation, documented**: the 14.9 cycle ran **inline** because sub-agent dispatch
  failed 3/3 on transport errors this session.

---

## 5. Open follow-up — R5/R6 (UNRESOLVED, non-blocking)

**R5/R6 remain OPEN. No pass is claimed for either. They are not part of this archive and
require a future decision.**

The test double *models* SQLite; it never executes it. It opens no connection, applies no
DDL and simulates no `PRAGMA foreign_keys`, so there is no runtime seam in which SQLite
behaviour could be verified. Task 14.9 recorded these probes as **recorded-but-not-an-
acceptance-criterion**, which is why the change could close without them.

| ID | Open item | Where to run it |
|---|---|---|
| **R5** | Validate on the real Tauri binary that migration 004 (`src/store/sqlite/migrations/004_operational_events.sql`) was actually applied — checksum recorded and DDL executed. | Real Tauri binary / device. Not reachable in the test environment. |
| **R6** | Run the read-only `getForeignKeys()` (`src/store/sqlite/database.ts:136-142`; the `PRAGMA foreign_keys` select at lines 138-140) to observe whether `PRAGMA foreign_keys` is actually **enforced** on the connection that serves `execute`/`select`. | Real Tauri binary / device. The Rust side was never verified — the environment cannot verify it at all (Termux/Android linker), so R6 has stayed open exactly as it did for migrations 001–003. |

R6 matters because the schema declares five physical foreign keys. Their declaration is
verified in the test suite at the DDL level, but **runtime enforcement on the serving
connection remains unconfirmed**.

---

## 6. Residual open items at close

Recorded honestly; none blocks the archive, and none is claimed as resolved.

1. **Stale `verifySchema` JSDoc.** The comment still reads *"Verify that all expected
   **Phase 1** tables exist"* while the function now checks **eight** tables. Task 1.3
   explicitly placed the module doc comment's Phase 1 framing out of scope, and A2 also
   declined it. **Still open at close** — verified in the current tree at
   `src/store/sqlite/migrations/index.ts:70-73`. (The historical note cites
   `database.ts`; the function now lives in `migrations/index.ts` since 10.1 — a citation
   drift in the note, not a change in the underlying issue.) Cosmetic, documentation-only.
2. **No verification certificate** — see §4. Evidence exists in `apply-progress.md`; a
   formal `verify-report.md` does not.
3. **R5/R6** — see §5. Open, non-blocking, deferred to a future decision.

---

## 7. Mechanical-archive evidence

- **Spec sync**: no `gentle-ai sdd-archive-compose` invocation was made — the mandatory
  composition command is only for the case where a main spec already exists, and none did.
  All three domains took the mechanical-copy path (`cp` → temp file in the target directory
  → `diff -r` readback → `mv` → post-`mv` `diff -r`). Both `diff -r` readbacks were empty
  for all three domains.
- **Archive move**: `git mv openspec/changes/sqlite-persistence-phase-2
  openspec/changes/archive/2026-09-30-sqlite-persistence-phase-2` (exit 0; all 8 files were
  git-tracked, so `git mv` applied and the plain-`mv` fallback never engaged). The
  destination-collision guard passed; the source directory was confirmed absent afterwards.
- **Mandatory readback**: `diff -r` of the pre-move recursive snapshot against the
  destination returned **empty output, exit 0**. File count 8 → 8. This report file is
  additive and is excluded from that comparison, because it did not exist in the source
  snapshot.
- **Independent confirmation**: `sha256` of each of the 8 archived files matches its blob in
  `HEAD` (8/8 identical), and the archived `tasks.md` still reads 63 checked / 0 unchecked.
- **No commit, no push** were performed. The rename is staged by `git mv`; the three new
  main specs are untracked and the orchestrator must stage them before committing.
