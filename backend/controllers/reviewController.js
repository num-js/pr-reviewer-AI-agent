import {
  parsePrUrl,
  fetchPullRequest,
  fetchPullRequestFiles,
  createPullRequestReviewComment,
  createIssueComment,
} from "../services/githubService.js";
import { generateStructuredReview } from "../services/openaiService.js";

/**
 * POST /api/review-pr
 * Body: { prUrl: string }
 */
export async function reviewPr(req, res) {
  const logs = [];
  const log = (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    logs.push(line);
    console.log(line);
  };

  try {
    const prUrl = req.body?.prUrl;
    if (!prUrl || typeof prUrl !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Missing prUrl in request body",
        logs,
      });
    }

    let owner;
    let repo;
    let pullNumber;
    try {
      ({ owner, repo, pullNumber } = parsePrUrl(prUrl));
    } catch (e) {
      return res.status(400).json({
        ok: false,
        error: e.message,
        logs,
      });
    }

    log(`Parsed PR: ${owner}/${repo}#${pullNumber}`);

    const pr = await fetchPullRequest(owner, repo, pullNumber);
    const files = await fetchPullRequestFiles(owner, repo, pullNumber);
    const headSha = pr.head?.sha;
    if (!headSha) {
      throw new Error("Could not read PR head commit SHA");
    }

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
    log(`OpenAI returned ${suggestions.length} suggestion(s)`);

    const postedInline = [];
    const inlineErrors = [];

    for (const s of suggestions) {
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
    if (postedInline.length === 0 && suggestions.length > 0) {
      const body = [
        "## Automated PR review (AI)",
        "",
        "Inline comments could not be posted. Summary:",
        "",
        ...suggestions.map(
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
      suggestionsCount: suggestions.length,
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
      error: err.message || "Review failed",
      logs,
    });
  }
}
