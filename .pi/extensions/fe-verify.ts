/**
 * fe-verify — Frontend PR verification gate for the WIMS-BFP prototype.
 *
 * Captured from a repeated SDD hardening loop (issues #618/#619/#620): after a
 * hardening worker edits a frontend PR, the parent ran the same deterministic
 * sequence by hand:
 *   1. git worktree add at the PR branch
 *   2. npm run lint          (changed frontend files)
 *   3. npx vitest run <tests> (changed test files)
 *   4. npx tsc --noEmit      (filtered to changed TS/TSX — catches test-only
 *                             typecheck regressions like bad mock shapes)
 *   5. parse pass/fail counts and report
 *
 * This extension turns that into one command. It is deliberately narrow:
 * frontend lint + vitest + typecheck only. It touches no auth/RBAC/PII/crypto,
 * migrations, infra, or backend.
 *
 * Usage:
 *   /fe-verify [branch] [--test <path>]... [--no-worktree] [--keep]
 *
 *   branch         PR head branch (e.g. feat/610-icons-severity-system).
 *                  If omitted, verifies the current working directory.
 *   --test <path>  Explicit test file(s) to run with vitest. Repeatable.
 *                  If omitted, derived from changed files on the branch.
 *   --no-worktree  Verify in the current directory instead of a temp worktree.
 *   --keep         Keep the temp worktree after verifying (default removes it).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ExecOut = { code: number; stdout: string; stderr: string };

async function sh(
  pi: ExtensionAPI,
  cwd: string,
  command: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<ExecOut> {
  const r = await pi.exec(command, args, { cwd, timeout: timeoutMs });
  return {
    code: r.code ?? (r.stdout ? 0 : 1),
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/** Parse "branch --test a --test b --no-worktree --keep" into structured args. */
function parseArgs(raw: string): {
  branch?: string;
  tests: string[];
  noWorktree: boolean;
  keep: boolean;
} {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let branch: string | undefined;
  const tests: string[] = [];
  let noWorktree = false;
  let keep = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--no-worktree") noWorktree = true;
    else if (t === "--keep") keep = true;
    else if (t === "--test") {
      const next = tokens[++i];
      if (next) tests.push(next);
    } else if (!t.startsWith("--") && !branch) {
      branch = t;
    }
  }
  return { branch, tests, noWorktree, keep };
}

/** Resolve the merge-base so we can list *changed* files vs the PR base. */
async function changedFrontendFiles(
  pi: ExtensionAPI,
  cwd: string,
  branch: string | undefined,
): Promise<string[]> {
  // Determine the diff range. For a branch we compare against its merge-base
  // with origin/master; for cwd we use the unstaged+staged working tree.
  let range = "";
  if (branch) {
    const mb = await sh(pi, cwd, "git", ["merge-base", "origin/master", `origin/${branch}`]);
    if (mb.code === 0 && mb.stdout.trim()) range = `${mb.stdout.trim()}...origin/${branch}`;
  }

  const diffArgs = range
    ? ["diff", "--name-only", range]
    : ["diff", "--name-only", "--cached", "HEAD"];
  const r = await sh(pi, cwd, "git", diffArgs);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("src/frontend/") && /\.(ts|tsx)$/.test(l));
}

function countVitest(lines: string): { files: number; tests: number; failed: number } {
  // Matches "Test Files  130 passed (130)" and "Tests  1361 passed (1361)"
  const filesM = lines.match(/Test Files\s+(\d+)\s+passed.*?(\d+)\s+failed/i);
  const testsM = lines.match(/Tests\s+(\d+)\s+passed.*?(\d+)\s+failed/i);
  const files = parseInt((lines.match(/Test Files\s+(\d+)/) ?? [])[1] ?? "0", 10);
  const tests = parseInt((lines.match(/Tests\s+(\d+)/) ?? [])[1] ?? "0", 10);
  const failed = testsM ? parseInt(testsM[2], 10) : 0;
  return { files, tests, failed };
}

function countLint(lines: string): { errors: number; warnings: number } {
  const m = lines.match(/(\d+)\s+problems\s+\((\d+)\s+errors?,?\s*(\d+)\s+warnings?\)/i);
  if (m) return { errors: parseInt(m[2], 10), warnings: parseInt(m[3], 10) };
  const errOnly = lines.match(/(\d+)\s+error/);
  return { errors: errOnly ? parseInt(errOnly[1], 10) : 0, warnings: 0 };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("fe-verify", {
    description:
      "Verify a WIMS-BFP frontend PR: lint + vitest + tsc in an isolated worktree. " +
      "Args: [branch] [--test <path>]... [--no-worktree] [--keep].",
    handler: async (args: string, ctx) => {
      const { branch, tests, noWorktree, keep } = parseArgs(args);
      const repoRoot = process.cwd();
      const summary: string[] = [];
      let worktreePath: string | undefined;

      try {
        // 1. Resolve working directory (temp worktree or cwd).
        if (branch && !noWorktree) {
          const wtName = `fe-verify-${branch.replace(/[^\w-]/g, "_")}`;
          worktreePath = `${repoRoot}/.worktrees/${wtName}`;
          // Clean any prior stale worktree with the same name.
          await sh(pi, repoRoot, "git", ["worktree", "remove", worktreePath, "--force"]).catch(
            () => undefined,
          );
          const add = await sh(pi, repoRoot, "git", [
            "worktree",
            "add",
            worktreePath,
            `origin/${branch}`,
          ]);
          if (add.code !== 0) {
            summary.push(`✗ worktree add failed:\n${add.stderr || add.stdout}`);
            if (ctx.hasUI) ctx.ui.notify(summary.join("\n"), "error");
            return;
          }
          summary.push(`▸ worktree: ${worktreePath}`);
        }
        const cwd = worktreePath ?? repoRoot;
        const feDir = `${cwd}/src/frontend`;

        // 2. Determine changed frontend files + test files.
        const changed = await changedFrontendFiles(pi, cwd, branch);
        const testPaths = tests.length
          ? tests
          : changed.filter((f) => /\.test\.(ts|tsx)$/.test(f));
        if (!testPaths.length) {
          summary.push("⚠ no changed frontend test files found; vitest step skipped.");
        } else {
          summary.push(`▸ test files (${testPaths.length}): ${testPaths.join(", ")}`);
        }

        const changedFeSources = changed.filter((f) => !/\.test\.(ts|tsx)$/.test(f));

        // 3. Lint (changed frontend sources + tests).
        summary.push("— lint —");
        if (changedFeSources.length || testPaths.length) {
          const lintTargets = [...changedFeSources, ...testPaths];
          const lint = await sh(pi, feDir, "npx", ["eslint", ...lintTargets]);
          const lc = countLint(lint.stdout + lint.stderr);
          if (lc.errors > 0) {
            summary.push(`✗ lint: ${lc.errors} error(s), ${lc.warnings} warning(s)`);
            summary.push((lint.stdout || lint.stderr).split("\n").slice(0, 20).join("\n"));
          } else {
            summary.push(`✓ lint clean (0 errors, ${lc.warnings} warnings)`);
          }
        } else {
          summary.push("⚠ no lint targets; skipped.");
        }

        // 4. Vitest (changed test files).
        summary.push("— vitest —");
        if (testPaths.length) {
          const vit = await sh(pi, feDir, "npx", ["vitest", "run", ...testPaths]);
          const vc = countVitest(vit.stdout);
          if (vc.failed > 0 || vit.code !== 0) {
            summary.push(`✗ vitest: ${vc.failed} failed (${vc.tests} total)`);
            summary.push(vit.stdout.split("\n").slice(-25).join("\n"));
          } else {
            summary.push(`✓ vitest: ${vc.tests} passed (${vc.files} files)`);
          }
        } else {
          summary.push("⚠ no test files; skipped.");
        }

        // 5. Typecheck (only changed frontend TS/TSX — catches test mock regressions).
        summary.push("— tsc --noEmit (changed frontend files) —");
        const tcTargets = changed.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
        if (tcTargets.length) {
          const tsAll = await sh(pi, feDir, "npx", ["tsc", "--noEmit", "-p", "tsconfig.json"]);
          // Filter tsc errors to our changed files only.
          const relevant = tsAll.stdout
            .split("\n")
            .filter((l) => tcTargets.some((f) => l.includes(f.replace("src/frontend/", ""))));
          if (relevant.length && tsAll.code !== 0) {
            summary.push(`✗ typecheck errors in changed files (${relevant.length}):`);
            summary.push(relevant.slice(0, 20).join("\n"));
          } else {
            summary.push("✓ typecheck clean for changed frontend files");
          }
        } else {
          summary.push("⚠ no changed TS/TSX; skipped.");
        }

        const ok = !summary.some((l) => l.startsWith("✗"));
        summary.push(ok ? "\n✅ fe-verify PASSED" : "\n❌ fe-verify FAILED");
        if (ctx.hasUI) ctx.ui.notify(summary.join("\n"), ok ? "success" : "error");
        console.log(summary.join("\n"));
      } finally {
        // 6. Clean up temp worktree unless --keep.
        if (worktreePath && !keep) {
          await sh(pi, repoRoot, "git", ["worktree", "remove", worktreePath, "--force"]).catch(
            () => undefined,
          );
          summary.push(`▸ removed temp worktree ${worktreePath}`);
        } else if (worktreePath && keep) {
          summary.push(`▸ kept temp worktree ${worktreePath}`);
        }
      }
    },
  });
}
