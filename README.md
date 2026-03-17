# Talli-Ai

## Local development

1. Create `.env` from `.env.example`.
2. Set `GROQ_API_KEY`.
3. Run `npm run dev`.

## Vercel deployment

1. Import the repo into Vercel.
2. Add `GROQ_API_KEY` in the Vercel project environment variables.
3. Deploy.

Vercel serves static assets from `public/` and the agent API from `api/agent.js` (rewrites are limited to `/api/*`).
