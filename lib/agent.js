import Groq from "groq-sdk";
import {
  MIN_SUMMARY_MESSAGES,
  getChat,
  normalizeChatId,
  normalizeMessages,
  normalizeSessionId,
  saveChatConversation,
  saveChatSummary,
} from "./chat-store.js";

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

function getTime() {
  return new Date().toISOString();
}

function calculate({ expression }) {
  try {
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
      return "Error: Expression contains invalid characters.";
    }

    const result = eval(expression);
    return String(result);
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

const toolHandlers = {
  get_time: () => getTime(),
  calculate: (args) => calculate(args),
};

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY environment variable.");
  }

  return new Groq({ apiKey });
}

function buildSystemPrompt() {
  return (
    "You are Talli, a personal AI companion." +
    "You are calm, insightful, slightly witty." +
    "You are excited to learn and share knowledge." +
    "You remember past conversations and build a relationship." +
    "Use tools when they help. " +
    "If a tool is used, explain the final result clearly to the user."
  );
}

function buildSummaryMessage(summary) {
  if (typeof summary !== "string" || summary.trim() === "") {
    return null;
  }

  return {
    role: "system",
    content:
      "Conversation summary for this chat thread: " +
      summary.trim() +
      " Use it as background context and prioritize newer chat messages if they conflict.",
  };
}

function shouldRefreshSummary(conversation, chat) {
  if (!Array.isArray(conversation) || conversation.length < MIN_SUMMARY_MESSAGES) {
    return false;
  }

  const hasSummary = typeof chat?.summary === "string" && chat.summary.trim() !== "";
  const summarizedMessageCount = Number.isInteger(chat?.summaryMessageCount)
    ? chat.summaryMessageCount
    : 0;

  return !hasSummary || conversation.length - summarizedMessageCount >= 4;
}

async function summarizeConversation(groq, conversation, existingSummary = null) {
  const normalizedConversation = normalizeMessages(conversation);

  if (!normalizedConversation || normalizedConversation.length < MIN_SUMMARY_MESSAGES) {
    return null;
  }

  const summaryMessages = [
    {
      role: "system",
      content:
        "Summarize the chat in 5 concise bullet points. Focus on stable goals, preferences, ongoing tasks, important facts, and unresolved follow-ups. Do not invent details.",
    },
  ];

  if (typeof existingSummary === "string" && existingSummary.trim() !== "") {
    summaryMessages.push({
      role: "system",
      content: `Existing summary:\n${existingSummary.trim()}`,
    });
  }

  summaryMessages.push(
    ...normalizedConversation.map((message) => ({
      role: message.role,
      content: message.content,
    }))
  );

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: summaryMessages,
  });

  return response.choices[0]?.message?.content?.trim() || null;
}

async function parseRequestBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function runAgent(input, options = {}) {
  const groq = getGroqClient();
  const model = "llama-3.3-70b-versatile";
  const sessionId = normalizeSessionId(options.sessionId);
  const chatId = normalizeChatId(options.chatId);
  const isSingleMessage = typeof input === "string" && input.trim() !== "";
  let conversation = null;
  let chatSummary = null;

  if (isSingleMessage) {
    if (!sessionId || !chatId) {
      return {
        status: 400,
        body: { error: "Send { sessionId, chatId, message }." },
      };
    }

    const chat = await getChat(sessionId, chatId);

    if (!chat) {
      return {
        status: 404,
        body: { error: "Chat not found." },
      };
    }

    if (chat.archived) {
      return {
        status: 400,
        body: { error: "Restore this chat before sending new messages." },
      };
    }

    chatSummary = chat.summary;
    const userMessage = { role: "user", content: input.trim() };
    conversation = [...chat.conversation, userMessage];
  } else {
    conversation = normalizeMessages(input);
  }

  if (!conversation) {
    return {
      status: 400,
      body: { error: "Send { sessionId, chatId, message } or { messages: Message[] }" },
    };
  }

  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(),
    },
  ];
  const summaryMessage = buildSummaryMessage(chatSummary);

  if (summaryMessage) {
    messages.push(summaryMessage);
  }

  messages.push(...conversation);

  for (let step = 0; step < 5; step += 1) {
    const response = await groq.chat.completions.create({
      model,
      messages,
      tools,
    });

    const message = response.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      const answer = message.content ?? "";
      const body = { answer };

      if (isSingleMessage && sessionId && chatId) {
        const updatedConversation =
          answer.trim() === ""
            ? conversation
            : [...conversation, { role: "assistant", content: answer }];

        let chat = await saveChatConversation(sessionId, chatId, updatedConversation);

        if (!chat) {
          return {
            status: 404,
            body: { error: "Chat not found." },
          };
        }

        if (shouldRefreshSummary(updatedConversation, chat)) {
          const nextSummary = await summarizeConversation(
            groq,
            updatedConversation,
            chat.summary
          );

          if (nextSummary) {
            chat =
              (await saveChatSummary(
                sessionId,
                chatId,
                nextSummary,
                updatedConversation.length
              )) ?? chat;
          }
        }

        body.chat = chat;
      }

      return { status: 200, body };
    }

    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments || "{}");
      const handler = toolHandlers[toolName];
      const toolResult = handler
        ? await handler(toolArgs)
        : `Error: Unknown tool '${toolName}'`;

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolName,
        content: String(toolResult),
      });
    }
  }

  return {
    status: 500,
    body: {
      error: "Agent exceeded step limit (possible loop). Try a simpler request.",
    },
  };
}

export async function handleAgentRequest(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const body = await parseRequestBody(req);
    const result = await runAgent(body?.message ?? body?.messages, {
      sessionId: body?.sessionId,
      chatId: body?.chatId,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("Agent error:", error);
    return res.status(500).json({ error: "Server error." });
  }
}
