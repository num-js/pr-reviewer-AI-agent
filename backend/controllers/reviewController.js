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
 * Body: { prUrl: string, comments: Array<{ file, line, comment }> }
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
          body: s.comment,
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

    let fallbackPosted = false;
    if (postedInline.length === 0 && comments.length > 0) {
      const body = [
        "## Automated PR review (AI)",
        "",
        "Inline comments could not be posted. Summary:",
        "",
        ...comments.map(
          (s, i) => `${i + 1}. **${s.file}:${s.line}** — ${s.comment}`
        ),
      ].join("\n");
      await createIssueComment(owner, repo, pullNumber, body);
      fallbackPosted = true;
      log("Posted fallback issue comment with full review");
    } else if (inlineErrors.length > 0) {
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
