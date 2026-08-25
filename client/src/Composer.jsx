/**
 * The composer dock: the jump-to-latest button and the input row.
 *
 * Holds no state of its own. `input` lives in App because `send()` reads it,
 * and the abort controller lives in App because the stream does — this
 * component only reports clicks and keystrokes upward.
 */
export default function Composer({
  input,
  onInputChange,
  onSend,
  onStop,
  busy,
  showJump,
  onJump,
}) {
  return (
    <div className="composer-dock">
      {showJump && (
        <button type="button" className="to-bottom" onClick={onJump}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M12 5v14M6 13l6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Latest
        </button>
      )}

      <div className="composer">
        <label className="sr-only" htmlFor="prompt">
          Ask a history question
        </label>
        <textarea
          id="prompt"
          className="composer__input"
          rows={1}
          value={input}
          onChange={(ev) => onInputChange(ev.target.value)}
          onKeyDown={(ev) => {
            // isComposing guards IME input: pressing Enter to confirm a
            // candidate must not send the message.
            if (
              ev.key === "Enter" &&
              !ev.shiftKey &&
              !ev.nativeEvent.isComposing
            ) {
              ev.preventDefault();
              onSend();
            }
          }}
          placeholder="Ask a history question…"
          autoComplete="off"
        />

        {/*
          One control, two states. Keeping the same element across states
          preserves keyboard focus, and makes "both visible at once"
          unexpressible — see the note in public/index.html.
        */}
        <button
          type="button"
          className="composer__action"
          data-state={busy ? "abort" : "send"}
          aria-label={busy ? "Stop generating" : "Send"}
          onClick={busy ? onStop : onSend}
        >
          <svg
            className="composer__icon composer__icon--send"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M5 12h13m0 0-5.5-5.5M18 12l-5.5 5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <svg
            className="composer__icon composer__icon--abort"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}