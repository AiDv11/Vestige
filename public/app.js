// ===========================================================================
// VESTIGE — client
// The server owns storage and the model; this file owns what's on screen.
// ===========================================================================

const $ = (sel) => document.querySelector(sel);

const els = {
  app: $("[data-app]"),
  rail: $("[data-rail]"),
  scrim: $("[data-scrim]"),
  menu: $("[data-menu]"),
  newChat: $("[data-new]"),
  convos: $("[data-convos]"),
  eraLabel: $("[data-era-label]"),
  convoTitle: $("[data-convo-title]"),
  transcript: $("[data-transcript]"),
  form: $("[data-form]"),
  input: $("[data-input]"),
  action: $("[data-action]"),
  toBottom: $("[data-to-bottom]"),
  announcer: $("[data-announcer]"),
  menuPop: $("[data-menu-pop]"),
  confirm: $("[data-confirm]"),
  confirmName: $("[data-confirm-name]"),
  confirmOk: $("[data-confirm-ok]"),
  confirmCancel: $("[data-confirm-cancel]"),
};

// The typeface whitelist, mirroring lib/eras.js. A custom era stores a KEY
// from this map, never a font name — the `spec` becomes a stylesheet URL, so
// free text here would be an injection point.
const FONT_CHOICES = {
  cormorant: { family: "Cormorant Garamond", spec: "Cormorant+Garamond:wght@700" },
  slab: { family: "Zilla Slab", spec: "Zilla+Slab:wght@600" },
  cardo: { family: "Cardo", spec: "Cardo:wght@700" },
  amiri: { family: "Amiri", spec: "Amiri:wght@700" },
  "source-serif": { family: "Source Serif 4", spec: "Source+Serif+4:wght@600" },
  oswald: { family: "Oswald", spec: "Oswald:wght@600" },
  spectral: { family: "Spectral", spec: "Spectral:wght@600" },
  bitter: { family: "Bitter", spec: "Bitter:wght@600" },
};

// Which face each built-in era uses. "all" has no entry — it keeps the system
// stack, so the initial page load still costs zero webfonts.
const ERA_FONT = {
  rome: "cormorant",
  egypt: "slab",
  medieval: "cardo",
  islamic: "amiri",
  song: "source-serif",
};

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

// --- state ------------------------------------------------------------------

const state = {
  eras: [],
  conversations: [],
  /** null while composing a brand-new chat that hasn't been saved yet. */
  currentId: null,
  draftEra: "all",
  messages: [],
  busy: false,
  controller: null,
};

const loadedFonts = new Set();

const eraById = (id) => state.eras.find((e) => e.id === id);

const activeEra = () => {
  const stored = state.currentId
    ? (state.conversations.find((c) => c.id === state.currentId)?.era ??
      state.draftEra)
    : state.draftEra;

  // Same fallback as resolveEra() on the server: a conversation saved before
  // `ww2` became `islamic` still carries the old key, which matches no era,
  // no theme and no font. Resolve it so those conversations still render.
  return eraById(stored) ? stored : "all";
};

// --- fonts ------------------------------------------------------------------

function loadFont(key) {
  const choice = FONT_CHOICES[key];
  if (!choice || loadedFonts.has(key)) return;
  loadedFonts.add(key);

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${choice.spec}&display=swap`;
  document.head.append(link);
}

/** A built-in era's face comes from the table; a custom era carries its key. */
function fontKeyFor(eraId) {
  const era = eraById(eraId);
  return era?.custom ? era.font : (ERA_FONT[eraId] ?? null);
}

function loadEraFont(eraId) {
  loadFont(fontKeyFor(eraId));
}

// --- markdown ---------------------------------------------------------------

/** Escape first, then apply a small subset of markdown. Model output is
 *  untrusted text — this is the app's entire XSS surface. */
function md(text) {
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return safe
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").filter((l) => l.trim() !== "");
      if (lines.length === 0) return "";

      const heading = lines[0].match(/^(#{2,4})\s+(.*)$/);
      if (heading && lines.length === 1) {
        return `<h3>${inline(heading[2])}</h3>`;
      }

      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        const items = lines
          .map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
        const items = lines
          .map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`)
          .join("");
        return `<ol>${items}</ol>`;
      }

      return `<p>${inline(lines.join("<br>"))}</p>`;
    })
    .join("");
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

// --- small helpers ----------------------------------------------------------

function scrollToEnd() {
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

/** Only autoscroll if the user hasn't deliberately scrolled up to read. */
function isPinnedToBottom() {
  const { scrollTop, scrollHeight, clientHeight } = els.transcript;
  return scrollHeight - scrollTop - clientHeight < 120;
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.role = "status";
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

// Set inline for a custom era; cleared for built-ins so the [data-era] rules
// in the stylesheet take over again.
const THEMED = [
  "--accent",
  "--tint",
  "--tint-hi",
  "--font-display",
  "--display-weight",
  "--display-tracking",
];

function applyEra(id) {
  const era = eraById(id);
  const root = document.documentElement;

  if (era?.custom) {
    // The hue was range-checked server-side; re-normalise anyway, because it's
    // about to be interpolated into a CSS colour.
    const hue = ((Number(era.hue) % 360) + 360) % 360 || 0;
    const family = FONT_CHOICES[era.font]?.family;

    root.dataset.era = "custom";
    root.style.setProperty("--accent", `oklch(0.66 0.15 ${hue})`);
    root.style.setProperty("--tint", `oklch(0.09 0.008 ${hue})`);
    root.style.setProperty("--tint-hi", `oklch(0.13 0.012 ${hue})`);
    root.style.setProperty("--display-weight", "600");
    root.style.setProperty("--display-tracking", "-0.02em");
    if (family) {
      root.style.setProperty("--font-display", `"${family}", Georgia, serif`);
    }
  } else {
    root.dataset.era = id;
    for (const prop of THEMED) root.style.removeProperty(prop);
  }

  loadEraFont(id);
  if (era) els.eraLabel.textContent = era.label;
}

function closeDrawer() {
  els.app.dataset.open = "false";
  els.scrim.hidden = true;
}

// --- conversation list ------------------------------------------------------

function groupOf(ts) {
  const day = 86_400_000;
  const midnight = new Date().setHours(0, 0, 0, 0);
  if (ts >= midnight) return "Today";
  if (ts >= midnight - day) return "Yesterday";
  if (ts >= midnight - day * 7) return "Previous 7 days";
  return "Older";
}

function renderConversations() {
  els.convos.replaceChildren();

  if (state.conversations.length === 0) {
    const p = document.createElement("p");
    p.className = "convos__empty";
    p.textContent = "No conversations yet.";
    els.convos.append(p);
    return;
  }

  const groups = new Map();
  for (const c of state.conversations) {
    const key = groupOf(c.updated_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  for (const [label, items] of groups) {
    const group = document.createElement("section");
    group.className = "convo-group";

    const h = document.createElement("p");
    h.className = "convo-group__label";
    h.textContent = label;
    group.append(h);

    for (const c of items) {
      group.append(buildConvoRow(c));
    }

    els.convos.append(group);
  }
}

/** One row in the sidebar: era dot, title, and a ⋯ menu button.
 *  The row is a <div> rather than a <button> because it contains its own
 *  button — nesting buttons is invalid HTML and breaks keyboard behaviour. */
function buildConvoRow(c) {
  const era = eraById(c.era);
  const row = document.createElement("div");
  row.className = "convo";
  row.dataset.era = c.era;
  row.dataset.id = c.id;
  row.setAttribute("aria-current", String(c.id === state.currentId));

  const open = document.createElement("button");
  open.type = "button";
  open.className = "convo__open";
  open.title = `${c.title} — ${era ? era.label : c.era}`;
  open.innerHTML = `
    <span class="convo__dot" aria-hidden="true"></span>
    <span class="convo__title"></span>
  `;
  open.querySelector(".convo__title").textContent = c.title;
  open.addEventListener("click", () => openConversation(c.id));

  const more = document.createElement("button");
  more.type = "button";
  more.className = "convo__more";
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-expanded", "false");
  more.setAttribute("aria-label", `Options for ${c.title}`);
  more.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  `;
  more.addEventListener("click", (e) => {
    e.stopPropagation();
    openRowMenu(more, c);
  });

  row.append(open, more);
  return row;
}

// --- row menu ---------------------------------------------------------------

let menuFor = null;

function openRowMenu(button, conversation) {
  if (menuFor?.id === conversation.id) return closeRowMenu();

  closeRowMenu();
  menuFor = conversation;

  els.menuPop.hidden = false;
  button.setAttribute("aria-expanded", "true");
  button.closest(".convo")?.setAttribute("data-menu-open", "true");

  // Position with fixed coords so the scrolling sidebar can't clip it, and
  // flip up / clamp left when it would run off screen.
  const r = button.getBoundingClientRect();
  const m = els.menuPop.getBoundingClientRect();
  const gap = 6;

  const top =
    r.bottom + gap + m.height > window.innerHeight
      ? Math.max(gap, r.top - m.height - gap)
      : r.bottom + gap;

  const left = Math.min(
    Math.max(gap, r.right - m.width),
    window.innerWidth - m.width - gap,
  );

  els.menuPop.style.top = `${top}px`;
  els.menuPop.style.left = `${left}px`;
  els.menuPop.querySelector(".menu__item")?.focus();
}

function closeRowMenu() {
  if (els.menuPop.hidden) return;
  els.menuPop.hidden = true;
  menuFor = null;
  document
    .querySelectorAll('.convo[data-menu-open="true"]')
    .forEach((el) => el.removeAttribute("data-menu-open"));
  document
    .querySelectorAll('.convo__more[aria-expanded="true"]')
    .forEach((el) => el.setAttribute("aria-expanded", "false"));
}

/** Swap the title for an input, in place. Enter or blur saves, Escape cancels. */
function startRename(conversation) {
  const row = els.convos.querySelector(`.convo[data-id="${conversation.id}"]`);
  const titleEl = row?.querySelector(".convo__title");
  if (!titleEl) return;

  const input = document.createElement("input");
  input.className = "convo__rename";
  input.value = conversation.title;
  input.maxLength = 60;
  input.setAttribute("aria-label", "Conversation name");

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;

  const finish = async (save) => {
    if (settled) return;
    settled = true;

    const next = input.value.trim().slice(0, 60);

    if (save && next && next !== conversation.title) {
      conversation.title = next;
      renderConversations();
      if (conversation.id === state.currentId) renderHeader();
      try {
        await api(`/api/conversations/${conversation.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: next }),
        });
      } catch {
        toast("Couldn't rename that");
        refreshConversations().catch(() => {});
      }
    } else {
      renderConversations();
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

/** Native <dialog>, so Escape and focus trapping come for free. */
function askToDelete(conversation) {
  els.confirmName.textContent = conversation.title;
  els.confirm.showModal();

  return new Promise((resolve) => {
    const done = (answer) => {
      els.confirm.close();
      els.confirmOk.removeEventListener("click", onOk);
      els.confirmCancel.removeEventListener("click", onCancel);
      els.confirm.removeEventListener("close", onCancel);
      resolve(answer);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);

    els.confirmOk.addEventListener("click", onOk);
    els.confirmCancel.addEventListener("click", onCancel);
    els.confirm.addEventListener("close", onCancel);
  });
}

async function deleteConversation(conversation) {
  if (!(await askToDelete(conversation))) return;

  try {
    await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
  } catch {
    toast("Couldn't delete that");
    return;
  }

  state.conversations = state.conversations.filter(
    (c) => c.id !== conversation.id,
  );
  toast("Conversation deleted");

  if (conversation.id === state.currentId) startNewChat();
  else renderConversations();
}

// --- transcript -------------------------------------------------------------

/** Real objects from the Met, shown as evidence under an answer. Everything
 *  is set with textContent — museum data is third-party text, same as model
 *  output, and gets the same treatment. */
function buildArtifacts(items) {
  const wrap = document.createElement("div");
  wrap.className = "relics";

  const label = document.createElement("p");
  label.className = "relics__label";
  label.textContent = "From the Met Museum collection";

  const row = document.createElement("div");
  row.className = "relics__row";

  for (const item of items) {
    const link = document.createElement("a");
    link.className = "relic";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = [item.title, item.date, item.culture, item.credit]
      .filter(Boolean)
      .join(" · ");

    const frame = document.createElement("div");
    frame.className = "relic__frame";

    const img = document.createElement("img");
    img.src = item.image;
    img.alt = item.title;
    img.loading = "lazy";
    img.decoding = "async";
    // A collection this size has some dead image URLs; fade rather than
    // showing a broken-image icon.
    img.addEventListener("error", () => {
      img.dataset.broken = "true";
    });
    frame.append(img);

    const title = document.createElement("span");
    title.className = "relic__title";
    title.textContent = item.title;

    const date = document.createElement("span");
    date.className = "relic__date";
    date.textContent = item.date;

    link.append(frame, title, date);
    row.append(link);
  }

  wrap.append(label, row);
  return wrap;
}

function buildMessage(message) {
  const { role, content, artifacts } = message;
  const el = document.createElement("div");

  if (role === "user") {
    el.className = "msg msg--user";

    const bubble = document.createElement("div");
    bubble.className = "msg__bubble";
    bubble.textContent = content;

    const actions = document.createElement("div");
    actions.className = "msg__actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "act";
    edit.dataset.edit = "";
    edit.textContent = "Edit";
    // The id is read at click time, not captured now: a message sent moments
    // ago gets its id from the stream, slightly after it appears on screen.
    edit.addEventListener("click", () => startEdit(message, el));

    actions.append(edit);
    el.append(bubble, actions);
    return el;
  }

  if (role === "error") {
    el.className = "msg msg--error";

    const text = document.createElement("span");
    text.textContent = content;

    // Without this an error is a dead end — the question is already stored
    // server-side, so retrying costs the user nothing but a click.
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "act";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      el.remove();
      regenerate({ dropLocalReply: false });
    });

    el.append(text, retry);
    return el;
  }

  const era = eraById(activeEra());
  el.className = "msg msg--bot";
  el.innerHTML = `
    <p class="msg__who">${era ? era.label : "History"}</p>
    <div class="msg__body"></div>
    <div class="msg__actions">
      <button type="button" class="act" data-copy>Copy</button>
      <button type="button" class="act" data-regen>Regenerate</button>
    </div>
  `;
  el.querySelector(".msg__body").innerHTML = md(content);

  if (artifacts?.length) {
    el.querySelector(".msg__actions").before(buildArtifacts(artifacts));
  }
  el.querySelector("[data-copy]").addEventListener("click", async () => {
    await navigator.clipboard.writeText(content);
    toast("Copied");
  });
  el.querySelector("[data-regen]").addEventListener("click", () => regenerate());
  return el;
}

function renderEmpty() {
  const wrap = document.createElement("div");
  wrap.className = "empty";
  wrap.innerHTML = `
    <div class="empty__brand">
      <svg class="empty__mark" aria-hidden="true" focusable="false">
        <use href="#vestige-mark" />
      </svg>
      <h2 class="empty__name">Vestige</h2>
      <span class="empty__tag">ask the past</span>
    </div>
    <p class="empty__sub">
      Pick an era and the assistant takes on that period's expertise. Follow-up
      questions keep their context — ask “when did he die?” and it'll know who
      you mean.
    </p>
    <p class="empty__label">Era</p>
    <div class="era-picker"></div>
    <p class="empty__label" data-starters-label>Try one</p>
    <div class="starters"></div>
  `;

  const picker = wrap.querySelector(".era-picker");
  state.eras.forEach((era) => picker.append(buildEraOption(era)));
  picker.append(buildAddEra(picker));

  // Built-in eras have hand-written openers; a generated era doesn't, and
  // inventing generic ones would undercut the point of the era mechanic.
  const starters = STARTERS[state.draftEra] || [];
  const row = wrap.querySelector(".starters");
  const startersLabel = wrap.querySelector("[data-starters-label]");

  if (starters.length === 0) {
    startersLabel.remove();
    row.remove();
  } else {
    starters.forEach((q) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "starter";
      b.textContent = q;
      b.addEventListener("click", () => send(q));
      row.append(b);
    });
  }

  els.transcript.append(wrap);
}

/**
 * One option in the era picker.
 *
 * Every label and blurb is set with textContent. For a custom era these are
 * model-written strings, so they are treated exactly like model output
 * anywhere else in this file: never interpolated into HTML.
 */
function buildEraOption(era) {
  const wrap = document.createElement("div");
  wrap.className = era.custom ? "era-opt era-opt--custom" : "era-opt";
  wrap.dataset.selected = String(era.id === state.draftEra);
    wrap.dataset.era = era.id;

  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "era-opt__choose";
  choose.setAttribute("aria-pressed", String(era.id === state.draftEra));

  const name = document.createElement("span");
  name.className = "era-opt__name";

   if (era.custom) {
    const dot = document.createElement("span");
    dot.className = "era-opt__dot";
    const hue = ((Number(era.hue) % 360) + 360) % 360 || 0;
    dot.style.setProperty("--era-dot", `oklch(0.66 0.15 ${hue})`);
    wrap.style.setProperty("--era-accent", `oklch(0.66 0.15 ${hue})`);
    name.append(dot);
  }

  name.append(document.createTextNode(era.label));

  const years = document.createElement("span");
  years.className = "era-opt__years";
  years.textContent = era.blurb;

  choose.append(name, years);

  // The Met has no department for every period; when none fitted, the era
  // ships with artifacts off and says so rather than showing wrong objects.
  if (era.custom && !era.hasArtifacts) {
    const note = document.createElement("span");
    note.className = "era-opt__noart";
    note.textContent = "no museum objects";
    choose.append(note);
  }

  // Hovering previews the era — including a custom era's generated colour.
  wrap.addEventListener("pointerenter", () => applyEra(era.id));
  wrap.addEventListener("pointerleave", () => applyEra(state.draftEra));

  choose.addEventListener("click", () => {
    state.draftEra = era.id;
    applyEra(era.id);
    renderTranscript();
  });

  wrap.append(choose);

  if (era.custom) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "era-opt__remove";
    remove.setAttribute("aria-label", `Delete the ${era.label} era`);
    remove.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" />
      </svg>
    `;
    remove.addEventListener("click", () => removeEra(era));
    wrap.append(remove);
  }

  return wrap;
}

/** The "Add era" affordance, which swaps itself for a small form. */
function buildAddEra(picker) {
  const add = document.createElement("button");
  add.type = "button";
  add.className = "era-add";
  add.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" />
    </svg>
    Add era
  `;
  add.addEventListener("click", () => {
    add.replaceWith(buildEraForm(picker));
    picker.querySelector(".era-new__input")?.focus();
  });
  return add;
}

function buildEraForm(picker) {
  const form = document.createElement("form");
  form.className = "era-new";
  form.innerHTML = `
    <input class="era-new__input" type="text" maxlength="60" autocomplete="off"
           placeholder="Name a period — e.g. the Mongol Empire"
           aria-label="Name a historical period" />
    <button type="submit" class="act act--primary" data-create>Create</button>
    <button type="button" class="act" data-cancel>Cancel</button>
  `;

  const input = form.querySelector(".era-new__input");
  const create = form.querySelector("[data-create]");
  const note = document.createElement("p");
  note.className = "era-new__note";

  const say = (text, isError) => {
    note.textContent = text;
    note.classList.toggle("era-new__note--error", !!isError);
    if (!note.isConnected) form.after(note);
  };

  form.querySelector("[data-cancel]").addEventListener("click", () => {
    note.remove();
    form.replaceWith(buildAddEra(picker));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;

    input.disabled = true;
    create.disabled = true;
    say("Building the era — this takes a few seconds…", false);

    try {
      const era = await api("/api/eras", {
        method: "POST",
        body: JSON.stringify({ name }),
      });

      state.eras.push(era);
      state.draftEra = era.id;
      applyEra(era.id);
      renderTranscript(); // rebuilds the picker with the new era selected
      toast(`${era.label} added`);
    } catch (err) {
      input.disabled = false;
      create.disabled = false;
      say(err.message, true);
      input.focus();
    }
  });

  return form;
}

async function removeEra(era) {
  try {
    await api(`/api/eras/${era.id}`, { method: "DELETE" });
  } catch {
    toast("Couldn't delete that era");
    return;
  }

  state.eras = state.eras.filter((e) => e.id !== era.id);
  // Conversations that used it still open: the server falls back to the
  // default era for a key that no longer exists.
  if (state.draftEra === era.id) state.draftEra = "all";
  applyEra(state.draftEra);
  renderTranscript();
  renderConversations();
  toast(`${era.label} deleted`);
}

function renderTranscript() {
  els.transcript.replaceChildren();

  if (state.messages.length === 0) {
    renderEmpty();
    updateToBottom();
    return;
  }

  state.messages.forEach((m) => els.transcript.append(buildMessage(m)));
  scrollToEnd();
  updateToBottom();
}

function renderHeader() {
  const convo = state.conversations.find((c) => c.id === state.currentId);
  els.convoTitle.textContent = convo ? convo.title : "New conversation";
  applyEra(activeEra());

  // So several open tabs are tellable apart.
  document.title = convo ? `${convo.title} — Vestige` : "Vestige — ask the past";
}

/** The jump-to-latest button only earns its space when you've scrolled away. */
/**
 * Swap the composer's single control between sending and aborting.
 *
 * The element never changes, only its state — so keyboard focus survives the
 * swap, and there is no moment where both controls exist.
 */
function setActionState(streaming) {
  els.action.dataset.state = streaming ? "abort" : "send";
  els.action.setAttribute("aria-label", streaming ? "Stop generating" : "Send");
}

function updateToBottom() {
  const scrollable =
    els.transcript.scrollHeight - els.transcript.clientHeight > 40;
  const hasMessages = state.messages.length > 0;
  els.toBottom.hidden = !hasMessages || !scrollable || isPinnedToBottom();
}

// --- thinking indicator -----------------------------------------------------

function showThinking() {
  const lines = THINKING[activeEra()] || THINKING.all;
  let i = 0;

  const el = document.createElement("div");
  el.className = "thinking";
  el.innerHTML = `
    <span class="thinking__dots"><i></i><i></i><i></i></span>
    <span class="thinking__text"></span>
  `;
  const label = el.querySelector(".thinking__text");
  label.textContent = `${lines[0]}…`;
  els.transcript.append(el);
  scrollToEnd();

  const timer = setInterval(() => {
    i = (i + 1) % lines.length;
    label.textContent = `${lines[i]}…`;
    label.style.animation = "none";
    void label.offsetWidth;
    label.style.animation = "";
  }, 2400);

  return () => {
    clearInterval(timer);
    el.remove();
  };
}

// --- server calls -----------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed.");
  return res.json();
}

async function refreshConversations() {
  state.conversations = await api("/api/conversations");
  renderConversations();
}

async function openConversation(id) {
  if (state.busy) return;

  const { conversation, messages } = await api(`/api/conversations/${id}`);
  state.currentId = conversation.id;
  state.messages = messages;
  state.draftEra = conversation.era;

  renderHeader();
  renderConversations();
  renderTranscript();
  closeDrawer();
  els.input.focus();
}

function startNewChat() {
  if (state.busy) return;
  state.currentId = null;
  state.messages = [];
  renderHeader();
  renderConversations();
  renderTranscript();
  closeDrawer();
  els.input.focus();
}

// --- streaming --------------------------------------------------------------

/** Read an SSE body frame by frame. EventSource only does GET, and these are
 *  POSTs, so the stream is parsed by hand. */
async function readStream(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

async function send(text) {
  const message = String(text ?? "").trim();
  if (!message || state.busy) return;

  els.input.value = "";

  // A brand-new chat isn't saved until the first message — so the sidebar
  // never fills with empty conversations.
  if (!state.currentId) {
    try {
      const convo = await api("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ era: state.draftEra }),
      });
      state.currentId = convo.id;
      state.conversations.unshift(convo);
    } catch (err) {
      els.transcript.append(
        buildMessage({ role: "error", content: err.message }),
      );
      return;
    }
  }

  if (els.transcript.querySelector(".empty")) els.transcript.replaceChildren();

  // One object, used for both state and the DOM — so when the stream reports
  // the stored id, the rendered Edit button is looking at the same message.
  const entry = { role: "user", content: message };
  state.messages.push(entry);
  els.transcript.append(buildMessage(entry));
  scrollToEnd();
  updateToBottom();
  renderHeader();

  await stream(`/api/conversations/${state.currentId}/messages`, { message });
}

/** POST a request that replies with an SSE stream, then render it. */
async function stream(url, payload) {
  state.controller = new AbortController();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: state.controller.signal,
    });

    if (!res.ok || !res.body) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error || "Couldn't start the reply.");
    }

    await consume(res);
  } catch (err) {
    state.controller = null;
    if (err.name !== "AbortError") {
      els.transcript.append(
        buildMessage({ role: "error", content: err.message }),
      );
      scrollToEnd();
    }
  }
}

// --- paced rendering -------------------------------------------------------
//
// Tokens arrive from the network in bursts, and painting each one as it lands
// reads as jitter. The stream itself is untouched — every token is kept the
// moment it arrives — but the DOM is written on animation frames, revealing a
// share of the outstanding backlog each time.
//
// Revealing a *fraction* rather than a fixed number of characters is what
// makes this self-correcting: a large burst drains fast, a trickle stays a
// trickle, and the pace follows however fast the model happens to be.
//
// The reveal deliberately outlives the stream. When `done` arrives there is
// still a backlog, and cutting to the full text there would land as a visible
// snap — the one artefact this was meant to remove. So `done` lets the reveal
// keep draining on its own; only abort and errors settle instantly, where
// stopping *is* the point.
//
// THIS IS THE TUNING KNOB. It's the divisor: each frame paints one twelfth of
// what's left to show, then one twelfth of the remainder, and so on.
//
//   Raise it  → slower, smoother, and a longer tail after the stream ends.
//               Too high and the text visibly lags the answer.
//   Lower it  → faster and closer to the raw stream, but burstier. Low enough
//               and it reverts to the jitter this replaced.
//
// Tuned against a measured reply — 1276 characters in 1283 ms — so rendering
// finishes at about 1.5x the stream's own duration, with a ~630 ms tail. That
// tail stays roughly constant at any reply length, because the backlog depends
// on how fast tokens arrive rather than on how many there are.
//
// Change this one number and hard-refresh.
const REVEAL_SMOOTHNESS = 12;

/** Shared stream consumer for both send and regenerate. */
async function consume(res) {
  state.busy = true;
  setActionState(true);

  // The stream now outlives the reply: artifacts arrive after `done`. So the
  // composer is released when the answer is finished, not when the connection
  // closes — otherwise a slow museum lookup would keep the send button
  // disabled for seconds after the reply was already on screen.
  const myController = state.controller;
  let released = false;

  const releaseInput = () => {
    if (released) return;
    released = true;
    // A newer turn may already own the UI; don't undo its busy state.
    if (state.controller !== myController) return;
    state.busy = false;
    state.controller = null;
    setActionState(false);
    els.input.focus();
  };

  const stopThinking = showThinking();
  let bubble = null;
  let body = null;
  let text = "";
  let artifacts = [];
  let assistantEntry = null;

  const ensureBubble = () => {
    if (bubble) return;
    stopThinking();
    bubble = buildMessage({ role: "assistant", content: "" });
    body = bubble.querySelector(".msg__body");
    els.transcript.append(bubble);
  };

  // See REVEAL_SMOOTHNESS at the top of this file for how the pacing works and
  // which number to change.
  const paced = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let shown = 0;
  let frame = null;
  let ended = false; // the stream is over: done, abort or error

  // The caret marks "more is coming", which is true right up until the last
  // character is on screen — not until `done`. Deriving it here rather than
  // passing a flag is what stops the two from disagreeing.
  const paint = (upto) => {
    if (!body) return;
    const pinned = isPinnedToBottom();
    const complete = ended && upto >= text.length;
    body.innerHTML = complete
      ? md(text)
      : md(text.slice(0, upto)) + '<span class="caret"></span>';
    if (pinned) scrollToEnd();
  };

  const step = () => {
    frame = null;
    const remaining = text.length - shown;
    if (remaining > 0) {
      shown = Math.min(
        text.length,
        shown + Math.max(1, Math.ceil(remaining / REVEAL_SMOOTHNESS)),
      );
    }
    paint(shown);
    if (shown < text.length) schedule();
  };

  const schedule = () => {
    if (frame === null) frame = requestAnimationFrame(step);
  };

  /**
   * End the reveal at once, showing everything received. For abort and errors
   * only — `done` lets the backlog drain instead, so the reply doesn't snap.
   */
  const settle = () => {
    ended = true;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    shown = text.length;
    paint(shown);
  };

  try {
    await readStream(res, (evt) => {
      if (evt.type === "delta") {
        ensureBubble();
        text += evt.text;
        if (paced) {
          schedule();
        } else {
          // Reduced motion: no staged reveal, paint what has arrived.
          shown = text.length;
          paint(shown);
        }
      } else if (evt.type === "user") {
        // The id of the message just stored, so it can be edited without a
        // page reload. Attach it to the most recent user turn.
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === "user") {
            state.messages[i].id = evt.id;
            break;
          }
        }
      } else if (evt.type === "artifacts") {
        ensureBubble();
        artifacts = evt.artifacts;
        // Normally this lands after `done`, so the reply is already in state —
        // update it in place so the strip survives a re-render.
        if (assistantEntry) assistantEntry.artifacts = artifacts;
        bubble.querySelector(".msg__actions").before(buildArtifacts(artifacts));
        if (isPinnedToBottom()) scrollToEnd();
      } else if (evt.type === "done") {
        ensureBubble();
        // Don't settle. The backlog keeps draining for a few hundred ms so the
        // reply finishes rendering smoothly instead of snapping to full. One
        // frame is scheduled unconditionally: if the reveal has already caught
        // up there's nothing left to paint, but the caret still has to go.
        ended = true;
        if (paced) schedule();
        else {
          shown = text.length;
          paint(shown);
        }
        assistantEntry = { role: "assistant", content: text, artifacts };
        state.messages.push(assistantEntry);
        // The answer is complete; the stream stays open only for artifacts.
        releaseInput();
        // Announce the finished reply once. The transcript itself is not a
        // live region, precisely so this isn't said on every token.
        els.announcer.textContent = text;
        if (evt.title) {
          const convo = state.conversations.find(
            (c) => c.id === state.currentId,
          );
          if (convo) convo.title = evt.title;
          renderHeader();
          renderConversations();
        }
      } else if (evt.type === "error") {
        stopThinking();
        bubble?.remove();
        body = null; // the bubble is gone; the pending frame must not paint
        els.transcript.append(
          buildMessage({ role: "error", content: evt.error }),
        );
      }
    });
  } catch (err) {
    if (err.name === "AbortError") {
      // Stop means stop: settle immediately and keep whatever streamed in
      // before the user hit it, in full. No trailing reveal here — the point
      // of the button is that the motion ends when it's pressed.
      settle();
      if (text) state.messages.push({ role: "assistant", content: text, artifacts });
    } else {
      bubble?.remove();
      body = null; // as above: nothing left to paint into
      els.transcript.append(
        buildMessage({ role: "error", content: err.message }),
      );
    }
  } finally {
    // Only force-finish if the stream didn't end cleanly. After `done` a
    // reveal is legitimately still running, and settling here would reinstate
    // exactly the snap this change removes.
    if (!ended) settle();
    stopThinking();
    releaseInput(); // no-op if `done` already released it
    if (isPinnedToBottom()) scrollToEnd();
    updateToBottom();
    refreshConversations().catch(() => {});
  }
}

/**
 * Edit a message in place.
 *
 * Follows the inline-rename pattern, with one deliberate difference: renaming
 * saves on blur, this does not. Submitting rewrites the conversation from this
 * point and discards every later turn, so it takes an explicit Enter or Save —
 * clicking away must never destroy history by accident.
 */
function startEdit(message, el) {
  if (state.busy || el.querySelector(".msg__edit")) return;

  if (!message.id) {
    toast("Still saving — try again in a moment");
    return;
  }

  const bubble = el.querySelector(".msg__bubble");
  const actions = el.querySelector(".msg__actions");

  const field = document.createElement("textarea");
  field.className = "msg__edit";
  field.value = message.content;
  field.rows = 1;
  field.setAttribute("aria-label", "Edit your message");

  const bar = document.createElement("div");
  bar.className = "msg__edit-actions";
  bar.innerHTML = `
    <button type="button" class="act" data-cancel>Cancel</button>
    <button type="button" class="act act--primary" data-save>Save &amp; resend</button>
  `;

  bubble.hidden = true;
  actions.hidden = true;
  bubble.after(field, bar);

  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);

  const close = () => {
    field.remove();
    bar.remove();
    bubble.hidden = false;
    actions.hidden = false;
  };

  const submit = () => {
    const value = field.value.trim();
    if (!value) return;
    if (value === message.content) return close(); // nothing changed
    close();
    submitEdit(message, value);
  };

  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
      el.querySelector("[data-edit]")?.focus(); // return focus where it came from
    }
  });

  bar.querySelector("[data-cancel]").addEventListener("click", close);
  bar.querySelector("[data-save]").addEventListener("click", submit);
}

/** Replace a message and everything after it, then answer again. */
async function submitEdit(message, text) {
  if (state.busy || !state.currentId) return;

  const index = state.messages.indexOf(message);
  if (index === -1) return;

  // Mirror server-side truncation: everything from here on is being replaced.
  state.messages.splice(index);
  state.messages.push({ role: "user", content: text });
  renderTranscript();

  await stream(
    `/api/conversations/${state.currentId}/messages/${message.id}`,
    { message: text },
  );
}

/**
 * Ask the server for a fresh reply.
 *
 * Used two ways: the Regenerate button (which discards the reply on screen
 * first) and Try again after an error (where there is no reply to discard —
 * the server endpoint only drops a stored reply if one is actually last).
 */
async function regenerate({ dropLocalReply = true } = {}) {
  if (state.busy || !state.currentId) return;

  if (dropLocalReply) {
    [...els.transcript.querySelectorAll(".msg--bot")].pop()?.remove();
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === "assistant") {
        state.messages.splice(i, 1);
        break;
      }
    }
  }

  await stream(`/api/conversations/${state.currentId}/regenerate`, {});
}

// --- events -----------------------------------------------------------------

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  send(els.input.value);
});

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send(els.input.value);
  }
});

// One control: it aborts while a reply is streaming, and sends otherwise.
els.action.addEventListener("click", () => {
  if (state.busy) state.controller?.abort();
  else send(els.input.value);
});

els.newChat.addEventListener("click", startNewChat);

// Deleting a conversation lives in the ⋯ menu on its sidebar row — the header
// had a second, duplicate control for the same action.

// --- row menu wiring --------------------------------------------------------

els.menuPop.addEventListener("click", (e) => {
  const action = e.target.closest("[data-act]")?.dataset.act;
  if (!action || !menuFor) return;

  const conversation = menuFor;
  closeRowMenu();

  if (action === "rename") startRename(conversation);
  if (action === "delete") deleteConversation(conversation);
});

// Arrow keys move between the two items; Escape returns to the list.
els.menuPop.addEventListener("keydown", (e) => {
  const items = [...els.menuPop.querySelectorAll(".menu__item")];
  const i = items.indexOf(document.activeElement);

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[(i + step + items.length) % items.length].focus();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeRowMenu();
  }
});

document.addEventListener("click", (e) => {
  if (!els.menuPop.hidden && !e.target.closest("[data-menu-pop]")) {
    closeRowMenu();
  }
});

// A fixed-position menu doesn't follow its button, so dismiss it on scroll
// and resize rather than letting it drift.
els.convos.addEventListener("scroll", closeRowMenu, { passive: true });
window.addEventListener("resize", closeRowMenu);

els.menu.addEventListener("click", () => {
  const open = els.app.dataset.open === "true";
  els.app.dataset.open = String(!open);
  els.scrim.hidden = open;
});

els.scrim.addEventListener("click", closeDrawer);

els.toBottom.addEventListener("click", () => {
  els.transcript.scrollTo({
    top: els.transcript.scrollHeight,
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  els.input.focus();
});

els.transcript.addEventListener("scroll", updateToBottom, { passive: true });
new ResizeObserver(updateToBottom).observe(els.transcript);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!els.menuPop.hidden) closeRowMenu();
  else closeDrawer();
});

// --- boot -------------------------------------------------------------------

async function init() {
  try {
    [state.eras, state.conversations] = await Promise.all([
      api("/api/eras"),
      api("/api/conversations"),
    ]);
  } catch {
    state.eras = [
      { id: "all", label: "All History", blurb: "Anything, any period" },
    ];
    state.conversations = [];
  }

  renderConversations();
  renderHeader();
  renderTranscript();
  els.input.focus();
}

init();
