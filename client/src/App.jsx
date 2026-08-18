import { useState, useEffect, useRef } from "react";
import Markdown from "./Markdown";

/**
 * Turn an SSE response body into a stream of parsed event objects.
 *
 * Kept outside the component because it has nothing to do with React — it is
 * pure transport. Network chunks do not line up with SSE event boundaries, so
 * anything after the last blank line is an incomplete event and goes back into
 * the buffer to wait for the rest.
 */
async function* readEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    // stream: true holds back multi-byte characters split across chunks.
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

export default function App() {
  const [eras, setEras] = useState([]);
  const [era, setEra] = useState("all");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  // The server owns conversation state; the client only needs the id.
  const [conversationId, setConversationId] = useState(null);

  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch("/api/eras")
      .then((r) => r.json())
      .then(setEras)
      .catch(() => setEras([]));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

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

  // Switching era starts a fresh conversation, because era is fixed at
  // creation time on the server and cannot change for an existing one.
  function chooseEra(id) {
    if (id === era) return;
    abortRef.current?.abort();
    setEra(id);
    setConversationId(null);
    setMessages([]);
  }

  async function send() {
    if (!input.trim() || busy) return;

    const text = input.trim();
    setInput("");
    setBusy(true);

    // User turn plus the empty placeholder the deltas will fill, in one render.
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Create the conversation on first send rather than on page load, so an
      // abandoned visit doesn't leave an empty row in the database.
      let id = conversationId;
      if (!id) {
        const created = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ era }),
          signal: controller.signal,
        });
        if (!created.ok) throw new Error(await errorText(created));
        id = (await created.json()).id;
        setConversationId(id);
      }

      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });

      // Only pre-stream failures land here: 404, 400, or 429 from the rate
      // limit. Once the stream is open the status is already 200, so failures
      // after that arrive as an error event instead.
      if (!res.ok) throw new Error(await errorText(res));

      for await (const evt of readEvents(res)) {
        switch (evt.type) {
          case "user":
            // The id of the stored user turn, needed later for Edit. It sits
            // one before the assistant placeholder.
            setMessages((prev) => {
              const next = [...prev];
              const i = next.length - 2;
              if (i >= 0) next[i] = { ...next[i], id: evt.id };
              return next;
            });
            break;

          case "delta":
            appendToLast(evt.text);
            break;

          case "done":
            // Release the composer here, NOT in finally. The stream stays open
            // past this point purely to deliver artifacts.
            setBusy(false);
            break;

          case "artifacts":
            patchLast({ artifacts: evt.artifacts });
            break;

          case "error":
            appendToLast(`\n\n${evt.error}`);
            setBusy(false);
            break;
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        appendToLast(`\n\n${err.message}`);
      }
    } finally {
      // A safety net for paths that never reached `done` — an abort, or a
      // failure before the stream opened.
      setBusy(false);
      abortRef.current = null;
    }
  }

 return (
  <div className="app">
    <aside className="rail">
      <div className="rail__head">
        <h1 className="brand">
          <span className="brand__name">Vestige</span>
          <span className="brand__tag">ask the past</span>
        </h1>
      </div>
    </aside>

    <main className="chat">
      <header className="chat__head">
        <div className="now">
          <span className="now__era">
            {eras.find((e) => e.id === era)?.label ?? "All History"}
          </span>
          <span className="now__title">New conversation</span>
        </div>
      </header>

      <div className="transcript">
        {messages.length === 0 ? (
          <div className="empty">
            <p className="empty__label">Era</p>
            <div className="era-picker">
              {eras.map((e) => (
                <div
                  key={e.id}
                  className="era-opt"
                  data-selected={String(e.id === era)}
                >
                  <button
                    type="button"
                    className="era-opt__choose"
                    onClick={() => chooseEra(e.id)}
                  >
                    <span className="era-opt__name">{e.label}</span>
                    <span className="era-opt__years">{e.blurb}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="msg msg--user">
                <div className="msg__bubble">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="msg msg--bot">
                <p className="msg__who">History</p>
                <div className="msg__body">
                  <Markdown text={m.content} />
                </div>
              </div>
            )
          )
        )}
        <div ref={bottomRef} />
      </div>

      <div className="composer-dock">
        <div className="composer">
          <input
            className="composer__input"
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !ev.nativeEvent.isComposing) send();
            }}
            placeholder="Ask a history question..."
          />
          <button
            type="button"
            className="composer__action"
            data-state={busy ? "abort" : "send"}
            aria-label={busy ? "Stop generating" : "Send"}
            onClick={busy ? () => abortRef.current?.abort() : send}
          >
            <svg className="composer__icon composer__icon--send" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <svg className="composer__icon composer__icon--abort" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </main>
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