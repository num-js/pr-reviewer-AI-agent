# GitHub Pull Request Reviewer

A full-stack web application that takes a **GitHub pull request URL**, loads the PR metadata and diffs via the **GitHub REST API**, asks **OpenRouter** for a structured code review, lets you **preview and deselect comments**, then **posts the selected comments back to the PR** (inline review comments when GitHub accepts them; otherwise a single PR/issue comment with the full summary).

---

## Table of contents

- [GitHub Pull Request Reviewer](#github-pull-request-reviewer)
  - [Table of contents](#table-of-contents)
  - [Features](#features)
  - [Architecture](#architecture)
  - [Tech stack](#tech-stack)
  - [Repository layout](#repository-layout)
  - [Prerequisites](#prerequisites)
  - [Configuration](#configuration)
    - [Step 1: Create `backend/.env`](#step-1-create-backendenv)
    - [Step 2: Environment variables](#step-2-environment-variables)
  - [GitHub token permissions](#github-token-permissions)
    - [Classic personal access token](#classic-personal-access-token)
    - [Fine-grained personal access token](#fine-grained-personal-access-token)
  - [Installation](#installation)
  - [Running the application](#running-the-application)
    - [Development (two terminals)](#development-two-terminals)
    - [Production build (frontend only)](#production-build-frontend-only)
    - [Backend production start](#backend-production-start)
  - [Using the web UI](#using-the-web-ui)
  - [HTTP API reference](#http-api-reference)
    - [`GET /api/health`](#get-apihealth)
    - [`POST /api/review-pr/generate`](#post-apireview-prgenerate)
    - [`POST /api/review-pr/post`](#post-apireview-prpost)
  - [Review pipeline](#review-pipeline)
  - [Production deployment](#production-deployment)
  - [Troubleshooting](#troubleshooting)
  - [Security](#security)
  - [Scripts reference](#scripts-reference)
  - [License](#license)

---

## Features

| Area | Details |
|------|---------|
| **Frontend** | React + TypeScript + Tailwind; PR URL input; review preview checklist; loading and success/error states; activity log (server + client messages). |
| **Validation** | Debounced PR URL validation (`https://github.com/{owner}/{repo}/pull/{number}`). |
| **Resilience** | Client-side retries with backoff on failed review requests. |
| **Backend** | Express `POST /api/review-pr/generate` + `POST /api/review-pr/post`; modular `githubService`, `openRouterService`, `reviewController`. |
| **AI output** | JSON array: `{ file, line, comment, suggestedCode }` per finding. |
| **GitHub** | Inline PR review comments (with suggested code when provided); always posts a PR-level summary comment. |

---

## Architecture

```mermaid
flowchart LR
  subgraph browser [Browser]
    UI[React UI]
  end
  subgraph vite [Vite dev server]
    Proxy["/api proxy → backend"]
  end
  subgraph backend [Node backend]
    API[Express]
    RC[reviewController]
    GH[githubService]
    OR[openRouterService]
  end
  subgraph external [External APIs]
    GITHUB[GitHub REST API]
    OPENROUTER[OpenRouter API]
  end
  UI --> Proxy
  Proxy --> API
  API --> RC
  RC --> GH
  RC --> OR
  GH --> GITHUB
  OR --> OPENROUTER
```

In **development**, the frontend talks to the same origin (`localhost:5173`); Vite forwards `/api/*` to the Express server (default `http://localhost:3001`). In **production**, you typically serve the built static files and point the UI at your API base URL (or put both behind one reverse proxy).

---

## Tech stack

| Layer | Technologies |
|--------|----------------|
| **Frontend** | React 18, TypeScript, Vite 5, Tailwind CSS 3 |
| **Backend** | Node.js 18+ (native `fetch`), Express 4, ES modules |
| **AI** | OpenRouter Chat Completions API via native `fetch` (`https://openrouter.ai/api/v1/chat/completions`) |
| **GitHub** | REST API v3 (`api.github.com`), `Bearer` token, `X-GitHub-Api-Version` header |

---

## Repository layout

```text
pr-revewer-agent-githuh/
├── .env.example              # Template for secrets (copy to backend/.env)
├── README.md                 # This file
├── backend/
│   ├── server.js             # Express app, CORS, routes, loads backend/.env
│   ├── controllers/
│   │   └── reviewController.js
│   └── services/
│       ├── githubService.js  # URL parse, PR/files fetch, comments
│       └── openRouterService.js  # Prompt + structured JSON review
└── frontend/
    ├── vite.config.ts        # Dev server + /api proxy
    ├── src/
    │   ├── App.tsx           # Main UI, retries, logs
    │   ├── hooks/useDebouncedValue.ts
    │   └── lib/prUrl.ts      # URL validation helpers
    └── …
```

Environment variables are read only from **`backend/.env`** (path resolved next to `server.js`), not from the repo root.

---

## Prerequisites

- **Node.js 18 or newer** (required for global `fetch` in the backend).
- **npm** (or compatible client) to install dependencies.
- A **GitHub account** and a token with rights to read the target repo and create PR/issue comments (see [GitHub token permissions](#github-token-permissions)).
- An **OpenRouter API key** with access to the model you configure (default: `openai/gpt-4o-mini`).

---

## Configuration

### Step 1: Create `backend/.env`

Copy the example file into the backend folder (do not commit real secrets):

```bash
cp .env.example backend/.env
```

### Step 2: Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | **Yes** | GitHub personal access token (classic or fine-grained) used for all GitHub API calls. |
| `OPENROUTER_API_KEY` | **Yes** | OpenRouter API secret key. |
| `PORT` | No | HTTP port for the API. Default: `3001`. |
| `CORS_ORIGIN` | No | Allowed browser origin for CORS (e.g. `http://localhost:5173`). If unset, the server reflects a permissive default suitable for local dev; set explicitly in production. |
| `OPENROUTER_MODEL` | No | OpenRouter model id. Default: `openai/gpt-4o-mini`. |

Example `backend/.env`:

```env
GITHUB_TOKEN=ghp_xxxxxxxx
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
PORT=3001
CORS_ORIGIN=http://localhost:5173
OPENROUTER_MODEL=openai/gpt-4o-mini
```

---

## GitHub token permissions

Requirements depend on repository visibility and token type.

### Classic personal access token

For **private** repositories, use a token with the **`repo`** scope so the app can read pull requests and create comments.

For **public** repositories only, narrower scopes may work in some setups, but **`repo`** is the simplest choice for an MVP that must always read PRs and post comments.

### Fine-grained personal access token

Grant access to the repositories you need, with permissions such as:

- **Contents:** read (to resolve PR context as needed by the API)
- **Pull requests:** read and write (read PR + files; create review/issue comments)

Consult [GitHub’s documentation on token scopes](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) if your organization enforces restrictions.

---

## Installation

From the repository root:

```bash
cd backend && npm install
cd ../frontend && npm install
```

---

## Running the application

### Development (two terminals)

**1. API server**

```bash
cd backend
npm run dev
```

Uses `node --watch` to restart on file changes. Listens on `PORT` (default **3001**).

**2. Frontend**

```bash
cd frontend
npm run dev
```

Opens the Vite dev server (default **http://localhost:5173**). Requests to `/api/*` are proxied to the backend (see `frontend/vite.config.ts`).

### Production build (frontend only)

```bash
cd frontend
npm run build
```

Static output is in `frontend/dist/`. Serve that folder with any static host and ensure the browser can reach the backend (same host + reverse proxy, or set `CORS_ORIGIN` and configure the frontend to call your API base URL; the stock dev UI uses relative `/api` paths).

### Backend production start

```bash
cd backend
npm start
```

Use a process manager (systemd, PM2, Docker, etc.) and inject `backend/.env` or environment variables from your secret store.

---

## Using the web UI

1. Open the app in the browser (dev: **http://localhost:5173**).  
2. Paste a full GitHub PR URL, for example:  
   `https://github.com/facebook/react/pull/12345`  
3. Click **Start review** and wait for AI suggestions.  
4. In the **review preview**, uncheck or **Remove** any comments you do not want.  
5. Click **Post N to GitHub** to publish only the selected comments.  
6. Inspect **Activity log** for server-side steps and any client retry messages.  
7. On success, open the PR on GitHub: you should see **inline review comments** and/or a **single summary comment** if every inline attempt failed.

The UI validates the URL shape (debounced). **Retry** appears after an error and re-runs generation. **Cancel** discards the preview without posting.

---

## HTTP API reference

Base URL in development (via proxy): same origin as the Vite app, paths under `/api`.

### `GET /api/health`

Liveness check.

**Response** `200`

```json
{ "ok": true }
```

---

### `POST /api/review-pr/generate`

Fetches the PR and generates AI review comments **without** posting to GitHub.

**Headers**

- `Content-Type: application/json`

**Body**

```json
{
  "prUrl": "https://github.com/owner/repo/pull/42"
}
```

**Success** `200`

```json
{
  "ok": true,
  "owner": "owner",
  "repo": "repo",
  "pullNumber": 42,
  "prTitle": "…",
  "suggestions": [
    {
      "file": "src/app.ts",
      "line": 10,
      "comment": "…",
      "suggestedCode": "…"
    }
  ],
  "logs": ["[ISO8601] …", "…"]
}
```

| Field | Meaning |
|--------|---------|
| `suggestions` | AI review items (`file`, `line`, `comment`, optional `suggestedCode`) ready for preview/selection. |
| `logs` | Timestamped log lines for debugging or UI display. |

**Client errors** `400`

Missing or invalid `prUrl`, or invalid URL format.

```json
{
  "ok": false,
  "error": "…",
  "logs": []
}
```

**Server / upstream errors** `4xx` / `5xx`

GitHub or OpenRouter failures surface with `ok: false` and an `error` message; `logs` may contain prior steps.

---

### `POST /api/review-pr/post`

Posts selected review comments to the PR on GitHub.

**Headers**

- `Content-Type: application/json`

**Body**

```json
{
  "prUrl": "https://github.com/owner/repo/pull/42",
  "comments": [
    {
      "file": "src/app.ts",
      "line": 10,
      "comment": "…",
      "suggestedCode": "…"
    }
  ]
}
```

**Success** `200`

```json
{
  "ok": true,
  "owner": "owner",
  "repo": "repo",
  "pullNumber": 42,
  "prTitle": "…",
  "suggestionsCount": 5,
  "postedInlineCount": 3,
  "fallbackPosted": false,
  "summaryPosted": true,
  "postedInline": [{ "file": "src/app.ts", "line": 10 }],
  "inlineErrors": [{ "file": "src/app.ts", "line": 99, "message": "…" }],
  "logs": ["[ISO8601] …", "…"]
}
```

| Field | Meaning |
|--------|---------|
| `suggestionsCount` | Number of comments submitted in the request. |
| `postedInlineCount` | How many inline PR review comments GitHub accepted. |
| `fallbackPosted` | `true` if **zero** inline comments succeeded; the PR summary still carries the full review. |
| `summaryPosted` | `true` when the detailed PR-level summary comment was posted (always on success). |
| `postedInline` | Successfully created inline comments (file + line). |
| `inlineErrors` | Items GitHub rejected (wrong line, path, permissions, etc.). |
| `logs` | Timestamped log lines for debugging or UI display. |

**Client errors** `400`

Missing/invalid `prUrl`, empty `comments`, or no valid comment objects.

**Server / upstream errors** `4xx` / `5xx`

GitHub failures surface with `ok: false` and an `error` message; `logs` may contain prior steps.

---

## Review pipeline

1. **Parse URL** — Expects `github.com/{owner}/{repo}/pull/{number}` (http/https allowed).  
2. **Generate** (`/api/review-pr/generate`) — Fetches PR + changed files; OpenRouter returns a JSON **array** of `{ "file", "line", "comment", "suggestedCode" }` (large diffs may be truncated; see `openRouterService.js`). No GitHub comments are created yet.  
3. **Preview (UI)** — User unchecks or removes unwanted comments (suggested code is shown when present).  
4. **Post** (`/api/review-pr/post`) — Re-fetches PR head SHA; for each selected comment, creates a [pull request review comment](https://docs.github.com/en/rest/pulls/comments#create-a-review-comment-for-a-pull-request) on the PR head (`side: RIGHT`), including a **Suggested change** code block when `suggestedCode` is non-empty. Then always creates one [issue comment](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment) with a detailed PR review summary.

**Line numbers:** GitHub expects the line to exist on the **right-hand** side of the diff for that commit. The model is instructed accordingly; mismatches still produce entries in `inlineErrors`.

---

## Production deployment

- Run the backend on a reachable host; restrict `CORS_ORIGIN` to your real front-end origin.  
- Do not expose `OPENROUTER_API_KEY` or `GITHUB_TOKEN` to the browser; only the backend uses them.  
- Serve `frontend/dist` over HTTPS in production.  
- If the UI is not on the same host as the API, configure your build or server so API calls hit the correct base URL (the stock Vite app uses relative `/api` paths, which assume a shared reverse proxy or same-origin deployment).

---

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| `401` / `403` from GitHub | Token expired, missing `repo` / pull-request permissions, or fine-grained token not allowed on that repo. |
| Inline comments fail, summary still posted | Model line numbers not on changed lines; binary files; or GitHub rejecting `path`/`line`. See `inlineErrors`; a PR summary comment is still posted. |
| `OPENROUTER_API_KEY is not set` | `backend/.env` missing or wrong path; ensure you run the server from any cwd (env is loaded from `backend/.env` next to `server.js`). |
| CORS errors in browser | Set `CORS_ORIGIN` to your exact front-end origin (scheme + host + port). |
| Empty or invalid AI JSON | Rare model drift; retry or switch `OPENROUTER_MODEL`. Invalid JSON throws in `openRouterService.js` and returns an error response. |
| Frontend cannot reach API | Dev: confirm backend on port 3001 and Vite proxy in `vite.config.ts`. Prod: proxy or CORS as above. |

---

## Security

- **Never** commit `backend/.env` or real tokens to git. The template is `.env.example` only.  
- **Never** embed `GITHUB_TOKEN` or `OPENROUTER_API_KEY` in frontend code or public repos.  
- Rotate tokens if they leak. Prefer fine-grained tokens scoped to specific repositories when possible.  
- This MVP is intended for **trusted operators**; it does not implement multi-user auth, rate limiting, or PR allowlists. Harden before exposing to the public internet.

---

## Scripts reference

| Location | Command | Purpose |
|----------|---------|---------|
| `backend` | `npm run dev` | Start API with `node --watch`. |
| `backend` | `npm start` | Start API once (`node server.js`). |
| `frontend` | `npm run dev` | Vite dev server + HMR. |
| `frontend` | `npm run build` | Typecheck + production bundle to `dist/`. |
| `frontend` | `npm run preview` | Preview the production build locally. |

---

## License

Add a `LICENSE` file for your project if you distribute or open-source this code.
