# History Bot

A chat interface for history questions. Pick an era — Ancient Rome, Egypt,
Medieval Europe, WWII — and the assistant adopts that period's expertise. The
era changes both the system prompt behind the conversation and the accent
colour of the interface, so the switch is felt as well as read.

Each era keeps its **own conversation thread**. Ask "Who was Sulla?" in Rome,
then "When did he die?" — it knows. Switch to WWII and ask the same follow-up,
and it correctly has no idea who you mean.

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
— no credit card.

There's also a terminal version:

```bash
npm start
```

---

## How it works

The whole thing is one idea repeated: **an LLM has no memory, so the app is the
memory.**

Every request sends the entire conversation back to the model. `server.js`
keeps one array per era:

```js
const conversations = new Map();   // era id → message array

conversations.get("rome");
// [ { role: "system",    content: "You are a specialist in Roman history…" },
//   { role: "user",      content: "Who was Sulla?" },
//   { role: "assistant", content: "Lucius Cornelius Sulla (138 BC – 78 BC)…" } ]
```

The array grows with every turn. That's the entire memory mechanism — there's
no database and no session store.

**Personas** are the same array, different first element. Each era's `system`
message defines what the assistant knows and how it speaks; Rome glosses Latin
terms, Egypt flags disputed chronology, WWII is instructed to handle atrocities
without euphemism. Same model, different instructions.

### Routes

| Method | Route        | Does                                        |
| ------ | ------------ | ------------------------------------------- |
| `GET`  | `/api/eras`  | Era list — the UI builds itself from this   |
| `POST` | `/api/chat`  | `{ message, era }` → `{ reply }`            |
| `POST` | `/api/reset` | Clears one era's conversation               |

---

## Stack

| Layer    | Choice                              |
| -------- | ----------------------------------- |
| Runtime  | Node                                |
| Server   | Express                             |
| Model    | `openai/gpt-oss-120b` via Groq      |
| Frontend | Vanilla HTML / CSS / JS, no build   |

No framework and no build step — the frontend is three files the browser reads
directly. Groq's API follows the OpenAI-compatible format, so switching
providers is a change to two lines.

---

## Design notes

The obvious visual direction for a history app is parchment, sepia and serifs.
That was rejected deliberately: this is a tool for asking questions, not a prop
from a period drama. The shell is a neutral near-black instrument and the era
supplies the only colour that moves — verdigris for general history (the green
of oxidised bronze on excavated artifacts), oxide red for Rome, gold for Egypt,
indigo for Medieval, steel for WWII.

Accents interpolate rather than snap between eras, via a registered
`@property --accent`.

Accessibility: WCAG AA contrast throughout, era never signalled by colour alone,
full keyboard operation (arrow keys move through eras), `prefers-reduced-motion`
honoured, and the transcript is a live region.

Fuller reasoning in [`PRODUCT.md`](./PRODUCT.md).

---

## Known limitations

- **The model can be wrong.** It will occasionally produce confident, incorrect
  dates or attributions. The system prompts instruct it to flag uncertainty and
  never invent quotations, but that reduces the problem rather than solving it.
  The interface says so plainly rather than implying a reliability it doesn't
  have.
- **Memory lives in server RAM.** Restart the server and conversations are gone.
- **Single-user.** All browsers hitting the server share the same conversation
  per era. Multi-user would need a session ID per client.
- **No streaming.** Replies arrive complete rather than word-by-word.

---

## Roadmap

- [ ] Stream responses (SSE) for word-by-word output
- [ ] Per-session conversations instead of one shared server-side thread
- [ ] Persist history to SQLite
- [ ] Rebuild the frontend in React as a second implementation
