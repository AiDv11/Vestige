# Project context for an AI assistant

**You are reading a handoff document.** It exists so an assistant with no prior
history on this project can pick it up without re-deriving decisions or
repeating mistakes that were already made and fixed. Read it before proposing
changes.

---

## 1. Who you are helping

Ali — a computer science student in his third semester, building a portfolio
for internship applications. Relevant working notes:

- **He learns by doing.** Show one worked example, then let him implement the
  next piece himself. Don't build everything for him unless he explicitly asks
  (he sometimes does, and that's fine — but ask if unclear).
- **Keep replies short.** He asked for this directly. Lead with the answer;
  add depth only when he asks for it. Long explanatory walls lose him.
- **He has a comprehension gap.** He has previously built things with AI help
  that he couldn't afterwards explain. This matters because the whole point of
  the project is job interviews, where he'll be asked to walk through the code.
  When you write something non-obvious, explain it in a sentence — and prefer
  a design he can describe over one that's merely clever.
- **Correct him plainly** when he's wrong, and say so when a request is a bad
  idea — but if he reaffirms, do it his way and move on.
- **He scopes tasks tightly** ("do not touch anything else", "list every file
  you changed"). Respect that: flag adjacent problems rather than fixing them
  unasked, and always end with the file list.

---

## 2. What the project is

**Vestige** — *ask the past*. A web chat application for history questions. The
user picks an **era**, and the assistant adopts that period's expertise.

Repo: `https://github.com/AiDv11/Vestige`
Local path: `C:\Users\ali66\Desktop\Projects\GIThub\history-bot`
(the folder still has the old name; only the GitHub repo was renamed)

The era mechanic is the product's whole reason for existing. It was chosen
deliberately to answer the criticism that any chatbot project is "one API call
in a trench coat": switching era changes the system prompt, the accent colour,
the display typeface, and the museum artifacts shown alongside answers.

**Six built-in eras:** `all`, `rome`, `egypt`, `medieval`, `islamic`, `song`.
`ww2` was removed — see §6 for why its artifact handling still gets a mention.

**Plus custom eras.** A visitor types a period name, the model generates the
era's configuration, and it is saved against their session cookie. This is the
largest feature in the project and has the most safety-critical code in it —
read §6 before touching any of it.

---

## 3. Stack, and why

| Layer | Choice | Reason it was chosen |
| --- | --- | --- |
| Runtime | Node 22+ | He already knew JavaScript. FastAPI was considered and rejected — learning Python *and* the LLM concepts at once was judged too much at once. |
| Server | Express 4 | Minimal, familiar |
| Model | `openai/gpt-oss-120b` via **Groq** | Free tier, no credit card. Chosen over Google Gemini because a friend of his uses Groq and can help him when stuck — that support outweighed a small model-quality difference. |
| Storage | `node:sqlite` | Built into Node 22+. Zero dependencies, no native compilation. |
| Frontend | Vanilla HTML/CSS/JS | No build step. A React rewrite of *only the frontend* is the planned phase 2, deliberately, so he learns React by comparison against an app he already understands. |
| Artifacts | Met Museum Open Access API | No key, no auth |

**Three runtime dependencies total:** `express`, `groq-sdk`, `dotenv`.
Keep it that way unless there's a strong reason not to.

---

## 4. File map

```
server.js            routes, session cookie, SSE plumbing, rate limits
lib/eras.js          the six built-in personas, plus the closed-set vocabulary
                     custom eras are validated against (fonts, departments, hues)
lib/customEras.js    generation, validation, the delimited prompt slot, and
                     era resolution — the safety-critical file
lib/chat.js          everything that talks to Groq (streaming, titling, JSON)
lib/artifacts.js     Met Museum lookup
lib/db.js            SQLite schema, migrations, queries
lib/rateLimit.js     in-memory per-visitor request cap
public/index.html    markup, incl. the footprint <symbol> and social meta tags
public/style.css     all styling, no framework
public/app.js        all client logic, no framework
public/favicon.svg   the footprint mark, standalone (see §11 re: XML comments)
public/og.png        1200x630 social preview card
index.js             the original terminal-only version, kept as history
PRODUCT.md           design strategy and rationale
README.md            user-facing documentation
```

---

## 5. The core idea, stated once

**An LLM has no memory, so the application is the memory.** Every request
resends the whole conversation:

```js
[ { role: "system", content: era.system },   // the persona
  ...storedTurns ]                            // everything said so far
```

Personas are that same array with a different first element. There is no other
magic. If you're explaining this project to Ali, this is the sentence that
matters most.

`era` there is a **resolved era object**, not an id — `resolveEraFor(id, session)`
in `lib/customEras.js` turns a stored key into a real era first. See §7.

---

## 6. Hard-won facts — do not rediscover these

### Groq / `openai/gpt-oss-120b`

- **The model reasons before answering, and that reasoning is billed against
  `max_completion_tokens`.** With a tight cap it spends the entire allowance
  thinking and returns **empty content** with `finish_reason: "length"`. This
  silently broke conversation auto-titling. The fix in `lib/chat.js` is
  `reasoning_effort: "low"` plus real headroom. Don't lower it. The same
  setting is used for era generation in `completeJSON`.

### Custom eras — the constraint that matters

**The model writes content, never structure.** Every field it returns is
validated against a closed set in `lib/customEras.js` before it touches
anything. Two of those fields are not cosmetic:

- **`font` is a KEY, never a font name.** The key indexes `FONT_CHOICES` in
  `lib/eras.js`, and the entry's `spec` is interpolated into a Google Fonts
  **stylesheet URL**. A free-text font name from the model would be an
  injection point straight into the page. An unknown key is rejected outright —
  never fall back to a default, because that turns a rejected value into an
  accepted one.
- **`met_department` must match the Met's real department list exactly, or be
  `null`.** It becomes an **API parameter** and decides which objects are shown
  as evidence. Surrounding whitespace is trimmed; anything else is rejected.
  `null` is a legitimate answer and ships the era with artifacts off, and the
  UI says so.

`hue` is range-checked (0–360, integer) and must be **at least 25° from every
existing era's hue**, measured around the wheel, so a generated era never looks
like Rome. All eight fonts were fetched and confirmed to resolve before being
whitelisted.

### Prompt injection — two findings, both load-bearing

The visitor's era name and the generated persona both land in a **delimited
slot** inside a fixed template (`buildCustomSystem`). Neither is ever used as
the system prompt, and neither is concatenated into one.

1. **Stripping in validation alone was not enough.** `validateEra` removes
   angle brackets, but `buildCustomSystem` was *trusting that it had happened*.
   A persona reaching it with `</era_brief>` intact — a hand-edited row, or a
   future caller that forgets — closed the slot, and the model followed the
   text inside. Verified by test: it named the delimiters and abandoned the
   question. **Strip at the point of use as well.** Both strips must stay.
2. **Never name the delimiter in the prose.** The instructions originally read
   "the text between the `<era_brief>` markers…", which put a *second* opening
   marker in the prompt and made the real boundary ambiguous. The prose now
   says "enclosed in markers" and never writes the tag. There is a test
   asserting exactly one opening and one closing marker.

The visitor's name is also gated before it goes anywhere: length cap, character
whitelist (letters, digits, spaces, ordinary punctuation **including en/em
dashes** — real names like `Ming (1368–1644)` need them), and control
characters are **refused rather than normalised**, so a newline can't be
quietly flattened into something that passes.

### Met Museum API (`lib/artifacts.js`)

All three found by testing the live API; none are in its documentation.

1. **`departmentId` combined with `q` is broken.** `q=pharaoh` filtered to
   Egyptian Art returns **1** result. Never send `departmentId` — filter by the
   `department` field on the objects that come back instead.
2. **`hasImages=true` destroys relevance.** With it on, the nonsense query
   `zzzqqxx` returns **128** hits. Never send it — drop image-less objects
   locally instead.
3. **Bot protection.** ~24 parallel object requests trips Incapsula, which
   replies with an **HTML challenge page and HTTP 200** — so naive `.json()`
   throws a confusing `SyntaxError`. Mitigated with batches of 4, a pause
   between them, a real `User-Agent`, and a `content-type` check before parsing.

`findArtifacts` takes a `{hint, departments}` **source**, not an era id — custom
eras aren't in `ERA_SOURCES`. A source with `departments: null` disables the
lookup entirely and returns `[]` without a request.

**That `departments: null` escape hatch must stay**, even though no era
currently uses it. It was added for WWII, where the Met — an art museum with
essentially no Second World War holdings — returned *Young Lady in 1866* and
*Oedipus and the Sphinx* for "Operation Barbarossa". If an era is ever added
the collection can't evidence, disable it rather than shipping wrong objects:
a wrong artifact is worse than none, because the feature exists to make answers
more trustworthy.

Results are also deduplicated by title: the Met catalogues the panels of a
single wall painting as separate objects, so Augustus appeared three times.

**This suite is genuinely flaky.** It hits the live Met, which throttles under
repeated use, and different eras fail on different runs. Re-run before assuming
a regression. Making it deterministic would mean injecting a fake `fetch`.

---

## 7. Design decisions worth preserving

- **`resolveEraFor` falling back to `all` is what makes deletion safe.**
  A conversation stores an era key. That key can stop existing — a retired
  built-in (`ww2`), a custom era the visitor deleted, or another visitor's id.
  Looking it up directly yields `undefined`, and reading `.system` off that
  throws, which would make those conversations impossible to open. The fallback
  is why "delete an era" doesn't have to touch conversations at all.
  **Do not remove it.** There are tests for both the `ww2` and deleted-custom-era
  cases.
- **Artifacts arrive in an SSE event *after* `done`, not before.** The reply is
  stored and `done` sent the moment the model finishes; the stream stays open
  only to deliver artifacts, which then update the stored row. This replaced a
  4-second race the Met often lost, silently dropping artifacts it had found.
  Because the stream now outlives the reply, the client releases the composer on
  `done` — not in the stream's `finally`, which would leave the send button
  disabled for seconds after the answer was on screen.
- **No parchment, sepia, or serif "old document" styling.** This was rejected
  deliberately as the category reflex. The shell is a neutral near-black
  instrument; the era supplies the only colour that moves. Full reasoning in
  `PRODUCT.md`. The wordmark deliberately does **not** swap typeface per era —
  a product name that reshapes itself reads as a bug, not a theme.
- **Each era has its own display typeface**, loaded on demand (zero webfonts on
  first paint) and prewarmed on hover. Egypt uses a **slab serif** because slab
  serifs were called "Egyptians" by 19th-century type foundries; Medieval uses
  **Cardo**, designed for medieval scholarship; Islamic uses **Amiri**, revived
  from the Bulaq Press types; Song uses **Source Serif**, whose CJK sibling is a
  Songti. These are jokes with a reason.
- **No stock photography.** It was requested and declined. The only images in
  the app are real museum objects functioning as evidence. Adding decorative
  stock imagery would undo the point.
- **The transcript is deliberately NOT `aria-live`.** Its HTML is rewritten on
  every streamed token, so a live region there re-announces the whole answer
  hundreds of times per reply. A separate visually-hidden `[data-announcer]`
  region announces each finished reply exactly once. **Do not add `aria-live`
  back to the transcript.**
- **`/api/conversations/:id/regenerate` doubles as retry.** It only drops a
  stored reply when one is genuinely the last message. When a turn fails
  mid-stream the user message is stored but no reply is, so dropping
  unconditionally would delete the *previous* good answer.
- **Editing truncates by message id, not by role.** `DELETE ... WHERE id >= ?`
  makes the same edge case impossible by construction: editing an unanswered
  message removes only it, because the earlier reply's id is lower. Proven by
  mutating the code — an off-by-one produced 9 failures, over-deleting produced
  "the earlier good reply SURVIVED — DELETED".

---

## 8. What is built

- Streaming replies over SSE, with a working stop/abort button
- Per-visitor sessions via an `HttpOnly` cookie (not auth — it just stops two
  browsers sharing one conversation, which was a real bug earlier)
- SQLite persistence, with an idempotent `ALTER TABLE` migration pattern
- Multiple conversations, auto-titled from the first question, grouped by date
- Rename (inline) and delete (with a confirmation dialog) via a ⋯ row menu
- Copy and Regenerate on every reply; Try again on every error
- **Editing a sent message**, which truncates the conversation there and
  re-streams through the same path
- **Custom eras**: generated, validated, session-scoped, deletable
- Met Museum artifacts, delivered after `done`, cached 6h, failure-tolerant
- Rate limiting: 12 model calls/min per visitor, 30 writes/min
- Responsive: sidebar becomes a drawer under 860px; the conversation column is
  centred on wide monitors via a `--gutter` custom property
- Branding: the footprint mark (one `<symbol>`, used by both the sidebar and
  the empty state), favicon, and Open Graph / Twitter preview card
- `render.yaml`, `/healthz`, and a route count in the startup log

## 9. What is not built

- **The React frontend rewrite** — phase 2 of his learning plan.
- Conversation search, markdown export, accounts.
- **Deployment status is unconfirmed.** A Render service name exists and the
  social tags point at `https://vestige-ilw5.onrender.com`, but whether it is
  currently serving has not been verified from this machine.

---

## 10. How to run and test

```bash
npm install
# .env must contain GROQ_API_KEY (get one free at console.groq.com)
npm start          # http://localhost:3000, with --watch
npm run server     # same, without --watch
npm run cli        # the terminal version
```

**A stale server has caused two confusing bugs so far**, and both looked like
client bugs. Files in `public/` are re-read from disk on every request, so a
browser refresh picks them up — but `server.js` and `lib/` are loaded once at
startup. Client and server then drift, and the symptom is something like
"editing does nothing" or "request failed".

Two defences, both already in place:

- `npm start` runs with `--watch`, so the process restarts on server changes.
  `npm run server` does not — if you use it, restart by hand.
- The startup log prints a **route count**: `12 routes | database: …`. If that
  number doesn't match the code you just edited, the server didn't restart.
  This is the fastest way to tell.

There is no test framework. Testing is standalone Node scripts run against a
second server instance on port 3100 with `DB_PATH=data/test.db`, covering the
API surface, session isolation, artifact behaviour, message editing, custom era
validation, and prompt-injection containment.

If you add a feature, add checks in the same style, and:

- **Make assertions strict enough to fail.** `[].every(...)` is `true`, so a
  bare `.every()` passes when the thing you were checking never arrived. That
  hid a broken artifact pipeline once. Use a non-empty-and-all-match helper.
- **Prove the test bites.** Deliberately break the code and confirm the suite
  goes red before trusting a green run.

---

## 11. Conventions

- ES modules throughout (`"type": "module"`).
- Comments explain **why**, not what. Several comments in `lib/artifacts.js`
  and `lib/customEras.js` document API bugs and attack surfaces — keep them;
  they're the reason the code looks unusual.
- **Model output, museum data, and custom era labels are all untrusted text.**
  `md()` in `public/app.js` escapes HTML before applying a small markdown
  subset; museum fields and era labels are set with `textContent`. Don't
  introduce `innerHTML` on third-party strings — a custom era's label is
  model-written and reaches the era picker.
- Secrets live in `.env`, which is gitignored and has never been committed
  (verified). `data/` is gitignored too — it holds real conversations.
- Every interactive element needs keyboard access and a visible focus state;
  `prefers-reduced-motion` is honoured throughout.
- Nested buttons are invalid HTML and break keyboard navigation. Where a row
  needs its own action — conversation rows, custom era options, user messages —
  the row is a `<div>` containing buttons, not a button itself.
- **The `hidden` attribute is only `display: none` from the UA stylesheet, so
  any author `display` rule overrides it — silently.** `el.hidden = true` then
  does nothing and the element stays on screen. This has bitten repeatedly
  here: `.msg__actions`, `.to-bottom` and `.icon-btn` all set `display`, and
  the composer's old stop button shipped visible alongside Send because
  `display: grid` beat its `hidden` attribute. When a component sets `display`
  and is toggled with `hidden`, either pair it with an explicit
  `&[hidden] { display: none }`, or make the states mutually exclusive by
  construction — as the composer button now does, with one element, a
  `data-state` attribute, and CSS displaying exactly one icon per state. The
  second approach is better where it fits, because it makes the broken state
  unexpressible rather than merely guarded against.
- A standalone `.svg` file is XML, so a comment inside it can never contain a
  double hyphen — `public/favicon.svg` failed to parse because its comment
  mentioned a CSS custom property by name. Write "the accent variable", not the
  literal token, inside SVG comments.
- `app.router` on Express 4 is a deprecated getter that **throws**. Optional
  chaining doesn't help — reading it is the error. Check `app._router` first.
