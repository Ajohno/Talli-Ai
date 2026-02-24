// server.js
// This file runs on your SERVER (Node.js), NOT in the browser.
// That’s important because the API key must stay secret on the server.

// Load environment variables from .env into process.env (local dev convenience).
import "dotenv/config";

// Import Express, a tiny web server framework.
import express from "express";

// Import the official OpenAI SDK.
import OpenAI from "openai";

// Create an Express app instance.
const app = express();

// Choose a port for your server.
const PORT = process.env.PORT || 3000;

// Tell Express to parse incoming JSON bodies (so we can read req.body).
app.use(express.json());

// Serve static files (HTML/JS) from the "public" folder.
app.use(express.static("public"));

// Create an OpenAI client.
// The SDK reads OPENAI_API_KEY from process.env automatically,
// but we pass it explicitly to be extra clear for learning.
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// A simple API endpoint your website will call.
// The browser will POST user text here, and THIS server will call OpenAI.
app.post("/api/ask", async (req, res) => {
  try {
    // Grab the user's message from the request body.
    const userMessage = req.body?.message;

    // Validate input (basic sanity check).
    if (!userMessage || typeof userMessage !== "string") {
      // Send a 400 "Bad Request" if message is missing/invalid.
      return res.status(400).json({ error: "Please send a 'message' string." });
    }

    // Call the OpenAI Responses API (recommended for new projects).
    // We send the user's input and choose a model.
    const response = await client.responses.create({
      model: "gpt-5.2",
      input: userMessage,
    });

    // The SDK provides a convenient output_text field
    // containing the model’s text response (when applicable).
    const answer = response.output_text;

    // Send the answer back to the browser as JSON.
    return res.json({ answer });
  } catch (err) {
    // Log the error on the server so you can debug it.
    console.error("OpenAI API error:", err);

    // Return a generic message to the browser.
    // (In production, you’d be more careful about what you reveal.)
    return res.status(500).json({ error: "Something went wrong on the server." });
  }
});

// Start the server and print a friendly URL.
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});