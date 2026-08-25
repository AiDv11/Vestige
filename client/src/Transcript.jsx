import { useState, useEffect } from "react";
import Markdown from "./Markdown";

/**
 * The scrolling conversation view.
 *
 * Owns no state. The scroll container's ref belongs to App because the
 * autoscroll effect and the jump-to-latest button both need it, so it is
 * passed down rather than created here.
 */

const THINKING = {
  all: ["Consulting the archives", "Cross-referencing dates", "Checking the record"],
  rome: ["Consulting the annals", "Checking the Fasti", "Reading the inscriptions"],
  egypt: ["Reading the cartouches", "Checking the king lists", "Consulting the papyri"],
  medieval: ["Turning the manuscript", "Consulting the chronicles", "Checking the rolls"],
  islamic: ["Consulting the House of Wisdom", "Checking the star tables", "Reading the commentaries"],
  song: ["Setting the movable type", "Unrolling the scroll", "Consulting the gazetteer"],
};

export default function Transcript({
  scrollRef,
  onScroll,
  messages,
  eraLabel,
  era,
  waiting,
  empty,
  editingIndex,
  editText,
  onEditTextChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onCopy,
  onRegenerate,
  onRetry,
}) {
  return (
    /*
      Deliberately NOT aria-live. The reply is rewritten on every streamed
      token, so a live region here would re-announce the whole answer hundreds
      of times. The finished reply is announced once, from the polite region at
      the end of App instead.
    */
    <div
      className="transcript"
      ref={scrollRef}
      role="log"
      aria-label="Conversation"
      onScroll={onScroll}
    >
      {messages.length === 0
        ? empty
        : messages.map((m, i) => {
            if (m.role === "user") {
              return (
                <UserMessage
                  key={i}
                  message={m}
                  editing={editingIndex === i}
                  editText={editText}
                  onEditTextChange={onEditTextChange}
                  onStartEdit={() => onStartEdit(i)}
                  onCancelEdit={onCancelEdit}
                  onSubmitEdit={() => onSubmitEdit(i)}
                />
              );
            }

            if (m.role === "error") {
              return <ErrorMessage key={i} message={m} onRetry={onRetry} />;
            }

            return (
              <BotMessage
                key={i}
                message={m}
                eraLabel={eraLabel}
                onCopy={() => onCopy(m.content)}
                onRegenerate={onRegenerate}
              />
            );
          })}

      {waiting && <Thinking era={era} />}
    </div>
  );
}

function UserMessage({
  message,
  editing,
  editText,
  onEditTextChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
}) {
  return (
    <div className="msg msg--user">
      {editing ? (
        <>
          {/*
            Unlike the sidebar rename, this does NOT save on blur. Submitting
            rewrites the conversation from this point and discards every later
            turn, so it takes an explicit Enter or Save.
          */}
          <textarea
            className="msg__edit"
            value={editText}
            autoFocus
            aria-label="Edit your message"
            onChange={(ev) => onEditTextChange(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !ev.shiftKey) {
                ev.preventDefault();
                onSubmitEdit();
              } else if (ev.key === "Escape") {
                ev.preventDefault();
                onCancelEdit();
              }
            }}
          />
          <div className="msg__edit-actions">
            <button type="button" className="act" onClick={onCancelEdit}>
              Cancel
            </button>
            <button
              type="button"
              className="act act--primary"
              onClick={onSubmitEdit}
            >
              Save &amp; resend
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="msg__bubble">{message.content}</div>
          <div className="msg__actions">
            <button type="button" className="act" onClick={onStartEdit}>
              Edit
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function BotMessage({ message, eraLabel, onCopy, onRegenerate }) {
  return (
    <div className="msg msg--bot">
      <p className="msg__who">{eraLabel}</p>
      <div className="msg__body">
        <Markdown text={message.content} />
      </div>

      {message.artifacts?.length > 0 && <Artifacts items={message.artifacts} />}

      <div className="msg__actions">
        <button type="button" className="act" onClick={onCopy}>
          Copy
        </button>
        <button type="button" className="act" onClick={onRegenerate}>
          Regenerate
        </button>
      </div>
    </div>
  );
}

/** Without a retry an error is a dead end — the question is already stored
 *  server-side, so trying again costs the user a click. */
function ErrorMessage({ message, onRetry }) {
  return (
    <div className="msg msg--error" role="alert">
      <span>{message.content}</span>
      <button type="button" className="act" onClick={onRetry}>
        Try again
      </button>
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
      {/* key={i} restarts the fade animation on each line change. */}
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