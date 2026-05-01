const GITHUB_API = "https://api.github.com";

function getToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set");
  }
  return token;
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pr-reviewer-app",
  };
}

/**
 * @param {string} prUrl
 * @returns {{ owner: string, repo: string, pullNumber: number }}
 */
export function parsePrUrl(prUrl) {
  const trimmed = prUrl.trim();
  const match = trimmed.match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i
  );
  if (!match) {
    throw new Error(
      "Invalid PR URL. Expected format: https://github.com/owner/repo/pull/123"
    );
  }
  const [, owner, repo, num] = match;
  const pullNumber = parseInt(num, 10);
  if (!owner || !repo || Number.isNaN(pullNumber)) {
    throw new Error("Could not parse owner, repo, or pull number from URL");
  }
  return { owner, repo, pullNumber };
}

async function githubFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...githubHeaders(), ...options.headers },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      data?.message ||
      data?.errors?.[0]?.message ||
      res.statusText ||
      "GitHub API error";
    const err = new Error(`${msg} (${res.status})`);
    err.status = res.status;
    err.github = data;
    throw err;
  }
  return data;
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {number} pullNumber
 */
export async function fetchPullRequest(owner, repo, pullNumber) {
  return githubFetch(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {number} pullNumber
 * @returns {Promise<Array<{ filename: string, status: string, patch?: string, additions: number, deletions: number }>>}
 */
export async function fetchPullRequestFiles(owner, repo, pullNumber) {
  const files = [];
  let url = `${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`;
  while (url) {
    const res = await fetch(url, {
      headers: githubHeaders(),
    });
    const text = await res.text();
    let page;
    try {
      page = JSON.parse(text);
    } catch {
      throw new Error("Invalid GitHub response for file list");
    }
    if (!res.ok) {
      throw new Error(
        page?.message || `Failed to list PR files (${res.status})`
      );
    }
    files.push(...page);
    const link = res.headers.get("link");
    url = null;
    if (link) {
      const next = link.split(",").find((p) => p.includes('rel="next"'));
      if (next) {
        const m = next.match(/<([^>]+)>/);
        if (m) url = m[1];
      }
    }
  }
  return files;
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {number} pullNumber
 * @param {{ body: string, commit_id: string, path: string, line: number, side?: string }} payload
 */
export async function createPullRequestReviewComment(
  owner,
  repo,
  pullNumber,
  payload
) {
  const body = {
    body: payload.body,
    commit_id: payload.commit_id,
    path: payload.path,
    line: payload.line,
    side: payload.side || "RIGHT",
  };
  return githubFetch(
    `/repos/${owner}/${repo}/pulls/${pullNumber}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

/**
 * General PR / issue comment (fallback).
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string} body
 */
export async function createIssueComment(owner, repo, issueNumber, body) {
  return githubFetch(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }
  );
}
