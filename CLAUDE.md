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

---

## 2. What the project is

A web chat application for history questions. The user picks an **era**, and
the assistant adopts that period's expertise.

Repo: `https://github.com/AiDv11/history-bot`
Local path: `C:\Users\ali66\Desktop\Projects\GIThub\history-bot`

The era mechanic is the product's whole reason for existing. It was chosen
deliberately to answer the criticism that any chatbot project is "one API call
in a trench coat": switching era changes the system prompt, the accent colour,
the display typeface, and the museum artifacts shown alongside answers.

Five eras: `all`, `rome`, `egypt`, `medieval`, `ww2`.

---

## 3. Stack, and why

| Layer | Choice | Reason it was chosen |
| --- | --- | --- |
| Runtime | Node 22+ | He already knew JavaScript. FastAPI was considered and rejected — learning Python *and* the LLM concepts at once was judged too much at once. |
| Server | Express | Minimal, familiar |
| Model | `openai/gpt-oss-120b` via **Groq** | Free tier, no credit card. Chosen over Google Gemini because a friend of his uses Groq and can help him when stuck — that support outweighed a small model-quality difference. |
| Storage | `node:sqlite` | Built into Node 22+. Zero dependencies, no native compilation. |
| Frontend | Vanilla HTML/CSS/JS | No build step. A React rewrite of *only the frontend* is the planned phase 2, deliberately, so he learns React by comparison against an app he already understands. |
| Artifacts | Met Museum Open Access API | No key, no auth |

**Three runtime dependencies total:** `express`, `groq-sdk`, `dotenv`.
Keep it that way unless there's a strong reason not to.

---

## 4. File map

```
server.js           routes, session cookie, SSE plumbing, rate limits
lib/eras.js         the five personas and their system prompts
lib/chat.js         everything that talks to Groq (streaming + titling)
lib/artifacts.js    Met Museum lookup
lib/db.js           SQLite schema, migrations, queries
lib/rateLimit.js    in-memory per-visitor request cap
public/index.html   markup
public/style.css    all styling, no framework
public/app.js       all client logic, no framework
index.js            the original terminal-only version, kept as history
PRODUCT.md          design strategy and rationale
README.md           user-facing documentation
```

---

## 5. The core idea, stated once

**An LLM has no memory, so the application is the memory.** Every request
resends the whole conversation:

```js
[ { role: "system", content: ERAS[era].system },   // the persona
  ...storedTurns ]                                  // everything said so far
```

Personas are that same array with a different first element. There is no other
magic. If you're explaining this project to Ali, this is the sentence that
matters most.

---

## 6. Hard-won facts — do not rediscover these

### Groq / `openai/gpt-oss-120b`

- **The model reasons before answering, and that reasoning is billed against
  `max_completion_tokens`.** With a tight cap it spends the entire allowance
  thinking and returns **empty content** with `finish_reason: "length"`. This
  silently broke conversation auto-titling. The fix in `lib/chat.js` is
  `reasoning_effort: "low"` plus ~200 tokens of headroom. Don't lower it.

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

**WWII artifacts are disabled on purpose.** The Met is an art museum with
essentially no Second World War holdings; testing returned *Young Lady in 1866*
and *Oedipus and the Sphinx* for "Operation Barbarossa". `ERA_SOURCES.ww2` has
`departments: null`. **Do not "fix" this** — a wrong artifact is worse than
none, because the feature exists to make answers more trustworthy.

Results are also deduplicated by title: the Met catalogues the panels of a
single wall painting as separate objects, so Augustus appeared three times.

---

## 7. Design decisions worth preserving

- **No parchment, sepia, or serif "old document" styling.** This was rejected
  deliberately as the category reflex. The shell is a neutral near-black
  instrument; the era supplies the only colour that moves. Full reasoning in
  `PRODUCT.md`.
- **Each era has its own display typeface**, loaded on demand (zero webfonts on
  first paint) and prewarmed on hover. Egypt uses a **slab serif** because slab
  serifs were called "Egyptians" by 19th-century type foundries; Medieval uses
  **Cardo**, designed for medieval scholarship. These are jokes with a reason.
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
  unconditionally would delete the *previous* good answer. There is a
  regression test for exactly this.

---

## 8. What is built

- Streaming replies over SSE, with a working stop/abort button
- Per-visitor sessions via an `HttpOnly` cookie (not auth — it just stops two
  browsers sharing one conversation, which was a real bug earlier)
- SQLite persistence, with an idempotent `ALTER TABLE` migration pattern
- Multiple conversations, auto-titled from the first question, grouped by date
- Rename (inline) and delete (with a confirmation dialog) via a ⋯ row menu
- Copy and Regenerate on every reply; Try again on every error
- Met Museum artifacts, fetched in parallel with the model so they cost no
  extra wall-clock time, cached 6h, failure-tolerant
- Rate limiting: 12 model calls/min per visitor, 30 writes/min
- Responsive: sidebar becomes a drawer under 860px; the conversation column is
  centred on wide monitors via a `--gutter` custom property
- `render.yaml` and `/healthz` for deployment

## 9. What is not built

- **Editing a sent message** — the next planned feature. Needs server-side
  truncation of the conversation at that point, then a re-stream.
- **The React frontend rewrite** — phase 2 of his learning plan.
- Conversation search, markdown export, accounts.
- **Not yet deployed.** `render.yaml` is ready; he hasn't connected the repo.

---

## 10. How to run and test

```bash
npm install
# .env must contain GROQ_API_KEY (get one free at console.groq.com)
npm start          # http://localhost:3000
npm run cli        # the terminal version
```

Server code is loaded once at startup — **any change to `server.js` or `lib/`
requires restarting the process.** Files in `public/` are read per request, so
a browser refresh is enough for those (hard-refresh, since CSS caches).

There is no test framework. Testing was done with standalone Node scripts that
hit a second server instance on port 3100 with `DB_PATH=data/test.db`, covering
the full API surface, session isolation, artifact behaviour, and the retry
edge case. If you add a feature, add a check in the same style — and make
assertions strict enough to fail. One earlier test passed on a fallback value
and hid a genuinely broken feature.

---

## 11. Conventions

- ES modules throughout (`"type": "module"`).
- Comments explain **why**, not what. Several comments in `lib/artifacts.js`
  document API bugs — keep them; they're the reason the code looks unusual.
- Model output and museum data are both **untrusted text**. `md()` in
  `public/app.js` escapes HTML before applying a small markdown subset; museum
  fields are set with `textContent`. Don't introduce `innerHTML` on third-party
  strings.
- Secrets live in `.env`, which is gitignored and has never been committed
  (verified). `data/` is gitignored too — it holds real conversations.
- Every interactive element needs keyboard access and a visible focus state;
  `prefers-reduced-motion` is honoured throughout.
- A standalone `.svg` file is XML, so a comment inside it can never contain a
  double hyphen — `public/favicon.svg` failed to parse because its comment
  mentioned a CSS custom property by name. Write "the accent variable", not the
  literal token, inside SVG comments.
