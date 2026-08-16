import "dotenv/config";
import express from "express";

import { DEFAULT_ERA, isEra, publicEras } from "./lib/eras.js";
import { generateTitle, streamReply } from "./lib/chat.js";
import { findArtifacts } from "./lib/artifacts.js";
import { rateLimit } from "./lib/rateLimit.js";
import * as store from "./lib/db.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a host's proxy, req.ip is the proxy unless this is set.
app.set("trust proxy", 1);
app.use(express.json({ limit: "64kb" }));

// ---------------------------------------------------------------------------
// SESSIONS
// A random id in a cookie. Not auth — it just means two browsers get two
// separate sets of conversations instead of sharing one. Before this, every
// visitor was reading the same chat.
// ---------------------------------------------------------------------------

const COOKIE = "hb_session";
const YEAR = 60 * 60 * 24 * 365;

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

app.use((req, res, next) => {
  let sid = readCookie(req.headers.cookie, COOKIE);

  if (!sid || !/^[\w-]{10,64}$/.test(sid)) {
    sid = crypto.randomUUID();
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${sid}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax`,
    );
  }

  req.sessionId = sid;
  next();
});

// ---------------------------------------------------------------------------
// LIMITS
// The model calls are what cost money, so they get the tight limit. Creating
// conversations is cheap but worth bounding so nobody fills the database.
// ---------------------------------------------------------------------------

const askLimit = rateLimit({
  windowMs: 60_000,
  max: 12,
  message: "That's a lot of questions at once. Give it a minute.",
});

const writeLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: "Too many requests. Give it a minute.",
});

// ---------------------------------------------------------------------------
// READ ROUTES
// ---------------------------------------------------------------------------

// Hosts ping this to know the process is alive; it must stay dependency-free
// and fast, so it deliberately touches nothing.
app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/eras", (req, res) => {
  res.json(publicEras());
});

app.get("/api/conversations", (req, res) => {
  res.json(store.listConversations(req.sessionId));
});

app.get("/api/conversations/:id", (req, res) => {
  const conversation = store.getConversation(req.params.id, req.sessionId);
  if (!conversation) return res.status(404).json({ error: "Not found." });

  res.json({ conversation, messages: store.getMessages(conversation.id) });
});

// ---------------------------------------------------------------------------
// WRITE ROUTES
// ---------------------------------------------------------------------------

app.post("/api/conversations", writeLimit, (req, res) => {
  const era = req.body?.era ?? DEFAULT_ERA;
  if (!isEra(era)) return res.status(400).json({ error: `Unknown era: ${era}` });

  res.status(201).json(store.createConversation(req.sessionId, era));
});

app.patch("/api/conversations/:id", (req, res) => {
  const conversation = store.getConversation(req.params.id, req.sessionId);
  if (!conversation) return res.status(404).json({ error: "Not found." });

  const title = String(req.body?.title ?? "").trim().slice(0, 60);
  if (!title) return res.status(400).json({ error: "Title is empty." });

  store.renameConversation(conversation.id, req.sessionId, title);
  res.json({ ok: true, title });
});

app.delete("/api/conversations/:id", (req, res) => {
  store.deleteConversation(req.params.id, req.sessionId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// STREAMING
// Server-Sent Events: one long-lived HTTP response the server writes to as
// tokens arrive. Simpler than WebSockets and the right fit here, because the
// data only ever flows one way.
// ---------------------------------------------------------------------------

function openStream(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // stops proxies buffering the stream
  });
  res.flushHeaders?.();
}

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Shared by "send a message" and "regenerate" — both stream a reply for
 *  whatever turns are currently stored. */
async function streamInto(res, conversation, sessionId, { isFirstExchange, question }) {
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  // Start the museum lookup immediately, so it runs while the model is still
  // writing. By the time the reply finishes it's usually already resolved,
  // which is why the feature costs the user no extra waiting.
  const artifactsPending = question
    ? findArtifacts(conversation.era, question)
    : Promise.resolve([]);

  let full = "";

  try {
    const turns = store.getMessages(conversation.id);

    for await (const piece of streamReply(conversation.era, turns, {
      signal: controller.signal,
    })) {
      full += piece;
      sendEvent(res, { type: "delta", text: piece });
    }

    if (!full.trim()) throw new Error("The model returned an empty reply.");

    // Give the lookup a short grace period if the model finished first, but
    // never hold a finished answer hostage to a slow museum API.
    const artifacts = await Promise.race([
      artifactsPending,
      new Promise((resolve) => setTimeout(() => resolve([]), 4000)),
    ]);

    store.addMessage(conversation.id, "assistant", full, artifacts);

    if (artifacts.length) sendEvent(res, { type: "artifacts", artifacts });

    // Name the conversation from its opening question, once.
    let title = null;
    if (isFirstExchange) {
      title = await generateTitle(question);
      store.renameConversation(conversation.id, sessionId, title);
    }

    sendEvent(res, { type: "done", title });
  } catch (error) {
    if (controller.signal.aborted) return res.end();

    console.error("Stream failed:", error.message);
    // Partial text is still worth keeping — the user watched it appear.
    if (full.trim()) store.addMessage(conversation.id, "assistant", full);
    sendEvent(res, {
      type: "error",
      error: "Couldn't reach the archives. Try again.",
    });
  } finally {
    res.end();
  }
}

app.post("/api/conversations/:id/messages", askLimit, async (req, res) => {
  const conversation = store.getConversation(req.params.id, req.sessionId);
  if (!conversation) return res.status(404).json({ error: "Not found." });

  const message = String(req.body?.message ?? "").trim();
  if (!message) return res.status(400).json({ error: "Message is empty." });

  const isFirstExchange = store.getMessages(conversation.id).length === 0;
  const userMessageId = store.addMessage(conversation.id, "user", message);

  openStream(res);
  // The browser needs this id to offer Edit on a message it just sent.
  sendEvent(res, { type: "user", id: userMessageId });
  await streamInto(res, conversation, req.sessionId, {
    isFirstExchange,
    question: message,
  });
});

/**
 * Edit a message already sent, then answer again from that point.
 *
 * Editing rewrites history: the edited message and everything after it is
 * removed, the new text is stored, and the reply is re-streamed through the
 * same `streamInto` the other two endpoints use.
 */
app.post("/api/conversations/:id/messages/:messageId", askLimit, async (req, res) => {
  const conversation = store.getConversation(req.params.id, req.sessionId);
  if (!conversation) return res.status(404).json({ error: "Not found." });

  const messageId = Number(req.params.messageId);
  if (!Number.isInteger(messageId) || messageId < 1) {
    return res.status(400).json({ error: "Bad message id." });
  }

  // Scoped to this conversation, which is itself scoped to this session — so a
  // message id belonging to another visitor resolves to nothing, not to their
  // message.
  const target = store.getMessage(messageId, conversation.id);
  if (!target) return res.status(404).json({ error: "Not found." });
  if (target.role !== "user") {
    return res.status(400).json({ error: "Only your own messages can be edited." });
  }

  const message = String(req.body?.message ?? "").trim();
  if (!message) return res.status(400).json({ error: "Message is empty." });

  // If the opening question is being rewritten, the title should follow it.
  const turns = store.getMessages(conversation.id);
  const isFirstExchange = turns[0]?.id === messageId;

  store.deleteMessagesFrom(conversation.id, messageId);
  const newMessageId = store.addMessage(conversation.id, "user", message);

  openStream(res);
  sendEvent(res, { type: "user", id: newMessageId });
  await streamInto(res, conversation, req.sessionId, {
    isFirstExchange,
    question: message,
  });
});

app.post("/api/conversations/:id/regenerate", askLimit, async (req, res) => {
  const conversation = store.getConversation(req.params.id, req.sessionId);
  if (!conversation) return res.status(404).json({ error: "Not found." });

  const turns = store.getMessages(conversation.id);
  if (turns.length === 0) {
    return res.status(400).json({ error: "Nothing to regenerate." });
  }

  // Only drop a reply if one is actually the last thing in the conversation.
  // When a turn fails mid-stream the user message is stored but no reply is,
  // so this endpoint doubles as "retry" — and dropping unconditionally would
  // delete the previous, perfectly good answer instead.
  if (turns[turns.length - 1]?.role === "assistant") {
    store.dropLastAssistantMessage(conversation.id);
  }

  // Reuse the question that prompted the reply, so the regenerated answer
  // gets artifacts too rather than silently losing them.
  const lastQuestion = [...turns].reverse().find((t) => t.role === "user")?.content;

  openStream(res);
  await streamInto(res, conversation, req.sessionId, {
    isFirstExchange: false,
    question: lastQuestion,
  });
});

// ---------------------------------------------------------------------------

app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`History bot running: http://localhost:${PORT}`);
  console.log(`Database: ${store.DB_PATH}`);
});
