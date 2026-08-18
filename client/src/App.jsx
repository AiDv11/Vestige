import { useState, useEffect } from "react";

export default function App() {
  const [eras, setEras] = useState([]);
  const [era, setEra] = useState("all");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/eras")
      .then((r) => r.json())
      .then((data) => setEras(data))
      .catch(() => setEras([]));
  }, []);

  function send() {
    if (!input.trim()) return;
    setMessages([...messages, { role: "user", content: input }]);
    setInput("");
  }

  return (
    <div>
      <h1>Vestige</h1>

     {eras.map((e) => (
      <button
        key={e.id}
        onClick={() => setEra(e.id)}
        style={{ fontWeight: era === e.id ? "bold" : "normal" }}
      >
        {e.label}
      </button>
        ))}

      {messages.map((m, i) => (
        <p key={i}>
          <strong>{m.role}:</strong> {m.content}
        </p>
      ))}

      <input
        value={input}
        onChange={(ev) => setInput(ev.target.value)}
        onKeyDown={(ev) => ev.key === "Enter" && send()}
        placeholder="Ask a history question..."
      />

      <button onClick={busy ? () => setBusy(false) : send}>
        {busy ? "◼" : "→"}
      </button>
    </div>
  );
}