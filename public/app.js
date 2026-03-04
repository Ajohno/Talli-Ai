// public/app.js
// This runs in the browser. It calls YOUR server endpoint (/api/agent).

const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const outEl = document.getElementById("out");

// Helper to display text
function setOut(text) {
  outEl.textContent = text;
}

sendBtn.addEventListener("click", async () => {
  const message = promptEl.value.trim();

  if (!message) {
    setOut("Type something first 🙂");
    return;
  }

  setOut("Agent is thinking...");

  try {
    // Call our server agent endpoint
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const data = await res.json();

    if (!res.ok) {
      setOut(data?.error || "Server error.");
      return;
    }

    setOut(data.answer || "(No answer returned.)");
  } catch (e) {
    console.error(e);
    setOut("Network error. Is the server running?");
  }
});