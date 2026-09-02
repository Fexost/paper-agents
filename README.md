# paper-agents

A learning project inspired by [ATLAS](https://github.com/chrisworsey55/atlas-gic): **multi-agent AI + feedback loops + paper trading**.

This is **not** a clone of ATLAS. It implements the core *patterns* in a small, understandable stack:

- **NestJS** API
- **Postgres** via Prisma
- **3 agents** (Macro → Sector → CIO)
- **Paper portfolio** (no real money)
- **Scorecard** (Sharpe per agent)
- **Darwinian weights** (good agents get louder)
- **Autoresearch stub** (rewrite worst agent's prompt)

## Architecture

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
(Optional) Autoresearch prompt tweak
```

## LLM providers (your choice)

The app uses an **OpenAI-compatible** client with fallback routing:

| Provider | Use case | Config |
|----------|----------|--------|
| **Ollama** (default) | Free local models | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` |
| **OmniRoute** | Gateway with free-tier routing | `OMNIROUTE_BASE_URL` — [OmniRoute](https://github.com/diegosouzapw/OmniRoute) |
| **OpenAI** | Direct API | `OPENAI_API_KEY` |

Set `LLM_PRIMARY` and `LLM_FALLBACKS` in `.env`. Example:

```env
LLM_PRIMARY=ollama
LLM_FALLBACKS=omniroute,openai
```

### Recommended local setup (cheapest)

1. Install [Ollama](https://ollama.com)
2. `ollama pull llama3.2`
3. Leave defaults in `.env`

### Optional: OmniRoute

Run OmniRoute locally, then point:

```env
LLM_PRIMARY=omniroute
OMNIROUTE_BASE_URL=http://localhost:20128/v1
```

OmniRoute gives you one OpenAI-compatible endpoint across many providers — useful when you want fallbacks without wiring each SDK yourself.

## Quick start

### 1. Prerequisites

- Node 22+
- Docker (for Postgres) **or** your own Postgres instance

### 2. Install

```bash
npm install
cp .env.example .env
```

### 3. Database

```bash
npm run db:up          # starts Postgres via Docker
npm run db:setup       # migrate + seed 3 agents
```

### 4. Run API

```bash
npm run start:dev
```

### 5. Trigger a daily cycle (paper)

```bash
curl -X POST http://localhost:3000/api/pipeline/run
```

Other endpoints:

- `GET /api/health`
- `GET /api/agents` — agents + Darwin weights
- `GET /api/portfolio` — paper cash/positions
- `GET /api/runs/latest` — last pipeline output
- `POST /api/autoresearch/propose` — tweak worst agent prompt

## Learning roadmap

| Phase | Goal | What to build |
|-------|------|----------------|
| **1 (now)** | Understand the loop | Run daily cycle, inspect DB, tweak prompts in `prompts/` |
| **2** | Real market data | Add `FINNHUB_API_KEY` (free tier) |
| **3** | Autoresearch properly | 5-day evaluation window, keep/revert prompt versions |
| **4** | JANUS-style blending | Multiple prompt cohorts, weight by recent accuracy |
| **5** | Angular dashboard | Visualize agents, equity curve, run history |
| **6** | Tiny live tests | Only after months of paper results — small size, strict rules |

## ATLAS concepts mapped

| ATLAS | paper-agents |
|-------|----------------|
| 25 agents, 4 layers | 3 agents, 3 layers |
| Autoresearch + git keep/revert | DB prompt versions + stub |
| Darwinian weights | Implemented |
| JANUS meta-layer | Future phase |
| MiroFish simulation | Future phase |
| Live trading | **Paper only** by design |

## Project structure

```text
prompts/           Agent prompt templates (versioned in DB)
prisma/            Schema + migrations + seed
src/
  agents/          LLM agent runners
  llm/             OpenAI-compatible provider routing
  market/          Market snapshot (mock or Finnhub)
  paper/           Paper portfolio execution
  pipeline/        EOD cycle, scorecard, Darwin, autoresearch
  api/             REST endpoints
```

## Safety note

This is for **learning and paper trading**. Past backtests (yours or ATLAS's) do not guarantee future returns. Do not risk money until you understand the system and have a long paper track record.

## References

- [ATLAS repo](https://github.com/chrisworsey55/atlas-gic)
- [Karpathy autoresearch](https://github.com/karpathy/autoresearch)
- [OmniRoute](https://github.com/diegosouzapw/OmniRoute)
