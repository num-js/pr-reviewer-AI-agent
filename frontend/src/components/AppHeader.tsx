type AppHeaderProps = {
  onReviewClick: () => void;
  onHistoryClick: () => void;
  onActivityClick: () => void;
};

export function AppHeader({
  onReviewClick,
  onHistoryClick,
  onActivityClick,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-[color-mix(in_oklab,var(--bg)_78%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
        <a
          href="#review"
          onClick={(e) => {
            e.preventDefault();
            onReviewClick();
          }}
          className="focus-ring group inline-flex min-w-0 items-center gap-2.5 rounded-lg"
        >
          <span
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] text-xs font-bold text-accent shadow-[0_0_20px_color-mix(in_oklab,var(--accent)_18%,transparent)]"
            aria-hidden
          >
            PR
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight text-ink sm:text-base">
              PR Reviewer
            </span>
            <span className="hidden text-xs text-muted sm:block">
              Agent - GitHub
            </span>
          </span>
        </a>

        <nav
          className="flex items-center gap-1 sm:gap-2"
          aria-label="Primary"
        >
          <button
            type="button"
            onClick={onReviewClick}
            className="focus-ring rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted transition duration-200 ease-outExpo hover:bg-elevated hover:text-ink sm:px-3"
          >
            Review
          </button>
          <button
            type="button"
            onClick={onHistoryClick}
            className="focus-ring rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted transition duration-200 ease-outExpo hover:bg-elevated hover:text-ink sm:px-3"
          >
            History
          </button>
          <button
            type="button"
            onClick={onActivityClick}
            className="focus-ring rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted transition duration-200 ease-outExpo hover:bg-elevated hover:text-ink sm:px-3"
          >
            Activity
          </button>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="focus-ring ml-1 hidden rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink transition duration-200 ease-outExpo hover:bg-elevated sm:inline-flex"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
