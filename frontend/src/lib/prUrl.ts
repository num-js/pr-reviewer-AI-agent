const PR_URL_REGEX =
  /^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(\/.*)?$/i;

export function isValidPrUrl(url: string): boolean {
  const t = url.trim();
  if (!t) return false;
  return PR_URL_REGEX.test(t);
}

export function prUrlHint(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  if (!t.includes("github.com")) {
    return "URL must be a github.com pull request link.";
  }
  if (!isValidPrUrl(t)) {
    return "Expected format: https://github.com/owner/repo/pull/123";
  }
  return null;
}
