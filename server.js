import "dotenv/config";
import express from "express";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "openai/gpt-oss-120b";
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// ERAS
// Each era is a persona: a label the UI shows, and a system prompt that
// changes what the assistant knows and how it speaks. Swapping the era is
// the entire "personality" mechanic — same model, different instructions.
// ---------------------------------------------------------------------------

const SHARED_RULES = `
Answer in under 120 words unless asked for more. Lead with the direct answer,
then context. Always give specific dates where they exist.
If you are genuinely unsure of a date, figure, or attribution, say so in a
short clause rather than guessing — do not invent precise-sounding details.
Never invent quotations or citations.
`.trim();

const ERAS = {
  all: {
    label: "All History",
    blurb: "Anything, any period",
    system: `You are a historian with broad expertise across all periods and regions.
When a question spans eras, say so and place it in context. ${SHARED_RULES}`,
  },
  rome: {
    label: "Ancient Rome",
    blurb: "753 BC – 476 AD",
    system: `You are a specialist in Roman history, from the founding through the
Republic, the Principate, and the fall of the West. You know the politics,
the military, the constitution, and daily life. Use Roman terms (consul,
princeps, legion, cursus honorum) and briefly gloss them. ${SHARED_RULES}`,
  },
  egypt: {
    label: "Ancient Egypt",
    blurb: "3100 – 30 BC",
    system: `You are an Egyptologist. You know the dynasties, the pharaohs, religion
and burial practice, hieroglyphs, and the Nile's role in Egyptian life. Give
dynasty and kingdom (Old/Middle/New) alongside dates, and flag where Egyptian
chronology is genuinely disputed rather than presenting one scheme as settled.
${SHARED_RULES}`,
  },
  medieval: {
    label: "Medieval Europe",
    blurb: "476 – 1453",
    system: `You are a medievalist covering Europe from the fall of Rome to the fall of
Constantinople. Feudalism, the Church, the Crusades, plague, guilds and towns,
and the dynastic wars. Push back on popular myths about the period when they
come up — briefly, without lecturing. ${SHARED_RULES}`,
  },
  ww2: {
    label: "World War II",
    blurb: "1939 – 1945",
    system: `You are a specialist in the Second World War: causes, campaigns and
theatres, strategy and logistics, the home fronts, and the Holocaust. Be
precise about dates, units, and figures. Treat atrocities with directness and
gravity — never euphemism, never sensationalism. ${SHARED_RULES}`,
  },
};

// ---------------------------------------------------------------------------
// CONVERSATION MEMORY
// One conversation per era, so switching eras doesn't scramble context.
// Same idea as the array in index.js — just one array per era.
// ---------------------------------------------------------------------------

const conversations = new Map();

function getConversation(eraId) {
  if (!conversations.has(eraId)) {
    conversations.set(eraId, [{ role: "system", content: ERAS[eraId].system }]);
  }
  return conversations.get(eraId);
}

// ---------------------------------------------------------------------------
// SERVER
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static("public"));

// The browser asks for the era list on load, so the UI is built from this
// file rather than hardcoded in two places.
app.get("/api/eras", (req, res) => {
  res.json(
    Object.entries(ERAS).map(([id, era]) => ({
      id,
      label: era.label,
      blurb: era.blurb,
    })),
  );
});

app.post("/api/chat", async (req, res) => {
  const { message, era = "all" } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Message is empty." });
  }
  if (!ERAS[era]) {
    return res.status(400).json({ error: `Unknown era: ${era}` });
  }

  const messages = getConversation(era);
  messages.push({ role: "user", content: message });

  try {
    const response = await groq.chat.completions.create({
      model: MODEL,
      messages,
    });

    const reply = response.choices[0].message.content;
    messages.push({ role: "assistant", content: reply });

    res.json({ reply });
  } catch (error) {
    // Roll back the user message so a failed turn doesn't poison the history.
    messages.pop();
    console.error("Groq request failed:", error.message);
    res.status(502).json({ error: "Couldn't reach the history archives. Try again." });
  }
});

app.post("/api/reset", (req, res) => {
  const { era = "all" } = req.body;
  conversations.delete(era);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`History bot running: http://localhost:${PORT}`);
});
