// Frontend app state and UI wiring for chats, auth state, and optimistic
// message rendering. The browser stores a fallback session id for guest users.
const formEl = document.getElementById("composer");
const promptEl = document.getElementById("prompt");
const sendBtn = document.getElementById("send");
const messagesEl = document.getElementById("messages");
const statusEl = document.getElementById("status");
const templateEl = document.getElementById("message-template");
const appShellEl = document.getElementById("app-shell");
const sidebarBackdropEl = document.getElementById("sidebar-backdrop");
const sidebarToggleBtn = document.getElementById("sidebar-toggle");
const clearChatBtn = document.getElementById("clear-chat");
const archiveChatBtn = document.getElementById("archive-chat");
const deleteChatBtn = document.getElementById("delete-chat");
const newChatBtn = document.getElementById("new-chat");
const chatListEl = document.getElementById("chat-list");
const archivedListEl = document.getElementById("archived-list");
const activeChatTitleEl = document.getElementById("active-chat-title");
const activeChatMetaEl = document.getElementById("active-chat-meta");
const authNameEl = document.getElementById("auth-name");
const authMetaEl = document.getElementById("auth-meta");
const signInBtn = document.getElementById("sign-in");
const signOutBtn = document.getElementById("sign-out");

const LEGACY_CONVERSATION_KEY = "talli.conversation.v1";
const SESSION_KEY = "talli.session.v1";
const ACTIVE_CHAT_KEY = "talli.active-chat.v1";
const DEFAULT_CONVERSATION = [
  {
    role: "assistant",
    content:
      "Hi! I'm Talli. Let me know if I can be of any assistance. I will help as best I can!",
  },
];

// Shared client-side state for the current browser tab.
const state = {
  sessionId: loadSessionId(),
  activeChatId: loadActiveChatId(),
  chats: [],
  isBusy: false,
  sidebarOpen: false,
  user: null,
  googleConfigured: false,
  missingGoogleAuthEnvVars: [],
};

let conversationRenderVersion = 0;
let activeTypewriterTimer = null;

clearLegacyConversationCache();

function sanitizeConversation(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry) => {
      return (
        entry &&
        (entry.role === "user" || entry.role === "assistant") &&
        typeof entry.content === "string" &&
        entry.content.trim() !== ""
      );
    })
    .map((entry) => ({
      role: entry.role,
      content: entry.content.trim(),
      pending: Boolean(entry.pending),
      animate: Boolean(entry.animate),
    }));
}

function getDefaultConversation() {
  return DEFAULT_CONVERSATION.map((entry) => ({ ...entry }));
}

function clearLegacyConversationCache() {
  try {
    localStorage.removeItem(LEGACY_CONVERSATION_KEY);
  } catch (error) {
    console.error("Failed to clear legacy conversation storage.", error);
  }
}

function createSessionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Guest mode uses a browser-local session id so chats still persist even
// when the user has not signed in with Google.
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

function loadActiveChatId() {
  try {
    const chatId = localStorage.getItem(ACTIVE_CHAT_KEY);
    return chatId && chatId.trim() !== "" ? chatId : null;
  } catch (error) {
    console.error("Failed to load active chat id from storage.", error);
    return null;
  }
}

function saveActiveChatId(chatId) {
  try {
    if (chatId) {
      localStorage.setItem(ACTIVE_CHAT_KEY, chatId);
    } else {
      localStorage.removeItem(ACTIVE_CHAT_KEY);
    }
  } catch (error) {
    console.error("Failed to save active chat id to storage.", error);
  }
}

function sortChats(chats) {
  return [...chats].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || 0);
    const rightTime = Date.parse(right.updatedAt || right.createdAt || 0);
    return rightTime - leftTime;
  });
}

function normalizeChat(chat) {
  const conversation = sanitizeConversation(chat?.conversation);
  const preview =
    typeof chat?.preview === "string" && chat.preview.trim() !== ""
      ? chat.preview.trim()
      : "Ready when you are.";

  return {
    chatId: chat.chatId,
    title:
      typeof chat?.title === "string" && chat.title.trim() !== ""
        ? chat.title.trim()
        : "New chat",
    archived: Boolean(chat?.archived),
    preview,
    conversation: conversation.length > 0 ? conversation : getDefaultConversation(),
    createdAt: chat?.createdAt ?? null,
    updatedAt: chat?.updatedAt ?? null,
  };
}

function getChatById(chatId) {
  return state.chats.find((chat) => chat.chatId === chatId) ?? null;
}

function getActiveChat() {
  return getChatById(state.activeChatId);
}

function pickActiveChatId(preferredChatId = null) {
  if (preferredChatId && getChatById(preferredChatId)) {
    return preferredChatId;
  }

  const firstLiveChat = state.chats.find((chat) => !chat.archived);

  if (firstLiveChat) {
    return firstLiveChat.chatId;
  }

  return state.chats[0]?.chatId ?? null;
}

function syncChats(chats, preferredChatId = null) {
  state.chats = sortChats((Array.isArray(chats) ? chats : []).map(normalizeChat));
  state.activeChatId = pickActiveChatId(preferredChatId ?? state.activeChatId);
  saveActiveChatId(state.activeChatId);
}

function updateChatInState(chat) {
  const normalizedChat = normalizeChat(chat);
  const existingIndex = state.chats.findIndex(
    (entry) => entry.chatId === normalizedChat.chatId
  );

  if (existingIndex === -1) {
    state.chats = sortChats([...state.chats, normalizedChat]);
  } else {
    state.chats[existingIndex] = normalizedChat;
    state.chats = sortChats(state.chats);
  }
}

function markLatestAssistantMessage(chat) {
  const normalizedChat = normalizeChat(chat);
  const latestMessage =
    normalizedChat.conversation[normalizedChat.conversation.length - 1] ?? null;

  if (latestMessage?.role === "assistant" && !latestMessage.pending) {
    latestMessage.animate = true;
  }

  return normalizedChat;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function getAuthErrorMessage() {
  const authError = new URLSearchParams(window.location.search).get("authError");

  if (authError === "state_mismatch") {
    return "Google sign-in could not be verified. Please try again.";
  }

  if (authError === "oauth_failed") {
    return "Google sign-in failed. Check your OAuth settings and try again.";
  }

  return "";
}

function clearAuthErrorFromUrl() {
  const url = new URL(window.location.href);

  if (!url.searchParams.has("authError")) {
    return;
  }

  url.searchParams.delete("authError");
  window.history.replaceState({}, "", url);
}

function getAuthMetaCopy() {
  if (state.user) {
    return state.user.email
      ? `Google account: ${state.user.email}`
      : "Google account connected.";
  }

  if (state.googleConfigured) {
    return "Sign in with Google to keep chats and memory attached to your account.";
  }

  if (state.missingGoogleAuthEnvVars.length > 0) {
    return `Google sign-in needs: ${state.missingGoogleAuthEnvVars.join(", ")}`;
  }

  return "Add your Google OAuth config to enable sign-in.";
}

// Keeps the sidebar account card in sync with the current auth state.
function renderAuth() {
  if (state.user) {
    authNameEl.textContent = state.user.name || state.user.email || "Signed in";
    authMetaEl.textContent = getAuthMetaCopy();
    signInBtn.hidden = true;
    signInBtn.disabled = false;
    signOutBtn.hidden = false;
    signOutBtn.disabled = state.isBusy;
    return;
  }

  authNameEl.textContent = "Guest mode";
  authMetaEl.textContent = getAuthMetaCopy();
  signInBtn.hidden = false;
  signInBtn.disabled = state.isBusy;
  signOutBtn.hidden = true;
  signOutBtn.disabled = true;
}

async function loadAuthState() {
  try {
    const res = await fetch("/api/auth?action=me");
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      state.user = null;
      state.googleConfigured = false;
      state.missingGoogleAuthEnvVars = [];
      return;
    }

    state.user = data?.user ?? null;
    state.googleConfigured = Boolean(data?.googleConfigured);
    state.missingGoogleAuthEnvVars = Array.isArray(data?.missingGoogleAuthEnvVars)
      ? data.missingGoogleAuthEnvVars
      : [];
  } catch (error) {
    console.error(error);
    state.user = null;
    state.googleConfigured = false;
    state.missingGoogleAuthEnvVars = [];
  }
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 920px)").matches;
}

function setSidebarOpen(isOpen) {
  state.sidebarOpen = isMobileLayout() ? isOpen : false;
  appShellEl.classList.toggle("sidebar-open", state.sidebarOpen);
  sidebarToggleBtn.setAttribute("aria-expanded", String(state.sidebarOpen));
}

function closeSidebar() {
  setSidebarOpen(false);
}

function autoResize() {
  promptEl.style.height = "auto";
  promptEl.style.height = `${Math.min(promptEl.scrollHeight, 180)}px`;
}

function scrollToLatest() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatTimestamp(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function buildChatMeta(chat) {
  const label = chat.archived ? "Archived" : "Updated";
  const formattedDate = formatTimestamp(chat.updatedAt || chat.createdAt);
  return formattedDate ? `${label} ${formattedDate}` : label;
}

function renderMessage(message) {
  const node = templateEl.content.firstElementChild.cloneNode(true);
  const bubbleEl = node.querySelector(".bubble");
  const roleEl = node.querySelector(".message-role");
  const bodyEl = node.querySelector(".message-body");

  node.dataset.role = message.role;
  roleEl.textContent = message.role === "user" ? "You" : "Talli";
  bubbleEl.classList.toggle("is-pending", Boolean(message.pending));
  bodyEl.classList.toggle("is-thinking", Boolean(message.pending));

  messagesEl.appendChild(node);

  if (message.animate && message.role === "assistant" && !message.pending) {
    bubbleEl.classList.add("is-typing");
    typewriteMessage(bodyEl, bubbleEl, message);
    return;
  }

  bodyEl.textContent = message.content;
}

function renderConversation() {
  conversationRenderVersion += 1;

  if (activeTypewriterTimer) {
    clearTimeout(activeTypewriterTimer);
    activeTypewriterTimer = null;
  }

  messagesEl.innerHTML = "";
  const conversation = getActiveChat()?.conversation ?? [];

  for (const message of conversation) {
    renderMessage(message);
  }

  scrollToLatest();
}

function typewriteMessage(bodyEl, bubbleEl, message) {
  const text = message.content;
  const renderVersion = conversationRenderVersion;
  let index = 0;

  function step() {
    if (renderVersion !== conversationRenderVersion) {
      return;
    }

    index += text[index] === " " ? 2 : 1;
    bodyEl.textContent = text.slice(0, index);
    scrollToLatest();

    if (index >= text.length) {
      bodyEl.textContent = text;
      bubbleEl.classList.remove("is-typing");
      message.animate = false;
      activeTypewriterTimer = null;
      return;
    }

    const nextChar = text[index];
    const delay =
      nextChar === "." || nextChar === "," || nextChar === "!" || nextChar === "?"
        ? 36
        : 18;

    activeTypewriterTimer = setTimeout(step, delay);
  }

  bodyEl.textContent = "";
  activeTypewriterTimer = setTimeout(step, 120);
}

function renderChatList(container, chats, emptyText) {
  container.innerHTML = "";

  if (chats.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "chat-list-empty";
    emptyEl.textContent = emptyText;
    container.appendChild(emptyEl);
    return;
  }

  for (const chat of chats) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-item";
    button.dataset.chatId = chat.chatId;

    if (chat.chatId === state.activeChatId) {
      button.classList.add("is-active");
    }

    const title = document.createElement("span");
    title.className = "chat-item-title";
    title.textContent = chat.title;

    const preview = document.createElement("span");
    preview.className = "chat-item-preview";
    preview.textContent = chat.preview;

    const meta = document.createElement("span");
    meta.className = "chat-item-meta";
    meta.textContent = buildChatMeta(chat);

    button.append(title, preview, meta);
    button.addEventListener("click", () => {
      selectChat(chat.chatId);
    });

    container.appendChild(button);
  }
}

function renderChatLists() {
  renderChatList(
    chatListEl,
    state.chats.filter((chat) => !chat.archived),
    "No active chats yet. Create one to get started."
  );
  renderChatList(
    archivedListEl,
    state.chats.filter((chat) => chat.archived),
    "Archived chats will show up here."
  );
}

function renderChatHeader() {
  const activeChat = getActiveChat();

  if (!activeChat) {
    activeChatTitleEl.textContent = "No chat selected";
    activeChatMetaEl.textContent = "Create a chat to start talking to Talli.";
    return;
  }

  activeChatTitleEl.textContent = activeChat.title;
  activeChatMetaEl.textContent = activeChat.archived
    ? "Archived chat. Restore it to continue talking in this thread."
    : "This chat keeps its own memory separate from your other chats.";
}

function updateControls() {
  renderAuth();
  const activeChat = getActiveChat();
  const isArchived = Boolean(activeChat?.archived);

  newChatBtn.disabled = state.isBusy;
  sidebarToggleBtn.disabled = state.isBusy;
  clearChatBtn.disabled = state.isBusy || !activeChat;
  archiveChatBtn.disabled = state.isBusy || !activeChat;
  deleteChatBtn.disabled = state.isBusy || !activeChat;
  archiveChatBtn.setAttribute(
    "aria-label",
    isArchived ? "Restore chat" : "Archive chat"
  );
  archiveChatBtn.setAttribute("title", isArchived ? "Restore chat" : "Archive chat");
  sendBtn.disabled = state.isBusy || !activeChat || isArchived;
  promptEl.disabled = state.isBusy || !activeChat || isArchived;
  promptEl.placeholder = isArchived
    ? "Restore this chat to continue."
    : "Message Talli...";
}

function renderApp() {
  appShellEl.classList.toggle("sidebar-open", state.sidebarOpen);
  renderChatLists();
  renderChatHeader();
  renderConversation();
  updateControls();
}

function selectChat(chatId) {
  if (!getChatById(chatId)) {
    return;
  }

  state.activeChatId = chatId;
  saveActiveChatId(chatId);
  closeSidebar();
  renderApp();
  setStatus(getActiveChat()?.archived ? "Viewing archived chat." : "Connected");
}

function getSessionPayload() {
  return { sessionId: state.sessionId };
}

// Fetch and normalize the owner's chats, then select a sensible active chat.
async function loadChats(preferredChatId = state.activeChatId) {
  state.isBusy = true;
  updateControls();
  setStatus("Loading chats...");

  try {
    const res = await fetch(
      `/api/chats?sessionId=${encodeURIComponent(state.sessionId)}`
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus(data?.error || "Unable to load chats.");
      return;
    }

    syncChats(data?.chats, preferredChatId);
    renderApp();
    setStatus(getActiveChat()?.archived ? "Viewing archived chat." : "Connected");
  } catch (error) {
    console.error(error);
    setStatus("Network error. Check the deployment and try again.");
  } finally {
    state.isBusy = false;
    updateControls();
  }
}

async function createNewChat(options = {}) {
  state.isBusy = true;
  updateControls();

  if (!options.silent) {
    setStatus("Creating a new chat...");
  }

  try {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getSessionPayload()),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus(data?.error || "Unable to create chat.");
      return;
    }

    syncChats(data?.chats, data?.chat?.chatId);
    closeSidebar();
    renderApp();
    setStatus("New chat ready.");
    promptEl.focus();
  } catch (error) {
    console.error(error);
    setStatus("Network error. Check the deployment and try again.");
  } finally {
    state.isBusy = false;
    updateControls();
  }
}

async function mutateActiveChat(action) {
  const activeChat = getActiveChat();

  if (!activeChat) {
    return;
  }

  state.isBusy = true;
  updateControls();
  setStatus(
    action === "clear"
      ? "Clearing chat..."
      : action === "archive"
        ? "Archiving chat..."
        : "Restoring chat..."
  );

  try {
    const res = await fetch("/api/chats", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...getSessionPayload(),
        chatId: activeChat.chatId,
        action,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus(data?.error || "Unable to update chat.");
      return;
    }

    syncChats(
      data?.chats,
      action === "archive" ? null : data?.chat?.chatId ?? activeChat.chatId
    );

    if (action === "archive" && !state.chats.some((chat) => !chat.archived)) {
      renderApp();
      state.isBusy = false;
      updateControls();
      await createNewChat({ silent: true });
      setStatus("Chat archived.");
      return;
    }

    closeSidebar();
    renderApp();
    setStatus(
      action === "clear"
        ? "Chat cleared."
        : action === "archive"
          ? "Chat archived."
          : "Chat restored."
    );
  } catch (error) {
    console.error(error);
    setStatus("Network error. Check the deployment and try again.");
  } finally {
    state.isBusy = false;
    updateControls();
  }
}

async function deleteActiveChat() {
  const activeChat = getActiveChat();

  if (!activeChat) {
    return;
  }

  if (!globalThis.confirm(`Delete "${activeChat.title}" permanently?`)) {
    return;
  }

  state.isBusy = true;
  updateControls();
  setStatus("Deleting chat...");

  try {
    const res = await fetch("/api/chats", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...getSessionPayload(),
        chatId: activeChat.chatId,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus(data?.error || "Unable to delete chat.");
      return;
    }

    syncChats(data?.chats, null);
    closeSidebar();

    if (state.chats.length === 0) {
      renderApp();
      state.isBusy = false;
      updateControls();
      await createNewChat({ silent: true });
      setStatus("Chat deleted.");
      return;
    }

    renderApp();
    setStatus("Chat deleted.");
  } catch (error) {
    console.error(error);
    setStatus("Network error. Check the deployment and try again.");
  } finally {
    state.isBusy = false;
    updateControls();
  }
}

// Sends the user's message, renders an optimistic pending reply, and then
// replaces it with the persisted assistant response returned by the backend.
async function sendMessage() {
  const activeChat = getActiveChat();
  const message = promptEl.value.trim();

  if (!activeChat) {
    setStatus("Create a chat first.");
    return;
  }

  if (activeChat.archived) {
    setStatus("Restore this chat to continue.");
    return;
  }

  if (!message) {
    setStatus("Type a message first.");
    return;
  }

  const optimisticChat = {
    ...activeChat,
    conversation: [
      ...activeChat.conversation,
      { role: "user", content: message },
      { role: "assistant", content: "Thinking...", pending: true },
    ],
  };

  updateChatInState(optimisticChat);
  renderApp();
  promptEl.value = "";
  autoResize();
  state.isBusy = true;
  updateControls();
  setStatus("Talli is thinking...");

  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...getSessionPayload(),
        chatId: activeChat.chatId,
        message,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      updateChatInState({
        ...activeChat,
        conversation: [
          ...activeChat.conversation,
          { role: "user", content: message },
          { role: "assistant", content: data?.error || "Server error." },
        ],
      });
      renderApp();
      setStatus(data?.error || "Server error.");
      return;
    }

    if (data?.chat) {
      updateChatInState(markLatestAssistantMessage(data.chat));
    }

    renderApp();
    setStatus("Connected");
  } catch (error) {
    console.error(error);
    updateChatInState({
      ...activeChat,
      conversation: [
        ...activeChat.conversation,
        { role: "user", content: message },
        {
          role: "assistant",
          content: "Network error. Check the deployment and try again.",
        },
      ],
    });
    renderApp();
    setStatus("Network error. Check the deployment and try again.");
  } finally {
    state.isBusy = false;
    updateControls();
    promptEl.focus();
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendMessage();
});

newChatBtn.addEventListener("click", async () => {
  await createNewChat();
});

clearChatBtn.addEventListener("click", async () => {
  await mutateActiveChat("clear");
});

archiveChatBtn.addEventListener("click", async () => {
  const action = getActiveChat()?.archived ? "restore" : "archive";
  await mutateActiveChat(action);
});

deleteChatBtn.addEventListener("click", async () => {
  await deleteActiveChat();
});

sidebarToggleBtn.addEventListener("click", () => {
  setSidebarOpen(!state.sidebarOpen);
});

sidebarBackdropEl.addEventListener("click", () => {
  closeSidebar();
});

promptEl.addEventListener("input", autoResize);
promptEl.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    await sendMessage();
  }
});

signInBtn.addEventListener("click", async () => {
  if (!state.googleConfigured) {
    await loadAuthState();
    renderAuth();
    setStatus(
      state.missingGoogleAuthEnvVars.length > 0
        ? `Google sign-in is not ready. Add: ${state.missingGoogleAuthEnvVars.join(", ")}`
        : "Google sign-in is not ready yet. Check your OAuth environment settings."
    );
    return;
  }

  window.location.href = "/api/auth?action=google-start";
});

signOutBtn.addEventListener("click", async () => {
  state.isBusy = true;
  updateControls();
  setStatus("Signing out...");

  try {
    const res = await fetch("/api/auth?action=logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      setStatus("Unable to sign out.");
      return;
    }

    state.user = null;
    await loadAuthState();
    await loadChats();
    setStatus("Signed out.");
  } catch (error) {
    console.error(error);
    setStatus("Unable to sign out.");
  } finally {
    state.isBusy = false;
    updateControls();
  }
});

window.addEventListener("resize", () => {
  if (!isMobileLayout()) {
    closeSidebar();
  }
});

async function initApp() {
  autoResize();
  renderApp();
  await loadAuthState();
  renderAuth();

  const authErrorMessage = getAuthErrorMessage();

  if (authErrorMessage) {
    clearAuthErrorFromUrl();
  }

  await loadChats();

  if (authErrorMessage) {
    setStatus(authErrorMessage);
  }
}

initApp();
