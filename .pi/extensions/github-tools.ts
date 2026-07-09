/**
 * GitHub Tools Extension
 *
 * Registers custom tools wrapping `gh` CLI for common GitHub operations.
 * Gracefully degrades when outside a git repo or when `gh` is not authenticated.
 *
 * Replaces the 3-layer PoC approach (PyGithub + Octokit + gh) with pure `gh` CLI.
 *
 * Requires: GitHub CLI (`gh`) installed and authenticated.
 *   - CI: pre-installed, auto-authenticated via GITHUB_TOKEN
 *   - Dev: `gh auth login` or GITHUB_TOKEN env var
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type GhResult = { ok: true; stdout: string } | { ok: false; error: string; hint?: string };

async function execGh(
  pi: ExtensionAPI,
  cwd: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<GhResult> {
  try {
    const result = await pi.exec("gh", args, { cwd, timeout: timeoutMs });
    if (result.code !== 0) {
      const stderr = result.stderr.trim();
      if (stderr.includes("not authenticated") || stderr.includes("auth login")) {
        return { ok: false, error: "GitHub CLI not authenticated", hint: "Run `gh auth login` or set GITHUB_TOKEN" };
      }
      return { ok: false, error: stderr || `gh exited with code ${result.code}` };
    }
    return { ok: true, stdout: result.stdout };
  } catch (err) {
    if (err instanceof Error && err.message.includes("ENOENT")) {
      return { ok: false, error: "gh CLI not installed", hint: "Install from https://cli.github.com/" };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

async function getDefaultRepo(pi: ExtensionAPI, cwd: string): Promise<string | { error: string }> {
  const result = await pi.exec("gh", ["repo", "view", "--json", "nameWithOwner"], { cwd, timeout: 5_000 });
  if (result.code !== 0) {
    return { error: "Not in a GitHub repository — use --repo flag" };
  }
  try {
    const data = JSON.parse(result.stdout) as { nameWithOwner: string };
    return data.nameWithOwner;
  } catch {
    return { error: "Failed to parse gh repo view output" };
  }
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  // ---- Tool: gh_repo_summary ----
  pi.registerTool({
    name: "gh_repo_summary",
    label: "GitHub Repo Summary",
    description: "Fetch repository metadata (stars, forks, open issues, description, language) via gh CLI.",
    promptSnippet: "Fetch repo metadata from GitHub",
    parameters: Type.Object({
      repo: Type.Optional(Type.String({ description: "owner/name (default: auto-detect from git remote)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const repo = params.repo || (await getDefaultRepo(pi, ctx.cwd));
      if (!params.repo && typeof repo !== "string") {
        return {
          content: [{ type: "text", text: repo.error }],
          details: { repo: params.repo ?? "(auto)" },
          isError: true,
        };
      }

      const result = await execGh(pi, ctx.cwd, [
        "repo", "view", repo as string,
        "--json", "nameWithOwner,description,stargazerCount,forkCount,openIssueCount,defaultBranch,language,topics,updatedAt,pushedAt",
      ]);

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `${result.error}${result.hint ? `\nHint: ${result.hint}` : ""}` }],
          details: { repo: params.repo ?? "(auto)" },
          isError: true,
        };
      }

      const data = JSON.parse(result.stdout);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { repo: data.nameWithOwner, summary: data },
      };
    },
  });

  // ---- Tool: gh_create_issue ----
  pi.registerTool({
    name: "gh_create_issue",
    label: "Create GitHub Issue",
    description: "Create a GitHub issue with title, body, and optional labels.",
    promptSnippet: "Create a GitHub issue with optional labels",
    parameters: Type.Object({
      title: Type.String({ description: "Issue title" }),
      body: Type.Optional(Type.String({ description: "Issue body / description" })),
      labels: Type.Optional(Type.Array(Type.String(), { description: "Labels to apply" })),
      repo: Type.Optional(Type.String({ description: "owner/name (default: auto-detect)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const repo = params.repo || (await getDefaultRepo(pi, ctx.cwd));
      if (!params.repo && typeof repo !== "string") {
        return {
          content: [{ type: "text", text: repo.error }],
          details: {},
          isError: true,
        };
      }

      const args = ["issue", "create", "--repo", repo as string, "--title", params.title];
      if (params.body) args.push("--body", params.body);
      if (params.labels?.length) {
        for (const label of params.labels) args.push("--label", label);
      }

      const result = await execGh(pi, ctx.cwd, args);
      if (!result.ok) {
        return {
          content: [{ type: "text", text: `${result.error}${result.hint ? `\nHint: ${result.hint}` : ""}` }],
          details: { title: params.title },
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: `Issue created: ${result.stdout.trim()}` }],
        details: { url: result.stdout.trim(), title: params.title },
      };
    },
  });

  // ---- Tool: gh_pr_comment ----
  pi.registerTool({
    name: "gh_pr_comment",
    label: "Comment on PR",
    description: "Post a comment on a pull request.",
    promptSnippet: "Post a comment on a GitHub pull request",
    parameters: Type.Object({
      pr_number: Type.Number({ description: "Pull request number" }),
      body: Type.String({ description: "Comment body text" }),
      repo: Type.Optional(Type.String({ description: "owner/name (default: auto-detect)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const repo = params.repo || (await getDefaultRepo(pi, ctx.cwd));
      if (!params.repo && typeof repo !== "string") {
        return {
          content: [{ type: "text", text: repo.error }],
          details: {},
          isError: true,
        };
      }

      const result = await execGh(pi, ctx.cwd, [
        "pr", "comment", String(params.pr_number),
        "--repo", repo as string,
        "--body", params.body,
      ]);

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `${result.error}${result.hint ? `\nHint: ${result.hint}` : ""}` }],
          details: { pr_number: params.pr_number },
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: `Comment posted on PR #${params.pr_number}` }],
        details: { pr_number: params.pr_number },
      };
    },
  });

  // ---- Tool: gh_list_prs ----
  pi.registerTool({
    name: "gh_list_prs",
    label: "List Pull Requests",
    description: "List open pull requests with titles, branch names, and authors.",
    promptSnippet: "List open GitHub pull requests",
    parameters: Type.Object({
      repo: Type.Optional(Type.String({ description: "owner/name (default: auto-detect)" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 20)", default: 20 })),
      state: Type.Optional(Type.String({ description: "PR state: open, closed, merged, all (default: open)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const repo = params.repo || (await getDefaultRepo(pi, ctx.cwd));
      if (!params.repo && typeof repo !== "string") {
        return {
          content: [{ type: "text", text: repo.error }],
          details: {},
          isError: true,
        };
      }

      const args = [
        "pr", "list", "--repo", repo as string,
        "--state", params.state || "open",
        "--limit", String(params.limit || 20),
        "--json", "number,title,headRefName,author,state,createdAt,url",
      ];

      const result = await execGh(pi, ctx.cwd, args);
      if (!result.ok) {
        return {
          content: [{ type: "text", text: `${result.error}${result.hint ? `\nHint: ${result.hint}` : ""}` }],
          details: {},
          isError: true,
        };
      }

      const prs = JSON.parse(result.stdout);
      return {
        content: [{ type: "text", text: JSON.stringify(prs, null, 2) }],
        details: { count: prs.length, prs },
      };
    },
  });

  // ---- Tool: gh_list_issues ----
  pi.registerTool({
    name: "gh_list_issues",
    label: "List Issues",
    description: "List GitHub issues with numbers, titles, state, and labels.",
    promptSnippet: "List GitHub issues",
    parameters: Type.Object({
      repo: Type.Optional(Type.String({ description: "owner/name (default: auto-detect)" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 20)", default: 20 })),
      state: Type.Optional(Type.String({ description: "Issue state: open, closed, all (default: open)" })),
      label: Type.Optional(Type.String({ description: "Filter by label name" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const repo = params.repo || (await getDefaultRepo(pi, ctx.cwd));
      if (!params.repo && typeof repo !== "string") {
        return {
          content: [{ type: "text", text: repo.error }],
          details: {},
          isError: true,
        };
      }

      const args = [
        "issue", "list", "--repo", repo as string,
        "--state", params.state || "open",
        "--limit", String(params.limit || 20),
        "--json", "number,title,state,labels,createdAt,url",
      ];
      if (params.label) args.push("--label", params.label);

      const result = await execGh(pi, ctx.cwd, args);
      if (!result.ok) {
        return {
          content: [{ type: "text", text: `${result.error}${result.hint ? `\nHint: ${result.hint}` : ""}` }],
          details: {},
          isError: true,
        };
      }

      const issues = JSON.parse(result.stdout);
      return {
        content: [{ type: "text", text: JSON.stringify(issues, null, 2) }],
        details: { count: issues.length, issues },
      };
    },
  });
}
