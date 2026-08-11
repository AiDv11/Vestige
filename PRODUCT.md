# Product

> ⚠️ **Draft — needs Ali's confirmation.** Written from our build conversation
> rather than a full init interview, because it was drafted while he was away.
> Review the Brand Personality and Anti-references sections especially.

## Register

product

## Users

Two audiences, and the second one is the real one:

1. **Curious people asking history questions** — a student, someone who just
   watched a documentary, someone settling an argument. They're at a laptop,
   casually, usually evening. They want a straight answer with dates, not an
   essay. Sessions are short and bursty: a question, a follow-up, a tangent.

2. **Internship recruiters and interviewers** — the actual reason this exists.
   They will open it for roughly ninety seconds. In that time it has to be
   obvious that this is a built thing with decisions behind it, not a wrapper
   around somebody else's API.

The job to be done: *ask a history question, get a trustworthy answer, and be
able to keep pulling the thread.*

## Product Purpose

A chat interface for history questions, where the user picks an **era** and the
assistant adopts that era's expertise — the era swaps both the system prompt and
the interface's accent color, so the shift is felt as well as read.

The era mechanic exists because the honest weakness of any chatbot project is
that it's one API call in a trench coat. Eras are the answer: they demonstrate
prompt engineering, application state, and theming in a way that reads
instantly, in the ninety seconds a recruiter gives it.

Success looks like: someone opens it, picks Ancient Rome, asks a question, asks
a follow-up that only makes sense in context ("when did he die?"), and it works.

## Brand Personality

**Instrument, not artifact.** Three words: *precise, curious, unfussy.*

This is a modern reference tool that happens to be about the past. The voice is
a good museum docent — knowledgeable, direct, never reverent about its own
subject matter. It gives you the date and moves on.

Emotionally the target is **confidence**: the user should feel they're using
something that knows what it's talking about, and the interface should never be
the reason they doubt an answer.

## Anti-references

- **Parchment, sepia, aged paper, wax seals, scrolls, blackletter.** The
  reflexive "history = old document" palette. This is a tool for asking
  questions, not a prop from a period drama.
- **Dark academia / museum-gilt** — deep navy and gold, serif everything. The
  second-order version of the same reflex. Also avoided.
- **"ChatGPT with a hat on."** If it reads as a generic chat box with a
  different logo, the project has failed at its actual job.
- **Fake authority.** No invented citations, no confident-looking source
  formatting that isn't real sourcing.

## Design Principles

1. **The era is the interface.** Switching era should visibly change the room,
   not just a dropdown value. It's the one gesture that carries the whole idea.
2. **Chrome stays neutral, era carries the color.** The shell is a quiet
   near-black instrument. Accent is the only thing that moves between eras —
   which is what makes the switch legible instead of noisy.
3. **Earned familiarity.** Chat is a solved pattern. Don't reinvent the input,
   the send button, or the scroll. Spend the novelty budget on the era mechanic.
4. **Honest about uncertainty.** The model can invent dates. The interface says
   so plainly, once, where it's relevant — rather than pretending to a
   reliability it doesn't have. This is a feature, not a disclaimer.
5. **Legible in ninety seconds.** A recruiter should understand what's
   interesting here without being told.

## Accessibility & Inclusion

- WCAG AA: body text ≥4.5:1, large text ≥3:1. Every era accent is checked
  against the surfaces it lands on, not just the default one.
- Era is never communicated by color alone — always a text label alongside.
- Full keyboard operation: send on Enter, era switching reachable by Tab.
- `prefers-reduced-motion` honored on every transition.
- Live region on the transcript so screen readers announce replies.
