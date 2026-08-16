# Vestige

**ask the past**

A chat interface for history questions. Pick an era — Ancient Rome, Egypt,
Medieval Europe, WWII — and the assistant adopts that period's expertise. The
era changes the system prompt behind the conversation, the accent colour of the
interface, and the display typeface, so switching is felt as well as read.

Replies stream in token by token. Conversations are saved, titled
automatically, and kept separate per visitor.

Answers arrive with **real museum objects** beside them — photographed
artifacts from the Metropolitan Museum's open collection, with their catalogue
dates and a link to the Met. Ask about Hatshepsut and you get the *Sphinx of
Hatshepsut*, dated ca. 1473–1458 BCE by curators rather than by a language
model.

Each conversation keeps its own thread. Ask "Who was Sulla?" then "When did he
die?" — it knows. Start a WWII chat and ask the same follow-up, and it
correctly has no idea who you mean.

---

## Run it

```bash
git clone https://github.com/AiDv11/history-bot.git
cd history-bot
npm install
cp .env.example .env      # then paste your Groq key into .env
npm run server
```

Open <http://localhost:3000>.

A free API key from [console.groq.com](https://console.groq.com) is all you need
— no credit card. There's also a terminal version: `npm start`.

Requires **Node 22+** (it uses the built-in `node:sqlite`).

---

## How it works

The whole thing rests on one idea: **an LLM has no memory, so the app is the
memory.** Every request sends the entire conversation back to the model.

```js
// lib/chat.js
export function buildMessages(era, turns) {
  return [
    { role: "system", content: ERAS[era].system },  // the persona
    ...turns,                                        // everything said so far
  ];
}
```

**Personas** are that same array with a different first element. Each era's
system prompt defines what the assistant knows and how it speaks: Rome glosses
Latin terms, Egypt flags disputed chronology, WWII is instructed to handle
atrocities without euphemism. Same model, different instructions.

### Streaming

Replies arrive over **Server-Sent Events** — one long-lived HTTP response the
server writes to as tokens arrive from the model. One-way data, so SSE fits
better than WebSockets.

```
POST /api/conversations/:id/messages
  → data: {"type":"delta","text":"Lucius"}
  → data: {"type":"delta","text":" Cornelius"}
  → data: {"type":"done","title":"Sulla Roman Dictator"}
```

`EventSource` only does GET, so the browser reads the response body with a
stream reader and parses the frames by hand (`readStream` in `public/app.js`).
Aborting the fetch cancels generation server-side and keeps whatever already
streamed in.

### Grounding answers in real objects

A language model can invent a date. A museum catalogue entry can't — it has an
accession number, a photograph, and a curator behind it. So every answer is
accompanied by objects pulled live from the
[Met's Open Access API](https://metmuseum.github.io/) (no key, no auth).

The lookup starts **at the same moment as the model request** and resolves
while the reply is still streaming, so it costs the user no extra waiting.

Three things had to be handled, all found by testing the live API rather than
trusting the docs:

| What the API does | What `lib/artifacts.js` does about it |
| --- | --- |
| `departmentId` combined with `q` is broken — *"pharaoh"* filtered to Egyptian Art returns **1** result | Never sends `departmentId`; filters by department on the objects that come back |
| `hasImages=true` destroys relevance — with it on, the nonsense query *"zzzqqxx"* returns **128** hits | Never sends it; drops image-less objects locally instead |
| ~24 parallel object requests trips their bot protection, which replies with an **HTML challenge page and a 200** | Batches of 4 with a pause, a real `User-Agent`, and a content-type check before parsing |

**WWII deliberately has no artifacts.** The Met is an art museum with
essentially no Second World War holdings, and testing showed the search
returning a portrait from 1866 and *Oedipus and the Sphinx* for "Operation
Barbarossa". Since the entire point of the feature is that the evidence is
real, an era with no real evidence shows none. Results are also deduplicated by
title — the Met catalogues the panels of one wall painting as separate objects.

The whole feature is failure-tolerant by design: on a network error, a bot
block, a timeout, or thin results, `findArtifacts` returns an empty array and
the reply simply appears without artifacts. It can never break the chat.

### Sessions

Each visitor gets a random id in an `HttpOnly` cookie. Not authentication — it
just means two browsers get two separate sets of conversations. Every query is
scoped by it, so requesting someone else's conversation id returns a 404 rather
than their chat.

### Storage

`node:sqlite`, built into Node 22+ — no dependency to install, no native module
to compile. Two tables, `conversations` and `messages`, with
`ON DELETE CASCADE` so deleting a conversation takes its messages with it.

### Routes

| Method   | Route                                | Does                                    |
| -------- | ------------------------------------ | --------------------------------------- |
| `GET`    | `/api/eras`                          | Era list — the UI builds itself from it |
| `GET`    | `/api/conversations`                 | This session's conversations            |
| `POST`   | `/api/conversations`                 | Create one for an era                   |
| `GET`    | `/api/conversations/:id`             | Conversation + its messages             |
| `PATCH`  | `/api/conversations/:id`             | Rename                                  |
| `DELETE` | `/api/conversations/:id`             | Delete                                  |
| `POST`   | `/api/conversations/:id/messages`    | Send a message → **SSE stream**         |
| `POST`   | `/api/conversations/:id/regenerate`  | Redo the last reply → **SSE stream**    |

### Layout

```
server.js          routes, sessions, SSE plumbing
lib/eras.js        era personas and system prompts
lib/chat.js        everything that talks to Groq
lib/artifacts.js   the Met Museum lookup
lib/db.js          SQLite storage
lib/rateLimit.js   per-visitor request cap
public/            the frontend — no build step
index.js           the original terminal version
```

---

## Stack

| Layer    | Choice                            |
| -------- | --------------------------------- |
| Runtime  | Node 22+                          |
| Server   | Express                           |
| Storage  | `node:sqlite` (built in)          |
| Model    | `openai/gpt-oss-120b` via Groq    |
| Frontend | Vanilla HTML / CSS / JS, no build |

Three runtime dependencies total: `express`, `groq-sdk`, `dotenv`. No frontend
framework and no build step — the browser reads the three files in `public/`
directly. Groq uses the OpenAI-compatible format, so switching providers is a
change to one file.

---

## Deploying

`render.yaml` is checked in, so connecting the repo at
[render.com](https://render.com) is enough — it reads the config, installs, and
runs `npm start`. Set `GROQ_API_KEY` in the dashboard (it's marked `sync: false`
so it never lives in the repo).

Two things to know about the free tier: the service **sleeps after ~15 minutes**
of inactivity, so the first request after a quiet spell takes about a minute;
and the filesystem is **ephemeral**, so saved conversations reset whenever the
instance restarts. Both are fine for a demo. A paid instance with a persistent
disk fixes both.

Because the deployed key is reachable by anyone with the URL, `/api/.../messages`
and `/api/.../regenerate` are capped at 12 requests per minute per visitor
(`lib/rateLimit.js`).

---

## Design notes

The obvious visual direction for a history app is parchment, sepia and serifs.
That was rejected deliberately: this is a tool for asking questions, not a prop
from a period drama. The shell is a neutral near-black instrument and the era
supplies what moves — verdigris for general history (the green of oxidised
bronze on excavated artifacts), oxide red for Rome, gold for Egypt, indigo for
Medieval, steel for WWII.

Each era also gets its own display typeface, and there's a joke buried in the
choices: **Egypt is set in a slab serif**, because slab serifs were literally
called "Egyptians" by 19th-century type foundries. Medieval uses **Cardo**,
which was designed for medieval and classical scholarship.

Fonts are fetched **only when an era is first opened**, and prewarmed on hover,
so the initial page load costs zero webfonts. Body text is the system stack
everywhere.

Accents and surface tints interpolate rather than snap between eras, via
registered `@property` custom properties.

Accessibility: WCAG AA contrast throughout, era never signalled by colour alone,
full keyboard operation, `prefers-reduced-motion` honoured, transcript is a live
region.

Fuller reasoning in [`PRODUCT.md`](./PRODUCT.md).

---

## Known limitations

- **The model can be wrong.** It will occasionally produce confident, incorrect
  dates or attributions. The system prompts instruct it to flag uncertainty and
  never invent quotations, and the museum artifacts give an independent, real
  reference point — but none of that *solves* it. The interface says so plainly
  rather than implying a reliability it doesn't have.
- **Artifacts are related, not cited.** They're matched by keyword against the
  question, so they illustrate the period rather than proving a specific claim.
  Abstract questions ("why did the Republic fall?") match less precisely than
  ones about a person or object.
- **Sessions are cookie-based, not accounts.** Clear your cookies and your
  conversations become unreachable. Fine for a single-user tool; real accounts
  would need auth.
- **Node prints an experimental warning** for `node:sqlite` on startup. Harmless.
- **No rate limiting.** Fine locally; would need adding before a public deploy.

---

## Roadmap

- [ ] Rate limiting before any public deployment
- [ ] Search across past conversations
- [ ] Export a conversation to markdown
- [ ] Rebuild the frontend in React as a second implementation
