# Talli-Ai

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

Vercel serves static assets from `public/` and the agent API from `api/agent.js` (rewrites are limited to `/api/*`).
