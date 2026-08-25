import { useEffect, useRef } from "react";

/**
 * The ⋯ menu for a conversation row.
 *
 * Lives at App level and is positioned with `fixed`, because the sidebar
 * scrolls — a menu positioned inside the row would be clipped by it.
 *
 * `menu` state stays in App (it holds which conversation and where). What
 * moved in here is the focus plumbing: a ref and an arrow-key handler, which
 * are DOM mechanics rather than application state.
 */
export default function RowMenu({ top, left, onRename, onDelete, onClose }) {
  const ref = useRef(null);

  // Opening the menu moves focus into it, so it can be driven entirely from
  // the keyboard.
  useEffect(() => {
    ref.current?.querySelector(".menu__item")?.focus();
  }, []);

  function onKeyDown(ev) {
    const items = [...(ref.current?.querySelectorAll(".menu__item") ?? [])];
    const i = items.indexOf(document.activeElement);

    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const step = ev.key === "ArrowDown" ? 1 : -1;
      // Wraps at both ends, so holding an arrow key never dead-ends.
      items[(i + step + items.length) % items.length]?.focus();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="menu"
      role="menu"
      ref={ref}
      style={{ top, left }}
      // The document-level dismiss listener in App would otherwise close the
      // menu the moment you click an item inside it.
      onClick={(ev) => ev.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="menu__item"
        role="menuitem"
        onClick={onRename}
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
        onClick={onDelete}
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
  );
}