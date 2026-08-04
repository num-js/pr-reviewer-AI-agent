import { useCallback, useEffect, useState } from "react";
import {
  clearReviews,
  deleteReview,
  listReviews,
  type ReviewHistoryEntry,
} from "../lib/reviewHistoryDb";

type ReviewHistoryProps = {
  refreshToken: number;
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

  return (
    <section
      id="history"
      className="glass-panel animate-fade-up scroll-mt-20 rounded-2xl [animation-delay:100ms]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-ink">Review history</h2>
          <p className="text-xs text-muted">
            Saved in this browser after each successful post
          </p>
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
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-xs text-muted">
            {entries.length}
          </span>
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        {loading ? (
          <p className="text-sm text-muted">Loading history…</p>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted">
            No saved reviews yet. After you post comments to GitHub, they will
            appear here.
          </p>
        ) : (
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {entries.map((entry) => {
              const open = expandedId === entry.id;
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
                      <p className="truncate text-sm font-medium text-ink">
                        {entry.prTitle ||
                          `${entry.owner}/${entry.repo}#${entry.pullNumber}`}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-glow">
                        {entry.owner}/{entry.repo}#{entry.pullNumber}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {formatSavedAt(entry.savedAt)} ·{" "}
                        {entry.postedInlineCount} inline ·{" "}
                        {entry.suggestionsCount} submitted
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(entry.id)}
                      disabled={busyId !== null}
                      className="focus-ring shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-danger transition hover:bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] disabled:opacity-50"
                    >
                      {busyId === entry.id ? "…" : "Delete"}
                    </button>
                  </div>

                  {open ? (
                    <div className="animate-fade-in space-y-3 border-t border-line px-3 py-3">
                      <a
                        href={entry.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="focus-ring inline-block break-all font-mono text-xs text-glow hover:underline"
                      >
                        {entry.prUrl}
                      </a>
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
