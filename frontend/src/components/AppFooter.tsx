export function AppFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-line/80 bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-8">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-ink">PR Reviewer</p>
          <p className="max-w-md text-sm text-muted text-pretty">
            An AI engineering manager for pull request reviews. Findings are
            prioritized by risk, correctness, maintainability, and performance,
            with clear rationale and actionable recommendations.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a
              href="https://openrouter.ai"
              target="_blank"
              rel="noreferrer"
              className="focus-ring rounded text-muted transition hover:text-ink"
            >
              OpenRouter
            </a>
            <a
              href="https://docs.github.com/en/rest/pulls/comments"
              target="_blank"
              rel="noreferrer"
              className="focus-ring rounded text-muted transition hover:text-ink"
            >
              GitHub API
            </a>
          </div>
          <p className="font-mono text-xs text-muted/80">
            © {year} · Local review console
          </p>
        </div>
      </div>
    </footer>
  );
}
