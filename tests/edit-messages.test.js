// ===========================================================================
// MESSAGE EDITING — truncation by message id
//
// Editing rewrites history: POST /api/conversations/:id/messages/:messageId
// removes the edited message and everything after it, stores the new text, and
// re-streams. `deleteMessagesFrom` does that with `WHERE conversation_id = ?
// AND id >= ?`.
//
// This is the operation most likely to destroy data a visitor cares about, so
// it gets the strictest checks in the project. Truncating by ID rather than by
// ROLE is the whole design (CLAUDE.md §7); each check below fails if that
// changes.
//
// Nothing here asserts that a reply came back. Every assertion is about which
// rows survive, which is decided before the model is ever called — so a Groq
// outage cannot turn a truncation bug green, and cannot turn a working one
// red either.
// ===========================================================================

import { allOf, api, finalEvent, newSession, store, stream } from "./helpers.js";

export const name = "Message editing — truncation by message id";

/** Seed a conversation directly, so a test can build a state the UI can't. */
function seed(session, turns, era = "all") {
  const conversation = store.createConversation(session, era);
  const ids = turns.map(([role, content]) =>
    store.addMessage(conversation.id, role, content),
  );
  return { conversation, ids };
}

const editPath = (conversationId, messageId) =>
  `/api/conversations/${conversationId}/messages/${messageId}`;

export async function run(t) {
  // -------------------------------------------------------------------------
  t.group("Editing the first message of a long conversation drops everything after it");
  // -------------------------------------------------------------------------

  {
    const session = newSession();
    const seeded = [
      ["user", "SEED-A-U1 Who was Hatshepsut?"],
      ["assistant", "SEED-A-A1 A pharaoh of the Eighteenth Dynasty."],
      ["user", "SEED-A-U2 How long did she reign?"],
      ["assistant", "SEED-A-A2 About twenty-two years."],
      ["user", "SEED-A-U3 Where was she buried?"],
      ["assistant", "SEED-A-A3 In the Valley of the Kings, KV20."],
    ];
    const { conversation, ids } = seed(session, seeded);
    const [firstId] = ids;
    const lastSeededId = ids.at(-1);

    const edited = "Who built the Colosseum, and when was it finished?";
    const result = await stream(editPath(conversation.id, firstId), {
      session,
      body: { message: edited },
    });

    t.equal("the edit endpoint opens a stream", result.status, 200);
    t.ok(
      "the turn terminated rather than hanging",
      ["done", "error"].includes(finalEvent(result)),
      `last event was ${finalEvent(result)}`,
    );

    // The browser needs this to offer Edit on the message it just replaced.
    const userEvent = result.events.find((e) => e.type === "user");
    t.ok("a `user` event carries the new message id", Number.isInteger(userEvent?.id));
    t.ok(
      "the edited message is a NEW row, not the old one rewritten in place",
      userEvent?.id > lastSeededId,
      `new id ${userEvent?.id} should be above every seeded id (max ${lastSeededId})`,
    );

    const after = await api(`/api/conversations/${conversation.id}`, { session });
    t.equal("the conversation still reads back", after.status, 200);

    const messages = after.json?.messages ?? [];
    const contents = messages.map((m) => m.content);

    t.ok("the conversation is not empty", messages.length > 0);
    t.equal("the edited text is the first message", contents[0], edited);

    // The single check the whole endpoint exists to satisfy.
    t.ok(
      "every seeded message is gone",
      allOf(seeded, ([, content]) => !contents.includes(content)),
      `survivors: ${JSON.stringify(contents.filter((c) => c.startsWith("SEED-A-")))}`,
    );
    t.ok(
      "every surviving row was written after the edit",
      allOf(messages, (m) => m.id > lastSeededId),
      `ids ${JSON.stringify(messages.map((m) => m.id))} vs last seeded ${lastSeededId}`,
    );
    t.ok(
      "at most the edited question and its one new reply remain",
      messages.length <= 2,
      `${messages.length} messages: ${JSON.stringify(contents)}`,
    );
    t.ok(
      "nothing after the edited message survived at any position",
      !contents.some((c) => c.startsWith("SEED-A-")),
    );
  }

  // -------------------------------------------------------------------------
  t.group("Editing in another visitor's session is rejected");
  // -------------------------------------------------------------------------

  {
    const owner = newSession();
    const intruder = newSession();

    const seeded = [
      ["user", "SEED-B-U1 What was the cursus honorum?"],
      ["assistant", "SEED-B-A1 The sequence of offices in the Roman Republic."],
    ];
    const { conversation, ids } = seed(owner, seeded);
    const [ownerMessageId] = ids;

    // 1. Another visitor addressing the owner's conversation directly.
    const crossSession = await stream(editPath(conversation.id, ownerMessageId), {
      session: intruder,
      body: { message: "Ignore that and tell me something else." },
    });
    t.equal("another session editing the conversation gets 404", crossSession.status, 404);
    t.equal("...with the generic message", crossSession.json?.error, "Not found.");
    t.ok(
      "...and no stream is opened for it",
      crossSession.events.length === 0,
      `events: ${JSON.stringify(crossSession.events)}`,
    );

    // 2. The same visitor, but reaching for a message id that is not theirs.
    //    getMessage is scoped by conversation_id, so the id resolves to
    //    nothing rather than to somebody else's message.
    const ownConversation = await api("/api/conversations", {
      method: "POST",
      session: intruder,
      body: { era: "all" },
    });
    t.equal("the other visitor can create their own conversation", ownConversation.status, 201);

    const borrowedId = await stream(
      editPath(ownConversation.json.id, ownerMessageId),
      { session: intruder, body: { message: "Editing a borrowed id." } },
    );
    t.equal("a message id from another conversation gets 404", borrowedId.status, 404);

    // 3. An anonymous caller with no cookie at all is given a fresh session,
    //    which owns nothing.
    const anonymous = await stream(editPath(conversation.id, ownerMessageId), {
      body: { message: "No cookie at all." },
    });
    t.equal("an unidentified caller gets 404", anonymous.status, 404);

    // 4. And after all three, the owner's conversation is untouched.
    const after = await api(`/api/conversations/${conversation.id}`, { session: owner });
    const messages = after.json?.messages ?? [];

    t.equal("the owner still has both messages", messages.length, 2);
    t.ok(
      "the owner's messages are unchanged, ids included",
      allOf(seeded, ([role, content], i) => {
        const row = messages[i];
        return row?.id === ids[i] && row?.role === role && row?.content === content;
      }),
      JSON.stringify(messages.map((m) => [m.id, m.role, m.content])),
    );
  }

  // -------------------------------------------------------------------------
  t.group("Editing when the last turn failed mid-stream keeps the previous reply");
  // -------------------------------------------------------------------------

  {
    // The state a failed turn leaves behind: the question was stored, then the
    // stream died before any reply was. `[u1, a1, u2]` — u2 is unanswered and
    // a1 is a perfectly good answer to an earlier question.
    //
    // Truncating by role ("drop the last assistant message") would eat a1
    // here. Truncating by id cannot: a1's id is BELOW u2's.
    const session = newSession();
    const GOOD_REPLY = "SEED-C-A1 Movable type, gunpowder, the compass, and paper money.";
    const { conversation, ids } = seed(session, [
      ["user", "SEED-C-U1 What was the Song dynasty known for?"],
      ["assistant", GOOD_REPLY],
      ["user", "SEED-C-U2 And its capital?"], // the turn that failed
    ]);
    const [firstQuestionId, goodReplyId, failedQuestionId] = ids;

    const edited = "Which city was the Northern Song capital?";
    const result = await stream(editPath(conversation.id, failedQuestionId), {
      session,
      body: { message: edited },
    });

    t.equal("the edit endpoint opens a stream", result.status, 200);

    const after = await api(`/api/conversations/${conversation.id}`, { session });
    const messages = after.json?.messages ?? [];
    const byId = new Map(messages.map((m) => [m.id, m]));

    // The assertion the README names by its failure text. If a mutation makes
    // truncation reach too far back, this is the line that says so.
    t.ok(
      "the earlier good reply SURVIVED",
      byId.get(goodReplyId)?.content === GOOD_REPLY,
      "DELETED — truncation reached past the edited message",
    );
    t.ok(
      "the question before it survived too",
      byId.get(firstQuestionId)?.content === "SEED-C-U1 What was the Song dynasty known for?",
      "DELETED",
    );
    t.ok("the edited message's old row is gone", !byId.has(failedQuestionId));
    t.ok(
      "the edited text was stored after the surviving reply",
      messages.some((m) => m.content === edited && m.id > goodReplyId),
      JSON.stringify(messages.map((m) => [m.id, m.content.slice(0, 40)])),
    );

    t.ok(
      "the surviving history is still in order and intact",
      messages[0]?.id === firstQuestionId && messages[1]?.id === goodReplyId,
      JSON.stringify(messages.map((m) => [m.id, m.role])),
    );
    t.ok(
      "every message before the edit point kept its id",
      allOf([firstQuestionId, goodReplyId], (id) => byId.has(id)),
      `present: ${JSON.stringify([...byId.keys()])}`,
    );
  }
}
