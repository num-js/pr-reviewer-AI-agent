import {
  parsePrUrl,
  fetchPullRequest,
  fetchPullRequestFiles,
  createPullRequestReviewComment,
  createIssueComment,
} from "../services/githubService.js";
import { generateStructuredReview } from "../services/openRouterService.js";

function createLogger() {
  const logs = [];
  const log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    logs.push(line);
    console.log(line);
  };
  return { logs, log };
}

function parsePrUrlOr400(prUrl, res, logs) {
  if (!prUrl || typeof prUrl !== "string") {
    res.status(400).json({
      ok: false,
      error: "Missing prUrl in request body",
      logs,
    });
    return null;
  }
  try {
    return parsePrUrl(prUrl);
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e.message,
      logs,
    });
    return null;
  }
}

function isValidComment(item) {
  return (
    item &&
    typeof item === "object" &&
    typeof item.file === "string" &&
    item.file.trim() &&
    typeof item.comment === "string" &&
    item.comment.trim() &&
    Number.isFinite(Number(item.line))
  );
}

const EXT_LANG = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  vue: "vue",
  svelte: "svelte",
};

/**
 * @param {string} filePath
 * @returns {string}
 */
function languageFromPath(filePath) {
  const base = String(filePath || "").split("/").pop() || "";
  const ext = base.includes(".") ? base.split(".").pop().toLowerCase() : "";
  return EXT_LANG[ext] || "";
}

/**
 * @param {{ file: string, suggestedCode?: string }} item
 * @returns {string}
 */
function formatSuggestedCodeBlock(item) {
  const code = String(item.suggestedCode || "").trim();
  if (!code) return "";
  const lang = languageFromPath(item.file);
  return `**Suggested change:**\n\`\`\`${lang}\n${code}\n\`\`\``;
}

/**
 * @param {{ file: string, comment: string, suggestedCode?: string }} item
 * @returns {string}
 */
function formatInlineCommentBody(item) {
  const parts = [item.comment.trim()];
  const suggestion = formatSuggestedCodeBlock(item);
  if (suggestion) {
    parts.push("", suggestion);
  }
  return parts.join("\n");
}

/**
 * @param {Array<{ file: string, line: number, comment: string, suggestedCode?: string }>} comments
 * @param {{ postedInlineCount: number, inlineErrorCount: number }} meta
 * @returns {string}
 */
function formatReviewSummaryBody(comments, meta) {
  const lines = [
    "## PR review summary",
    "",
    `I reviewed this change set and selected **${comments.length}** finding(s) for follow-up. ` +
      `${meta.postedInlineCount} inline comment(s) were posted on the diff` +
      (meta.inlineErrorCount > 0
        ? `; ${meta.inlineErrorCount} could not be anchored to a line and are included below.`
        : "."),
    "",
    "### Findings",
    "",
  ];

  comments.forEach((s, i) => {
    lines.push(`${i + 1}. **\`${s.file}:${s.line}\`**`);
    lines.push("");
    lines.push(s.comment.trim());
    const suggestion = formatSuggestedCodeBlock(s);
    if (suggestion) {
      lines.push("");
      lines.push(suggestion);
    }
    lines.push("");
  });

  lines.push("---");
  lines.push("");
  lines.push(
    "Please address the higher-risk items (correctness, security, data integrity) before merge, and leave a short note on any findings you intentionally defer."
  );

  return lines.join("\n");
}

/**
 * POST /api/review-pr/generate
 * Body: { prUrl: string }
 */
export async function generateReview(req, res) {
  const { logs, log } = createLogger();

  try {
    const parsed = parsePrUrlOr400(req.body?.prUrl, res, logs);
    if (!parsed) return;

    const { owner, repo, pullNumber } = parsed;
    log(`Parsed PR: ${owner}/${repo}#${pullNumber}`);

    const pr = await fetchPullRequest(owner, repo, pullNumber);
    const files = await fetchPullRequestFiles(owner, repo, pullNumber);

    log(`Fetched PR "${pr.title}" with ${files.length} file(s)`);

    const prContext = {
      title: pr.title || "",
      description: pr.body || "",
      files: files.map((f) => ({
        filename: f.filename,
        status: f.status,
        patch: f.patch,
      })),
    };

    const suggestions = await generateStructuredReview(prContext);
    log(`OpenRouter returned ${suggestions.length} suggestion(s)`);

    return res.json({
      ok: true,
      owner,
      repo,
      pullNumber,
      prTitle: pr.title,
      suggestions,
      logs,
    });
  } catch (err) {
    log(`Error: ${err.message}`);
    const status = err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({
      ok: false,
      error: err.message || "Review generation failed",
      logs,
    });
  }
}

/**
 * POST /api/review-pr/post
 * Body: { prUrl: string, comments: Array<{ file, line, comment, suggestedCode? }> }
 */
export async function postReview(req, res) {
  const { logs, log } = createLogger();

  try {
    const parsed = parsePrUrlOr400(req.body?.prUrl, res, logs);
    if (!parsed) return;

    const rawComments = req.body?.comments;
    if (!Array.isArray(rawComments) || rawComments.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "comments must be a non-empty array",
        logs,
      });
    }

    const comments = rawComments.filter(isValidComment).map((c) => ({
      file: String(c.file).trim(),
      line: Number(c.line),
      comment: String(c.comment).trim(),
      suggestedCode: String(c.suggestedCode || "").trim(),
    }));

    if (comments.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No valid comments to post (need file, line, comment)",
        logs,
      });
    }

    const { owner, repo, pullNumber } = parsed;
    log(`Parsed PR: ${owner}/${repo}#${pullNumber}`);

    const pr = await fetchPullRequest(owner, repo, pullNumber);
    const headSha = pr.head?.sha;
    if (!headSha) {
      throw new Error("Could not read PR head commit SHA");
    }

    log(
      `Posting ${comments.length} comment(s) to "${pr.title}" at ${headSha.slice(0, 7)}`
    );

    const postedInline = [];
    const inlineErrors = [];

    for (const s of comments) {
      try {
        await createPullRequestReviewComment(owner, repo, pullNumber, {
          body: formatInlineCommentBody(s),
          commit_id: headSha,
          path: s.file,
          line: Math.max(1, Math.floor(s.line)),
          side: "RIGHT",
        });
        postedInline.push({ file: s.file, line: s.line });
        log(`Posted inline comment on ${s.file}:${s.line}`);
      } catch (err) {
        inlineErrors.push({
          file: s.file,
          line: s.line,
          message: err.message,
        });
        log(`Inline comment failed for ${s.file}:${s.line} — ${err.message}`);
      }
    }

    const summaryBody = formatReviewSummaryBody(comments, {
      postedInlineCount: postedInline.length,
      inlineErrorCount: inlineErrors.length,
    });
    await createIssueComment(owner, repo, pullNumber, summaryBody);
    log("Posted PR review summary comment");

    const fallbackPosted = postedInline.length === 0;
    if (inlineErrors.length > 0 && !fallbackPosted) {
      log(
        `Partial inline failures: ${inlineErrors.length} (see response inlineErrors)`
      );
    }

    return res.json({
      ok: true,
      owner,
      repo,
      pullNumber,
      prTitle: pr.title,
      suggestionsCount: comments.length,
      postedInlineCount: postedInline.length,
      fallbackPosted,
      summaryPosted: true,
      postedInline,
      inlineErrors,
      logs,
    });
  } catch (err) {
    log(`Error: ${err.message}`);
    const status = err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({
      ok: false,
      error: err.message || "Posting review failed",
      logs,
    });
  }
}
