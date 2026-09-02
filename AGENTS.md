# AGENTS.md — paper-agents

Context for AI coding agents (Cursor, Grok Build, Claude Code, etc.) working on this repository.

**Human developers:** start with [README.md](./README.md) for setup, dashboard usage, and troubleshooting.

## What this project is

**paper-agents** is a learning project inspired by [ATLAS](https://github.com/chrisworsey55/atlas-gic) and [Karpathy autoresearch](https://github.com/karpathy/autoresearch). It is **not** a fork of ATLAS. It implements the core *patterns* in a small, understandable stack:

- Multi-agent pipeline (Macro → Sector → CIO)
- Paper trading only (no real money)
- Per-agent scorecard (Sharpe, hit rate)
- Darwinian agent weights (0.3–2.5)
- ATLAS-style **autoresearch**: propose one prompt change, evaluate for N days, keep or revert based on Sharpe

## Architecture

```text
Angular Dashboard (:4200) → proxy /api → NestJS API (:3001) → Postgres (:5433 via Docker)
```

```text
Market snapshot
 ↓
Macro Agent → regime (RISK_ON / RISK_OFF / NEUTRAL)
 ↓
Sector Agent → 1–3 ticker picks
 ↓
CIO Agent → paper trade actions (BUY/SELL/HOLD)
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
| Frontend | Angular 19 in `dashboard/` — see [dashboard/AGENTS.md](./dashboard/AGENTS.md) |

## Key directories

```text
paper-agents/
  docker-compose.yml        Postgres on host port 5433
  prisma7.config.ts           Prisma 7 config (seed command, etc.)
  .env.example                Copy to .env — never commit secrets

prompts/                      Seed prompt templates (macro, sector, cio)
  macro.md                    VIX only when snapshot.vix is present
  sector.md
  cio.md

prisma/
  schema.prisma               Source of truth for models
  migrations/                 Applied via prisma migrate dev
  seed.ts                     Upserts 3 agents + prompts from prompts/

generated/prisma/             Prisma client output (import from here in src/)

src/
  main.ts                     Nest bootstrap
  app.module.ts
  agents/
    agent-runner.service.ts   runMacro, runSector, runCio
    agents.module.ts
  api/
    api.controller.ts         All /api/* routes
    api.module.ts
  common/
    date.util.ts              calendarDateOnly() for run/snapshot dates
    pagination.util.ts        paginate(), parseLimit() for cursor lists
  llm/
    llm.service.ts            Provider routing + fallbacks
    llm.types.ts
  market/
    market-data.service.ts    Mock / Finnhub; omits VIX when price <= 0
  paper/
    paper-trading.service.ts  Portfolio, executeActions, listTrades (SELL P&L)
    paper.module.ts
  pipeline/
    eod-cycle.service.ts      Daily pipeline; hooks pipeline-progress
    pipeline-progress.service.ts  In-memory macro/sector/cio step state
    pipeline.module.ts
    scorecard.service.ts      Sharpe, hit rate, recommendation scoring
    darwin.service.ts         Agent weight updates
    autoresearch.service.ts   Experiments, runningCandidateSharpe
    daily-cycle.job.ts        Optional cron (AUTO_RUN_DAILY_CYCLE)
  prisma/
    prisma.service.ts         Prisma client via @prisma/adapter-pg

dashboard/
  AGENTS.md                   Angular style guide for agents (templates, SOLID, lint)
  proxy.conf.json             /api → http://localhost:3001
  eslint.config.mjs           @angular-eslint flat config
  src/app/
    api.service.ts            HTTP client for all API calls
    models.ts                 Shared TS interfaces (incl. PipelineProgress)
    app.config.ts
    app.routes.ts
    components/
      scroll-load-box/        220px infinite scroll + IntersectionObserver
      agent-pipeline-stepper/ Toolbar stepper (green=done, blue=active)
    pages/dashboard/
      dashboard.component.ts  Main page logic, pagers, panel height sync
      dashboard.component.html
      dashboard.component.css
```

## Data models (Prisma)

| Model | Purpose |
|-------|---------|
| `Agent` | macro / sector / cio; `darwinWeight`, `rollingSharpe` |
| `AgentPrompt` | Versioned prompts; `isActive`, autoresearch notes |
| `DailyRun` | One paper cycle; `runDate`, `cycleNumber`, `skippedActions` JSON |
| `Recommendation` | Per-agent pick per run; scored for hit rate / Sharpe |
| `PaperAccount` | Single default account; cash balance |
| `PaperPosition` | Open holdings |
| `PaperTrade` | Executed trades; `costBasis`, `realizedPnl` on SELL |
| `ScoreSnapshot` | Historical agent metrics |
| `AutoresearchExperiment` | Prompt A/B eval; `baselineSharpe`, `candidateSharpe` |

`DailyRun` is unique on `(runDate, cycleNumber)`. `force: true` creates the next cycle number for the same calendar day.

## Agents (business logic, not AI tools)

| Slug | Layer | Role |
|------|-------|------|
| `macro` | MACRO | Market regime + conviction |
| `sector` | SECTOR | Sector/ticker picks |
| `cio` | DECISION | Portfolio actions |

Prompts are **versioned in the DB** (`AgentPrompt`). Autoresearch creates candidate prompt versions and may revert to baseline.

`prompts/macro.md` only cites VIX when `snapshot.vix` is present; invalid VIX quotes (`price <= 0`) are omitted from market snapshots.

## Autoresearch (ATLAS pattern)

1. Pick worst-Sharpe agent (with cooldown so same agent isn't picked within eval window)
2. LLM proposes **one** prompt change → saves as **candidate** prompt (active), baseline deactivated
3. Creates `AutoresearchExperiment` with status `EVALUATING`
4. After each completed daily run: `tickAfterDailyRun()` increments `daysCompleted`
5. After N days (`AUTORESEARCH_EVAL_DAYS`, default 5): compare candidate Sharpe vs baseline
   - **Improved → KEPT** (candidate stays active)
   - **Worse → REVERTED** (baseline reactivated, candidate deactivated)

Active experiment API includes `runningCandidateSharpe` and `runningDelta` while status is `EVALUATING`.

## API endpoints

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/health` | GET | Health check |
| `/api/status` | GET | marketDataSource, llmPrimary, activeExperiment, evalDays |
| `/api/agents` | GET | Agents + Darwin weights + live hit rate |
| `/api/portfolio` | GET | Account + positions only |
| `/api/portfolio/reset` | POST | Reset paper cash/positions |
| `/api/trades` | GET | Paginated trades; `realizedPnl` on SELL (`?limit=5&cursor=`) |
| `/api/runs` | GET | Paginated runs (`?limit=5&cursor=`) |
| `/api/runs/latest` | GET | Latest run with recs/trades |
| `/api/runs/:id` | GET | Run detail |
| `/api/pipeline/run` | POST | Body: `{ autoresearch?: boolean, force?: boolean }` |
| `/api/pipeline/progress` | GET | `{ active, steps: { macro, sector, cio }, startedAt }` |
| `/api/autoresearch/start` | POST | Start new experiment |
| `/api/autoresearch/experiments` | GET | Paginated (`?limit=5&cursor=`) |
| `/api/autoresearch/active` | GET | Active experiment |
| `/api/agents/:slug/prompt` | GET/PUT | Prompt read/write (versioned) |

List endpoints return `{ items, nextCursor, hasMore }`.

## Environment variables

Copy `.env.example` to `.env`. Important values:

```env
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/paper_agents?schema=public
LLM_PRIMARY=mock # mock | ollama | omniroute | openai
LLM_FALLBACKS=ollama,omniroute,openai
AUTORESEARCH_EVAL_DAYS=5
FINNHUB_API_KEY= # optional, for live quotes
MARKET_SNAPSHOT_TTL_MS=15000
MARKET_MOCK_TTL_MS=30000
MARKET_FINNHUB_BACKOFF_MS=60000
PAPER_STARTING_CASH=100000
MAX_POSITION_PCT=0.1
```

**Never commit `.env`.** CI uses `LLM_PRIMARY=mock` and a Postgres service container.

`npm run start:dev` and `npm run dashboard:dev` set API port **3001** and dashboard port **4200** in their scripts (`cross-env` + `ng serve --port`), so you do not need to set `$env:PORT` manually.

## Local development

```powershell
# Terminal 1 — database
npm run db:up
npm run db:setup

# Terminal 2 — API (port 3001)
npm run start:dev

# Terminal 3 — dashboard (port 4200)
npm run dashboard:dev
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
- `PaperTrade` stores `costBasis` and `realizedPnl` on SELL execution

After schema changes: `npx prisma migrate dev`, then `npx prisma generate`.

## Build commands

```bash
npm run build # NestJS API
npm run dashboard:build # Angular (or cd dashboard && npm run build)
npm run dashboard:lint # ESLint for dashboard
npx prisma generate # Regenerate client after schema changes
```

`tsconfig.build.json` excludes `dashboard/` from the Nest build.

## Dashboard UI (Angular)

Layout (top to bottom):

1. Header badges + refresh / reset
2. Collapsible system status (default closed)
3. Toolbar — run controls + inline pipeline stepper while a cycle runs
4. Fast cards — equity, cash, positions, last run
5. Active autoresearch experiment (if any)
6. **Agents | Portfolio** — two-column grid; agents panel height syncs to portfolio
7. **History zone** — Recent Trades, Autoresearch History, Run History (220px scroll boxes, cursor pagination)
8. Latest run detail — click a run row to load
9. Prompt editor

Dashboard polls `/api/pipeline/progress` every 400ms while `POST /api/pipeline/run` is in flight.

Trade P&L: only **SELL** rows show realized P&L; BUY rows show `—`.

`eod-cycle.service.ts` sanitizes CIO actions before execution (drops SELL for tickers not held).

Proxy config: `dashboard/proxy.conf.json` → `http://localhost:3001`

**Angular conventions** (enforced by ESLint — see [dashboard/AGENTS.md](./dashboard/AGENTS.md)):

- External `templateUrl` / `styleUrl` on all components
- Built-in control flow: `@if`, `@for` (not `*ngIf` / `*ngFor`)
- `ChangeDetectionStrategy.OnPush` on all components
- `inject()` for DI; `input()` / `output()` on shared widgets
- `[class.foo]` bindings instead of `NgClass`
- `npm run dashboard:lint` before finishing dashboard changes

## Mental model for agents

- **Paper run ≠ automatic learning.** Learning happens via prompt versions, Darwin weights, score snapshots, and autoresearch experiments.
- **One paper run per calendar day** by default (`DailyRun` is unique per `runDate` + `cycleNumber`). Use `force: true` to start **another cycle** the same day without deleting prior runs, trades, or recommendations.
- **Mock LLM** returns deterministic JSON for local dev when Ollama/OpenAI are unavailable.
- **Paper only by design.** Do not add live trading without explicit user request and strong safeguards.

## Common tasks

| Task | Where to look |
|------|----------------|
| Change agent behavior | `prompts/*.md` or dashboard prompt editor / DB `AgentPrompt` |
| Add API endpoint | `src/api/api.controller.ts` |
| Change daily pipeline | `src/pipeline/eod-cycle.service.ts` |
| Pipeline progress / stepper | `src/pipeline/pipeline-progress.service.ts`, `eod-cycle.service.ts` |
| Change autoresearch logic | `src/pipeline/autoresearch.service.ts` |
| Trade execution + P&L | `src/paper/paper-trading.service.ts` |
| Paginated list helpers | `src/common/pagination.util.ts` |
| Add LLM provider | `src/llm/llm.service.ts` |
| Dashboard layout / histories | `dashboard/src/app/pages/dashboard/` |
| Angular conventions / lint | [dashboard/AGENTS.md](./dashboard/AGENTS.md) |
| Reusable dashboard widgets | `dashboard/src/app/components/` |
| API client + types | `dashboard/src/app/api.service.ts`, `models.ts` |

## Safety

This is for **learning and paper trading**. Do not risk real money. Do not commit secrets. Do not force-push to `main` without user approval.

## References

- [ATLAS](https://github.com/chrisworsey55/atlas-gic)
- [Karpathy autoresearch](https://github.com/karpathy/autoresearch)
- [OmniRoute](https://github.com/diegosouzapw/OmniRoute)
