// server.js
// This runs on the SERVER (Node). Keep GROQ_API_KEY here, never in browser JS.

import "dotenv/config"; // Loads .env into process.env
import express from "express";
import Groq from "groq-sdk"; // Official Groq JS SDK

const app = express();
const port = process.env.PORT || 3000;

// Parse JSON bodies from the browser
app.use(express.json());

// Serve your web page files
app.use(express.static("public"));

// Vercel ignores express.static(), so the homepage needs an explicit route.
app.get("/", (_req, res) => {
  res.redirect("/index.html");
});

// Create Groq client (reads GROQ_API_KEY from env)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function normalizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return null;
  }

  const messages = input
    .filter((message) => {
      return (
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim() !== ""
      );
    })
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));

  return messages.length > 0 ? messages : null;
}

// -------------------------
// 1) Define your tool schemas (what the model "sees")
// -------------------------
const tools = [
  {
    type: "function",
    function: {
      name: "get_time",
      description: "Get the current time in ISO format.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Evaluate a simple math expression like '25 * 4'.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "A math expression using + - * / and parentheses.",
          },
        },
        required: ["expression"],
      },
    },
  },
];

// -------------------------
// 2) Implement the tools (what YOUR server can actually do)
// -------------------------
function getTime() {
  // Return time in a stable, machine-friendly format
  return new Date().toISOString();
}

function calculate({ expression }) {
  // NOTE: eval is unsafe for real apps. This is for learning only.
  // In production, use a safe math parser library.
  try {
    // Allow only digits, spaces, and basic operators for this demo
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
      return "Error: Expression contains invalid characters.";
    }
    const result = eval(expression);
    return String(result);
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

// Map tool name -> implementation
const toolHandlers = {
  get_time: () => getTime(),
  calculate: (args) => calculate(args),
};

// -------------------------
// 3) The agent endpoint (this is your "agent loop")
// -------------------------
app.post("/api/agent", async (req, res) => {
  try {
    // Pick a Llama model hosted on Groq.
    // Groq’s docs list available models and model IDs. :contentReference[oaicite:6]{index=6}
    const model = "llama-3.3-70b-versatile";
    const conversation =
      typeof req.body?.message === "string" && req.body.message.trim() !== ""
        ? [{ role: "user", content: req.body.message.trim() }]
        : normalizeMessages(req.body?.messages);

    if (!conversation) {
      return res.status(400).json({
        error: "Send { message: string } or { messages: Message[] }",
      });
    }

    // Conversation “memory” for this single request:
    // (For multi-turn chat, store this per-session.)
    const messages = [
      {
        role: "system",
        content:
          "You are a helpful web agent. Use tools when they help. " +
          "If a tool is used, explain the final result clearly to the user.",
      },
      ...conversation,
    ];

    // Agent orchestration loop:
    // - Ask model what to do
    // - If it requests tool calls, run them
    // - Feed tool results back
    // - Repeat until final answer
    for (let step = 0; step < 5; step++) {
      // Ask the model for the next action
      const response = await groq.chat.completions.create({
        model,
        messages,
        tools, // Give the model access to our tool schemas
      });

      const msg = response.choices[0].message;

      // Add the model message to the conversation
      messages.push(msg);

      // If no tool calls, we’re done: return the model’s final answer
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return res.json({ answer: msg.content ?? "" });
      }

      // Otherwise, run each tool call locally and add tool results
      for (const toolCall of msg.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments || "{}");

        // Find the matching local tool
        const handler = toolHandlers[toolName];

        // If the model calls an unknown tool, handle gracefully
        const toolResult = handler
          ? await handler(toolArgs)
          : `Error: Unknown tool '${toolName}'`;

        // Append tool output in the format the API expects
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolName,
          content: String(toolResult),
        });
      }
    }

    // If we hit max steps, fail safely
    return res.status(500).json({
      error: "Agent exceeded step limit (possible loop). Try a simpler request.",
    });
  } catch (err) {
    console.error("Agent error:", err);
    return res.status(500).json({ error: "Server error." });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Running: http://localhost:${port}`);
});

export default app;
