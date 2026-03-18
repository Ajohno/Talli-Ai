# Talli-Ai

Talli-Ai is a chat application for a personal AI companion that combines:

- persistent multi-chat threads
- optional Google sign-in
- MongoDB-backed storage
- cross-chat memory extraction and retrieval
- automatic thread summarization

This README focuses on the features that are currently active in the codebase and the environment variables required to run them.

## Active features in this codebase

### 1. Multi-chat conversation management
Talli supports multiple chat threads per owner. Each thread can be:

- created
- selected
- archived / restored
- cleared
- deleted

Chats are stored in MongoDB and scoped to an owner, which is either:

- a signed-in Google account, or
- a local browser session when no account is connected

### 2. Persistent chat history
Each chat stores:

- a title
- the conversation history
- preview text
- timestamps
- archive state

The backend trims old messages so each chat stays within a manageable message window.

### 3. Automatic thread summarization
Longer chats are summarized automatically.

The summary is stored with the chat and then injected back into the agent prompt so Talli can keep continuity even when the raw conversation has been trimmed.

### 4. Cross-chat memory
Talli extracts durable user-specific facts from conversations and stores them in a dedicated MongoDB `memories` collection.

Examples of the kinds of things the system tries to remember:

- preferences
- goals
- projects
- identity details
- recurring context

When a new message is sent, the backend retrieves relevant memories and includes them in the model prompt.

### 5. Google OAuth sign-in
The app includes an optional Google sign-in flow.

When Google sign-in is configured and a user authenticates successfully:

- the app stores an auth cookie
- the backend resolves requests to a Google-based owner id
- chats and memories become account-scoped instead of session-scoped

When the user is not signed in, the app falls back to a local browser session id.

### 6. Auth-aware frontend UI
The sidebar shows an account card that can display:

- guest mode
- signed-in Google account state
- missing OAuth configuration requirements

The frontend also supports:

- sign in
- sign out
- auth status checks via `/api/auth?action=me`

### 7. Tool-enabled AI responses
The current agent supports small built-in tools for:

- reading the current time
- basic calculator-style math

### 8. Vercel-friendly API structure
The app serves static assets from `public/` and exposes API handlers through `/api/*`, which matches the current local server setup and the existing Vercel deployment structure.

## High-level architecture

### Frontend
- `public/index.html` — app layout and styles
- `public/app.js` — client state, chat UI, auth UI, and API requests

### Backend
- `server.js` — local Express entrypoint
- `lib/agent.js` — AI orchestration, memory retrieval, summarization, and reply flow
- `lib/chats.js` — `/api/chats` request handling
- `lib/auth.js` — `/api/auth` request handling and Google OAuth helpers
- `lib/chat-store.js` — chat persistence helpers
- `lib/memory-store.js` — long-term memory persistence helpers
- `lib/mongodb.js` — MongoDB connection and index setup

## Environment variables

Create `.env` from `.env.example` and set the variables you need.

### Required for core app behavior
- `GROQ_API_KEY`
- `MONGODB_URI`
- `MONGODB_DB_NAME` (optional; defaults to `talli` if omitted in code)

### Required for Google sign-in
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_COOKIE_SECRET`

### Optional for Google sign-in
- `GOOGLE_REDIRECT_URI`
  - If not set, the app derives the callback URL from the current request origin.
  - The callback path is `/api/auth?action=google-callback`.

## Local development

1. Create `.env` from `.env.example`.
2. Set `GROQ_API_KEY`, `MONGODB_URI`, and `AUTH_COOKIE_SECRET`.
3. To enable Google sign-in, also set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. In the Google Cloud Console, add an authorized redirect URI pointing to `/api/auth?action=google-callback` on your app origin (for local dev that is typically `http://localhost:3000/api/auth?action=google-callback`).
5. Run `npm run dev`.

## Vercel deployment

1. Import the repo into Vercel.
2. Add `GROQ_API_KEY`, `MONGODB_URI`, and `AUTH_COOKIE_SECRET` in the Vercel project environment variables.
3. If you want Google sign-in, also add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `GOOGLE_REDIRECT_URI` if you need to force a specific callback URL.
4. In Google Cloud Console, add your deployed callback URL `/api/auth?action=google-callback` to the app's authorized redirect URIs.
5. Deploy.

## What is not yet handled automatically

A few important things are not fully built out yet:

- guest-to-account data migration after sign-in
- a UI for inspecting / editing long-term memories
- a formal automated test suite
- stronger production observability around auth, summaries, and memory quality
