import "dotenv/config";
import Groq from "groq-sdk";
import readline from "node:readline/promises";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "openai/gpt-oss-120b";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// THE MEMORY. Lives outside the loop, so it survives every turn.
const messages = [
  {
    role: "system",
    content:
      "You are a history expert. Answer clearly and include dates. Keep it under 100 words.",
  },
];

console.log("History bot ready. Type 'exit' to quit.\n");

while (true) {
  const question = await rl.question("You: ");

  if (question.toLowerCase() === "exit") break;

  // 1. Add what YOU said to the conversation.
  messages.push({ role: "user", content: question });

  // 2. Send the WHOLE conversation every time — not just the new question.
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: messages,
  });

  const reply = response.choices[0].message.content;

  // 3. Add the bot's answer too, or it forgets what it just said.
  messages.push({ role: "assistant", content: reply });

  console.log(`\nBot: ${reply}\n`);
}

rl.close();
