const formEl = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const messagesEl = document.getElementById("messages");
const statusEl = document.getElementById("status");
const templateEl = document.getElementById("message-template");
const composerStageEl = document.getElementById("composerStage");
const typingCharacterEl = document.getElementById("typingCharacter");

const MAX_CHARS_FOR_CHARACTER_TRAVEL = 140;
const TYPING_ANIMATION_IDLE_MS = 240;

let typingAnimationTimeoutId;

const conversation = [
  {
    role: "assistant",
    content:
      "I'm ready. Ask for a calculation, the current time, or anything else you want to explore.",
  },
];

function setStatus(text) {
  statusEl.textContent = text;
}

function autoResize() {
  promptEl.style.height = "auto";
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 180)}px`;
}

function updateTypingCharacter() {
  if (!composerStageEl || !typingCharacterEl) {
    return;
  }

  const length = promptEl.value.trim().length;
  typingCharacterEl.classList.toggle("is-active", length > 0);

  if (length === 0) {
    typingCharacterEl.classList.remove("is-typing");
  }

  const stageRect = composerStageEl.getBoundingClientRect();
  const characterWidth = typingCharacterEl.offsetWidth;
  const minX = 8;
  const maxX = Math.max(minX, stageRect.width - characterWidth - 8);
  const progress = Math.min(length / MAX_CHARS_FOR_CHARACTER_TRAVEL, 1);
  const x = minX + (maxX - minX) * progress;

  typingCharacterEl.style.transform = `translateX(${x}px)`;
}

function animateTypingCharacter() {
  if (!typingCharacterEl || !promptEl.value.trim()) {
    return;
  }

  typingCharacterEl.classList.add("is-typing");
  clearTimeout(typingAnimationTimeoutId);

  typingAnimationTimeoutId = setTimeout(() => {
    typingCharacterEl.classList.remove("is-typing");
  }, TYPING_ANIMATION_IDLE_MS);
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
  rerenderConversation();
  promptEl.value = "";
  autoResize();
  clearTimeout(typingAnimationTimeoutId);
  updateTypingCharacter();
  setSendingState(true);

  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conversation
          .filter((entry) => !entry.pending)
          .map(({ role, content }) => ({ role, content })),
      }),
    });

    const data = await res.json();
    conversation.pop();

    if (!res.ok) {
      conversation.push({
        role: "assistant",
        content: data?.error || "Server error.",
      });
      rerenderConversation();
      return;
    }

    conversation.push({
      role: "assistant",
      content: data.answer || "(No answer returned.)",
    });
    rerenderConversation();
  } catch (error) {
    console.error(error);
    conversation.pop();
    conversation.push({
      role: "assistant",
      content: "Network error. Check the deployment and try again.",
    });
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
promptEl.addEventListener("input", updateTypingCharacter);
promptEl.addEventListener("input", animateTypingCharacter);
window.addEventListener("resize", updateTypingCharacter);
promptEl.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    await sendMessage();
  }
});

rerenderConversation();
autoResize();
updateTypingCharacter();
