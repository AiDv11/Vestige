/**
 * The left rail: brand, new chat, and the grouped conversation list.
 *
 * Renders the ⋯ trigger but not the menu itself — the menu is
 * position: fixed at the App level, because the sidebar scrolls and an
 * absolutely positioned menu inside it would be clipped.
 */

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

export default function Sidebar({
  conversations,
  currentId,
  onOpen,
  onNewChat,
  openMenuId,
  onOpenMenu,
  renamingId,
  renameText,
  onRenameTextChange,
  onCommitRename,
  onCancelRename,
}) {
  return (
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

      <button type="button" className="new-chat" onClick={onNewChat}>
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
                <ConversationRow
                  key={c.id}
                  conversation={c}
                  isCurrent={c.id === currentId}
                  menuOpen={openMenuId === c.id}
                  onOpen={() => onOpen(c.id)}
                  onOpenMenu={onOpenMenu}
                  renaming={renamingId === c.id}
                  renameText={renameText}
                  onRenameTextChange={onRenameTextChange}
                  onCommitRename={() => onCommitRename(c)}
                  onCancelRename={onCancelRename}
                />
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
  );
}

/**
 * A row, not a button — it contains its own ⋯ button, and nesting buttons is
 * invalid HTML and breaks keyboard behaviour.
 */
function ConversationRow({
  conversation: c,
  isCurrent,
  menuOpen,
  onOpen,
  onOpenMenu,
  renaming,
  renameText,
  onRenameTextChange,
  onCommitRename,
  onCancelRename,
}) {
  return (
    <div
      className="convo"
      data-era={c.era}
      data-menu-open={menuOpen ? "true" : undefined}
      aria-current={String(isCurrent)}
    >
      {renaming ? (
        // Renaming saves on blur, unlike message editing — a title is cheap
        // to change back, a rewritten conversation is not.
        <input
          className="convo__rename"
          value={renameText}
          maxLength={60}
          autoFocus
          aria-label="Conversation name"
          onChange={(ev) => onRenameTextChange(ev.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              ev.preventDefault();
              onCommitRename();
            } else if (ev.key === "Escape") {
              ev.preventDefault();
              onCancelRename();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="convo__open"
          title={c.title}
          onClick={onOpen}
        >
          {/* Era is signalled by a dot AND the tooltip — never colour alone. */}
          <span className="convo__dot" aria-hidden="true" />
          <span className="convo__title">{c.title}</span>
        </button>
      )}

      <button
        type="button"
        className="convo__more"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Options for ${c.title}`}
        onClick={(ev) => {
          // Without this the document-level click listener that dismisses the
          // menu would fire immediately and close what we just opened.
          ev.stopPropagation();
          onOpenMenu(c, ev.currentTarget);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="5" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}