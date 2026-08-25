import { useState, useEffect, useRef } from "react";
import Markdown from "./Markdown";
import { useEra } from "./useEra";
import Composer from "./Composer";
import EraPicker from "./EraPicker";

/**
 * Turn an SSE response body into a stream of parsed event objects.
 *
 * Pure transport, so it lives outside the component. Network chunks do not
 * line up with SSE event boundaries: anything after the last blank line is an
 * incomplete event and goes back into the buffer to wait for the rest.
 */
async function* readEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop();

    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(5).trim());
      } catch {
        // A malformed frame is not worth killing the stream over.
      }
    }
  }
}

const THINKING = {
  all: ["Consulting the archives", "Cross-referencing dates", "Checking the record"],
  rome: ["Consulting the annals", "Checking the Fasti", "Reading the inscriptions"],
  egypt: ["Reading the cartouches", "Checking the king lists", "Consulting the papyri"],
  medieval: ["Turning the manuscript", "Consulting the chronicles", "Checking the rolls"],
  islamic: ["Consulting the House of Wisdom", "Checking the star tables", "Reading the commentaries"],
  song: ["Setting the movable type", "Unrolling the scroll", "Consulting the gazetteer"],
};

const STARTERS = {
  all: [
    "What caused the Bronze Age collapse?",
    "How did the printing press change Europe?",
    "Who was Mansa Musa?",
  ],
  rome: [
    "Why did the Republic fall?",
    "What was the cursus honorum?",
    "How did a legion actually fight?",
  ],
  egypt: [
    "How were the pyramids built?",
    "Who was Hatshepsut?",
    "What did the Book of the Dead do?",
  ],
  medieval: [
    "Was medieval medicine really useless?",
    "What triggered the First Crusade?",
    "How did the Black Death change society?",
  ],
  islamic: [
    "Who was Al-Khwarizmi?",
    "What was the House of Wisdom?",
    "How did Ibn al-Haytham study light?",
  ],
  song: [
    "How did movable type actually work?",
    "Why did Song China invent paper money?",
    "What was the examination system?",
  ],
};

/** Same buckets the vanilla sidebar used. */
function groupOf(ts) {
  const day = 86_400_000;
  const midnight = new Date().setHours(0, 0, 0, 0);
  if (ts >= midnight) return "Today";
  if (ts >= midnight - day) return "Yesterday";
  if (ts >= midnight - day * 7) return "Previous 7 days";
  return "Older";
}

function groupConversations(list) {
  const groups = new Map();
  for (const c of list) {
    const key = groupOf(c.updated_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups];
}

export default function App() {
  const [eras, setEras] = useState([]);
  const [era, setEra] = useState("all");
  const [hoverEra, setHoverEra] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  // The one thing screen readers are told about, once per finished reply.
  const [announcement, setAnnouncement] = useState("");

  // UI-only state.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [menu, setMenu] = useState(null); // { conversation, top, left, trigger }
  const [renamingId, setRenamingId] = useState(null);
  const [renameText, setRenameText] = useState("");
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState("");
  const [addingEra, setAddingEra] = useState(false);
  const [eraName, setEraName] = useState("");
  const [eraNote, setEraNote] = useState(null); // { text, error }
  const [creatingEra, setCreatingEra] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const abortRef = useRef(null);
  const transcriptRef = useRef(null);
  const dialogRef = useRef(null);
  const menuRef = useRef(null);

  // Escape during a rename must cancel, not save. The input's blur handler
  // fires as it unmounts, so without this flag Escape would still commit.
  const renameCancelled = useRef(false);

  // Hovering an era previews it; otherwise the selected era themes the page.
  useEra(eras, hoverEra ?? era);

  useEffect(() => {
    fetch("/api/eras")
      .then((r) => r.json())
      .then(setEras)
      .catch(() => setEras([]));
    refreshConversations();
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the newest message in view, but never yank the view back down while
  // the user is deliberately scrolled up reading something earlier.
  useEffect(() => {
    if (!atBottom) return;
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, atBottom]);

  // The native <dialog> gives Escape and focus trapping for free.
  useEffect(() => {
    if (confirmTarget) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [confirmTarget]);

  // Opening the row menu moves focus into it, so it can be driven entirely
  // from the keyboard.
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector(".menu__item")?.focus();
  }, [menu]);

  // A fixed-position menu doesn't follow its button, so dismiss it rather than
  // letting it drift away from the row it belongs to. Focus is NOT restored
  // here — the user clicked or scrolled elsewhere deliberately.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("click", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("click", close);
    };
  }, [menu]);

  // Escape closes the mobile drawer. The menu and dialog handle their own.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  function refreshConversations() {
    return fetch("/api/conversations")
      .then((r) => r.json())
      .then(setConversations)
      .catch(() => {});
  }

  // ---- message helpers ----------------------------------------------------
  // Always the updater form: `prev` is current, while a captured `messages`
  // would be a stale snapshot from the render the stream started in.

  function appendToLast(text) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, content: last.content + text };
      return next;
    });
  }

  function patchLast(fields) {
    setMessages((prev) => {
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], ...fields };
      return next;
    });
  }

  /**
   * Errors get their own bubble with a retry, not text dumped into the reply.
   * A placeholder that never received a token is dropped; partial text is
   * kept, because the server stored it and the user watched it appear.
   */
  function showError(message) {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant" && !last.content) next.pop();
      return [...next, { role: "error", content: message }];
    });
  }

  // ---- streaming ----------------------------------------------------------

  /**
   * Shared by send, edit and regenerate — all three POST a request that
   * replies with an SSE stream. The caller sets up the message list first;
   * this only reads the stream into it.
   */
  async function runStream(url, payload) {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    // Accumulated locally so the finished reply can be announced in one piece.
    let full = "";

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      // Only pre-stream failures land here: 404, 400, or 429 from the rate
      // limit. Once the stream is open the status is already 200, so failures
      // after that arrive as an error event instead.
      if (!res.ok) throw new Error(await errorText(res));

      for await (const evt of readEvents(res)) {
        switch (evt.type) {
          case "user":
            // The id of the stored user turn, needed for Edit. It sits one
            // before the assistant placeholder.
            setMessages((prev) => {
              const next = [...prev];
              const i = next.length - 2;
              if (i >= 0) next[i] = { ...next[i], id: evt.id };
              return next;
            });
            break;

          case "delta":
            full += evt.text;
            appendToLast(evt.text);
            break;

          case "done":
            // Release the composer here, NOT in finally. The stream stays open
            // past this point purely to deliver artifacts.
            setBusy(false);
            // Announce the finished reply once. The transcript itself is not a
            // live region, precisely so this isn't said on every token.
            setAnnouncement(full);
            // The server renames the conversation from its opening question,
            // so re-reading the list is enough to pick the new title up.
            if (evt.title) refreshConversations();
            break;

          case "artifacts":
            patchLast({ artifacts: evt.artifacts });
            break;

          case "error":
            showError(evt.error);
            setBusy(false);
            break;
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") showError(err.message);
    } finally {
      // A safety net for paths that never reached `done` — an abort, or a
      // failure before the stream opened.
      setBusy(false);
      abortRef.current = null;
      refreshConversations();
    }
  }

  async function send(textArg) {
    const text = String(textArg ?? input).trim();
    if (!text || busy) return;

    setInput("");
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);

    // Create the conversation on first send rather than on page load, so an
    // abandoned visit doesn't leave an empty row in the database.
    let id = conversationId;
    if (!id) {
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ era }),
        });
        if (!res.ok) throw new Error(await errorText(res));
        id = (await res.json()).id;
        setConversationId(id);
      } catch (err) {
        showError(err.message);
        setBusy(false);
        return;
      }
    }

    await runStream(`/api/conversations/${id}/messages`, { message: text });
  }

  /**
   * Ask for a fresh reply.
   *
   * Used two ways: the Regenerate button, which discards the reply on screen
   * first, and Try again after an error, where there is no reply to discard —
   * the server endpoint only drops a stored reply if one is actually last.
   */
  async function regenerate({ dropLocalReply = true } = {}) {
    if (busy || !conversationId) return;

    setMessages((prev) => {
      const next = [...prev];
      // Any trailing error bubble is being replaced by this attempt.
      while (next.length && next[next.length - 1].role === "error") next.pop();
      if (dropLocalReply && next[next.length - 1]?.role === "assistant") next.pop();
      return [...next, { role: "assistant", content: "" }];
    });

    await runStream(`/api/conversations/${conversationId}/regenerate`, {});
  }

  /**
   * Editing rewrites history: the edited message and everything after it is
   * replaced, then the reply is streamed again from that point.
   */
  async function submitEdit(index) {
    const target = messages[index];
    const text = editText.trim();

    setEditingIndex(null);
    if (!text || !target?.id || !conversationId || busy) return;
    if (text === target.content) return;

    setMessages((prev) => [
      ...prev.slice(0, index),
      { role: "user", content: text, id: target.id },
      { role: "assistant", content: "" },
    ]);

    await runStream(
      `/api/conversations/${conversationId}/messages/${target.id}`,
      { message: text },
    );
  }

  // ---- conversations ------------------------------------------------------

  function startNewChat() {
    if (busy) return;
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setDrawerOpen(false);
  }

  async function openConversation(id) {
    if (busy) return;
    abortRef.current?.abort();

    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;

    const { conversation, messages: stored } = await res.json();
    setConversationId(conversation.id);
    setEra(conversation.era);
    setMessages(stored);
    setDrawerOpen(false);
    setAtBottom(true);
  }

  function startRename(conversation) {
    renameCancelled.current = false;
    setRenameText(conversation.title);
    setRenamingId(conversation.id);
  }

  async function commitRename(conversation) {
    if (renameCancelled.current) return;

    const title = renameText.trim().slice(0, 60);
    setRenamingId(null);
    if (!title || title === conversation.title) return;

    // Show it immediately; put the old title back if the server disagrees.
    setConversations((prev) =>
      prev.map((c) => (c.id === conversation.id ? { ...c, title } : c)),
    );

    const res = await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    if (!res.ok) {
      setToast("Couldn't rename that");
      refreshConversations();
    }
  }

  async function deleteConversation(conversation) {
    setConfirmTarget(null);

    const res = await fetch(`/api/conversations/${conversation.id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      setToast("Couldn't delete that");
      return;
    }

    setConversations((prev) => prev.filter((c) => c.id !== conversation.id));
    setToast("Conversation deleted");
    if (conversation.id === conversationId) startNewChat();
  }

  // ---- row menu -----------------------------------------------------------

  function closeMenu({ restoreFocus = true } = {}) {
    const trigger = menu?.trigger;
    setMenu(null);
    if (restoreFocus) trigger?.focus();
  }

  function onMenuKeyDown(ev) {
    const items = [...(menuRef.current?.querySelectorAll(".menu__item") ?? [])];
    const i = items.indexOf(document.activeElement);

    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const step = ev.key === "ArrowDown" ? 1 : -1;
      items[(i + step + items.length) % items.length]?.focus();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeMenu();
    }
  }

  // ---- eras ---------------------------------------------------------------

  function chooseEra(id) {
    if (id === era) return;
    abortRef.current?.abort();
    setEra(id);
    setConversationId(null);
    setMessages([]);
  }

  async function createEra(e) {
    e.preventDefault();
    const name = eraName.trim();
    if (!name || creatingEra) return;

    setCreatingEra(true);
    setEraNote({ text: "Building the era — this takes a few seconds…" });

    try {
      const res = await fetch("/api/eras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await errorText(res));

      const created = await res.json();
      setEras((prev) => [...prev, created]);
      chooseEra(created.id);
      setAddingEra(false);
      setEraName("");
      setEraNote(null);
      setToast(`${created.label} added`);
    } catch (err) {
      setEraNote({ text: err.message, error: true });
    } finally {
      setCreatingEra(false);
    }
  }

  async function removeEra(target) {
    const res = await fetch(`/api/eras/${target.id}`, { method: "DELETE" });
    if (!res.ok) {
      setToast("Couldn't delete that era");
      return;
    }

    setEras((prev) => prev.filter((e) => e.id !== target.id));
    // Conversations that used it still open: the server falls back to the
    // default era for a key that no longer exists.
    if (era === target.id) chooseEra("all");
    setToast(`${target.label} deleted`);
  }

  // ---- derived ------------------------------------------------------------

  const currentEra = eras.find((e) => e.id === era);
  const currentTitle =
    conversations.find((c) => c.id === conversationId)?.title ??
    "New conversation";
  const starters = STARTERS[era] ?? [];

  // So several open tabs are tellable apart.
  useEffect(() => {
    document.title = conversationId
      ? `${currentTitle} — Vestige`
      : "Vestige — ask the past";
  }, [conversationId, currentTitle]);

  // The indicator belongs to the gap between "sent" and "first token", which
  // is exactly an empty assistant turn at the end of the list.
  const waiting =
    busy &&
    messages[messages.length - 1]?.role === "assistant" &&
    messages[messages.length - 1]?.content === "";

  function onTranscriptScroll(e) {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    setAtBottom(scrollHeight - scrollTop - clientHeight < 120);
  }

  function jumpToBottom() {
  setAtBottom(true);
  const el = transcriptRef.current;
  if (el) el.scrollTop = el.scrollHeight;
  }

  return (
    <div className="app" data-open={String(drawerOpen)}>
      <aside className="rail">
        <div className="rail__head">
          <h1 className="brand">
            <svg className="brand__mark" aria-hidden="true" focusable="false">
              <use href="#vestige-mark" />
            </svg>
            <span className="brand__name">Vestige</span>
            <span className="brand__tag">ask the past</span>
          </h1>
        </div>

        <button type="button" className="new-chat" onClick={startNewChat}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          New chat
        </button>

        <nav className="convos" aria-label="Your conversations">
          {conversations.length === 0 ? (
            <p className="convos__empty">No conversations yet.</p>
          ) : (
            groupConversations(conversations).map(([label, items]) => (
              <section key={label} className="convo-group">
                <p className="convo-group__label">{label}</p>
                {items.map((c) => (
                  <div
                    key={c.id}
                    className="convo"
                    data-era={c.era}
                    data-menu-open={menu?.conversation.id === c.id ? "true" : undefined}
                    aria-current={String(c.id === conversationId)}
                  >
                    {renamingId === c.id ? (
                      <input
                        className="convo__rename"
                        value={renameText}
                        maxLength={60}
                        autoFocus
                        aria-label="Conversation name"
                        onChange={(ev) => setRenameText(ev.target.value)}
                        onBlur={() => commitRename(c)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            ev.preventDefault();
                            commitRename(c);
                          } else if (ev.key === "Escape") {
                            ev.preventDefault();
                            // Set before the state change: unmounting the input
                            // fires onBlur, which would otherwise save.
                            renameCancelled.current = true;
                            setRenamingId(null);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="convo__open"
                        title={c.title}
                        onClick={() => openConversation(c.id)}
                      >
                        <span className="convo__dot" aria-hidden="true" />
                        <span className="convo__title">{c.title}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="convo__more"
                      aria-haspopup="menu"
                      aria-expanded={menu?.conversation.id === c.id}
                      aria-label={`Options for ${c.title}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (menu?.conversation.id === c.id) return closeMenu();
                        const trigger = ev.currentTarget;
                        const r = trigger.getBoundingClientRect();
                        setMenu({
                          conversation: c,
                          top: r.bottom + 6,
                          left: Math.max(6, r.right - 160),
                          trigger,
                        });
                      }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <circle cx="5" cy="12" r="1.6" fill="currentColor" />
                        <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                        <circle cx="19" cy="12" r="1.6" fill="currentColor" />
                      </svg>
                    </button>
                  </div>
                ))}
              </section>
            ))
          )}
        </nav>

        <div className="rail__foot">
          <p className="caveat">
            Answers are generated and may be wrong. Check anything that matters.
          </p>
        </div>
      </aside>

      {drawerOpen && (
        <button
          type="button"
          className="scrim"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <main className="chat">
        <header className="chat__head">
          <button
            type="button"
            className="icon-btn chat__menu"
            aria-label="Show conversations"
            onClick={() => setDrawerOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="now">
            <span className="now__era">{currentEra?.label ?? "All History"}</span>
            <span className="now__title">{currentTitle}</span>
          </div>
        </header>

        {/*
          Deliberately NOT aria-live. The reply is rewritten on every streamed
          token, so a live region here would re-announce the whole answer
          hundreds of times. The finished reply is announced once, via the
          polite region at the end of the document instead.
        */}
        <div
          className="transcript"
          ref={transcriptRef}
          role="log"
          aria-label="Conversation"
          onScroll={onTranscriptScroll}
        >
          {messages.length === 0 ? (
            <div className="empty">
              <div className="empty__brand">
                <svg className="empty__mark" aria-hidden="true" focusable="false">
                  <use href="#vestige-mark" />
                </svg>
                <h2 className="empty__name">Vestige</h2>
                <span className="empty__tag">ask the past</span>
              </div>

              <p className="empty__sub">
                Pick an era and the assistant takes on that period's expertise.
                Follow-up questions keep their context.
              </p>

              <p className="empty__label">Era</p>

              <EraPicker
                  eras={eras}
                  selected={era}
                  onChoose={chooseEra}
                  onHover={setHoverEra}
                  onRemove={removeEra}
                  adding={addingEra}
                  onStartAdd={() => setAddingEra(true)}
                  onCancelAdd={() => {
                    setAddingEra(false);
                    setEraNote(null);
                  }}
                  name={eraName}
                  onNameChange={setEraName}
                  onSubmit={createEra}
                  creating={creatingEra}
                  note={eraNote}
                />

              {starters.length > 0 && (
                <>
                  <p className="empty__label">Try one</p>
                  <div className="starters">
                    {starters.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className="starter"
                        onClick={() => send(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            messages.map((m, i) => {
              if (m.role === "user") {
                return (
                  <div key={i} className="msg msg--user">
                    {editingIndex === i ? (
                      <>
                        <textarea
                          className="msg__edit"
                          value={editText}
                          autoFocus
                          aria-label="Edit your message"
                          onChange={(ev) => setEditText(ev.target.value)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" && !ev.shiftKey) {
                              ev.preventDefault();
                              submitEdit(i);
                            } else if (ev.key === "Escape") {
                              ev.preventDefault();
                              setEditingIndex(null);
                            }
                          }}
                        />
                        <div className="msg__edit-actions">
                          <button
                            type="button"
                            className="act"
                            onClick={() => setEditingIndex(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="act act--primary"
                            onClick={() => submitEdit(i)}
                          >
                            Save &amp; resend
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="msg__bubble">{m.content}</div>
                        <div className="msg__actions">
                          <button
                            type="button"
                            className="act"
                            onClick={() => {
                              // The id arrives from the stream slightly after
                              // the message appears, so it can briefly be
                              // missing.
                              if (!m.id) {
                                return setToast("Still saving — try again in a moment");
                              }
                              setEditingIndex(i);
                              setEditText(m.content);
                            }}
                          >
                            Edit
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              }

              if (m.role === "error") {
                // Without a retry an error is a dead end — the question is
                // already stored server-side, so trying again costs a click.
                return (
                  <div key={i} className="msg msg--error" role="alert">
                    <span>{m.content}</span>
                    <button
                      type="button"
                      className="act"
                      onClick={() => regenerate({ dropLocalReply: false })}
                    >
                      Try again
                    </button>
                  </div>
                );
              }

              return (
                <div key={i} className="msg msg--bot">
                  <p className="msg__who">{currentEra?.label ?? "History"}</p>
                  <div className="msg__body">
                    <Markdown text={m.content} />
                  </div>

                  {m.artifacts?.length > 0 && <Artifacts items={m.artifacts} />}

                  <div className="msg__actions">
                    <button
                      type="button"
                      className="act"
                      onClick={async () => {
                        await navigator.clipboard.writeText(m.content);
                        setToast("Copied");
                      }}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="act"
                      onClick={() => regenerate()}
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {waiting && <Thinking era={era} />}
        </div>

                  <Composer
          input={input}
          onInputChange={setInput}
          onSend={() => send()}
          onStop={() => abortRef.current?.abort()}
          busy={busy}
          showJump={!atBottom && messages.length > 0}
          onJump={jumpToBottom}
        />


      </main>

      {menu && (
        <div
          className="menu"
          role="menu"
          ref={menuRef}
          style={{ top: menu.top, left: menu.left }}
          onClick={(ev) => ev.stopPropagation()}
          onKeyDown={onMenuKeyDown}
        >
          <button
            type="button"
            className="menu__item"
            role="menuitem"
            onClick={() => {
              const c = menu.conversation;
              closeMenu({ restoreFocus: false });
              startRename(c);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Rename
          </button>
          <button
            type="button"
            className="menu__item menu__item--danger"
            role="menuitem"
            onClick={() => {
              const c = menu.conversation;
              closeMenu({ restoreFocus: false });
              setConfirmTarget(c);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Delete
          </button>
        </div>
      )}

      <dialog
        className="confirm"
        ref={dialogRef}
        onClose={() => setConfirmTarget(null)}
      >
        <h2 className="confirm__title">Delete this conversation?</h2>
        <p className="confirm__body">
          <strong>{confirmTarget?.title}</strong> and all its messages will be
          permanently removed. This can't be undone.
        </p>
        <div className="confirm__actions">
          <button
            type="button"
            className="btn"
            onClick={() => setConfirmTarget(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => deleteConversation(confirmTarget)}
          >
            Delete
          </button>
        </div>
      </dialog>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {/*
        Announces one finished reply at a time to screen readers. Kept out of
        the transcript on purpose — see the comment on .transcript above.
      */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}

/** Era-flavoured waiting text, cycling while the model composes. */
function Thinking({ era }) {
  const lines = THINKING[era] ?? THINKING.all;
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 2400);
    return () => clearInterval(t);
  }, [lines.length]);

  return (
    <div className="thinking">
      <span className="thinking__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="thinking__text" key={i}>
        {lines[i]}…
      </span>
    </div>
  );
}

/**
 * Real objects from the Met, shown as evidence under an answer.
 *
 * Museum fields are third-party text and get the same treatment as model
 * output: rendered as text nodes, never as markup.
 */
function Artifacts({ items }) {
  return (
    <div className="relics">
      <p className="relics__label">From the Met Museum collection</p>
      <div className="relics__row">
        {items.map((item, i) => (
          <a
            key={i}
            className="relic"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            title={[item.title, item.date, item.culture, item.credit]
              .filter(Boolean)
              .join(" · ")}
          >
            <div className="relic__frame">
              <img
                src={item.image}
                alt={item.title}
                loading="lazy"
                decoding="async"
                // Dead image URLs happen in a collection this size; fade the
                // frame rather than showing a torn-image icon.
                onError={(e) => {
                  e.currentTarget.dataset.broken = "true";
                }}
              />
            </div>
            <span className="relic__title">{item.title}</span>
            <span className="relic__date">{item.date}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Your error routes all reply with { error }. Fall back to the status code. */
async function errorText(res) {
  try {
    const body = await res.json();
    return body.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}