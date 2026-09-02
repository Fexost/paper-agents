# paper-agents

A learning project inspired by [ATLAS](https://github.com/chrisworsey55/atlas-gic): **multi-agent AI + feedback loops + paper trading**.

Three LLM agents read market data, debate picks, and execute **paper** trades. The system scores each agent, adjusts their influence (Darwin weights), and can **autoresearch** better prompts over time — all without risking real money.

> **Paper only.** No broker integration. No live trading. Built to learn how multi-agent + feedback loops work.

---

## What happens when you run it

1. **Market snapshot** — mock prices by default, or live quotes via Finnhub.
2. **Macro agent** — reads indices/VIX, outputs `RISK_ON`, `RISK_OFF`, or `NEUTRAL`.
3. **Sector agent** — picks 1–3 tickers with conviction.
4. **CIO agent** — decides BUY / SELL / HOLD against your paper portfolio.
5. **Paper execution** — updates cash, positions, and trade history in Postgres.
6. **Scorecard** — scores past recommendations, updates Sharpe and hit rate.
7. **Darwin** — nudges agent weights up/down based on performance.
8. **Autoresearch** (optional) — proposes one prompt tweak, evaluates for N days, keeps or reverts.

You watch all of this on the **Angular dashboard** at http://localhost:4200.

---

## Architecture

```text
Angular Dashboard (:4200)  →  proxy /api  →  NestJS API (:3001)  →  Postgres (:5433)
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
Autoresearch tick (after each completed daily run)
```

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 22+** | `node -v` |
| **Docker** | For local Postgres (`docker compose`). Or use your own Postgres and set `DATABASE_URL`. |
| **LLM (optional)** | Default `LLM_PRIMARY=mock` works with zero setup. Add Ollama or an API key when ready. |

---

## Quick start (≈5 minutes)

### 1. Clone and install

```bash
git clone <your-repo-url>
cd paper-agents

npm install
cd dashboard && npm install && cd ..

cp .env.example .env   # Windows: copy .env.example .env
```

### 2. Start the database

```bash
npm run db:up
npm run db:setup        # runs migrations + seeds 3 agents from prompts/
```

This creates Postgres on **port 5433** (not the default 5432, to avoid clashes).

### 3. Run API + dashboard

Open **two terminals** in the repo root:

```bash
# Terminal 1 — API (http://localhost:3001)
npm run start:dev

# Terminal 2 — dashboard (http://localhost:4200)
npm run dashboard:dev
```

### 4. Verify it works

| Check | How |
|-------|-----|
| API alive | http://localhost:3001/api/health → `{ "ok": true }` |
| Dashboard | http://localhost:4200 — header badge should say **API online** |
| Agents seeded | Dashboard **Agents** table shows macro, sector, cio |

### 5. Run your first paper cycle

**From the dashboard:** click **Run Paper Cycle** (enable **Force another cycle today** if you already ran once today).

**From the terminal:**

```bash
curl -X POST http://localhost:3001/api/pipeline/run \
  -H "Content-Type: application/json" \
  -d "{\"force\":true}"
```

You should see:

- Toolbar **pipeline stepper** advance: Macro → Sector → CIO (blue = running, green = done).
- **Portfolio** and **Recent Trades** update.
- A new row in **Run History**.

With `LLM_PRIMARY=mock`, responses are deterministic — great for learning the flow without API keys.

---

## Using the dashboard

Layout top to bottom:

| Section | What to do |
|---------|------------|
| **Header** | Check API / market / LLM badges. **Refresh** reloads data. **Reset Paper Portfolio** clears positions/trades but keeps prompts, scores, and run history. |
| **Toolbar** | **Run Paper Cycle** — main action. **Start Autoresearch** — kick off a prompt experiment. Checkboxes: auto-start autoresearch, force re-run same day. |
| **Fast cards** | Equity, cash, position count, last run status at a glance. |
| **Agents \| Portfolio** | Agent Sharpe, Darwin weight, hit rate; open positions with unrealized P&L. |
| **Recent Trades** | Scroll to load more. **SELL** rows show realized P&L; **BUY** rows show `—`. |
| **Run History** | Click a row to jump to **Latest Run Detail** (recommendations, trades, skipped actions). |
| **Autoresearch History** | Past experiments — KEPT / REVERTED, baseline vs candidate Sharpe. |
| **Prompt editor** | Edit macro / sector / cio system prompts; saves a new version in the DB. |

**Show system details** (collapsed by default) exposes LLM provider status, DB connection, and cache settings.

---

## Daily runs and cycles

- By default, **one completed run per calendar day** unless you pass `force: true`.
- **Force re-run** creates a new `DailyRun` with an incremented `cycleNumber` — prior runs, trades, and recommendations are kept.
- Each run stores: regime, agent recommendations, executed trades, and any skipped CIO actions (e.g. SELL with no position).

```bash
# Normal run (skips if today already completed)
curl -X POST http://localhost:3001/api/pipeline/run -H "Content-Type: application/json" -d "{}"

# Force another cycle today
curl -X POST http://localhost:3001/api/pipeline/run -H "Content-Type: application/json" -d "{\"force\":true}"

# Run + start autoresearch if none active
curl -X POST http://localhost:3001/api/pipeline/run -H "Content-Type: application/json" -d "{\"autoresearch\":true,\"force\":true}"
```

Poll progress while a run is in flight:

```bash
curl http://localhost:3001/api/pipeline/progress
```

---

## LLM providers

OpenAI-compatible routing with fallbacks. Set in `.env`:

| Provider | Best for | Config |
|----------|----------|--------|
| **mock** | First-time setup, CI, no keys | `LLM_PRIMARY=mock` |
| **Ollama** | Free local models | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` |
| **OmniRoute** | Local gateway / multi-model | `OMNIROUTE_BASE_URL` — [OmniRoute](https://github.com/diegosouzapw/OmniRoute) |
| **OpenAI** | Cloud API | `OPENAI_API_KEY` |

```env
LLM_PRIMARY=mock
LLM_FALLBACKS=ollama,omniroute,openai
```

### Ollama

```bash
ollama pull llama3.2
```

```env
LLM_PRIMARY=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=llama3.2
```

### Live market data (optional)

```env
FINNHUB_API_KEY=your_key_here
```

Without a key, the app uses **mock quotes** — enough to exercise the full pipeline.

---

## Autoresearch (prompt evolution)

ATLAS-style loop:

1. Pick the worst-Sharpe agent (with cooldown).
2. LLM proposes **one** prompt change → new candidate version goes live.
3. Run paper cycles for `AUTORESEARCH_EVAL_DAYS` (default **5**).
4. Compare candidate Sharpe vs baseline → **KEPT** or **REVERTED**.

Start manually from the dashboard or:

```bash
curl -X POST http://localhost:3001/api/autoresearch/start
```

Watch **Active Autoresearch Experiment** on the dashboard for day progress and running candidate Sharpe.

---

## API reference

Base URL: `http://localhost:3001`

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/health` | GET | Health check |
| `/api/status` | GET | Market, LLM, active experiment |
| `/api/agents` | GET | Agents + Darwin weights + hit rate |
| `/api/portfolio` | GET | Account + positions |
| `/api/portfolio/reset` | POST | Reset cash/positions; keeps learning data |
| `/api/trades` | GET | Paginated (`?limit=5&cursor=`) |
| `/api/runs` | GET | Paginated run history |
| `/api/runs/latest` | GET | Latest run + recs/trades |
| `/api/runs/:id` | GET | Single run detail |
| `/api/pipeline/run` | POST | `{ autoresearch?, force? }` |
| `/api/pipeline/progress` | GET | Live macro/sector/cio step state |
| `/api/autoresearch/start` | POST | Start experiment |
| `/api/autoresearch/experiments` | GET | Paginated history |
| `/api/autoresearch/active` | GET | Current experiment |
| `/api/agents/:slug/prompt` | GET/PUT | Read/write versioned prompt |

Paginated responses:

```json
{ "items": [], "nextCursor": "clxyz…", "hasMore": true }
```

Example — read portfolio:

```bash
curl http://localhost:3001/api/portfolio | jq
```

Example — update macro prompt:

```bash
curl -X PUT http://localhost:3001/api/agents/macro/prompt \
  -H "Content-Type: application/json" \
  -d '{"content":"Your new prompt…","note":"manual tweak"}'
```

---

## npm scripts

| Script | What it does |
|--------|----------------|
| `npm run start:dev` | API with hot reload (:3001) |
| `npm run dashboard:dev` | Angular dev server (:4200) |
| `npm run build` | Build API |
| `npm run dashboard:build` | Build dashboard for production |
| `npm run dashboard:lint` | ESLint for Angular dashboard |
| `npm run db:up` | `docker compose up -d` (Postgres) |
| `npm run db:setup` | Migrate + seed |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Re-seed agents from `prompts/` |
| `npm run prisma:generate` | Regenerate Prisma client after schema changes |
| `npm test` | Jest unit tests |

---

## Project structure

```text
docker-compose.yml            Postgres on port 5433
prisma7.config.ts             Prisma 7 config + seed command
.env.example

prompts/                      Seed templates → loaded into DB on seed
  macro.md                    Regime; VIX only when present in snapshot
  sector.md                   Ticker picks
  cio.md                      Portfolio actions

prisma/
  schema.prisma               Agent, DailyRun, PaperTrade, …
  migrations/
  seed.ts

generated/prisma/             Prisma client (imported by src/)

src/
  agents/agent-runner.service.ts   runMacro, runSector, runCio
  api/api.controller.ts            REST surface
  common/                          date.util, pagination.util
  llm/                             mock | ollama | omniroute | openai
  market/market-data.service.ts    Mock or Finnhub snapshots
  paper/paper-trading.service.ts   Portfolio, trades, SELL realized P&L
  pipeline/
    eod-cycle.service.ts           Daily pipeline orchestration
    pipeline-progress.service.ts   In-memory stepper state
    scorecard.service.ts
    darwin.service.ts
    autoresearch.service.ts
    daily-cycle.job.ts             Optional scheduled runs

dashboard/
  AGENTS.md                     Angular style guide (templates, OnPush, lint)
  eslint.config.mjs             @angular-eslint flat config
  proxy.conf.json               /api → localhost:3001
  src/app/
    api.service.ts              HTTP client
    models.ts                   TypeScript types
    components/
      scroll-load-box/          Infinite-scroll history panels
      agent-pipeline-stepper/   Toolbar pipeline progress
    pages/dashboard/            Main UI (html, css, ts)
```

**Where to change behavior**

| Goal | Start here |
|------|------------|
| Agent instructions | `prompts/*.md` or dashboard prompt editor |
| Pipeline flow | `src/pipeline/eod-cycle.service.ts` |
| Pipeline progress API | `src/pipeline/pipeline-progress.service.ts` |
| Trade rules / P&L | `src/paper/paper-trading.service.ts` |
| Scoring / Sharpe | `src/pipeline/scorecard.service.ts` |
| Paginated API lists | `src/common/pagination.util.ts` + `api.controller.ts` |
| New API route | `src/api/api.controller.ts` |
| Dashboard layout / scroll | `dashboard/src/app/pages/dashboard/` |
| Reusable widgets | `dashboard/src/app/components/` |
| API client + types | `dashboard/src/app/api.service.ts`, `models.ts` |
| Angular conventions / lint | [dashboard/AGENTS.md](./dashboard/AGENTS.md) |

See [AGENTS.md](./AGENTS.md) for the full file tree and Prisma model reference.

---

## Dashboard development

The dashboard is **Angular 19** with standalone components, external `.html` / `.css` files (`templateUrl` / `styleUrl`), built-in control flow (`@if`, `@for`), and **OnPush** change detection.

| Task | Command |
|------|---------|
| Dev server | `npm run dashboard:dev` |
| Production build | `npm run dashboard:build` |
| Lint | `npm run dashboard:lint` |

**Conventions for UI changes:** read [dashboard/AGENTS.md](./dashboard/AGENTS.md) before editing `dashboard/`. It covers file layout, `inject()`, template patterns, SOLID, and the ESLint rules enforced in CI.

Quick rules:

- Put templates in `.html` files — no inline `template:` strings.
- Use `@if` / `@for` instead of `*ngIf` / `*ngFor`.
- Prefer `[class.foo]` over `NgClass`.
- Run `npm run dashboard:lint` and `npm run dashboard:build` before committing dashboard changes.

---

## Environment variables

Copy `.env.example` → `.env`. Essentials:

```env
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/paper_agents?schema=public

LLM_PRIMARY=mock
LLM_FALLBACKS=ollama,omniroute,openai

PAPER_STARTING_CASH=100000
MAX_POSITION_PCT=0.1
AUTORESEARCH_EVAL_DAYS=5

FINNHUB_API_KEY=              # optional
MARKET_SNAPSHOT_TTL_MS=15000
MARKET_MOCK_TTL_MS=30000
MARKET_FINNHUB_BACKOFF_MS=60000
```

Ports **3001** (API) and **4200** (dashboard) are set in npm scripts — you usually don't need to export `PORT` manually.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Dashboard says **API offline** | Start `npm run start:dev` in repo root. API must be on :3001. |
| `Can't reach database` | Run `npm run db:up`. Check `DATABASE_URL` port is **5433**. |
| Run says **already completed** | Use `force: true` or enable **Force another cycle today** in the dashboard. |
| LLM errors / timeouts | Switch to `LLM_PRIMARY=mock` to isolate. Check Ollama is running if using `ollama`. |
| Empty agents table | Run `npm run db:seed`. |
| Schema out of date | `npm run db:migrate` then `npm run prisma:generate`. |
| Prisma client errors after pull | `npx prisma generate` |
| Dashboard shows mock market with Finnhub key set | Finnhub may be rate-limited; check `/api/status` for `finnhubError`. Mock fallback is intentional. |
| Dashboard lint errors | Run `npm run dashboard:lint` from repo root. See [dashboard/AGENTS.md](./dashboard/AGENTS.md). |

Inspect data directly:

```bash
npx prisma studio
```

Opens a browser UI on your local database.

---

## Learning path

| Step | Try this |
|------|----------|
| **1. See the loop** | Run 3–5 paper cycles with `mock` LLM. Watch portfolio + run detail. |
| **2. Read the code** | `eod-cycle.service.ts` → `agent-runner.service.ts` → `paper-trading.service.ts`. |
| **3. Tweak prompts** | Edit `prompts/macro.md`, re-seed or use dashboard editor, re-run. |
| **4. Live quotes** | Add `FINNHUB_API_KEY`, compare rationales. |
| **5. Real LLM** | Ollama or OpenAI; compare agent output quality. |
| **6. Autoresearch** | Start an experiment, run 5 days of cycles, see KEPT/REVERTED. |

---

## ATLAS concepts mapped

| ATLAS | paper-agents |
|-------|----------------|
| 25 agents, 4 layers | 3 agents, 3 layers |
| Autoresearch + git keep/revert | DB prompt versions + experiments |
| Darwinian weights | Implemented |
| JANUS meta-layer | Future |
| Live trading | **Not included** — paper only |

---

## Safety

This is for **learning and paper trading**. Past performance does not guarantee future returns. Do not connect real money without understanding the system and accepting the risks.

---

## References

- [ATLAS](https://github.com/chrisworsey55/atlas-gic)
- [Karpathy autoresearch](https://github.com/karpathy/autoresearch)
- [OmniRoute](https://github.com/diegosouzapw/OmniRoute)

**Contributing / AI agents:** see [AGENTS.md](./AGENTS.md) for backend architecture and [dashboard/AGENTS.md](./dashboard/AGENTS.md) for Angular conventions.
