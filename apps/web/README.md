# Debugany Web

Next.js dashboard for the Debugany observability platform.

## Run locally

From the repository root:

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
npm run dev:web
```

Open http://localhost:3000.

Set `DEBUGANY_API_URL` to the API base URL and `DEBUGANY_API_KEY` to the demo project's ingestion key in `.env.local`. The dashboard uses these server-side variables to request project issues from `GET /v1/events`; the key is not exposed to browser JavaScript.

If either variable is missing or the API request fails, the dashboard falls back to clearly labeled illustrative sample data. The event list and total event count are connected when the API is reachable; chart bars and other summary metrics remain sample data in this iteration.
