# AGENTS.md — paper-agents

Context for AI coding agents (Cursor, Grok Build, Claude Code, etc.) working on this repository.

## What this project is

**paper-agents** is a learning project inspired by [ATLAS](https://github.com/chrisworsey55/atlas-gic) and [Karpathy autoresearch](https://github.com/karpathy/autoresearch). It is **not** a fork of ATLAS. It implements the core *patterns* in a small, understandable stack:

- Multi-agent pipeline (Macro → Sector → CIO)
- Paper trading only (no real money)
- Per-agent scorecard (Sharpe, hit rate)
- Darwinian agent weights (0.3–2.5)
- ATLAS-style **autoresearch**: propose one prompt change, evaluate for N days, keep or revert based on Sharpe

## Architecture

```text
Angular Dashboard (:4200)  →  proxy /api  →  NestJS API (:3001)  →  Postgres (:5433 via Docker)
```

```text
Market snapshot
    ↓
Macro Agent  → regime (RISK_ON / RISK_OFF / NEUTRAL)
    ↓
Sector Agent → 1–3 ticker picks
    ↓
CIO Agent    → paper trade actions (BUY/SELL/HOLD)
    ↓
Paper portfolio + scorecard + Darwin weights
    ↓
Autoresearch tick (after each daily run)
```

## Tech stack

| Layer | Stack |
|-------|-------|
| API | NestJS 11, TypeScript |
| DB | Postgres via Docker Compose (port **5433**), Prisma 7 with `@prisma/adapter-pg` |
| LLM | OpenAI-compatible client; providers: **mock**, ollama, omniroute, openai |
| Market | Mock by default; Finnhub if `FINNHUB_API_KEY` set |
| Frontend | Angular 19 in `dashboard/` |

## Key directories

```text
prompts/              Seed prompt templates (macro, sector, cio)
prisma/               Schema, migrations, seed
src/
  agents/             LLM agent runners
  llm/                Provider routing (mock / ollama / omniroute / openai)
  market/             Market snapshot service
  paper/              Paper portfolio execution
  pipeline/           EOD cycle, scorecard, Darwin, autoresearch
  api/                REST endpoints
dashboard/            Angular dashboard (proxy to API)
```

## Agents (business logic, not AI tools)

| Slug | Layer | Role |
|------|-------|------|
| `macro` | MACRO | Market regime + conviction |
| `sector` | SECTOR | Sector/ticker picks |
| `cio` | DECISION | Portfolio actions |

Prompts are **versioned in the DB** (`AgentPrompt`). Autoresearch creates candidate prompt versions and may revert to baseline.

## Autoresearch (ATLAS pattern)

1. Pick worst-Sharpe agent (with cooldown so same agent isn't picked within eval window)
2. LLM proposes **one** prompt change → saves as **candidate** prompt (active), baseline deactivated
3. Creates `AutoresearchExperiment` with status `EVALUATING`
4. After each completed daily run: `tickAfterDailyRun()` increments `daysCompleted`
5. After N days (`AUTORESEARCH_EVAL_DAYS`, default 5): compare candidate Sharpe vs baseline
   - **Improved → KEPT** (candidate stays active)
   - **Worse → REVERTED** (baseline reactivated, candidate deactivated)

## API endpoints

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/health` | GET | Health check |
| `/api/status` | GET | marketDataSource, llmPrimary, activeExperiment, evalDays |
| `/api/agents` | GET | Agents + Darwin weights + score snapshots |
| `/api/portfolio` | GET | Paper portfolio |
| `/api/runs` | GET | Run history |
| `/api/runs/latest` | GET | Latest run with recs/trades |
| `/api/pipeline/run` | POST | Body: `{ autoresearch?: boolean, force?: boolean }` |
| `/api/autoresearch/start` | POST | Start new experiment |
| `/api/autoresearch/experiments` | GET | Experiment history |
| `/api/autoresearch/active` | GET | Active experiment |
| `/api/agents/:slug/prompt` | GET/PUT | Prompt read/write (versioned) |

## Environment variables

Copy `.env.example` to `.env`. Important values:

```env
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/paper_agents?schema=public
LLM_PRIMARY=mock          # mock | ollama | omniroute | openai
LLM_FALLBACKS=ollama,omniroute,openai
AUTORESEARCH_EVAL_DAYS=5
FINNHUB_API_KEY=          # optional, for live quotes
```

**Never commit `.env`.** CI uses `LLM_PRIMARY=mock` and a Postgres service container.

## Local development

```powershell
# Terminal 1 — database
npm run db:up
npm run db:setup

# Terminal 2 — API
$env:PORT=3001; npm run start:dev

# Terminal 3 — dashboard
cd dashboard
npx ng serve --port 4200
```

Open http://localhost:4200

Trigger a paper run from the dashboard or:

```bash
curl -X POST http://localhost:3001/api/pipeline/run -H "Content-Type: application/json" -d "{\"force\":true}"
```

## Prisma conventions

- Both sides of relations with `@relation`
- IDs: `@id @default(cuid())` for strings, `@default(autoincrement())` for ints
- `createdAt` / `updatedAt` on models where appropriate
- `@@index` on frequently queried fields

After schema changes: `npx prisma migrate dev`, then `npx prisma generate`.

## Build commands

```bash
npm run build              # NestJS API
npm run dashboard:build    # Angular (or cd dashboard && npm run build)
npx prisma generate        # Regenerate client after schema changes
```

`tsconfig.build.json` excludes `dashboard/` from the Nest build.

## Dashboard UI (Angular)

The dashboard at `dashboard/` shows:

- System status (market source, LLM, autoresearch config)
- Run controls (paper cycle, autoresearch, force re-run)
- Portfolio, agents, run history, latest run detail
- Autoresearch progress + history
- Prompt editor for macro/sector/cio

Proxy config: `dashboard/proxy.conf.json` → `http://localhost:3001`

## Mental model for agents

- **Paper run ≠ automatic learning.** Learning happens via prompt versions, Darwin weights, score snapshots, and autoresearch experiments.
- **One paper run per calendar day** by default (`DailyRun.runDate` unique). Use `force: true` to delete today's run and re-run.
- **Mock LLM** returns deterministic JSON for local dev when Ollama/OpenAI are unavailable.
- **Paper only by design.** Do not add live trading without explicit user request and strong safeguards.

## Common tasks

| Task | Where to look |
|------|----------------|
| Change agent behavior | `prompts/*.md` or dashboard prompt editor / DB `AgentPrompt` |
| Add API endpoint | `src/api/api.controller.ts` |
| Change daily pipeline | `src/pipeline/eod-cycle.service.ts` |
| Change autoresearch logic | `src/pipeline/autoresearch.service.ts` |
| Add LLM provider | `src/llm/llm.service.ts` |
| Dashboard feature | `dashboard/src/app/pages/dashboard/` |

## Safety

This is for **learning and paper trading**. Do not risk real money. Do not commit secrets. Do not force-push to `main` without user approval.

## References

- [ATLAS](https://github.com/chrisworsey55/atlas-gic)
- [Karpathy autoresearch](https://github.com/karpathy/autoresearch)
- [OmniRoute](https://github.com/diegosouzapw/OmniRoute)
