// public/app.js
// This file runs in the BROWSER.
// It sends the user's text to your server endpoint (/api/ask).

// Grab references to HTML elements we care about.
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("sendBtn");
const outputEl = document.getElementById("output");

// A helper function to safely set output text.
function setOutput(text) {
  outputEl.textContent = text;
}

// When the user clicks the button, we send their prompt to the server.
sendBtn.addEventListener("click", async () => {
  // Read the user's input from the textarea.
  const message = promptEl.value.trim();

  // Basic validation: don't send empty messages.
  if (!message) {
    setOutput("Type something first 🙂");
    return;
  }

  // Show a loading message while we wait.
  setOutput("Thinking...");

  try {
    // Call our own server endpoint (NOT OpenAI directly).
    // We send JSON with the user's message.
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: {
        // Tell the server we're sending JSON.
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    // Parse the JSON response from the server.
    const data = await res.json();

    // If the server returned an error, show it.
    if (!res.ok) {
      setOutput(data?.error || "Server error.");
      return;
    }

    // Show the model answer on the page.
    setOutput(data.answer || "(No text returned.)");
  } catch (err) {
    // Catch network errors, etc.
    console.error(err);
    setOutput("Network error. Is the server running?");
  }
});