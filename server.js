import "dotenv/config";
import express from "express";

import { DEFAULT_ERA, isEra, publicEras } from "./lib/eras.js";
import { generateTitle, streamReply } from "./lib/chat.js";
import { findArtifacts } from "./lib/artifacts.js";
import { rateLimit } from "./lib/rateLimit.js";
import {
  MAX_CUSTOM_ERAS,
  generateEra,
  publicCustomEras,
  resolveEraFor,
  sanitiseEraName,
  takenHuesFor,
} from "./lib/customEras.js";
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
  res.json([...publicEras(), ...publicCustomEras(req.sessionId)]);
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

  // A custom era counts only if it belongs to this visitor.
  const known = isEra(era) || !!store.getCustomEra(era, req.sessionId);
  if (!known) return res.status(400).json({ error: `Unknown era: ${era}` });

  res.status(201).json(store.createConversation(req.sessionId, era));
});

// ---------------------------------------------------------------------------
// CUSTOM ERAS
// The model writes the content; every field is validated against a closed set
// in lib/customEras.js before it is stored or reaches the page.
// ---------------------------------------------------------------------------

app.post("/api/eras", askLimit, async (req, res) => {
  const existing = store.listCustomEras(req.sessionId);
  if (existing.length >= MAX_CUSTOM_ERAS) {
    return res
      .status(400)
      .json({ error: `You can keep up to ${MAX_CUSTOM_ERAS} custom eras.` });
  }

  const cleaned = sanitiseEraName(req.body?.name);
  if (!cleaned.ok) return res.status(400).json({ error: cleaned.error });

  const result = await generateEra(cleaned.name, takenHuesFor(req.sessionId));
  if (!result.ok) {
    console.error("Era generation failed:", result.problems?.join(" | "));
    return res.status(422).json({ error: result.error });
  }

  const saved = store.createCustomEra(req.sessionId, result.era);

  res.status(201).json({
    id: saved.id,
    label: saved.label,
    blurb: saved.blurb,
    hue: saved.hue,
    font: saved.font,
    hasArtifacts: !!saved.met_department,
    custom: true,
  });
});

app.delete("/api/eras/:id", (req, res) => {
  // Conversations that used it are left alone: resolveEraFor falls back to the
  // default for a missing era, exactly as it does for the retired `ww2` key.
  const removed = store.deleteCustomEra(req.params.id, req.sessionId);
  if (!removed) return res.status(404).json({ error: "Not found." });
  res.json({ ok: true });
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
  let clientGone = false;
  res.on("close", () => {
    clientGone = true;
    controller.abort();
  });

  // Resolve the stored key into a real era once. Built-in, this visitor's
  // custom era, or — for a retired key or a deleted custom era — the default.
  const era = resolveEraFor(conversation.era, sessionId);

  // Start the museum lookup immediately, so it runs while the model is still
  // writing. A custom era with no Met department has no source, and this
  // resolves to an empty array without a request.
  const artifactsPending = question
    ? findArtifacts(era.source, question)
    : Promise.resolve([]);

  let full = "";

  try {
    const turns = store.getMessages(conversation.id);

    for await (const piece of streamReply(era, turns, {
      signal: controller.signal,
    })) {
      full += piece;
      sendEvent(res, { type: "delta", text: piece });
    }

    if (!full.trim()) throw new Error("The model returned an empty reply.");

    const assistantId = store.addMessage(conversation.id, "assistant", full);

    // Name the conversation from its opening question, once.
    let title = null;
    if (isFirstExchange) {
      title = await generateTitle(question);
      store.renameConversation(conversation.id, sessionId, title);
    }

    // The reply is finished here. Nothing below is allowed to delay it.
    sendEvent(res, { type: "done", title });

    // The museum lookup finishes on its own schedule. The stream stays open a
    // little longer purely to deliver it — the client has already rendered the
    // answer and re-enabled input, and if this never arrives the reply simply
    // stands without artifacts. Previously this was a 4-second race the Met
    // often lost, which silently dropped artifacts that had been found.
    const artifacts = await artifactsPending;

    if (artifacts.length) {
      // Persist regardless of whether anyone is still listening, so a reload
      // shows them even if the tab was closed mid-lookup.
      store.setMessageArtifacts(assistantId, artifacts);
      if (!clientGone) sendEvent(res, { type: "artifacts", artifacts });
    }
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

app.use(express.static("client/dist"));

/**
 * Count registered routes. Printing this at startup makes a stale process
 * obvious at a glance: if the number doesn't match the code you just edited,
 * the server didn't restart. Express 5 exposes `app.router`; 4 uses `_router`.
 */
function countRoutes() {
  // Express 4 keeps the stack on `_router`. Check that FIRST: on Express 4
  // `app.router` is a deprecated getter that *throws*, so optional chaining
  // doesn't protect you — reading it at all is the error.
  let stack = app._router?.stack;

  if (!stack) {
    try {
      stack = app.router?.stack; // Express 5
    } catch {
      stack = null;
    }
  }

  return (stack ?? []).filter((layer) => layer.route).length;
}

app.listen(PORT, () => {
  console.log(`Vestige running: http://localhost:${PORT}`);
  console.log(`${countRoutes()} routes | database: ${store.DB_PATH}`);
});
