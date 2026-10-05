import OpenAI from "openai";

/*
 * PHASE 1 LEARNING GUIDE — THE AI REQUEST PIPELINE
 *
 * This is the central Phase 1 orchestration file. For a normal chat message:
 *
 *   1. Identify the owner and chat.
 *   2. Load the stored thread.
 *   3. Append the new user message.
 *   4. Retrieve relevant cross-chat memories.
 *   5. Build model context in this order:
 *        system prompt -> memories -> thread summary -> recent conversation
 *   6. Let the model answer or request one of the allowed tools.
 *   7. Persist the completed conversation.
 *   8. Refresh the thread summary when needed.
 *   9. Extract/update durable memories for future chats.
 *
 * The distinction between summary and memory is critical:
 *   - summary = compressed history of ONE chat thread
 *   - memory  = durable user context that may be useful in OTHER chats
 *
 * Phase 2 will formalize the small tool mechanism already visible in this file.
 */

// Agent orchestration: request validation, memory retrieval, thread summary
// injection, tool execution, reply generation, and post-reply persistence.
import { resolveOwnerId } from "./auth.js";
import {
  findRelevantMemories,
  normalizeCandidateMemories,
  touchMemories,
  upsertMemories,
} from "./memory-store.js";
import {
  MIN_SUMMARY_MESSAGES,
  getChat,
  normalizeChatId,
  normalizeMessages,
  normalizeSessionId,
  saveChatConversation,
  saveChatSummary,
} from "./chat-store.js";

// User-facing and background AI workloads are configured separately so model
// selection can change through environment variables without a code edit.
const CHAT_MODEL =
  process.env.TALLI_CHAT_MODEL?.trim() || "openai/gpt-oss-120b";

const CHAT_FALLBACK_MODEL =
  process.env.TALLI_CHAT_FALLBACK_MODEL?.trim() || "openai/gpt-oss-20b";

const BACKGROUND_MODEL =
  process.env.TALLI_BACKGROUND_MODEL?.trim() || "openai/gpt-oss-20b";

const BACKGROUND_FALLBACK_MODEL =
  process.env.TALLI_BACKGROUND_FALLBACK_MODEL?.trim() ||
  "openai/gpt-oss-120b";
const MEMORY_REFRESH_INTERVAL = 4;
// These two built-in tools are an early version of the Phase 2 concept.
// The model sees schemas; toolHandlers below maps the selected name to trusted
// backend code. Later, this should become the generic tool registry.
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

function getAiGatewayClient() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;

  if (!apiKey) {
    const configurationError = new Error(
      "Missing AI_GATEWAY_API_KEY environment variable."
    );
    configurationError.code = AI_ERROR_CODES.CONFIGURATION_ERROR;
    configurationError.status = 503;

    throw configurationError;
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://ai-gateway.vercel.sh/v1",
  });
}

const AI_ERROR_CODES = Object.freeze({
  MODEL_UNAVAILABLE: "AI_MODEL_UNAVAILABLE",
  RATE_LIMITED: "AI_RATE_LIMITED",
  REQUEST_TIMEOUT: "AI_REQUEST_TIMEOUT",
  CONFIGURATION_ERROR: "AI_CONFIGURATION_ERROR",
  PROVIDER_UNAVAILABLE: "AI_PROVIDER_UNAVAILABLE",
  INVALID_REQUEST: "AI_INVALID_REQUEST",
  PROVIDER_ERROR: "AI_PROVIDER_ERROR",
  TOOL_LOOP_EXHAUSTED: "AI_TOOL_LOOP_EXHAUSTED",
});

function normalizeAiError(error) {
  const providerStatus =
    Number.isInteger(error?.status) ? error.status : null;

  const providerCode =
    typeof error?.code === "string"
      ? error.code.toLowerCase()
      : typeof error?.error?.code === "string"
        ? error.error.code.toLowerCase()
        : typeof error?.type === "string"
          ? error.type.toLowerCase()
          : typeof error?.error?.type === "string"
            ? error.error.type.toLowerCase()
            : "";

  const networkCode =
    typeof error?.cause?.code === "string"
      ? error.cause.code.toLowerCase()
      : "";

  const errorName =
    typeof error?.name === "string"
      ? error.name.toLowerCase()
      : "";

  let code = AI_ERROR_CODES.PROVIDER_ERROR;
  let status = 502;

  if (
    providerStatus === 404 ||
    providerCode.includes("model_not_found") ||
    providerCode.includes("model_not_available")
  ) {
    code = AI_ERROR_CODES.MODEL_UNAVAILABLE;
    status = 503;
  } else if (
    providerStatus === 429 ||
    providerCode.includes("rate_limit") ||
    errorName.includes("ratelimit")
  ) {
    code = AI_ERROR_CODES.RATE_LIMITED;
    status = 429;
  } else if (
    providerStatus === 408 ||
    providerStatus === 504 ||
    providerCode === "etimedout" ||
    providerCode === "econnreset" ||
    networkCode === "etimedout" ||
    networkCode === "econnreset" ||
    errorName.includes("timeout")
  ) {
    code = AI_ERROR_CODES.REQUEST_TIMEOUT;
    status = 504;
  } else if (
    networkCode === "econnrefused" ||
    networkCode === "enotfound" ||
    networkCode === "eai_again"
  ) {
    code = AI_ERROR_CODES.PROVIDER_UNAVAILABLE;
    status = 503;
  } else if (
    providerStatus === 401 ||
    providerStatus === 403 ||
    providerCode.includes("invalid_api_key") ||
    providerCode.includes("authentication")
  ) {
    code = AI_ERROR_CODES.CONFIGURATION_ERROR;
    status = 503;
  } else if (
    providerStatus === 502 ||
    providerStatus === 503
  ) {
    code = AI_ERROR_CODES.PROVIDER_UNAVAILABLE;
    status = 503;
  } else if (
    providerStatus === 400 ||
    providerStatus === 422
  ) {
    code = AI_ERROR_CODES.INVALID_REQUEST;
    status = 502;
  }

  const normalizedError = new Error("AI request failed.");
  normalizedError.code = code;
  normalizedError.status = status;
  normalizedError.providerStatus = providerStatus;
  normalizedError.providerCode = providerCode || null;
  normalizedError.cause = error;

  return normalizedError;
}

function getSafeAiErrorResponse(error) {
  switch (error?.code) {
    case AI_ERROR_CODES.MODEL_UNAVAILABLE:
      return {
        status: 503,
        body: {
          error: "The AI model is temporarily unavailable.",
          code: error.code,
        },
      };

    case AI_ERROR_CODES.RATE_LIMITED:
      return {
        status: 429,
        body: {
          error: "The AI service is temporarily busy. Please try again shortly.",
          code: error.code,
        },
      };

    case AI_ERROR_CODES.TOOL_LOOP_EXHAUSTED:
      return {
        status: 500,
        body: {
          error: "The AI request could not be completed. Please try a simpler request.",
          code: error.code,
        },
      };

    case AI_ERROR_CODES.REQUEST_TIMEOUT:
      return {
        status: 504,
        body: {
          error: "The AI service took too long to respond. Please try again.",
          code: error.code,
        },
      };

    case AI_ERROR_CODES.CONFIGURATION_ERROR:
      return {
        status: 503,
        body: {
          error: "The AI service is temporarily unavailable.",
          code: error.code,
        },
      };

    case AI_ERROR_CODES.PROVIDER_UNAVAILABLE:
      return {
        status: 503,
        body: {
          error: "The AI service is temporarily unavailable.",
          code: error.code,
        },
      };

    case AI_ERROR_CODES.INVALID_REQUEST:
      return {
        status: 502,
        body: {
          error: "The AI service could not process the request.",
          code: error.code,
        },
      };

    case AI_ERROR_CODES.PROVIDER_ERROR:
      return {
        status: 502,
        body: {
          error: "The AI service encountered an upstream error.",
          code: error.code,
        },
      };

    default:
      return null;
  }
}

async function createAiCompletion(
  aiClient,
  {
    workload,
    primaryModel,
    fallbackModel,
    ...completionOptions
  }
) {
  const approvedFallbackModels =
    typeof fallbackModel === "string" &&
    fallbackModel.trim() !== "" &&
    fallbackModel !== primaryModel
      ? [fallbackModel]
      : [];

  try {
    const response = await aiClient.chat.completions.create({
      ...completionOptions,
      model: primaryModel,
      ...(approvedFallbackModels.length > 0
        ? { models: approvedFallbackModels }
        : {}),
    });

    const resolvedModel = response.model;

    if (
      approvedFallbackModels.length > 0 &&
      typeof resolvedModel === "string" &&
      resolvedModel !== primaryModel
    ) {
      console.warn("AI model fallback used.", {
        workload,
        primaryModel,
        resolvedModel,
      });
    }

    return response;
  } catch (error) {
    const normalizedError = normalizeAiError(error);

    console.error("AI request failed.", {
      workload,
      primaryModel,
      fallbackModels: approvedFallbackModels,
      code: normalizedError.code,
      providerStatus: normalizedError.providerStatus,
      providerCode: normalizedError.providerCode,
    });

    throw normalizedError;
  }
}

// The top-level system prompt defines the desired personality and behavior
// for every assistant response.
function buildSystemPrompt() {
  return (
    "You are Talli, a personal AI companion. " +
    "You are calm, insightful, slightly witty. " +
    "You are excited to learn and share knowledge. " +
    "You remember past conversations and build a relationship. " +
    "Use tools when they help. If a tool is used, explain the final result clearly to the user."
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

function buildMemoryMessage(memories) {
  if (!Array.isArray(memories) || memories.length === 0) {
    return null;
  }

  const lines = memories.map((memory) => {
    const prefix = memory.category ? `${memory.category}: ` : "";
    return `- ${prefix}${memory.content}`;
  });

  return {
    role: "system",
    content:
      "Relevant long-term memories for this user session:\n" +
      lines.join("\n") +
      "\nUse these only when they help, and defer to the current conversation if anything conflicts.",
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

  return !hasSummary || conversation.length - summarizedMessageCount >= MEMORY_REFRESH_INTERVAL;
}

function extractJsonBlock(content) {
  if (typeof content !== "string") {
    return null;
  }

  const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBracket = content.indexOf("[");
  const lastBracket = content.lastIndexOf("]");

  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    return content.slice(firstBracket, lastBracket + 1);
  }

  return content.trim();
}

function buildConversationTranscript(conversation) {
  return conversation
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");
}

// Summaries compress the important parts of a thread so the model can retain
// continuity without always seeing the full historical transcript.
async function summarizeConversation(aiClient, conversation, existingSummary = null) {
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

  const response = await createAiCompletion(aiClient, {
    workload: "summary",
    primaryModel: BACKGROUND_MODEL,
    fallbackModel: BACKGROUND_FALLBACK_MODEL,
    messages: summaryMessages,
  });

  return response.choices[0]?.message?.content?.trim() || null;
}

// After each reply, ask the model which durable user facts are worth saving
// for future chats. The memory-store module handles normalization and deduping.
async function extractCrossChatMemories(aiClient, conversation, answer, summary) {
  const normalizedConversation = normalizeMessages(conversation);

  if (!normalizedConversation || normalizedConversation.length === 0) {
    return [];
  }

  const memoryExtractionMessages = [
    {
      role: "system",
      content:
        "Extract durable user-specific memories that would be useful in future chats. " +
        "Only capture stable preferences, identity details, ongoing goals, projects, relationships, or recurring context. " +
        "Return JSON only as an array of objects with keys: content, category, confidence. " +
        "Use categories from: identity, preference, goal, project, relationship, context. " +
        "Do not include temporary requests, assistant facts, or anything uncertain.",
    },
  ];

  if (typeof summary === "string" && summary.trim() !== "") {
    memoryExtractionMessages.push({
      role: "system",
      content: `Thread summary:\n${summary.trim()}`,
    });
  }

  memoryExtractionMessages.push({
    role: "user",
    content:
      "Conversation transcript:\n" +
      buildConversationTranscript(normalizedConversation) +
      "\n\nAssistant reply:\n" +
      answer,
  });

  const response = await createAiCompletion(aiClient, {
    workload: "memory-extraction",
    primaryModel: BACKGROUND_MODEL,
    fallbackModel: BACKGROUND_FALLBACK_MODEL,
    messages: memoryExtractionMessages,
  });

  const content = response.choices[0]?.message?.content ?? "";
  const jsonBlock = extractJsonBlock(content);

  if (!jsonBlock) {
    return [];
  }

  let parsed;

  try {
    parsed = JSON.parse(jsonBlock);
  } catch (error) {
    return [];
  }

  const candidateMemories = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.memories)
      ? parsed.memories
      : [];

  return normalizeCandidateMemories(candidateMemories);
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

// Core agent execution path used by both the local server and deployed API.
export async function runAgent(input, options = {}) {
  const aiClient = getAiGatewayClient();
  const sessionId = normalizeSessionId(options.sessionId);
  const chatId = normalizeChatId(options.chatId);
  const isSingleMessage = typeof input === "string" && input.trim() !== "";
  let conversation = null;
  let chatSummary = null;
  let relevantMemories = [];

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
    relevantMemories = await findRelevantMemories(
      sessionId,
      `${chat.title}\n${chat.summary ?? ""}\n${buildConversationTranscript(conversation)}`
    );
  } else {
    conversation = normalizeMessages(input);
  }

  if (!conversation) {
    return {
      status: 400,
      body: { error: "Send { sessionId, chatId, message } or { messages: Message[] }" },
    };
  }

  // The model does not receive only the visible chat bubbles. Talli prepends
  // hidden system context (personality, relevant memories, and thread summary)
  // before the recent conversation. That is how continuity is produced.
  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(),
    },
  ];
  const summaryMessage = buildSummaryMessage(chatSummary);
  const memoryMessage = buildMemoryMessage(relevantMemories);

  if (memoryMessage) {
    messages.push(memoryMessage);
  }

  if (summaryMessage) {
    messages.push(summaryMessage);
  }

  messages.push(...conversation);

  // Tool loop: the model may request a tool, receive its result, and continue.
  // The five-step cap protects against an accidental infinite tool-calling loop.
  for (let step = 0; step < 5; step += 1) {
    const response = await createAiCompletion(aiClient, {
      workload: "chat-tool-loop",
      primaryModel: CHAT_MODEL,
      fallbackModel: CHAT_FALLBACK_MODEL,
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

        // Persist only after a final assistant answer is available. The frontend's
        // temporary "Thinking..." bubble never becomes stored conversation data.
        let chat = await saveChatConversation(sessionId, chatId, updatedConversation);

        if (!chat) {
          return {
            status: 404,
            body: { error: "Chat not found." },
          };
        }

        // Thread summaries are refreshed periodically rather than on every turn,
        // reducing extra model calls while retaining older thread context.
        if (shouldRefreshSummary(updatedConversation, chat)) {
          let nextSummary = null;

          try {
            nextSummary = await summarizeConversation(
              aiClient,
              updatedConversation,
              chat.summary
            );
          } catch (error) {
            const safeAiError = getSafeAiErrorResponse(error);

            if (!safeAiError) {
              throw error;
            }

            console.warn("Background AI task skipped.", {
              workload: "summary",
              code: error.code,
              providerStatus: error.providerStatus ?? null,
              providerCode: error.providerCode ?? null,
            });
          }

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

        // Memory extraction is a second model task after the user-facing answer.
        // Its output is normalized/deduplicated before MongoDB storage.
        let candidateMemories = [];

        try {
          candidateMemories = await extractCrossChatMemories(
            aiClient,
            updatedConversation,
            answer,
            chat.summary
          );
        } catch (error) {
          const safeAiError = getSafeAiErrorResponse(error);

          if (!safeAiError) {
            throw error;
          }

          console.warn("Background AI task skipped.", {
            workload: "memory-extraction",
            code: error.code,
            providerStatus: error.providerStatus ?? null,
            providerCode: error.providerCode ?? null,
          });
        }

        const storedMemories = await upsertMemories(
          sessionId,
          chatId,
          candidateMemories
        );

        if (relevantMemories.length > 0) {
          await touchMemories(
            sessionId,
            relevantMemories
              .map((memory) => memory.memoryId)
              .filter((memoryId) => typeof memoryId === "string")
          );
        }

        body.chat = chat;
        body.memories = storedMemories;
        body.relevantMemories = relevantMemories;
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

  const loopError = new Error("Agent exceeded tool step limit.");
  loopError.code = AI_ERROR_CODES.TOOL_LOOP_EXHAUSTED;
  loopError.status = 500;

  throw loopError;
}

export async function handleAgentRequest(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const body = await parseRequestBody(req);
    const result = await runAgent(body?.message ?? body?.messages, {
      sessionId: resolveOwnerId(req, body?.sessionId),
      chatId: body?.chatId,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    const safeAiError = getSafeAiErrorResponse(error);

    if (safeAiError) {
      console.error("Agent AI error.", {
        code: error.code,
        status: error.status ?? safeAiError.status,
        providerStatus: error.providerStatus ?? null,
        providerCode: error.providerCode ?? null,
      });

      return res.status(safeAiError.status).json(safeAiError.body);
    }

    console.error("Agent error:", error);
    return res.status(500).json({ error: "Server error." });
  }
}
