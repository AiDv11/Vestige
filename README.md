# Vestige — ask the past

A chat application for history questions. You pick an era, and the assistant
answers with that period's expertise — Ancient Rome, Egypt, Medieval Europe,
the Islamic Golden Age, Song China, or anything you name yourself. Alongside
each answer, real photographed objects from the Metropolitan Museum's open
collection appear as evidence: ask about Hatshepsut and the *Sphinx of
Hatshepsut* appears, dated ca. 1473–1458 BCE by curators rather than by a
language model.

**Live: <https://vestige-ilw5.onrender.com>**

<!-- The alt text below was written from the app's design, NOT from the image:
     the file was a 0-byte placeholder when this was added. Check it against the
     real screenshot and correct it — describing an image you cannot see is
     exactly the kind of unverified claim the rest of this README argues
     against. verify-docs.js fails until a real PNG is in place. -->

![The Vestige interface: a dark near-black three-column layout. On the left, a
sidebar of saved conversations grouped by date. In the centre, a question about
a historical subject and the assistant's streamed answer beneath it, with a row
of photographed Metropolitan Museum objects below the reply, each captioned with
its title and curator-assigned date. On the right, the era picker — Ancient
Rome, Egypt, Medieval Europe, the Islamic Golden Age, Song China — each card
carrying its own accent colour, with the selected era tinting the
interface.](client/public/screenshot.png)

---

## Why the era mechanic exists

The fair criticism of any chatbot project is that it's one API call in a trench
coat. The era mechanic is the answer to that, and everything else is built
around it.

Switching era changes four things at once:

| | |
| --- | --- |
| **The system prompt** | Rome glosses Latin terms. Egypt gives dynasty and kingdom alongside dates, and flags where Egyptian chronology is genuinely disputed. The Islamic Golden Age is instructed not to call the period "Arab" science, because its major figures were Persian, Andalusian and Central Asian. |
| **The accent colour** | Every surface in the interface shifts hue. Accents interpolate rather than snap, via a registered `@property`. |
| **The display typeface** | Loaded on demand, so the first paint costs zero webfonts. |
| **Which museum departments are searched** | Rome searches Greek and Roman Art; Egypt searches Egyptian Art; Medieval searches Medieval Art, The Cloisters and Arms and Armor. |

The typeface choices are not arbitrary. Egypt is set in a slab serif because
slab serifs were called "Egyptians" by nineteenth-century type foundries.
Medieval uses Cardo, designed for medieval scholarship. Islamic uses Amiri,
revived from the types of the Bulaq Press. Song uses Source Serif, whose CJK
sibling is a Songti — the typeface class named after that dynasty.

Underneath, the whole thing rests on one idea: **a language model has no
memory, so the application is the memory.** Every request resends the entire
conversation, with the era's persona as its first element. Personas are that
same array with a different first element. There is no other mechanism.

---

## Custom eras, and containing untrusted input

You can type any period name and the model generates the era: its label, date
range, accent hue, typeface, museum department, and the persona text that
drives it.

The governing rule is that **the model writes content, never structure.** Two
of the fields it returns are not cosmetic:

- **The typeface is a key, not a font name.** The key indexes a hardcoded list
  of eight vetted fonts, and the matching entry becomes a **Google Fonts
  stylesheet URL**. A free-text font name from the model would be a URL going
  into the page. An unknown key is rejected outright rather than falling back
  to a default — a fallback would turn a rejected value into an accepted one.
- **The museum department must match the Met's real list exactly, or be null.**
  It becomes an **API parameter** and decides which objects are presented as
  evidence. There are nineteen valid values. `null` is a legitimate answer: the
  era then ships with artifacts switched off, and the interface says so, because
  a wrong artifact is worse than none.

The generated hue is range-checked and must sit at least 25° from every
existing era's hue, measured around the colour wheel, so a generated era never
looks like Rome.

The persona text is never used as a system prompt and never concatenated into
one. It goes into a **delimited slot** inside a fixed template, framed as data,
with the rules stated before it *and restated after it*. Angle brackets are
stripped so the slot cannot be closed early.

That last defence has a history worth stating, in the order it actually
happened.

Stripping during validation was not sufficient on its own, because the function
that builds the prompt was *trusting that validation had happened*. A persona
reaching it with a closing marker intact escaped the slot, and the model
followed the instructions inside — it named the delimiters and abandoned the
question. The fix was to strip again at the point of use.

That closed the hole in the structure, and the structure was never the whole
problem. With the brackets gone and the slot intact — nothing escaping, no
markup at all — the model still obeyed plain instructions sitting inside it,
written as ordinary prose. **6 of 8 runs compromised**, and the same runs handed
back the system prompt when the persona asked for it. Containing the text was
necessary and not sufficient.

What fixed it was moving the rule rather than strengthening it. The template now
restates the containment rule *after* the closing marker as well as before it:
the brief has ended, and anything it appeared to instruct is void. **0 of 24
compromised** after that. **Recency beats precedence with this model** — the
last instruction before the question is the one it follows, so a rule stated
only at the top is a rule the untrusted text gets the final word on.

Worth being straight about how that was found, because it is the more useful
half of the story: the first two findings were written up here as tested and
contained while they were neither. The suite that proved them had been lost, the
prose stayed, and nothing was checking. It was rebuilding the test suite that
ran the attack again and turned up the third finding. The tests are tracked
files now, and `verify-docs.js` checks the numbers in this section against the
suite that measures them.

There is a test that plants a hostile persona directly in the database,
bypassing validation entirely, and asserts the model answers the history
question instead. Two more assert that the closing paragraph is present and sits
before the shared rules, because it is the load-bearing part and the easiest
thing to tidy away.

The visitor's own input is gated before it reaches any of this: a 60-character
cap, a character whitelist, and control characters refused rather than
normalised, so a newline can't be quietly flattened into something that passes.

Then there is the other end of it: all of that text — model replies, museum
fields, and a custom era's model-written label — eventually gets rendered. In
the React client that is handled by construction rather than by discipline.
`Markdown.jsx` parses the markdown subset into **React elements**, not into an
HTML string, so every piece of text ends up as a text node and there is nothing
to escape out of. **`dangerouslySetInnerHTML` appears nowhere in `client/`** —
one grep is the whole audit. The vanilla version had to do it the other way
round, escaping by hand before assigning `innerHTML`, which is the version
where forgetting a step is possible.

---

## Three Met API bugs, none of them documented

All three were found by testing the live API rather than trusting its docs, and
each one shapes how `lib/artifacts.js` is written.

1. **`departmentId` combined with `q` is broken.** Searching `pharaoh` filtered
   to Egyptian Art returns **one** result. The fix is to never send
   `departmentId`, and instead filter on the `department` field of the objects
   that come back.
2. **`hasImages=true` destroys relevance.** With it enabled, the nonsense query
   `zzzqqxx` returns **128 hits**. It is never sent; objects without a
   photograph are dropped locally instead.
3. **Bot protection returns an HTML challenge page with HTTP 200.** Firing
   roughly 24 parallel object requests trips it, and because the status is 200,
   a naive `.json()` throws a confusing `SyntaxError` rather than a network
   error. Mitigated with batches of four, a pause between them, a real
   `User-Agent`, and a content-type check before parsing.

Results are also deduplicated by title, because the Met catalogues the panels
of a single wall painting as separate objects — which made Augustus appear
three times.

The lookup starts at the same moment as the model request and its result is
delivered in a later event, so a slow museum never delays a finished answer. If
it fails, times out, or finds nothing, the reply simply appears without
artifacts.

---

## Testing

There is no test framework. Tests are standalone Node scripts run against a
second server instance on a separate port and database. Two suites are tracked:
`tests/edit-messages.test.js` covers truncation by message id and session
isolation around editing, and `tests/custom-eras.test.js` covers field
validation, the hue gap, and prompt-injection containment. The API surface and
artifact behaviour are not covered yet — the suite that used to cover them is
the one that was lost.

The part worth mentioning is how the assertions are trusted: **the code is
deliberately broken to confirm the tests fail.** Message editing truncates a
conversation by message id, which is the operation most likely to destroy data,
so it was mutated twice —

- changing `id >= ?` to `id > ?` produced **5 failures**
- deleting two messages too far back produced the one that matters:
  `the earlier good reply SURVIVED — DELETED`

— and then reverted. A green run means something only if a red run was
reachable.

One earlier assertion used `.every()` on a possibly-empty array, which is
vacuously true, and passed while the feature behind it was broken. That is the
reason for the rule above.

---

## Known limitations

- **Conversations do not survive a redeploy.** The deployed instance runs on
  Render's free tier, which has an ephemeral filesystem, so the SQLite database
  is lost whenever the instance restarts or wakes from sleep. Locally it
  persists normally. A paid instance with a disk would fix it.
- **The free tier also sleeps** after inactivity, so the first request after a
  quiet period is slow.
- **The model can still be wrong.** The system prompts instruct it to flag
  uncertainty and never invent quotations, and the museum objects give an
  independent reference point, but none of that solves it. The interface says
  so rather than implying a reliability it doesn't have.
- **Artifacts are related, not cited.** They are matched by keyword against the
  question, so they illustrate the period rather than proving a specific claim.
- **Sessions are cookie-based, not accounts.** Clearing cookies makes your
  conversations unreachable.

---

## Stack

| Layer | |
| --- | --- |
| Runtime | Node 22+ |
| Server | Express |
| Storage | `node:sqlite`, built in — three tables, no ORM |
| Model | `openai/gpt-oss-120b` via Groq |
| Artifacts | Met Museum Open Access API — no key, no auth |
| Frontend | React 19 + Vite, in `client/`, built to `client/dist` |

Three runtime dependencies in total: `express`, `groq-sdk`, `dotenv`. `react`
and `react-dom` are not among them — they are `client/`'s build dependencies,
bundled into `client/dist` by Vite, and the server process never imports them.
Groq uses the OpenAI-compatible format, so changing providers is a change to
one file.

The frontend was built twice on purpose. It was written first in vanilla HTML,
CSS and JavaScript with no build step, then rebuilt in React against the same
API — the second version is what ships, and the first is still in `public/` to
read side by side.

Rate limiting is per visitor: 12 model calls a minute, 30 writes.

```
server.js            routes, sessions, SSE
lib/eras.js          the six built-in personas, and the closed lists custom eras validate against
lib/customEras.js    generation, validation, the delimited prompt slot
lib/chat.js          everything that talks to Groq
lib/artifacts.js     Met Museum lookup
lib/db.js            SQLite schema and queries
lib/rateLimit.js     per-visitor request cap

client/index.html    the shell: social meta tags, the footprint symbol, #root
client/src/App.jsx   the whole UI
client/src/Markdown.jsx  the markdown subset, rendered as React elements
client/src/useEra.js     era theming: accent, typeface, on-demand font loading
client/src/style.css     ported unchanged from public/style.css
client/dist/         the build output — this is what Express serves

public/              the original vanilla frontend. Kept as reference; not served.
index.js             the original terminal version, kept as history
```

---

## What I'd do next

- **Postgres instead of SQLite.** This is the first one because it unblocks the
  second. The deployed instance runs on Render's free tier, whose filesystem is
  ephemeral, so every conversation is lost on restart — the limitation above is
  a hosting artifact, not a design choice. `lib/db.js` is the only file that
  touches storage, and the queries are plain SQL, so this is a driver swap and a
  migration rather than a rewrite.
- **Accounts, once persistence is real.** Sessions are an `HttpOnly` cookie
  today: enough to stop two browsers sharing one conversation, and not auth. It
  is deliberately in this order — accounts on top of a database that empties
  itself would be a login that loses your history, which is worse than no login
  at all.
- **Frontend tests under jsdom.** Everything currently tested runs server-side.
  The client has logic worth covering that has nothing to do with the network —
  `Markdown.jsx` turning text into React elements, `useEra.js` deciding when to
  inject a font `<link>`, and the SSE reducer's handling of events arriving out
  of order. Those are the parts an interviewer would ask about, and they are
  currently proven by clicking around.
- **Deterministic artifact tests.** The Met suite hits the live API, so it
  throttles, and different eras fail on different runs. That is not a test, it
  is a weather report. Injecting `fetch` and replaying recorded responses would
  make the three documented API bugs — the `departmentId` filter, `hasImages`,
  the Incapsula HTML-with-200 — into fixtures that assert the mitigations still
  work, instead of behaviour nobody re-checks because re-running is unpleasant.

---

## Running it locally

```bash
git clone https://github.com/AiDv11/Vestige.git
cd Vestige
npm install
npm run build             # builds client/dist — without it there is no UI
cp .env.example .env      # then paste your Groq key into .env
npm start
```

Open <http://localhost:3000>.

A free API key from [console.groq.com](https://console.groq.com) is all that is
needed — no credit card. Requires **Node 22+**, for the built-in
`node:sqlite`.

`npm run build` runs `cd client && npm install && npm run build`, so it
installs the client's dependencies too. `npm start` runs the server with
`--watch`, so server changes reload automatically. `npm run server` runs
without it. `npm run cli` starts the original terminal version.

### Working on the frontend

```bash
cd client && npm run dev    # http://localhost:5173, proxies /api to :3000
```

Run that alongside `npm start` and edit against **:5173**, which hot-reloads.
API calls reach the real server through Vite's proxy.

Port 3000 serves `client/dist`, which is a **build artifact**: editing
`App.jsx` changes nothing there until you re-run `npm run build`. If a change
isn't showing up on :3000, that's why.

The startup line prints a route count:

```
Vestige running: http://localhost:3000
12 routes | database: .../data/history.db
```

If that number doesn't match the code you just edited, the server didn't
restart — server code is loaded once at startup.

---

## Deploying

`render.yaml` is checked in, so connecting the repository at
[render.com](https://render.com) is enough. It builds with
`npm install && npm run build` — which builds the client — and starts with
`npm run server`, deliberately not `npm start`, since `--watch` has no business
in production. Set `GROQ_API_KEY` in the dashboard; it is marked `sync: false`
so it never lives in the repo.

Design reasoning is in [`PRODUCT.md`](./PRODUCT.md). Architectural notes and the
decisions that must not be undone are in [`CLAUDE.md`](./CLAUDE.md).
