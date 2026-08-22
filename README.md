# So-study

A small, local-first web app that turns academic papers into structured,
**pre-lecture** study modules. You give it a topic; it retrieves candidate papers,
waits for you to approve them, synthesizes a grounded study module from the
approved set, then lets you read it, ask scoped questions about it, and practise
recalling it.

The point is the **head start**: arrive at the lecture having already met the core
theories. So-study is deliberately **not** a chatbot and **not** a substitute for
attending lectures.

- Users: 2 trusted students (no signup) · Device: iPad + Magic Keyboard (Safari),
  installed as a standalone PWA · Infra cost: $0
- Plan and status: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Internals and module boundaries: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Hosting, database, auth and the iPad install: [`docs/DEPLOY.md`](docs/DEPLOY.md)

---

## Requirements

- Node.js 22+ and npm
- A **PostgreSQL** database (hosted, or a throwaway local one — see
  [`docs/DEPLOY.md` §8](docs/DEPLOY.md)). The app used to keep a local SQLite
  file; that is what made it un-deployable, since a serverless filesystem is
  ephemeral and per-instance.
- A Google Gemini API key (synthesis, Q&A, essay feedback). Everything else —
  retrieval, MCQ fallback, grading of MCQs, scheduling — runs without an LLM.

## Setup

```bash
npm install                 # also runs `prisma generate`

cp .env.example .env        # then fill in, at minimum:
#   DATABASE_URL="postgresql://…"       # hosted Postgres (pooled url)
#   SESSION_SECRET="$(openssl rand -base64 48)"   # auth fails CLOSED without it
#   GEMINI_API_KEY="…"                  # server-side only, never NEXT_PUBLIC_

npm run db:deploy           # prisma migrate deploy (use the DIRECT url)
npm run db:seed -- you "a-long-passphrase-here" "Your Name"
npm run dev                 # http://localhost:3000  → redirects to /login
```

Coming from the old SQLite build? Move the data across once with
`node scripts/import-sqlite.mjs prisma/dev.db --owner you`.

## Auth (there is no signup)

Two trusted people share one deployment, so the app has the smallest auth that is
honest: a **passphrase per person**, a signed HttpOnly session cookie (HMAC-SHA256,
90 days), a root `proxy.ts` that redirects unauthenticated pages to `/login` and
401s unauthenticated `/api/*`, and a `requireUser` call in **every** route handler
that also scopes its queries by `ownerId`. No auth library, no OAuth, no email, no
password reset, no roles — and no public onboarding, by design.

Users exist only via `npm run db:seed`. `app/api/route-guard.test.ts` fails the
build if a route handler forgets the guard or queries `Course`/`Topic`/`Module`
without scoping by owner. Full model, including what it deliberately does **not**
protect against: [`docs/DEPLOY.md` §9–10](docs/DEPLOY.md).

Each student's courses, topics, modules, attempts, question bank, settings and push
subscriptions are private to them. Papers are shared (deduplicated, no private
data) and AI cost is shared (one key, one wallet).

### Web-push notifications (Soso reminds you)

Real iOS notifications require the app to be **installed to the Home Screen**
(standalone) and the student to **grant notification permission** — there is no
push path from a plain browser tab. Both are gated in the UI (`<PushOptIn>` only
shows when `navigator.standalone === true` and `Notification.permission ===
"default"`).

The server half uses [web-push](https://github.com/web-push-libs/web-push) with a
VAPID key pair. **Generate the keypair once** and store the three values in env
(`.env` / Vercel project settings) — never commit them:

```bash
npx web-push generate-vapid-keys
# => Public Key:  BCL…   → NEXT_PUBLIC_VAPID_PUBLIC_KEY
# => Private Key: dJ9…   → VAPID_PRIVATE_KEY
```

```bash
# .env (all three required for /api/push/send to fire):
NEXT_PUBLIC_VAPID_PUBLIC_KEY="<Public Key>"   # exposed to the browser
VAPID_PRIVATE_KEY="<Private Key>"              # server-only
VAPID_SUBJECT="mailto:you@example.com"         # contact in the VAPID claim
CRON_SECRET="some-long-random"                 # shared with the Vercel cron job
```

On Vercel, the daily check runs as a cron (`vercel.json` → `/api/push/send`,
`0 13 * * *` = 20:00 WIB). If you ever need to **regenerate** the keys, just
rerun `npx web-push generate-vapid-keys`, update the three env vars, and
redeploy — existing subscriptions auto-refresh on the next grant.

Reminders are computed **per user**: each subscriber's own attempts decide whether
they get nudged, and their own `Settings` row personalizes the copy. `CRON_SECRET`
is required in production — the two cron routes are exempt from the session gate
(cron sends no cookie), so that secret is the only thing guarding them.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint (Next core-web-vitals + TS) |
| `npm test` | Vitest — both the `node` and `dom` projects |
| `npm run ci` | **The gate**: prisma generate → lint → `tsc --noEmit` → tests |
| `npm run db:generate` / `npm run db:migrate` | Prisma client / schema migrations (`prisma/migrations/` is the schema source of truth — see rule I6) |
| `npm run db:deploy` | Apply migrations to a hosted database (`prisma migrate deploy`) |
| `npm run db:seed -- <name> "<passphrase>"` | Create/rotate a trusted user. The only way an account exists |
| `npm run db:import-sqlite -- prisma/dev.db --owner <name>` | One-shot import of the old local SQLite data |
| `npm run db:push` | Schema **push** (experiments only; does not record a migration) |

Run `npm run ci` before committing; it is the same script CI runs
(`scripts/ci.sh`) and it stops at the first failure.

---

## The study loop

```
Topic (+ week / due-before-lecture date)
  → retrieve candidate papers        OpenAlex, heuristic, cached, no LLM
  → APPROVE papers                   human gate — synthesis uses nothing else
  → synthesize module                Gemini, chunked, inline [n] citations
  → Baca    read the module          works offline; TOC for long modules
  → Tanya   ask scoped questions     RAG: only module chunks are injected
  → Latih   practise                 MCQ + essay + your own authored cards
  → review                           confidence-based spaced repetition
```

Two invariants hold throughout:

1. **Human approval gate.** A module is synthesized only from papers you
   approved; the app never promotes candidates by itself.
2. **Grounding.** Every claim carries an inline `[n]` citation mapped to its true
   source paper, Q&A answers are restricted to injected module chunks, and Q&A
   refuses to answer offline rather than inventing something.

### Practice features

- **Closed-book mode** ("Mode tertutup") hides Baca, Tanya *and* Sumber while you
  answer, so recall comes from memory.
- **Attempts are persisted** with a self-rated confidence (1–5) and drive the
  spaced-repetition queue.
- **You can author and edit your own MCQs** (self-made cards beat generated ones).
- **Interleaved practice** mixes questions across a course's topics.
- **Metacognitive prompts** (plan / monitor / evaluate) bracket the session and
  autosave locally.

### Export

From a module's header:

| Format | Output |
| --- | --- |
| **Markdown** | `GET /api/modules/[id]/export?format=md` — module + essay prompt/rubric + numbered source list with URLs |
| **Anki** | `GET /api/modules/[id]/export?format=anki` — tab-separated notes (`#separator:tab`, `#html:true`) into a `So-study::<topic>` deck. Uses your authored question bank; falls back to deterministic cloze cards from the module when the bank is empty |
| **PDF** | `GET /api/modules/[id]/export?format=pdf` — a server-generated PDF (pdfmake). This is the Safari/iPad path, so there is no client print or PDF dependency |

### Cost

Every Gemini call is logged to `AIUsage` and shown in the "Biaya AI" panel
(tokens in/out + estimated cost). Retrieval, MCQ grading, the MCQ fallback,
scheduling and export cost nothing. Each AI endpoint also enforces
**input-length guards** (`src/lib/guards.ts`) and rejects oversized input with
HTTP 413 instead of silently truncating it.

Observability alone does not stop a runaway loop, so there is also a **hard
budget cap** (`src/lib/aiusage.ts`): before *any* paid call, spend for the current
day and month is aggregated from `AIUsage` and compared against
`AI_DAILY_COST_LIMIT_USD` / `AI_MONTHLY_COST_LIMIT_USD` (defaults `$1` / `$20`,
windows resetting in `AI_BUDGET_TIMEZONE`). A breach returns **HTTP 429** with the
spend, the cap and the reset time. It fails **closed** — if the budget query
itself errors, the call is blocked, because a cost gate that opens on error is not
a gate. An explicit `0` means "block everything", never "unlimited". The cap is
global on purpose: it protects one shared API key.

---

## Tests

```bash
npm test                      # everything
npx vitest run --project node # pure logic (src/lib, app/lib)
npx vitest run --project dom  # components in jsdom (*.dom.test.tsx)
```

- `node` project: scoring, MCQ generation, scheduler, guards, export formatters,
  closed-book/slug helpers.
- `dom` project: `@testing-library/react` component tests — the Workspace shell
  (tab a11y, closed-book lock, offline refusal, attempt recording, export links),
  the markdown/citation renderer, the TOC, and the metacognitive panel.

## Documentation

| File | Contents |
| --- | --- |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Source of truth: vision, phases, per-item status, risk register, audit |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Hosting runbook: Postgres choice, migrations, env, seeding users, auth + tenancy model, iPad install |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layering (`app/lib` vs `src/lib`), data flow, API surface, invariants |
| [`docs/whitepaper/`](docs/whitepaper) | Product ("about") and technical whitepapers |
| [`docs/rules/`](docs/rules) | The three rule sets governing generation, implementation, execution |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Verified learning-science sources behind the practice features |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Append-only audit trail; every change is logged with timestamp + file |

Changes to behaviour must be logged in `docs/CHANGELOG.md` and reflected in the
roadmap — doc/code drift is treated as a defect (rule I12).
