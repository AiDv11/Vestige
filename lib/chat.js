// ===========================================================================
// MODEL CALLS
// Everything that talks to Groq lives here, so swapping providers is a
// one-file change. Groq uses the OpenAI-compatible format.
// ===========================================================================

import Groq from "groq-sdk";
import { ERAS } from "./eras.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export const MODEL = process.env.MODEL || "openai/gpt-oss-120b";

/** Build the array the model actually receives: the era's persona first,
 *  then the stored turns. This is the whole "memory" mechanism. */
export function buildMessages(era, turns) {
  return [
    { role: "system", content: ERAS[era].system },
    ...turns.map(({ role, content }) => ({ role, content })),
  ];
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
