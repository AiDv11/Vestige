// ===========================================================================
// STORAGE
// Uses node:sqlite — built into Node 22+, so there is no dependency to
// install and no native module to compile. Conversations survive restarts.
// ===========================================================================

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = resolve(process.env.DB_PATH || "data/history.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// WAL keeps reads fast while a write is in progress; foreign_keys makes the
// ON DELETE CASCADE below actually fire (SQLite has it off by default).
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    era         TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT 'New conversation',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_session
    ON conversations (session_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (conversation_id)
      REFERENCES conversations (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages (conversation_id, id);
`);

// Eras a visitor generated for themselves. Scoped to the session cookie, the
// same way conversations are — there are no accounts here.
db.exec(`
  CREATE TABLE IF NOT EXISTS custom_eras (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    label           TEXT NOT NULL,
    blurb           TEXT NOT NULL,
    hue             INTEGER NOT NULL,
    font            TEXT NOT NULL,
    met_department  TEXT,
    persona         TEXT NOT NULL,
    created_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_custom_eras_session
    ON custom_eras (session_id, created_at);
`);

// --- migrations -------------------------------------------------------------
// `CREATE TABLE IF NOT EXISTS` doesn't alter a table that already exists, so
// columns added after the first release need an explicit, idempotent step.
// Anyone running an older database gets upgraded in place on next start.

const messageColumns = new Set(
  db.prepare("PRAGMA table_info(messages)").all().map((c) => c.name),
);

if (!messageColumns.has("artifacts")) {
  db.exec("ALTER TABLE messages ADD COLUMN artifacts TEXT");
}

// Prepared once, reused for every call — this is why SQLite is fast here.
const stmt = {
  listConversations: db.prepare(`
    SELECT c.id, c.era, c.title, c.updated_at,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
    FROM conversations c
    WHERE c.session_id = ?
    ORDER BY c.updated_at DESC
    LIMIT 200
  `),
  getConversation: db.prepare(
    `SELECT id, era, title, created_at, updated_at
       FROM conversations WHERE id = ? AND session_id = ?`,
  ),
  createConversation: db.prepare(
    `INSERT INTO conversations (id, session_id, era, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  touchConversation: db.prepare(
    `UPDATE conversations SET updated_at = ? WHERE id = ?`,
  ),
  renameConversation: db.prepare(
    `UPDATE conversations SET title = ? WHERE id = ? AND session_id = ?`,
  ),
  deleteConversation: db.prepare(
    `DELETE FROM conversations WHERE id = ? AND session_id = ?`,
  ),
  getMessages: db.prepare(
    `SELECT id, role, content, artifacts, created_at FROM messages
      WHERE conversation_id = ? ORDER BY id ASC`,
  ),
  getMessage: db.prepare(
    `SELECT id, role, content FROM messages
      WHERE id = ? AND conversation_id = ?`,
  ),
  // Editing rewrites history from a point: the edited message and everything
  // after it goes. Scoping by conversation_id as well as id means a message
  // id from someone else's conversation matches nothing.
  deleteMessagesFrom: db.prepare(
    `DELETE FROM messages WHERE conversation_id = ? AND id >= ?`,
  ),
  addMessage: db.prepare(
    `INSERT INTO messages (conversation_id, role, content, artifacts, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ),
  setMessageArtifacts: db.prepare(
    `UPDATE messages SET artifacts = ? WHERE id = ?`,
  ),
  listCustomEras: db.prepare(
    `SELECT id, label, blurb, hue, font, met_department, persona
       FROM custom_eras WHERE session_id = ? ORDER BY created_at ASC LIMIT 40`,
  ),
  getCustomEra: db.prepare(
    `SELECT id, label, blurb, hue, font, met_department, persona
       FROM custom_eras WHERE id = ? AND session_id = ?`,
  ),
  createCustomEra: db.prepare(
    `INSERT INTO custom_eras
       (id, session_id, label, blurb, hue, font, met_department, persona, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  deleteCustomEra: db.prepare(
    `DELETE FROM custom_eras WHERE id = ? AND session_id = ?`,
  ),
  deleteLastAssistant: db.prepare(
    `DELETE FROM messages WHERE id = (
       SELECT id FROM messages
        WHERE conversation_id = ? AND role = 'assistant'
        ORDER BY id DESC LIMIT 1
     )`,
  ),
};

const now = () => Date.now();

export function listConversations(sessionId) {
  return stmt.listConversations.all(sessionId);
}

export function getConversation(id, sessionId) {
  return stmt.getConversation.get(id, sessionId);
}

export function createConversation(sessionId, era, title = "New conversation") {
  const id = crypto.randomUUID();
  const t = now();
  stmt.createConversation.run(id, sessionId, era, title, t, t);
  return { id, era, title, created_at: t, updated_at: t, message_count: 0 };
}

export function renameConversation(id, sessionId, title) {
  stmt.renameConversation.run(title, id, sessionId);
}

export function deleteConversation(id, sessionId) {
  stmt.deleteConversation.run(id, sessionId);
}

/** Artifacts are stored as a JSON string; callers get them back as an array. */
export function getMessages(conversationId) {
  return stmt.getMessages.all(conversationId).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
    artifacts: row.artifacts ? safeParse(row.artifacts) : [],
  }));
}

function safeParse(json) {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** Returns the new message's id, which the edit flow needs to address it. */
export function addMessage(conversationId, role, content, artifacts = null) {
  const { lastInsertRowid } = stmt.addMessage.run(
    conversationId,
    role,
    content,
    artifacts?.length ? JSON.stringify(artifacts) : null,
    now(),
  );
  stmt.touchConversation.run(now(), conversationId);
  return Number(lastInsertRowid);
}

/**
 * Attach artifacts to a message that is already stored.
 *
 * The reply is written and sent the moment the model finishes; the museum
 * lookup lands afterwards, so it updates the row rather than being part of the
 * insert. A conversation deleted in the meantime simply updates no rows.
 */
export function setMessageArtifacts(messageId, artifacts) {
  stmt.setMessageArtifacts.run(
    artifacts?.length ? JSON.stringify(artifacts) : null,
    messageId,
  );
}

/** One message, scoped to its conversation so ids can't be probed across them. */
export function getMessage(messageId, conversationId) {
  return stmt.getMessage.get(messageId, conversationId);
}

/**
 * Delete a message and every message after it.
 *
 * Truncating by id — not by role — is what makes editing safe. Consider
 * [u1, a1, u2] where u2's reply failed mid-stream: editing u2 removes only u2
 * and leaves a1 intact, because a1's id is lower. A "drop the last assistant"
 * approach would have eaten a1 instead. Message ids are AUTOINCREMENT, so they
 * are strictly increasing and never reused.
 */
export function deleteMessagesFrom(conversationId, messageId) {
  return stmt.deleteMessagesFrom.run(conversationId, messageId).changes;
}

/** Used by "regenerate": drop the last reply so it can be produced again. */
export function dropLastAssistantMessage(conversationId) {
  stmt.deleteLastAssistant.run(conversationId);
}

// --- custom eras ------------------------------------------------------------

export function listCustomEras(sessionId) {
  return stmt.listCustomEras.all(sessionId);
}

export function getCustomEra(id, sessionId) {
  return stmt.getCustomEra.get(id, sessionId);
}

export function createCustomEra(sessionId, era) {
  // The `custom_` prefix keeps generated ids in a namespace of their own, so
  // one can never shadow a built-in key like `rome`.
  const id = `custom_${crypto.randomUUID()}`;
  stmt.createCustomEra.run(
    id,
    sessionId,
    era.label,
    era.blurb,
    era.hue,
    era.font,
    era.met_department ?? null,
    era.persona,
    Date.now(),
  );
  return { id, ...era };
}

export function deleteCustomEra(id, sessionId) {
  return stmt.deleteCustomEra.run(id, sessionId).changes;
}

export { DB_PATH };
