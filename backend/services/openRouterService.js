const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const MAX_CONTEXT_CHARS = 120_000;

/**
 * @param {{
 *   title: string,
 *   description: string,
 *   files: Array<{ filename: string, status: string, patch?: string }>
 * }} prContext
 * @returns {Promise<Array<{ file: string, line: number, comment: string }>>}
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

  const userContent = `Pull request title: ${prContext.title}

Pull request description:
${prContext.description || "(none)"}

Changed files and diffs:
${bundle}

Respond with ONLY valid JSON (no markdown fences): an array of objects with keys "file" (string path matching a changed file), "line" (integer: line number in the NEW/right-hand version of the file where the comment applies — must be a line that appears in the diff), and "comment" (string: concise actionable review note). Use at least 1 and at most 25 items. If a finding applies to the whole file, use the first changed line number from the diff for that file.`;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.CORS_ORIGIN,
      "X-OpenRouter-Title": "PR Reviewer Agent",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a senior software engineer performing a detailed code review. Provide actionable, concise feedback. Output must be ONLY a JSON array of objects with keys: file (string), line (integer), comment (string). No markdown, no explanation outside the JSON.",
        },
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
 * @returns {Array<{ file: string, line: number, comment: string }>}
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
    }))
    .filter((item) => item.file && item.comment && Number.isFinite(item.line));
}
