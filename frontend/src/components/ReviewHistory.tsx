import { useCallback, useEffect, useState } from "react";
import {
  clearReviews,
  deleteReview,
  listReviews,
  saveReview,
  type ReviewHistoryEntry,
} from "../lib/reviewHistoryDb";

type ReviewHistoryProps = {
  refreshToken: number;
};

type PostApiBody = {
  ok?: boolean;
  error?: string;
  suggestionsCount?: number;
  postedInlineCount?: number;
  fallbackPosted?: boolean;
  summaryPosted?: boolean;
  prTitle?: string;
};

function formatSavedAt(ts: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export function ReviewHistory({ refreshToken }: ReviewHistoryProps) {
  const [entries, setEntries] = useState<ReviewHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [postMessage, setPostMessage] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await listReviews();
      setEntries(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  const onDelete = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await deleteReview(id);
        if (expandedId === id) setExpandedId(null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete entry");
      } finally {
        setBusyId(null);
      }
    },
    [expandedId, reload]
  );

  const onClearAll = useCallback(async () => {
    if (
      !window.confirm(
        "Clear all saved review history from this browser? This cannot be undone."
      )
    ) {
      return;
    }
    setBusyId("__clear__");
    try {
      await clearReviews();
      setExpandedId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear history");
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  const onPost = useCallback(
    async (entry: ReviewHistoryEntry) => {
      if (entry.status === "posted") return;
      if (!entry.comments.length) {
        setError("This review has no comments to post.");
        return;
      }
      if (
        !window.confirm(
          `Post ${entry.comments.length} comment(s) to ${entry.owner}/${entry.repo}#${entry.pullNumber}?`
        )
      ) {
        return;
      }

      setBusyId(entry.id);
      setError("");
      setPostMessage("");
      try {
        const res = await fetch("/api/review-pr/post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prUrl: entry.prUrl,
            comments: entry.comments.map((c) => ({
              file: c.file,
              line: c.line,
              comment: c.comment,
              suggestedCode: c.suggestedCode || "",
            })),
          }),
        });
        const data = (await res.json()) as PostApiBody;
        if (!res.ok || !data.ok) {
          throw new Error(data.error || res.statusText || "Post failed");
        }

        await saveReview({
          ...entry,
          status: "posted",
          postedAt: Date.now(),
          prTitle: data.prTitle || entry.prTitle,
          suggestionsCount:
            data.suggestionsCount ?? entry.comments.length,
          postedInlineCount: data.postedInlineCount ?? 0,
          fallbackPosted: Boolean(data.fallbackPosted),
          summaryPosted: data.summaryPosted,
        });
        setPostMessage(
          `Posted ${data.postedInlineCount ?? 0} inline comment(s) for ${entry.owner}/${entry.repo}#${entry.pullNumber}.`
        );
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to post review");
      } finally {
        setBusyId(null);
      }
    },
    [reload]
  );

  return (
    <section
      id="history"
      className="glass-panel animate-fade-up scroll-mt-20 rounded-2xl [animation-delay:100ms]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-ink">Review history
          <span className="ml-2 rounded-full border border-line px-2 py-0.5 font-mono text-xs text-muted">
            {entries.length}
          </span>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 ? (
            <button
              type="button"
              onClick={() => void onClearAll()}
              disabled={busyId !== null}
              className="focus-ring rounded-lg px-2.5 py-1.5 text-xs font-medium text-danger transition hover:bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] disabled:opacity-50"
            >
              Clear all
            </button>
          ) : null}
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        {postMessage ? (
          <p className="mb-3 rounded-lg border border-accent/35 bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-3 py-2 text-sm text-ink">
            {postMessage}
          </p>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted">Loading history…</p>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted">
            No saved reviews yet. Generated reviews appear here automatically.
          </p>
        ) : (
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {entries.map((entry) => {
              const open = expandedId === entry.id;
              const posted = entry.status === "posted";
              const posting = busyId === entry.id;
              return (
                <li
                  key={entry.id}
                  className="rounded-xl border border-line bg-[color-mix(in_oklab,var(--bg)_55%,transparent)]"
                >
                  <div className="flex items-start gap-2 px-3 py-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(open ? null : entry.id)
                      }
                      className="focus-ring min-w-0 flex-1 rounded-lg text-left"
                      aria-expanded={open}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-ink">
                          {entry.prTitle ||
                            `${entry.owner}/${entry.repo}#${entry.pullNumber}`}
                        </p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                            posted
                              ? "border-accent/35 bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-accent"
                              : "border-warn/40 bg-[color-mix(in_oklab,var(--warn)_14%,transparent)] text-warn"
                          }`}
                        >
                          {posted ? "Posted" : "Not posted"}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-glow">
                        {entry.owner}/{entry.repo}#{entry.pullNumber}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {formatSavedAt(entry.savedAt)} ·{" "}
                        {entry.suggestionsCount} finding(s)
                        {posted
                          ? ` · ${entry.postedInlineCount} inline`
                          : ""}
                      </p>
                    </button>
                    <div className="flex shrink-0 flex-col items-stretch gap-1 sm:flex-row sm:items-center">
                      {!posted ? (
                        <button
                          type="button"
                          onClick={() => void onPost(entry)}
                          disabled={busyId !== null || entry.comments.length === 0}
                          className="focus-ring rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-[oklch(0.18_0.02_145)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {posting ? "Posting…" : "Post"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void onDelete(entry.id)}
                        disabled={busyId !== null}
                        className="focus-ring rounded-lg px-2 py-1.5 text-xs font-medium text-danger transition hover:bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] disabled:opacity-50"
                      >
                        {posting ? "…" : "Delete"}
                      </button>
                    </div>
                  </div>

                  {open ? (
                    <div className="animate-fade-in space-y-3 border-t border-line px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <a
                          href={entry.prUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="focus-ring inline-block break-all font-mono text-xs text-glow hover:underline"
                        >
                          {entry.prUrl}
                        </a>
                        {!posted ? (
                          <button
                            type="button"
                            onClick={() => void onPost(entry)}
                            disabled={
                              busyId !== null || entry.comments.length === 0
                            }
                            className="focus-ring rounded-lg border border-accent/40 bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] px-3 py-1.5 text-xs font-semibold text-accent transition hover:brightness-110 disabled:opacity-50"
                          >
                            {posting
                              ? "Posting to GitHub…"
                              : `Post ${entry.comments.length} to GitHub`}
                          </button>
                        ) : null}
                      </div>
                      <ul className="space-y-2">
                        {entry.comments.map((c, i) => (
                          <li
                            key={`${c.file}:${c.line}:${i}`}
                            className="rounded-lg border border-line/80 bg-surface/50 px-3 py-2"
                          >
                            <p className="font-mono text-xs text-glow">
                              {c.file}:{c.line}
                            </p>
                            <p className="mt-1 text-sm text-ink whitespace-pre-wrap break-words text-pretty">
                              {c.comment}
                            </p>
                            {c.suggestedCode?.trim() ? (
                              <pre className="mt-2 max-h-32 overflow-auto rounded-md border border-line bg-[color-mix(in_oklab,var(--bg)_85%,transparent)] p-2 font-mono text-xs text-muted whitespace-pre-wrap break-words">
                                {c.suggestedCode}
                              </pre>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
