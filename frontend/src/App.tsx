import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { AppFooter } from "./components/AppFooter";
import { AppHeader } from "./components/AppHeader";
import { ReviewHistory } from "./components/ReviewHistory";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { getReview, saveReview } from "./lib/reviewHistoryDb";
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
  const [logOpen, setLogOpen] = useState(true);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  const debouncedHint = useMemo(
    () => prUrlHint(debouncedUrl),
    [debouncedUrl]
  );
  const busy = generating || posting;
  const canSubmit = isValidPrUrl(prUrl.trim()) && !busy;
  const urlValid =
    Boolean(debouncedUrl.trim()) && !debouncedHint && isValidPrUrl(debouncedUrl.trim());
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
    setLogOpen(true);
    setActiveHistoryId(null);

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
      const suggestions = data.suggestions || [];
      setItems(toPreviewItems(suggestions));
      setStatus("preview");
      setMessage(
        suggestions.length
          ? `${suggestions.length} comment(s) ready — uncheck or remove any you do not want, then post.`
          : "AI returned no comments for this PR."
      );
      try {
        const historyId = crypto.randomUUID();
        await saveReview({
          id: historyId,
          savedAt: Date.now(),
          status: "generated",
          prUrl: url,
          owner: data.owner,
          repo: data.repo,
          pullNumber: data.pullNumber,
          prTitle: data.prTitle,
          comments: suggestions.map((s) => ({
            file: s.file,
            line: s.line,
            comment: s.comment,
            suggestedCode: s.suggestedCode || "",
          })),
          suggestionsCount: suggestions.length,
          postedInlineCount: 0,
          fallbackPosted: false,
          summaryPosted: false,
        });
        setActiveHistoryId(historyId);
        setHistoryRefreshToken((n) => n + 1);
        clientLog("Saved generated review to browser history");
      } catch (saveErr) {
        const msg =
          saveErr instanceof Error
            ? saveErr.message
            : "Failed to save review history";
        clientLog(`History save failed: ${msg}`);
      }
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
      try {
        const historyId = activeHistoryId || crypto.randomUUID();
        const existing = activeHistoryId
          ? await getReview(activeHistoryId)
          : undefined;
        await saveReview({
          id: historyId,
          savedAt: existing?.savedAt ?? Date.now(),
          postedAt: Date.now(),
          status: "posted",
          prUrl: url,
          owner: data.owner,
          repo: data.repo,
          pullNumber: data.pullNumber,
          prTitle: data.prTitle,
          comments,
          suggestionsCount: data.suggestionsCount,
          postedInlineCount: data.postedInlineCount,
          fallbackPosted: data.fallbackPosted,
          summaryPosted: data.summaryPosted,
        });
        setActiveHistoryId(null);
        setHistoryRefreshToken((n) => n + 1);
        clientLog("Updated review history status to posted");
      } catch (saveErr) {
        const msg =
          saveErr instanceof Error
            ? saveErr.message
            : "Failed to save review history";
        clientLog(`History save failed: ${msg}`);
      }
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
  }, [prUrl, selectedItems, activeHistoryId, appendLogs, clientLog]);

  const scrollToReview = useCallback(() => {
    document.getElementById("review")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    window.setTimeout(() => {
      document.getElementById("pr-url")?.focus();
    }, 280);
  }, []);

  const scrollToActivity = useCallback(() => {
    setLogOpen(true);
    window.setTimeout(() => {
      document.getElementById("activity")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 40);
  }, []);

  const scrollToHistory = useCallback(() => {
    document.getElementById("history")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  return (
    <div className="app-atmosphere relative flex min-h-screen flex-col overflow-x-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        aria-hidden
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in oklab, var(--line) 35%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--line) 35%, transparent) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 70% 55% at 50% 20%, black, transparent)",
        }}
      />

      <AppHeader
        onReviewClick={scrollToReview}
        onHistoryClick={scrollToHistory}
        onActivityClick={scrollToActivity}
      />

      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:py-12">
        <div className="animate-fade-up space-y-3 text-center sm:space-y-4">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Pull request reviewer
          </h1>
          <p className="mx-auto max-w-prose text-pretty text-muted">
            Paste a PR link, curate the AI findings, then post only what matters
            — with suggested code and a review summary.
          </p>
        </div>

        <section
          id="review"
          className="glass-elevated animate-fade-up scroll-mt-20 rounded-2xl p-5 sm:p-6 [animation-delay:60ms]"
        >
          <label
            htmlFor="pr-url"
            className="mb-2 block text-sm font-medium text-ink"
          >
            GitHub PR URL
          </label>
          <div className="relative">
            <input
              id="pr-url"
              type="url"
              autoComplete="off"
              placeholder="https://github.com/owner/repo/pull/42"
              value={prUrl}
              onChange={(e) => setPrUrl(e.target.value)}
              disabled={busy || status === "preview"}
              className={`focus-ring w-full rounded-xl border bg-[color-mix(in_oklab,var(--bg)_70%,transparent)] px-4 py-3 font-mono text-sm text-ink transition duration-200 ease-outExpo placeholder:text-muted/50 disabled:opacity-60 ${
                debouncedHint
                  ? "border-warn/50 shadow-[0_0_0_1px_color-mix(in_oklab,var(--warn)_25%,transparent)]"
                  : urlValid
                    ? "border-accent/45 shadow-glow"
                    : "border-line focus:border-glow/60 focus:shadow-glow"
              }`}
            />
          </div>
          {debouncedHint && (
            <p className="mt-2 text-sm text-warn">{debouncedHint}</p>
          )}
          {urlValid && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-accent">
              <StatusDot tone="accent" />
              URL looks valid
            </p>
          )}

          {status !== "preview" && (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runGenerate}
                disabled={!canSubmit}
                className={`focus-ring inline-flex items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-[oklch(0.18_0.02_145)] shadow-[0_10px_30px_-12px_color-mix(in_oklab,var(--accent)_55%,transparent)] transition duration-200 ease-outExpo hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[color-mix(in_oklab,var(--muted)_35%,var(--bg))] disabled:text-muted disabled:shadow-none disabled:active:scale-100 ${
                  generating ? "animate-pulse-soft" : ""
                }`}
              >
                {generating ? (
                  <span className="flex items-center gap-2">
                    <Spinner dark />
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
                  className="focus-ring rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink transition duration-200 ease-outExpo hover:bg-elevated disabled:opacity-50"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {generating && (
            <div
              className="mt-6 space-y-3 animate-fade-in"
              role="status"
              aria-live="polite"
            >
              <p className="text-xs font-medium text-muted">
                Generating review findings…
              </p>
              <div className="skeleton-shimmer h-3 w-3/5 rounded-full" aria-hidden />
              <div
                className="skeleton-shimmer flex h-[4.5rem] flex-col justify-center gap-2 rounded-xl px-3"
                aria-hidden
              >
                <div className="h-2 w-2/5 rounded-full bg-[color-mix(in_oklab,var(--ink)_12%,transparent)]" />
                <div className="h-2 w-11/12 rounded-full bg-[color-mix(in_oklab,var(--ink)_10%,transparent)]" />
                <div className="h-2 w-4/5 rounded-full bg-[color-mix(in_oklab,var(--ink)_10%,transparent)]" />
              </div>
              <div
                className="skeleton-shimmer skeleton-shimmer-delay-1 flex h-[4.5rem] flex-col justify-center gap-2 rounded-xl px-3"
                aria-hidden
              >
                <div className="h-2 w-1/3 rounded-full bg-[color-mix(in_oklab,var(--ink)_12%,transparent)]" />
                <div className="h-2 w-10/12 rounded-full bg-[color-mix(in_oklab,var(--ink)_10%,transparent)]" />
                <div className="h-2 w-2/3 rounded-full bg-[color-mix(in_oklab,var(--ink)_10%,transparent)]" />
              </div>
              <div
                className="skeleton-shimmer skeleton-shimmer-delay-2 flex h-[4.5rem] flex-col justify-center gap-2 rounded-xl px-3"
                aria-hidden
              >
                <div className="h-2 w-2/5 rounded-full bg-[color-mix(in_oklab,var(--ink)_12%,transparent)]" />
                <div className="h-2 w-9/12 rounded-full bg-[color-mix(in_oklab,var(--ink)_10%,transparent)]" />
                <div className="h-2 w-3/5 rounded-full bg-[color-mix(in_oklab,var(--ink)_10%,transparent)]" />
              </div>
            </div>
          )}

          {message && status !== "idle" && (
            <div
              className={`mt-6 animate-fade-in rounded-xl border px-4 py-3 text-sm ${
                status === "success"
                  ? "border-accent/35 bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-ink"
                  : status === "preview"
                    ? "border-glow/35 bg-[color-mix(in_oklab,var(--glow)_12%,transparent)] text-ink"
                    : "border-danger/40 bg-[color-mix(in_oklab,var(--danger)_14%,transparent)] text-ink"
              }`}
              role="status"
            >
              {message}
            </div>
          )}

          {status === "preview" && previewMeta && (
            <div className="mt-6 space-y-4 animate-fade-in">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-ink">
                    Review preview
                  </h2>
                  {previewMeta.prTitle && (
                    <p className="mt-1 text-sm text-muted text-pretty">
                      {previewMeta.prTitle}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-accent/30 bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-2.5 py-1 text-xs font-medium text-accent">
                    {selectedCount} of {items.length} selected
                  </span>
                  <span className="rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-xs text-muted">
                    {previewMeta.owner}/{previewMeta.repo}#
                    {previewMeta.pullNumber}
                  </span>
                </div>
              </div>

              {items.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
                  No comments left to post. Cancel and run the review again, or
                  start over with another PR.
                </p>
              ) : (
                <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                  {items.map((item, index) => (
                    <li
                      key={item.id}
                      style={
                        {
                          "--i": Math.min(index, 10),
                        } as CSSProperties
                      }
                      className={`stagger-item rounded-xl border px-3 py-3 transition duration-200 ease-outQuart ${
                        item.selected
                          ? "border-line bg-[color-mix(in_oklab,var(--bg)_55%,transparent)]"
                          : "border-line/60 bg-surface/40 opacity-55"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => toggleItem(item.id)}
                          disabled={posting}
                          className="focus-ring h-4 w-4 shrink-0 rounded border-line bg-[var(--bg)] text-accent accent-[var(--accent)]"
                          aria-label={`Include comment on ${item.file}:${item.line}`}
                        />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="font-mono text-xs text-glow">
                            {item.file}:{item.line}
                          </p>
                          <p className="text-sm text-ink/95 whitespace-pre-wrap break-words text-pretty">
                            {item.comment}
                          </p>
                          {item.suggestedCode?.trim() ? (
                            <details className="group mt-2">
                              <summary className="cursor-pointer list-none text-xs font-medium text-muted transition hover:text-ink [&::-webkit-details-marker]:hidden">
                                <span className="inline-flex items-center gap-1.5">
                                  Suggested code
                                  <span className="text-muted/70 transition group-open:rotate-90">
                                    ▸
                                  </span>
                                </span>
                              </summary>
                              <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-line bg-[color-mix(in_oklab,var(--bg)_85%,transparent)] p-2.5 font-mono text-xs text-muted whitespace-pre-wrap break-words">
                                {item.suggestedCode}
                              </pre>
                            </details>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          disabled={posting}
                          className="focus-ring shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-danger transition duration-150 hover:bg-[color-mix(in_oklab,var(--danger)_14%,transparent)] disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={runPost}
                  disabled={posting || selectedCount === 0}
                  className={`focus-ring inline-flex items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-[oklch(0.18_0.02_145)] shadow-[0_10px_30px_-12px_color-mix(in_oklab,var(--accent)_55%,transparent)] transition duration-200 ease-outExpo hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[color-mix(in_oklab,var(--muted)_35%,var(--bg))] disabled:text-muted disabled:shadow-none ${
                    posting ? "animate-pulse-soft" : ""
                  }`}
                >
                  {posting ? (
                    <span className="flex items-center gap-2">
                      <Spinner dark />
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
                  className="focus-ring rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-elevated disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {result && status === "success" && (
            <div className="mt-5 animate-success-pop space-y-4">
              <div className="flex items-center gap-3">
                <SuccessBadge />
                <p className="text-sm font-medium text-accent">
                  Posted successfully
                </p>
              </div>
              <dl className="grid gap-2 rounded-xl border border-line bg-surface p-4 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">PR title</dt>
                  <dd className="text-right font-medium text-ink">
                    {result.prTitle || "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Comments submitted</dt>
                  <dd className="text-ink">{result.suggestionsCount}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Inline comments posted</dt>
                  <dd className="text-ink">{result.postedInlineCount}</dd>
                </div>
              </dl>
            </div>
          )}
        </section>

        <ReviewHistory refreshToken={historyRefreshToken} />

        <section
          id="activity"
          className="glass-panel animate-fade-up scroll-mt-20 rounded-2xl [animation-delay:120ms]"
        >
          <button
            type="button"
            onClick={() => setLogOpen((o) => !o)}
            className="focus-ring flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left"
            aria-expanded={logOpen}
          >
            <span className="text-sm font-medium text-muted">
              Activity log
              {logs.length > 0 ? (
                <span className="ml-2 rounded-full border border-line px-2 py-0.5 font-mono text-xs text-ink/80">
                  {logs.length}
                </span>
              ) : null}
            </span>
            <span
              className={`text-muted transition duration-200 ease-outQuart ${
                logOpen ? "rotate-90" : ""
              }`}
            >
              ▸
            </span>
          </button>
          {logOpen && (
            <div className="animate-fade-in border-t border-line px-4 pb-4 pt-3">
              <div className="max-h-56 overflow-y-auto rounded-lg bg-[color-mix(in_oklab,var(--bg)_75%,transparent)] p-3 font-mono text-xs text-muted">
                {logs.length === 0 ? (
                  <p className="text-muted/70">
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
            </div>
          )}
        </section>
      </main>

      <AppFooter />
    </div>
  );
}

function StatusDot({ tone }: { tone: "accent" | "warn" | "danger" }) {
  const color =
    tone === "accent"
      ? "bg-accent"
      : tone === "warn"
        ? "bg-warn"
        : "bg-danger";
  return (
    <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} aria-hidden />
  );
}

function SuccessBadge() {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-accent/40 bg-[color-mix(in_oklab,var(--accent)_16%,transparent)]">
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
        className="text-accent"
      >
        <path
          d="M3.5 8.5L6.5 11.5L12.5 4.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-check-draw"
          style={{ strokeDasharray: 16 }}
        />
      </svg>
    </span>
  );
}

function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-t-transparent ${
        dark ? "border-[oklch(0.18_0.02_145)]" : "border-ink"
      }`}
      aria-hidden
    />
  );
}
