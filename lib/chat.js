// ===========================================================================
// MODEL CALLS
// Everything that talks to Groq lives here, so swapping providers is a
// one-file change. Groq uses the OpenAI-compatible format.
// ===========================================================================

import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export const MODEL = process.env.MODEL || "openai/gpt-oss-120b";

/**
 * Build the array the model actually receives: the era's persona first, then
 * the stored turns. This is the whole "memory" mechanism.
 *
 * `era` is a resolved era object, not an id — the caller has already turned a
 * stored key into a real era (built-in or custom, falling back to the default
 * for keys that no longer exist).
 */
export function buildMessages(era, turns) {
  return [
    { role: "system", content: era.system },
    ...turns.map(({ role, content }) => ({ role, content })),
  ];
}

/**
 * Ask the model for a JSON object and parse it.
 *
 * Returns null rather than throwing on anything unusable — an unparseable
 * reply is an expected outcome here, and the caller retries.
 */
export async function completeJSON(system, user, { maxTokens = 1200 } = {}) {
  try {
    const res = await groq.chat.completions.create({
      model: MODEL,
      max_completion_tokens: maxTokens,
      reasoning_effort: "low", // see generateTitle: reasoning eats the budget
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const text = (res.choices[0].message.content ?? "").trim();
    if (!text) return null;

    // Be tolerant of a fenced block even though JSON mode was requested.
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const value = JSON.parse(cleaned);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Stream a reply token by token.
 * Yields text fragments as they arrive; the caller forwards them to the
 * browser and concatenates them for storage.
 */
export async function* streamReply(era, turns, { signal } = {}) {
  const stream = await groq.chat.completions.create(
    {
      model: MODEL,
      messages: buildMessages(era, turns),
      stream: true,
    },
    { signal },
  );

  for await (const chunk of stream) {
    const piece = chunk.choices?.[0]?.delta?.content;
    if (piece) yield piece;
  }
}

/**
 * Name a conversation from its first exchange, the way real chat apps do.
 * Failure is non-fatal — an untitled conversation is cosmetic, not broken.
 *
 * `reasoning_effort: "low"` matters here. This model reasons before it
 * answers, and that reasoning is billed against the same token budget: at a
 * tight cap it spends the whole allowance thinking and returns empty content
 * with finish_reason "length". Low effort plus real headroom leaves room for
 * the four words we actually want.
 */
export async function generateTitle(question) {
  try {
    const res = await groq.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 200,
      reasoning_effort: "low",
      messages: [
        {
          role: "system",
          content:
            "Write a 2–4 word title for a conversation that starts with the " +
            "user's message. Title case. No quotes, no punctuation at the end, " +
            "no preamble — reply with the title only.",
        },
        { role: "user", content: question },
      ],
    });

    const title = (res.choices[0].message.content ?? "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .split("\n")[0]
      .slice(0, 60);

    return title || "New conversation";
  } catch {
    return "New conversation";
  }
}
