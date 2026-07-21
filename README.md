# AI Forecast Studio

An AI-powered data science team for small businesses. The project includes the React product experience, a Node/Express API, real CSV/XLSX/JSON ingestion, Neon Postgres persistence, and a structured multi-agent workflow through an OpenAI-compatible API.

## Architecture

- **Frontend:** React, TypeScript, Vite
- **API:** Express with multipart uploads and asynchronous analysis polling
- **Database:** Neon Postgres through `@neondatabase/serverless`
- **AI:** OpenAI JavaScript SDK against NVIDIA's OpenAI-compatible Chat Completions endpoint, with Zod-validated JSON outputs
- **Ingestion:** deterministic schema inference, data profiling, time-series aggregation, and sensitive-column redaction
- **Analytics:** deterministic metrics calculated from the authenticated user's persisted rows: period revenue, demand, cost, gross margin, closing inventory, trends, and leading segments
- **Notifications:** persisted Neon event stream with unread counters, contextual actions, read receipts, and polling for agent/workspace updates

Complete source records are persisted in Neon. The inference provider receives only the dataset profile, aggregated time series, and a redacted sample. Reasoning content is never exposed in the product UI.

## Configure Neon and OpenAI

Requirements: Node.js 20 or newer, a Neon project, and an NVIDIA API key.

1. In the Neon dashboard, create a project and copy its pooled connection string.
2. Create a local environment file:

```bash
cp .env.example .env
```

3. Set these values in `.env`:

```dotenv
DATABASE_URL=postgresql://user:password@your-neon-host/neondb?sslmode=require
AI_BASE_URL=https://integrate.api.nvidia.com/v1
AI_API_KEY=nvapi-...
AI_MODEL=openai/gpt-oss-120b
AI_TIMEOUT_MS=300000
AI_MAX_RETRIES=0
AI_MAX_OUTPUT_TOKENS=1200
AI_BRIEFING_MAX_TOKENS=1600
AI_REASONING_EFFORT=low
APP_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
```

4. Apply the database schema:

```bash
npm run db:migrate
```

The API also applies the idempotent schema automatically when it starts.

## Run locally

```bash
npm install
npm run dev
```

This starts Vite on `http://localhost:5173`, the API on `http://127.0.0.1:8787`, and a development proxy from `/api` to the backend.

## Product flow

1. Create an account or sign in. Passwords use scrypt and sessions are stored as hashed, revocable tokens in Neon.
2. Choose **Deploy your AI Team** and upload a CSV, XLSX, or JSON file, reuse sources from the dataset library, or use the Northstar Retail scenario.
3. The API fingerprints, parses, profiles, redacts, and persists new data in Neon. Exact duplicate files reuse the existing dataset automatically.
4. Review the detected business fields and data-quality summary.
5. Deploy the specialist team and watch each persisted agent run.
6. Enter the Command Center when the Team Lead briefing completes.
7. Explore routed workspaces for Forecasts, Insights, Decision Room, Team Meetings, and Reports.

The authenticated dashboard never substitutes demo values for business metrics. Without data it shows a connection state; with data it reads deterministic aggregates from Neon. AI-only fields such as risk, confidence, and recommendations appear after a completed analysis.

## API

- `GET /api/health` — credential and database readiness
- `POST /api/auth/register` — create an account and HttpOnly session
- `POST /api/auth/login` — authenticate and create a session
- `POST /api/auth/token` — exchange valid credentials for an API Bearer token; the raw token is returned once
- `POST /api/auth/logout` — revoke the current cookie or Bearer token
- `GET /api/auth/me` — current authenticated user
- `POST /api/datasets/ingest` — deduplicated multipart dataset ingestion
- `POST /api/datasets/sample` — persisted Northstar demo dataset
- `GET /api/datasets` — complete authenticated dataset history with coverage and analysis usage
- `GET /api/datasets/:datasetId` — dataset profile
- `GET /api/datasets/latest/current` — latest dataset owned by the current user
- `GET /api/datasets/latest/current/analytics` — real dashboard aggregates calculated from the latest persisted rows
- `GET /api/datasets/:datasetId/analytics` — real aggregates for an owned dataset
- `POST /api/analyses` — create and start the AI Team workflow with one to five owned `datasetIds`
- `POST /api/analyses/:analysisId/retry` — resume a failed analysis from its first incomplete agent
- `GET /api/analyses/:analysisId` — poll analysis and agent statuses
- `GET /api/analyses/latest/current` — latest analysis owned by the current user
- `GET /api/team/conversations` — authenticated Team Meetings history
- `GET /api/team/conversations/:conversationId` — complete owned conversation and message history
- `POST /api/team/ask` — ask one specialist or the entire five-agent team, optionally continuing an existing conversation
- `GET /api/notifications` — latest notifications and unread count
- `PATCH /api/notifications/:notificationId/read` — mark an owned notification as read
- `POST /api/notifications/read-all` — mark every owned notification as read

Except for health, registration, login, and token issuance, every `/api` route passes through the authentication middleware. Browser requests use the secure HttpOnly cookie; programmatic clients can send `Authorization: Bearer <token>`. Tokens are random opaque credentials, only their SHA-256 hashes are persisted, and logout revokes the current token. Dataset and analysis queries also enforce workspace ownership in Neon. Mutating browser requests are restricted to the `APP_ORIGIN` allowlist.

The analysis worker uses an atomic database claim, records safe per-agent latency telemetry, and preserves completed specialist results. Provider timeouts become a retryable analysis state, and a periodic recovery sweep converts abandoned jobs into resumable failures instead of leaving them permanently `running`.

Every uploaded source receives a SHA-256 content fingerprint. A partial unique index in Neon prevents exact duplicates inside a workspace, including concurrent uploads. The Connect Data library can reuse and combine up to five owned datasets; the AI Team receives each source's profile, aggregates, and redacted sample as a single multi-source context.

Team Meetings are persisted as conversations tied to the user and the completed analysis used as evidence. A room can target Elena, Noah, Maya, Owen, Ava, or the entire team. Follow-up questions retain the room's original target, while team rooms store each specialist response and the final synthesis as separate messages.

Notification events are emitted for account setup, dataset connections, analysis deployment, material risk findings, completed or failed analyses, and completed team meetings.

## Error contract

API errors are normalized through the centralized catalog in `server/errors/index.ts`. Public responses contain only a stable code, safe message, and request identifier:

```json
{
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "Your session has expired. Sign in again to continue.",
    "requestId": "..."
  }
}
```

Provider, database, stack, and configuration details are written only to server logs with the matching request identifier. The frontend ignores unrecognized raw response text and converts network failures into controlled messages.

## Validate

```bash
npm run lint
npm run build
npm run test:server
npm audit --omit=dev
```
