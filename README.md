# paper-agents

A learning project inspired by [ATLAS](https://github.com/chrisworsey55/atlas-gic): **multi-agent AI + feedback loops + paper trading**.

This is **not** a clone of ATLAS. It implements the core *patterns* in a small, understandable stack:

- **NestJS** API + **Angular** dashboard
- **Postgres** via Prisma (Docker on port **5433**)
- **3 agents** (Macro → Sector → CIO)
- **Paper portfolio** (no real money)
- **Scorecard** (Sharpe, hit rate per agent)
- **Darwinian weights** (good agents get louder)
- **ATLAS-style autoresearch** (propose one prompt change, evaluate N days, keep or revert)

## Architecture

```text
Angular Dashboard (:4200)  →  proxy /api  →  NestJS API (:3001)  →  Postgres (:5433)
```

```text
Market snapshot
    ↓
Macro Agent  → regime (RISK_ON / RISK_OFF / NEUTRAL)
    ↓
Sector Agent → 1-3 ticker picks
    ↓
CIO Agent    → paper trade actions (BUY/SELL/HOLD)
    ↓
Paper portfolio + scorecard + Darwin weights
    ↓
Autoresearch tick (after each daily run)
```

## LLM providers

The app uses an **OpenAI-compatible** client with fallback routing:

| Provider | Use case | Config |
|----------|----------|--------|
| **mock** (default) | Deterministic JSON for local dev | `LLM_PRIMARY=mock` |
| **Ollama** | Free local models | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` |
| **OmniRoute** | Gateway with free-tier routing | `OMNIROUTE_BASE_URL` — [OmniRoute](https://github.com/diegosouzapw/OmniRoute) |
| **OpenAI** | Direct API | `OPENAI_API_KEY` |

Set `LLM_PRIMARY` and `LLM_FALLBACKS` in `.env`. Example:

```env
LLM_PRIMARY=mock
LLM_FALLBACKS=ollama,omniroute,openai
```

### Optional: Ollama (local models)

1. Install [Ollama](https://ollama.com)
2. `ollama pull llama3.2`
3. Set `LLM_PRIMARY=ollama` in `.env`

### Optional: OmniRoute

Run OmniRoute locally, then point:

```env
LLM_PRIMARY=omniroute
OMNIROUTE_BASE_URL=http://localhost:20128/v1
```

## Quick start

### 1. Prerequisites

- Node 22+
- Docker (for Postgres) **or** your own Postgres instance

### 2. Install

```bash
npm install
cd dashboard && npm install && cd ..
cp .env.example .env
```

### 3. Database

```bash
npm run db:up          # starts Postgres via Docker (port 5433)
npm run db:setup       # migrate + seed 3 agents
```

### 4. Run API + dashboard

Ports are set in npm scripts — no manual `PORT=` or `--port` flags needed.

```bash
# Terminal 1 — API on http://localhost:3001
npm run start:dev

# Terminal 2 — dashboard on http://localhost:4200
npm run dashboard:dev
```

Open http://localhost:4200

### 5. Trigger a daily cycle (paper)

From the dashboard, or:

```bash
curl -X POST http://localhost:3001/api/pipeline/run -H "Content-Type: application/json" -d "{\"force\":true}"
```

Use `force: true` to re-run on the same calendar day (one run per day by default).

## API endpoints

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/health` | GET | Health check |
| `/api/status` | GET | Market source, LLM, autoresearch config |
| `/api/agents` | GET | Agents + Darwin weights + score snapshots |
| `/api/portfolio` | GET | Paper portfolio |
| `/api/runs` | GET | Run history |
| `/api/runs/latest` | GET | Latest run with recs/trades |
| `/api/pipeline/run` | POST | Body: `{ autoresearch?: boolean, force?: boolean }` |
| `/api/autoresearch/start` | POST | Start new experiment |
| `/api/autoresearch/experiments` | GET | Experiment history |
| `/api/autoresearch/active` | GET | Active experiment |
| `/api/agents/:slug/prompt` | GET/PUT | Prompt read/write (versioned) |

## Dashboard

The Angular app in `dashboard/` shows:

- System status (market source, LLM, autoresearch)
- Run controls (paper cycle, autoresearch, force re-run)
- Portfolio, agents, run history, latest run detail
- Autoresearch progress + history
- Prompt editor for macro / sector / cio

Proxy: `dashboard/proxy.conf.json` → `http://localhost:3001`

## Learning roadmap

| Phase | Goal | Status |
|-------|------|--------|
| **1** | Understand the loop | Run daily cycle, inspect DB, tweak prompts |
| **2** | Real market data | Add `FINNHUB_API_KEY` (free tier) |
| **3** | Autoresearch | 5-day eval window, keep/revert prompt versions |
| **4** | JANUS-style blending | Multiple prompt cohorts, weight by recent accuracy |
| **5** | Angular dashboard | Agents, portfolio, run history, prompt editor |
| **6** | Tiny live tests | Only after months of paper — small size, strict rules |

## ATLAS concepts mapped

| ATLAS | paper-agents |
|-------|----------------|
| 25 agents, 4 layers | 3 agents, 3 layers |
| Autoresearch + git keep/revert | DB prompt versions + experiments |
| Darwinian weights | Implemented |
| JANUS meta-layer | Future phase |
| MiroFish simulation | Future phase |
| Live trading | **Paper only** by design |

## Project structure

```text
prompts/           Agent prompt templates (versioned in DB)
prisma/            Schema + migrations + seed
dashboard/         Angular 19 UI
src/
  agents/          LLM agent runners
  llm/             OpenAI-compatible provider routing
  market/          Market snapshot (mock or Finnhub)
  paper/           Paper portfolio execution
  pipeline/        EOD cycle, scorecard, Darwin, autoresearch
  api/             REST endpoints
```

## Environment variables

Copy `.env.example` to `.env`. Key values:

```env
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/paper_agents?schema=public
LLM_PRIMARY=mock
AUTORESEARCH_EVAL_DAYS=5
FINNHUB_API_KEY=          # optional, for live quotes
```

`PORT` is also set in `npm run start:dev` via `cross-env`, so the API starts on 3001 even before `.env` exists.

## Safety note

This is for **learning and paper trading**. Past backtests (yours or ATLAS's) do not guarantee future returns. Do not risk money until you understand the system and have a long paper track record.

## References

- [ATLAS repo](https://github.com/chrisworsey55/atlas-gic)
- [Karpathy autoresearch](https://github.com/karpathy/autoresearch)
- [OmniRoute](https://github.com/diegosouzapw/OmniRoute)

For AI agent context, see [AGENTS.md](./AGENTS.md).
