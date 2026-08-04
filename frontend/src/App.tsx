import { useCallback, useMemo, useState } from "react";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { isValidPrUrl, prUrlHint } from "./lib/prUrl";

type Suggestion = {
  file: string;
  line: number;
  comment: string;
  suggestedCode?: string;
};

type PreviewItem = Suggestion & {
  id: string;
  selected: boolean;
};

type GenerateSuccess = {
  ok: true;
  owner: string;
  repo: string;
  pullNumber: number;
  prTitle?: string;
  suggestions: Suggestion[];
  logs: string[];
};

type PostSuccess = {
  ok: true;
  owner: string;
  repo: string;
  pullNumber: number;
  prTitle?: string;
  suggestionsCount: number;
  postedInlineCount: number;
  fallbackPosted: boolean;
  summaryPosted?: boolean;
  postedInline: { file: string; line: number }[];
  inlineErrors: { file: string; line: number; message: string }[];
  logs: string[];
};

type ApiBody = {
  ok?: boolean;
  error?: string;
  logs?: string[];
  owner?: string;
  repo?: string;
  pullNumber?: number;
  prTitle?: string;
  suggestions?: Suggestion[];
  suggestionsCount?: number;
  postedInlineCount?: number;
  fallbackPosted?: boolean;
  summaryPosted?: boolean;
  postedInline?: { file: string; line: number }[];
  inlineErrors?: { file: string; line: number; message: string }[];
};

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 800;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry<T extends { ok?: boolean }>(
  url: string,
  body: unknown,
  onAttempt: (attempt: number, message: string) => void
): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const wait = RETRY_BASE_MS * 2 ** (attempt - 1);
        onAttempt(attempt, `Retrying in ${wait}ms (attempt ${attempt + 1})…`);
        await sleep(wait);
      }
      onAttempt(attempt, attempt === 0 ? "Sending request…" : "Retrying…");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ApiBody;
      const serverLogs = Array.isArray(data.logs) ? data.logs : [];
      if (!res.ok || !data.ok) {
        const msg = data.error || res.statusText || "Request failed";
        const err = new Error(msg) as Error & { logs?: string[] };
        err.logs = serverLogs;
        throw err;
      }
      return data as T;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const withLogs = lastErr as Error & { logs?: string[] };
      onAttempt(
        attempt,
        lastErr.message +
          (withLogs.logs?.length ? ` (${withLogs.logs.length} log lines)` : "")
      );
      if (attempt === MAX_RETRIES) break;
    }
  }
  throw lastErr || new Error("Unknown error");
}

function toPreviewItems(suggestions: Suggestion[]): PreviewItem[] {
  return suggestions.map((s, i) => ({
    ...s,
    id: `${s.file}:${s.line}:${i}`,
    selected: true,
  }));
}

export default function App() {
  const [prUrl, setPrUrl] = useState("");
  const debouncedUrl = useDebouncedValue(prUrl, 350);
  const [generating, setGenerating] = useState(false);
  const [posting, setPosting] = useState(false);
  const [status, setStatus] = useState<"idle" | "preview" | "success" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");
  const [previewMeta, setPreviewMeta] = useState<{
    owner: string;
    repo: string;
    pullNumber: number;
    prTitle?: string;
  } | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [result, setResult] = useState<PostSuccess | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const debouncedHint = useMemo(
    () => prUrlHint(debouncedUrl),
    [debouncedUrl]
  );
  const busy = generating || posting;
  const canSubmit = isValidPrUrl(prUrl.trim()) && !busy;
  const selectedItems = useMemo(
    () => items.filter((item) => item.selected),
    [items]
  );
  const selectedCount = selectedItems.length;

  const appendLogs = useCallback((lines: string[]) => {
    setLogs((prev) => [...prev, ...lines]);
  }, []);

  const clientLog = useCallback((msg: string) => {
    setLogs((prev) => [
      ...prev,
      `[client] ${new Date().toISOString()} ${msg}`,
    ]);
  }, []);

  const runGenerate = useCallback(async () => {
    const url = prUrl.trim();
    if (!isValidPrUrl(url)) {
      setStatus("error");
      setMessage("Enter a valid GitHub pull request URL.");
      return;
    }
    setGenerating(true);
    setStatus("idle");
    setMessage("");
    setResult(null);
    setPreviewMeta(null);
    setItems([]);
    setLogs([]);

    try {
      const data = await fetchJsonWithRetry<GenerateSuccess>(
        "/api/review-pr/generate",
        { prUrl: url },
        (_attempt, msg) => clientLog(msg)
      );
      setLogs((prev) => [...prev, ...(data.logs || [])]);
      setPreviewMeta({
        owner: data.owner,
        repo: data.repo,
        pullNumber: data.pullNumber,
        prTitle: data.prTitle,
      });
      setItems(toPreviewItems(data.suggestions || []));
      setStatus("preview");
      setMessage(
        data.suggestions?.length
          ? `${data.suggestions.length} comment(s) ready — uncheck or remove any you do not want, then post.`
          : "AI returned no comments for this PR."
      );
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const withLogs = err as Error & { logs?: string[] };
      if (withLogs.logs?.length) {
        appendLogs(withLogs.logs);
      }
      setStatus("error");
      setMessage(err.message);
    } finally {
      setGenerating(false);
    }
  }, [prUrl, appendLogs, clientLog]);

  const cancelPreview = useCallback(() => {
    setItems([]);
    setPreviewMeta(null);
    setStatus("idle");
    setMessage("");
  }, []);

  const toggleItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const runPost = useCallback(async () => {
    const url = prUrl.trim();
    if (!isValidPrUrl(url) || selectedItems.length === 0) return;

    setPosting(true);
    setMessage("");

    try {
      const comments = selectedItems.map(
        ({ file, line, comment, suggestedCode }) => ({
          file,
          line,
          comment,
          suggestedCode: suggestedCode || "",
        })
      );
      const data = await fetchJsonWithRetry<PostSuccess>(
        "/api/review-pr/post",
        { prUrl: url, comments },
        (_attempt, msg) => clientLog(msg)
      );
      setLogs((prev) => [...prev, ...(data.logs || [])]);
      setResult(data);
      setItems([]);
      setPreviewMeta(null);
      setStatus("success");
      setMessage(
        `Review posted for ${data.owner}/${data.repo}#${data.pullNumber}.` +
          (data.fallbackPosted
            ? " Inline comments could not be posted; a detailed PR summary comment was added."
            : ` ${data.postedInlineCount} inline comment(s) plus a PR summary.`)
      );
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const withLogs = err as Error & { logs?: string[] };
      if (withLogs.logs?.length) {
        appendLogs(withLogs.logs);
      }
      setStatus("error");
      setMessage(err.message);
    } finally {
      setPosting(false);
    }
  }, [prUrl, selectedItems, appendLogs, clientLog]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16">
        <header className="space-y-2 text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-cyan-400/90">
            GitHub + OpenRouter
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Pull request reviewer
          </h1>
          <p className="text-slate-400">
            Paste a PR link, review the AI comments, remove any you do not need,
            then post the rest to GitHub.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl shadow-black/40 backdrop-blur">
          <label
            htmlFor="pr-url"
            className="mb-2 block text-sm font-medium text-slate-300"
          >
            GitHub PR URL
          </label>
          <input
            id="pr-url"
            type="url"
            autoComplete="off"
            placeholder="https://github.com/owner/repo/pull/42"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            disabled={busy || status === "preview"}
            className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 font-mono text-sm text-slate-100 outline-none ring-cyan-500/40 placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-2 disabled:opacity-60"
          />
          {debouncedHint && (
            <p className="mt-2 text-sm text-amber-400/90">{debouncedHint}</p>
          )}
          {debouncedUrl.trim() && !debouncedHint && (
            <p className="mt-2 text-sm text-emerald-400/90">URL looks valid.</p>
          )}

          {status !== "preview" && (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runGenerate}
                disabled={!canSubmit}
                className="inline-flex items-center justify-center rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:bg-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
              >
                {generating ? (
                  <span className="flex items-center gap-2">
                    <Spinner />
                    Generating…
                  </span>
                ) : (
                  "Start review"
                )}
              </button>
              {status === "error" && (
                <button
                  type="button"
                  onClick={runGenerate}
                  disabled={busy || !isValidPrUrl(prUrl.trim())}
                  className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500 hover:bg-slate-800/80 disabled:opacity-50"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {message && status !== "idle" && (
            <div
              className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
                status === "success"
                  ? "border-emerald-800/80 bg-emerald-950/40 text-emerald-100"
                  : status === "preview"
                    ? "border-cyan-800/80 bg-cyan-950/30 text-cyan-100"
                    : "border-rose-800/80 bg-rose-950/40 text-rose-100"
              }`}
              role="status"
            >
              {message}
            </div>
          )}

          {status === "preview" && previewMeta && (
            <div className="mt-6 space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  Review preview
                </h2>
                <p className="text-sm text-slate-400">
                  {selectedCount} of {items.length} selected ·{" "}
                  <span className="text-slate-300">
                    {previewMeta.owner}/{previewMeta.repo}#
                    {previewMeta.pullNumber}
                  </span>
                </p>
              </div>

              {previewMeta.prTitle && (
                <p className="text-sm text-slate-300">
                  <span className="text-slate-500">PR title:</span>{" "}
                  {previewMeta.prTitle}
                </p>
              )}

              {items.length === 0 ? (
                <p className="rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm text-slate-400">
                  No comments left to post. Cancel and run the review again, or
                  start over with another PR.
                </p>
              ) : (
                <ul className="max-h-96 space-y-2 overflow-y-auto">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className={`rounded-xl border px-3 py-3 transition ${
                        item.selected
                          ? "border-slate-700 bg-slate-950/70"
                          : "border-slate-800 bg-slate-950/30 opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => toggleItem(item.id)}
                          disabled={posting}
                          className="h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500/40"
                          aria-label={`Include comment on ${item.file}:${item.line}`}
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="font-mono text-xs text-cyan-400/90">
                            {item.file}:{item.line}
                          </p>
                          <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                            {item.comment}
                          </p>
                          {item.suggestedCode?.trim() ? (
                            <div className="mt-2 space-y-1">
                              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                Suggested code
                              </p>
                              <pre className="max-h-40 overflow-auto rounded-lg border border-slate-800 bg-slate-950/90 p-2 font-mono text-xs text-slate-300 whitespace-pre-wrap break-words">
                                {item.suggestedCode}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          disabled={posting}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-rose-300/90 hover:bg-rose-950/50 hover:text-rose-200 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={runPost}
                  disabled={posting || selectedCount === 0}
                  className="inline-flex items-center justify-center rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:bg-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
                >
                  {posting ? (
                    <span className="flex items-center gap-2">
                      <Spinner />
                      Posting…
                    </span>
                  ) : (
                    `Post ${selectedCount} to GitHub`
                  )}
                </button>
                <button
                  type="button"
                  onClick={cancelPreview}
                  disabled={posting}
                  className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500 hover:bg-slate-800/80 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {result && status === "success" && (
            <dl className="mt-4 grid gap-2 text-sm text-slate-300">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">PR title</dt>
                <dd className="text-right font-medium text-slate-100">
                  {result.prTitle || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Comments submitted</dt>
                <dd>{result.suggestionsCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Inline comments posted</dt>
                <dd>{result.postedInlineCount}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Activity log
          </h2>
          <div className="max-h-64 overflow-y-auto rounded-lg bg-slate-950/80 p-3 font-mono text-xs text-slate-400">
            {logs.length === 0 ? (
              <p className="text-slate-600">
                Logs appear here after you run a review.
              </p>
            ) : (
              <ul className="space-y-1">
                {logs.map((line, i) => (
                  <li
                    key={`${i}-${line.slice(0, 24)}`}
                    className="whitespace-pre-wrap break-all"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent"
      aria-hidden
    />
  );
}
