const formEl = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const messagesEl = document.getElementById("messages");
const statusEl = document.getElementById("status");
const templateEl = document.getElementById("message-template");

const STORAGE_KEY = "talli.conversation.v1";
const SESSION_KEY = "talli.session.v1";
const DEFAULT_CONVERSATION = [
  {
    role: "assistant",
    content:
      "Hi! I'm Talli. Let me know if I can be of any assistance. I will help as best I can!",
  },
];

function sanitizeConversation(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry) => {
      return (
        entry &&
        !entry.pending &&
        (entry.role === "user" || entry.role === "assistant") &&
        typeof entry.content === "string" &&
        entry.content.trim() !== ""
      );
    })
    .map((entry) => ({
      role: entry.role,
      content: entry.content.trim(),
    }));
}

function getDefaultConversation() {
  return DEFAULT_CONVERSATION.map((entry) => ({ ...entry }));
}

function loadConversation() {
  try {
    const rawConversation = localStorage.getItem(STORAGE_KEY);

    if (!rawConversation) {
      return getDefaultConversation();
    }

    const parsedConversation = JSON.parse(rawConversation);
    const sanitizedConversation = sanitizeConversation(parsedConversation);

    return sanitizedConversation.length > 0
      ? sanitizedConversation
      : getDefaultConversation();
  } catch (error) {
    console.error("Failed to load conversation from storage.", error);
    return getDefaultConversation();
  }
}

function createSessionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadSessionId() {
  try {
    const storedSessionId = localStorage.getItem(SESSION_KEY);

    if (storedSessionId && storedSessionId.trim() !== "") {
      return storedSessionId;
    }

    const sessionId = createSessionId();
    localStorage.setItem(SESSION_KEY, sessionId);
    return sessionId;
  } catch (error) {
    console.error("Failed to load session id from storage.", error);
    return createSessionId();
  }
}

function saveConversation() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(sanitizeConversation(conversation))
    );
  } catch (error) {
    console.error("Failed to save conversation to storage.", error);
  }
}

const sessionId = loadSessionId();
const conversation = loadConversation();

function setStatus(text) {
  statusEl.textContent = text;
}

function autoResize() {
  promptEl.style.height = "auto";
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 180)}px`;
}

function scrollToLatest() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessage(message) {
  const node = templateEl.content.firstElementChild.cloneNode(true);
  const bubbleEl = node.querySelector(".bubble");
  const roleEl = node.querySelector(".message-role");
  const bodyEl = node.querySelector(".message-body");

  node.dataset.role = message.role;
  roleEl.textContent = message.role === "user" ? "You" : "Talli";
  bodyEl.textContent = message.content;
  bubbleEl.classList.toggle("is-pending", Boolean(message.pending));

  messagesEl.appendChild(node);
  scrollToLatest();
}

function rerenderConversation() {
  messagesEl.innerHTML = "";

  for (const message of conversation) {
    renderMessage(message);
  }
}

function setSendingState(isSending) {
  sendBtn.disabled = isSending;
  promptEl.disabled = isSending;
  setStatus(isSending ? "Talli is thinking..." : "Connected");
}

async function sendMessage() {
  const message = promptEl.value.trim();

  if (!message) {
    setStatus("Type a message first.");
    return;
  }

  const userMessage = { role: "user", content: message };
  const pendingMessage = {
    role: "assistant",
    content: "Thinking...",
    pending: true,
  };

  conversation.push(userMessage, pendingMessage);
  saveConversation();
  rerenderConversation();
  promptEl.value = "";
  autoResize();
  setSendingState(true);

  try {
    const history = sanitizeConversation(conversation).slice(0, -1);
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        message,
        history,
      }),
    });

    const data = await res.json();
    conversation.pop();

    if (!res.ok) {
      conversation.push({
        role: "assistant",
        content: data?.error || "Server error.",
      });
      saveConversation();
      rerenderConversation();
      return;
    }

    if (Array.isArray(data?.conversation) && data.conversation.length > 0) {
      conversation.length = 0;
      conversation.push(...sanitizeConversation(data.conversation));
    } else {
      conversation.push({
        role: "assistant",
        content: data.answer || "(No answer returned.)",
      });
    }

    saveConversation();
    rerenderConversation();
  } catch (error) {
    console.error(error);
    conversation.pop();
    conversation.push({
      role: "assistant",
      content: "Network error. Check the deployment and try again.",
    });
    saveConversation();
    rerenderConversation();
  } finally {
    setSendingState(false);
    promptEl.focus();
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendMessage();
});

promptEl.addEventListener("input", autoResize);
promptEl.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    await sendMessage();
  }
});

rerenderConversation();
autoResize();
