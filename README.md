# So-study

A single-user, local-first web app that turns academic papers into structured,
**pre-lecture** study modules. You give it a topic; it retrieves candidate papers,
waits for you to approve them, synthesizes a grounded study module from the
approved set, then lets you read it, ask scoped questions about it, and practise
recalling it.

The point is the **head start**: arrive at the lecture having already met the core
theories. So-study is deliberately **not** a chatbot and **not** a substitute for
attending lectures.

- Users: 1 student · Device: iPad + Magic Keyboard (Safari) · Infra cost: $0
- Plan and status: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Internals and module boundaries: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Requirements

- Node.js 22+ and npm
- A Google Gemini API key (synthesis, Q&A, essay feedback). Everything else —
  retrieval, MCQ fallback, grading of MCQs, scheduling — runs without an LLM.

## Setup

```bash
npm install

# .env in the project root:
#   DATABASE_URL="file:./dev.db"
#   GEMINI_API_KEY="…"          # server-side only, never NEXT_PUBLIC_
#   GEMINI_MODEL="gemini-3.6-flash"   # optional override

npm run db:generate   # prisma generate
npm run db:migrate    # create/apply migrations + refresh prisma/dev.db
npm run dev           # http://localhost:3000
```

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

The database is a local SQLite file (`prisma/dev.db`). There is no auth: it is a
single-user local app. Deploying to Vercel would require swapping SQLite for
Turso — see "Tech Decisions" in the roadmap.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint (Next core-web-vitals + TS) |
| `npm test` | Vitest — both the `node` and `dom` projects |
| `npm run ci` | **The gate**: prisma generate → lint → `tsc --noEmit` → tests |
| `npm run db:generate` / `npm run db:migrate` | Prisma client / schema migrations (`prisma/migrations/` is the schema source of truth — see rule I6) |
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
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layering (`app/lib` vs `src/lib`), data flow, API surface, invariants |
| [`docs/whitepaper/`](docs/whitepaper) | Product ("about") and technical whitepapers |
| [`docs/rules/`](docs/rules) | The three rule sets governing generation, implementation, execution |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Verified learning-science sources behind the practice features |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Append-only audit trail; every change is logged with timestamp + file |

Changes to behaviour must be logged in `docs/CHANGELOG.md` and reflected in the
roadmap — doc/code drift is treated as a defect (rule I12).
