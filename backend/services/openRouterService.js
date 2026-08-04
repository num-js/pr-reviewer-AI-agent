const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const MAX_CONTEXT_CHARS = 120_000;

const SYSTEM_PROMPT = `You are a senior engineering manager with 10+ years of experience reviewing pull requests on production teams. You give clear, constructive, prioritized feedback that helps engineers ship safe, maintainable code.

Tone and style:
- Professional, respectful, and direct — like a strong EM in a written PR review
- Explain why each issue matters (risk, maintainability, correctness, performance)
- Prefer concrete guidance over vague preferences
- No fluff, sarcasm, or personal criticism

Output rules:
- Respond with ONLY valid JSON (no markdown fences, no prose outside JSON)
- JSON must be an array of objects with keys:
  - "file" (string): path matching a changed file
  - "line" (integer): line in the NEW/right-hand version of the file; must appear in the diff
  - "comment" (string): finding + why it matters + what to do
  - "suggestedCode" (string): focused code the author should apply, or "" when a code snippet is not appropriate
- Use at least 1 and at most 25 items
- If a finding applies to the whole file, use the first changed line number from the diff for that file
- Include suggestedCode whenever a concrete fix exists; omit code (use "") for process, design, or naming-only feedback`;

/**
 * @param {{
 *   title: string,
 *   description: string,
 *   files: Array<{ filename: string, status: string, patch?: string }>
 * }} prContext
 * @returns {Promise<Array<{ file: string, line: number, comment: string, suggestedCode: string }>>}
 */
export async function generateStructuredReview(prContext) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  let bundle = "";
  for (const f of prContext.files) {
    const patch = f.patch || "(no patch — binary or large file)";
    const chunk = `\n\n### File: ${f.filename} (${f.status})\n${patch}\n`;
    if (bundle.length + chunk.length > MAX_CONTEXT_CHARS) {
      bundle += `\n\n[... additional files omitted to stay within context limit ...]\n`;
      break;
    }
    bundle += chunk;
  }

  const userContent = `Review this pull request as you would for your engineering team before merge.

Pull request title: ${prContext.title}

Pull request description:
${prContext.description || "(none)"}

Changed files and diffs:
${bundle}

Return ONLY a JSON array of review findings with keys file, line, comment, and suggestedCode as specified. Prioritize correctness and risk, then maintainability, then polish.`;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.CORS_ORIGIN || "http://localhost:5173",
      "X-OpenRouter-Title": "PR Reviewer Agent",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content?.trim() || "[]";
  return parseReviewJson(text);
}

/**
 * @param {string} text
 * @returns {Array<{ file: string, line: number, comment: string, suggestedCode: string }>}
 */
function parseReviewJson(text) {
  let raw = text;
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("AI response was not a JSON array");
  }
  return parsed
    .map((item) => ({
      file: String(item.file || "").trim(),
      line: Number(item.line),
      comment: String(item.comment || "").trim(),
      suggestedCode: String(item.suggestedCode || "").trim(),
    }))
    .filter((item) => item.file && item.comment && Number.isFinite(item.line));
}
