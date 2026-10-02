// @vitest-environment node
// @ts-expect-error type error without @types/node package
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The declared precondition commit for the historical-day-navigation change.
 *
 * NOT `HEAD`: HEAD moves on every commit of the change, and a guard that moved
 * with it would compare the change against itself and stay green forever. The
 * baseline stays put because it is the change's *precondition* — reverting past
 * it would make this guard green for the wrong reason.
 */
const BASE = "851172c";

/**
 * Why this is a git guard and not a content grep.
 *
 * "Zero diff" is a git fact. Any string-based approximation of it either misses
 * real diffs or fires on files that are legitimately unchanged, and a guard that
 * is red on the precondition commit guards nothing at all. Concretely, a grep
 * for `fechaOperativaHoy` / `new Date(` / `getFullYear` / `toISOString()` /
 * repository ports already fires on the untouched tree: `new Date(` appears at
 * `actividades.ts:177,198`, `danos.ts:64,185,186,257`,
 * `inspeccionTela.ts:63`, `mantenimiento.ts:56,160,242`,
 * `paradas.ts:228,248,263,264` and `tiempo.ts:53,54,89,93,168,169`; the domain
 * suites are co-located `src/domain/*.test.ts` with no `src/domain/__tests__/`
 * directory to hang a `?raw` reader on; and `src/domain/calidad.test.ts`
 * legitimately imports `InMemoryDanoRepository`.
 *
 * The rejected alternative is therefore genuinely unavailable, not merely
 * unchosen.
 */
function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

describe("src/domain has zero diff caused by this change", () => {
  it("has no committed, staged or unstaged change against the precondition", () => {
    // `git diff <commit> -- path` compares BASE with the WORKING TREE, so it
    // already folds committed + staged + unstaged edits together.
    const diff = git(["diff", "--name-only", BASE, "--", "src/domain"]);

    expect(diff).toBe("");
  });

  it("has no new file anywhere under src/domain", () => {
    // Untracked files are invisible to `git diff`; they are the other half of
    // "zero diff".
    const nuevos = git(["ls-files", "--others", "--exclude-standard", "--", "src/domain"]);

    expect(nuevos).toBe("");
  });
});
