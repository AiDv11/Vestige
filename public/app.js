// ===========================================================================
// HISTORY BOT — client
// Talks to the Express server in server.js. The server owns the conversation
// memory; this file owns what's on screen.
// ===========================================================================

const els = {
  eraList: document.querySelector(".eras__list"),
  eraLabel: document.querySelector("[data-era-label]"),
  eraBlurb: document.querySelector("[data-era-blurb]"),
  transcript: document.querySelector("[data-transcript]"),
  form: document.querySelector("[data-form]"),
  input: document.querySelector("[data-input]"),
  send: document.querySelector("[data-send]"),
  reset: document.querySelector("[data-reset]"),
};

// Suggested openers per era. These do real work: they teach what the era
// mechanic actually changes, in the first few seconds.
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
  ww2: [
    "Why did Barbarossa fail?",
    "What was the significance of Midway?",
    "How was Enigma broken?",
  ],
};

let eras = [];
let currentEra = "all";
// One visible transcript per era, so switching back doesn't lose the thread.
const history = new Map();
let busy = false;

// --- rendering helpers ------------------------------------------------------

/** Escape first, then apply a tiny subset of markdown. Never inject raw model
 *  output as HTML — this is the whole XSS surface of the app. */
function format(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n");
      const isList = lines.every((l) => /^\s*[-*]\s+/.test(l));

      if (isList) {
        const items = lines
          .map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${inline(lines.join("<br>"))}</p>`;
    })
    .join("");
}

function inline(s) {
  return s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function scrollToEnd() {
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function renderEmpty() {
  const era = eras.find((e) => e.id === currentEra);
  const wrap = document.createElement("div");
  wrap.className = "empty";
  wrap.innerHTML = `
    <h2 class="empty__title">${era ? era.label : "History"}</h2>
    <p class="empty__sub">
      Ask anything about this period. Follow-up questions keep their context —
      ask “when did he die?” and it'll know who you mean.
    </p>
    <p class="empty__label">Try one</p>
    <div class="starters"></div>
  `;

  const row = wrap.querySelector(".starters");
  (STARTERS[currentEra] || []).forEach((q) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "starter";
    b.textContent = q;
    b.addEventListener("click", () => send(q));
    row.append(b);
  });

  els.transcript.append(wrap);
}

function renderTranscript() {
  els.transcript.replaceChildren();
  const log = history.get(currentEra) || [];

  if (log.length === 0) {
    renderEmpty();
    return;
  }

  log.forEach((m) => els.transcript.append(buildMessage(m)));
  scrollToEnd();
}

function buildMessage({ role, content }) {
  const el = document.createElement("div");

  if (role === "user") {
    el.className = "msg msg--user";
    el.textContent = content;
    return el;
  }

  if (role === "error") {
    el.className = "msg msg--error";
    el.textContent = content;
    return el;
  }

  const era = eras.find((e) => e.id === currentEra);
  el.className = "msg msg--bot";
  el.innerHTML = `
    <p class="msg__who">${era ? era.label : "History"}</p>
    <div class="msg__body">${format(content)}</div>
  `;
  return el;
}

// --- era switching ----------------------------------------------------------

function renderEras() {
  els.eraList.replaceChildren();

  eras.forEach((era, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "era";
    b.role = "radio";
    b.setAttribute("aria-checked", String(era.id === currentEra));
    // Roving tabindex: one stop for the whole group, arrows move within it.
    b.tabIndex = era.id === currentEra ? 0 : -1;
    b.dataset.era = era.id;
    b.innerHTML = `
      <span class="era__name">${era.label}</span>
      <span class="era__years">${era.blurb}</span>
    `;
    b.addEventListener("click", () => selectEra(era.id));
    b.addEventListener("keydown", (e) => onEraKey(e, i));
    els.eraList.append(b);
  });
}

function onEraKey(e, index) {
  const keys = {
    ArrowDown: 1,
    ArrowRight: 1,
    ArrowUp: -1,
    ArrowLeft: -1,
  };
  const step = keys[e.key];
  if (!step) return;

  e.preventDefault();
  const next = (index + step + eras.length) % eras.length;
  selectEra(eras[next].id);
  els.eraList.children[next].focus();
}

function selectEra(id) {
  if (id === currentEra) return;
  currentEra = id;

  const era = eras.find((e) => e.id === id);
  document.documentElement.dataset.era = id;
  els.eraLabel.textContent = era.label;
  els.eraBlurb.textContent = era.blurb;

  [...els.eraList.children].forEach((b) => {
    const on = b.dataset.era === id;
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on ? 0 : -1;
  });

  renderTranscript();
  els.input.focus();
}

// --- sending ----------------------------------------------------------------

async function send(text) {
  const message = text.trim();
  if (!message || busy) return;

  busy = true;
  els.send.disabled = true;
  els.input.value = "";

  const log = history.get(currentEra) || [];
  log.push({ role: "user", content: message });
  history.set(currentEra, log);

  // If the empty state is showing, clear it before the first message.
  if (els.transcript.querySelector(".empty")) els.transcript.replaceChildren();

  els.transcript.append(buildMessage({ role: "user", content: message }));
  scrollToEnd();

  const thinking = document.createElement("div");
  thinking.className = "thinking";
  thinking.innerHTML = "<span></span><span></span><span></span>";
  els.transcript.append(thinking);
  scrollToEnd();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, era: currentEra }),
    });

    const data = await res.json();
    thinking.remove();

    if (!res.ok) throw new Error(data.error || "Request failed.");

    log.push({ role: "assistant", content: data.reply });
    els.transcript.append(
      buildMessage({ role: "assistant", content: data.reply }),
    );
  } catch (err) {
    thinking.remove();
    const msg = err.message || "Something went wrong.";
    log.push({ role: "error", content: msg });
    els.transcript.append(buildMessage({ role: "error", content: msg }));
  } finally {
    busy = false;
    els.send.disabled = false;
    scrollToEnd();
    els.input.focus();
  }
}

// --- events -----------------------------------------------------------------

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  send(els.input.value);
});

// Enter sends, Shift+Enter makes a new line.
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send(els.input.value);
  }
});

els.reset.addEventListener("click", async () => {
  await fetch("/api/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ era: currentEra }),
  });
  history.set(currentEra, []);
  renderTranscript();
  els.input.focus();
});

// --- boot -------------------------------------------------------------------

async function init() {
  try {
    const res = await fetch("/api/eras");
    eras = await res.json();
  } catch {
    eras = [{ id: "all", label: "All History", blurb: "Anything, any period" }];
  }

  document.documentElement.dataset.era = currentEra;
  renderEras();
  renderTranscript();
  els.input.focus();
}

init();
