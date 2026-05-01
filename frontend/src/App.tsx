import { useCallback, useMemo, useState } from "react";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { isValidPrUrl, prUrlHint } from "./lib/prUrl";

type ReviewSuccess = {
  ok: true;
  owner: string;
  repo: string;
  pullNumber: number;
  prTitle?: string;
  suggestionsCount: number;
  postedInlineCount: number;
  fallbackPosted: boolean;
  postedInline: { file: string; line: number }[];
  inlineErrors: { file: string; line: number; message: string }[];
  logs: string[];
};

type ReviewApiBody = {
  ok?: boolean;
  error?: string;
  logs?: string[];
  owner?: string;
  repo?: string;
  pullNumber?: number;
  prTitle?: string;
  suggestionsCount?: number;
  postedInlineCount?: number;
  fallbackPosted?: boolean;
  postedInline?: { file: string; line: number }[];
  inlineErrors?: { file: string; line: number; message: string }[];
};

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 800;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postReviewWithRetry(
  prUrl: string,
  onAttempt: (attempt: number, message: string) => void
): Promise<ReviewSuccess> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const wait = RETRY_BASE_MS * 2 ** (attempt - 1);
        onAttempt(attempt, `Retrying in ${wait}ms (attempt ${attempt + 1})…`);
        await sleep(wait);
      }
      onAttempt(attempt, attempt === 0 ? "Sending request…" : "Retrying…");
      const res = await fetch("/api/review-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl }),
      });
      const data = (await res.json()) as ReviewApiBody;
      const serverLogs = Array.isArray(data.logs) ? data.logs : [];
      if (!res.ok || !data.ok) {
        const msg = data.error || res.statusText || "Request failed";
        const err = new Error(msg) as Error & { logs?: string[] };
        err.logs = serverLogs;
        throw err;
      }
      return data as ReviewSuccess;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const withLogs = lastErr as Error & { logs?: string[] };
      onAttempt(
        attempt,
        lastErr.message + (withLogs.logs?.length ? ` (${withLogs.logs.length} log lines)` : "")
      );
      if (attempt === MAX_RETRIES) break;
    }
  }
  throw lastErr || new Error("Unknown error");
}

export default function App() {
  const [prUrl, setPrUrl] = useState("");
  const debouncedUrl = useDebouncedValue(prUrl, 350);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ReviewSuccess | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const debouncedHint = useMemo(
    () => prUrlHint(debouncedUrl),
    [debouncedUrl]
  );
  const canSubmit =
    isValidPrUrl(prUrl.trim()) && !loading;

  const appendLogs = useCallback((lines: string[]) => {
    setLogs((prev) => [...prev, ...lines]);
  }, []);

  const runReview = useCallback(async () => {
    const url = prUrl.trim();
    if (!isValidPrUrl(url)) {
      setStatus("error");
      setMessage("Enter a valid GitHub pull request URL.");
      return;
    }
    setLoading(true);
    setStatus("idle");
    setMessage("");
    setResult(null);
    setLogs([]);

    try {
      const data = await postReviewWithRetry(url, (_attempt, msg) => {
        setLogs((prev) => [
          ...prev,
          `[client] ${new Date().toISOString()} ${msg}`,
        ]);
      });
      setResult(data);
      setLogs((prev) => [...prev, ...(data.logs || [])]);
      setStatus("success");
      setMessage(
        `Review posted for ${data.owner}/${data.repo}#${data.pullNumber}.` +
          (data.fallbackPosted
            ? " A general PR comment was used because no inline comments succeeded."
            : ` ${data.postedInlineCount} inline comment(s).`)
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
      setLoading(false);
    }
  }, [prUrl, appendLogs]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16">
        <header className="space-y-2 text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-cyan-400/90">
            GitHub + OpenAI
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Pull request reviewer
          </h1>
          <p className="text-slate-400">
            Paste a PR link, run an AI review, and post comments back to
            GitHub automatically.
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
            disabled={loading}
            className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 font-mono text-sm text-slate-100 outline-none ring-cyan-500/40 placeholder:text-slate-600 focus:border-cyan-500/50 focus:ring-2 disabled:opacity-60"
          />
          {debouncedHint && (
            <p className="mt-2 text-sm text-amber-400/90">{debouncedHint}</p>
          )}
          {debouncedUrl.trim() && !debouncedHint && (
            <p className="mt-2 text-sm text-emerald-400/90">URL looks valid.</p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runReview}
              disabled={!canSubmit}
              className="inline-flex items-center justify-center rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/25 transition hover:bg-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Spinner />
                  Processing…
                </span>
              ) : (
                "Start review"
              )}
            </button>
            {status === "error" && (
              <button
                type="button"
                onClick={runReview}
                disabled={loading || !isValidPrUrl(prUrl.trim())}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500 hover:bg-slate-800/80 disabled:opacity-50"
              >
                Retry
              </button>
            )}
          </div>

          {status !== "idle" && (
            <div
              className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
                status === "success"
                  ? "border-emerald-800/80 bg-emerald-950/40 text-emerald-100"
                  : "border-rose-800/80 bg-rose-950/40 text-rose-100"
              }`}
              role="status"
            >
              {message}
            </div>
          )}

          {result && (
            <dl className="mt-4 grid gap-2 text-sm text-slate-300">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">PR title</dt>
                <dd className="text-right font-medium text-slate-100">
                  {result.prTitle || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">AI suggestions</dt>
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
              <p className="text-slate-600">Logs appear here after you run a review.</p>
            ) : (
              <ul className="space-y-1">
                {logs.map((line, i) => (
                  <li key={`${i}-${line.slice(0, 24)}`} className="whitespace-pre-wrap break-all">
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
