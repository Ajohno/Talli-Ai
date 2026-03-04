const formEl = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const messagesEl = document.getElementById("messages");
const statusEl = document.getElementById("status");
const templateEl = document.getElementById("message-template");

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
promptEl.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    await sendMessage();
  }
});

rerenderConversation();
autoResize();
