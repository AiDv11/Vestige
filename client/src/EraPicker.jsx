/**
 * The era grid on the empty screen, including the "Add era" form.
 *
 * Stateless by design: every value it renders and every flag it toggles lives
 * in App, so there is exactly one place to look when asking "what is the
 * current era" or "is the add-era form open".
 */

/** The hue was range-checked server-side; re-normalise anyway, because it is
 *  about to be interpolated into a CSS colour. */
function hueOf(era) {
  return ((Number(era.hue) % 360) + 360) % 360 || 0;
}

export default function EraPicker({
  eras,
  selected,
  onChoose,
  onHover,
  onRemove,
  adding,
  onStartAdd,
  onCancelAdd,
  name,
  onNameChange,
  onSubmit,
  creating,
  note,
}) {
  return (
    <div className="era-picker">
      {eras.map((e) => (
        <div
          key={e.id}
          className={e.custom ? "era-opt era-opt--custom" : "era-opt"}
          // Each card carries its own colour so hover-previewing one era
          // doesn't recolour the card that's actually selected.
          data-era={e.id}
          data-selected={String(e.id === selected)}
          style={
            e.custom
              ? { "--era-accent": `oklch(0.66 0.15 ${hueOf(e)})` }
              : undefined
          }
          onPointerEnter={() => onHover(e.id)}
          onPointerLeave={() => onHover(null)}
        >
          <button
            type="button"
            className="era-opt__choose"
            aria-pressed={e.id === selected}
            onClick={() => onChoose(e.id)}
          >
            <span className="era-opt__name">
              {e.custom && (
                <span
                  className="era-opt__dot"
                  aria-hidden="true"
                  style={{ "--era-dot": `oklch(0.66 0.15 ${hueOf(e)})` }}
                />
              )}
              {e.label}
            </span>
            <span className="era-opt__years">{e.blurb}</span>
            {/* The Met has no department for every period; when none fitted,
                the era ships with artifacts off and says so. */}
            {e.custom && !e.hasArtifacts && (
              <span className="era-opt__noart">no museum objects</span>
            )}
          </button>

          {e.custom && (
            <button
              type="button"
              className="era-opt__remove"
              aria-label={`Delete the ${e.label} era`}
              onClick={() => onRemove(e)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      ))}

      {adding ? (
        <>
          <form className="era-new" onSubmit={onSubmit}>
            <input
              className="era-new__input"
              type="text"
              maxLength={60}
              autoComplete="off"
              autoFocus
              disabled={creating}
              placeholder="Name a period — e.g. the Mongol Empire"
              aria-label="Name a historical period"
              value={name}
              onChange={(ev) => onNameChange(ev.target.value)}
            />
            <button type="submit" className="act act--primary" disabled={creating}>
              Create
            </button>
            <button type="button" className="act" onClick={onCancelAdd}>
              Cancel
            </button>
          </form>
          {note && (
            <p
              className={
                note.error ? "era-new__note era-new__note--error" : "era-new__note"
              }
              role={note.error ? "alert" : "status"}
            >
              {note.text}
            </p>
          )}
        </>
      ) : (
        <button type="button" className="era-add" onClick={onStartAdd}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Add era
        </button>
      )}
    </div>
  );
}