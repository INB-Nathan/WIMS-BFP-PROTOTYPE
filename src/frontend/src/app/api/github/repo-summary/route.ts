import { Octokit } from '@octokit/rest';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * PoC 2 — Octokit Next.js API Route
 *
 * Fetches public repository metadata from GitHub.
 * Demonstrates Octokit integration in the Next.js App Router:
 *   - Authenticated calls when GITHUB_TOKEN is set (higher rate limit)
 *   - Unauthenticated fallback for public repos (rate-limited)
 *   - Graceful degradation on API errors
 */
export async function GET() {
  const owner = process.env.GITHUB_OWNER || 'x1n4te';
  const repo = process.env.GITHUB_REPO || 'WIMS-BFP-PROTOTYPE';

  try {
    const octokit = new Octokit(
      process.env.GITHUB_TOKEN
        ? { auth: process.env.GITHUB_TOKEN }
        : undefined,
    );

    // Fetch repo metadata and open PR count in parallel
    const [repoResult, pullsResult] = await Promise.allSettled([
      octokit.repos.get({ owner, repo }),
      octokit.pulls.list({ owner, repo, state: 'open', per_page: 1 }),
    ]);

    if (repoResult.status === 'rejected') {
      return NextResponse.json(
        {
          error: 'Failed to fetch repository data',
          message: repoResult.reason instanceof Error ? repoResult.reason.message : 'Unknown error',
          authenticated: !!process.env.GITHUB_TOKEN,
        },
        { status: 502 },
      );
    }

    const repoData = repoResult.value.data;

    return NextResponse.json({
      owner,
      repo,
      full_name: repoData.full_name,
      description: repoData.description,
      html_url: repoData.html_url,
      default_branch: repoData.default_branch,
      stars: repoData.stargazers_count,
      forks: repoData.forks_count,
      open_issues: repoData.open_issues_count,
      open_pull_requests:
        pullsResult.status === 'fulfilled' ? pullsResult.value.data.length : undefined,
      language: repoData.language,
      topics: repoData.topics,
      updated_at: repoData.updated_at,
      authenticated: !!process.env.GITHUB_TOKEN,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Unexpected error fetching GitHub data',
        message: err instanceof Error ? err.message : 'Unknown error',
        authenticated: !!process.env.GITHUB_TOKEN,
      },
      { status: 500 },
    );
  }
}
