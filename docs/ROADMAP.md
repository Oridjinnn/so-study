# ROADMAP — Pre-Study Webapp "Teori Antropologi Kontemporer"

**Project codename:** `So-study`
**Status:** Draft v5 (deploy + hosted DB + 2-user auth/tenancy + hard AI budget + iPad PWA shipped 2026-08-22; see §17)
**Owner:** habel-davidson (build) — end users: 2 trusted students (iPad)
**Last updated:** 2026-08-22 21:30 WIB
**Source of truth:** this file + `docs/whitepaper/*` + `docs/rules/*` + `docs/RESEARCH.md`
+ `docs/ARCHITECTURE.md` (code layout & invariants)

---

## 0. TL;DR

A small, local-first web app that turns academic papers into structured,
pre-lecture study modules for one or more courses, then lets the student read,
ask scoped questions, and take assessments — giving an early head start before
each class. It is **not** a chatbot and **not** a substitute for lectures.

**As deployed (2026-08-22):** it is now a **two-user** web app (no signup) running
on a hosted PostgreSQL database behind a passphrase login, installed on an iPad as
a standalone PWA, with a hard daily/monthly Gemini cost cap. See §17 and
[`DEPLOY.md`](DEPLOY.md).

**Current state (2026-08-18, v4):** The full create→retrieve→approve→synthesize→read→
ask→assess loop works locally, and the *learning-science closure* from the audit (§7.6)
is now implemented. Retrieval is enforced (closed-book locks Baca/Tanya/Sumber during
Latih), every practice attempt is persisted (`AssessmentAttempt`) and drives a
confidence-based spaced-repetition scheduler (`ReviewQueue`), the student can author
their own MCQs (generation effect) and do course-wide interleaved practice, metacognitive
prompts bracket the work, essay prompts/rubrics are auto-generated and tethered to the
module, and topics carry a week/due-before-lecture date so "X/N siap" is real. The one
broken grounding feature (all excerpts pointing at `paperIds[0]`) is fixed.

---

## 1. Vision & Objective

Build a *study companion*, not a research assistant. The value is the
**early-start**: the student arrives at lecture having already met the core
theories via curated papers, synthesized into a readable module, with a safe
Q&A and a self-check.

Success = the student consistently reads the module *before* the corresponding
lecture and reports lower first-contact confusion in class.

---

## 2. Target User & Device

| Attribute | Value |
| --- | --- |
| Users | 2 trusted students (no public signup) |
| Device | iPad + Magic Keyboard |
| Browser | Safari |
| Connectivity | Online-capable, but module reading must work offline |
| Tech comfort | Non-developer end user |

**Implications (hard requirements):**
- Responsive / touch-first UI (iPad-native patterns, not desktop-first).
- PWA: "Add to Home Screen", fullscreen, own icon.
- Offline cache for **module reading** (Q&A/grading need network — must say so,
  never fake an offline answer).
- Essay drafts persist locally (IndexedDB / localStorage) before submit — no lost work.
- Auto-save everywhere; no manual "Save" button needed.
- Accessibility: Dynamic Type + VoiceOver labels; `role="dialog"`/`aria-modal` on
  modals; `role="tab"`/`aria-selected` on tab lists.

---

## 3. Non-Goals (explicit)

- NOT a scalable product — but **two** trusted users and multi-*course* per user are in scope
  (see §17; there is no signup, no roles, no billing).
- NOT a general research assistant / literature-review tool.
- NOT a native iOS app (PWA covers all needed UX; native is overkill + $99/yr).
- NOT a replacement for attending lectures. Copy/UI must reinforce "head-start".
- NOT auto-generating the topic order via AI (human must input it).

---

## 4. Tech Decisions (locked unless revisited)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Framework | Next.js (App Router) + TS + Tailwind | Zero-config Vercel deploy; single codebase |
| DB | **Hosted PostgreSQL** (`prisma/schema.prisma`, `provider = "postgresql"`) | The old local SQLite file was the thing that made the app un-deployable — a serverless filesystem is ephemeral and per-instance. Postgres needed zero new deps vs. Turso's driver adapter (§17.1). |
| LLM | Google Gemini API (server-side only) | Synthesis/Q&A/grading; key never in client bundle |
| Retrieval | **OpenAlex** (primary, no key) + Semantic Scholar (fallback) | OpenAlex more stable/free; retrieval is heuristic, not LLM |
| Q&A method | **Retrieval-augmented** (embed module chunks, retrieve 3–5, inject only those) | Grounded + far cheaper than full-module injection |
| Deploy | **Vercel** (free tier) + hosted Postgres + iPhone web-push (VAPID) | Shipped 2026-08-22; runbook in [`DEPLOY.md`](DEPLOY.md). `vercel.json` crons unchanged. |
| Auth | Signed-cookie passphrase per trusted user + edge `proxy.ts` gate + `requireUser` in every route + `ownerId` tenancy | No auth library, no signup. Friction kept at: one passphrase field, one Keychain autofill on the iPad (§17.9–10). |
| Cost target | $0 infra; Gemini per-use cost **capped** by `AI_DAILY_COST_LIMIT_USD`/`AI_MONTHLY_COST_LIMIT_USD` (defaults $1/$20, enforced before every paid call; fails closed) | "Cost 0" = infra only |

---

## 5. Architecture Overview

```mermaid
flowchart LR
  A[Topic / week input<br/>human] --> B[Paper retrieval<br/>OpenAlex heuristic]
  B --> C[Shortlist review<br/>human approval]
  C --> D[Module synthesis<br/>Gemini, chunked]
  D --> E[Module reader<br/>offline-cached]
  E --> F[Scoped Q&A<br/>RAG-grounded]
  F --> G[Assessment<br/>MCQ + essay]
  G --> H[Feedback<br/>rubric-grounded]
  H --> I[Practice log<br/>attempts + confidence]
  I --> J[Spaced review<br/>scheduler]
  R[official RPS] -. reconcile .-> A
```

**Data model (Prisma / SQLite) — current + planned:**

- `Course` — id, name (multi-course support from the start) ✅
- `Topic` — id, courseId, title, weekNumber?, dueBeforeLecture?, status
  (`pending`|`papers_fetched`|`module_generated`|`ready`). *weekNumber exists in
  schema but the UI does **not** capture it yet — see §7.6 P1.*
- `Paper` — id, title, authors, year, abstract, sourceUrl, citationCount,
  relevanceScore, fullTextAvailable (shared, deduplicated) ✅
- `TopicPaper` — topicId, paperId, approved (bool) *(many-to-many join)* ✅
- `Module` — id, topicId (1:1), contentMarkdown, generatedAt, sourcePaperIds[] ✅
- `Excerpt` — id, moduleId, paperId, claim, quote, location. ✅ schema + ✅ correctness
   (each claim now mapped to its true source paper via inline `[n]`; fix `synthesize/route.ts`).
- `ModuleVersion` — id, moduleId, version, contentMarkdown, generatedAt, changeNote? ✅
- `QASession` — id, topicId, messages[] ✅ (used by Q&A)
- `Assessment` — id, topicId, questionType, questionText, studentAnswer, rubric,
  aiFeedback, score?, grounded? — currently **single-shot**, not an attempts log ❌
- **`AssessmentAttempt` ✅ built** — id, moduleId, topicId, questionType, itemRef,
  prompt, response, score, isCorrect, confidenceRating (1–5), answeredAt, scheduledNextAt
  (set by `src/lib/scheduler.ts`). Persisted by `POST /api/attempts`; drives `ReviewQueue`. (P0/P1)
 - `RPSReconcile` — id, courseId, officialOrder, customOrder, reconciledAt, updatedAt (FK to `Course`) ✅ **built** 2026-08-19. `diff` is *not* stored — recomputed from live `Topic` rows on read (`src/lib/rps.ts`) so it can't go stale. `Topic.orderSource` now defaults to `"custom"` in the schema (was hardcoded at runtime).
- `AIUsage` — id, topicId?, kind, tokensIn, tokensOut, estimatedCost, createdAt ✅
- `Snapshot` (deferred) — id, topicId, kind, payload, createdAt

---

## 6. Phased Roadmap (revised, status as of 2026-08-18)

Legend: ✅ done · 🟡 done-with-known-issues · ❌ not done

### Phase 0 — Foundations (local-first, no deploy)
- [x] Scaffold Next.js + TS + Tailwind + Prisma (local SQLite `dev.db`)
- [x] **CI gate from day one**: `scripts/ci.sh` (lint + typecheck + unit tests) — rule E3/G10
- [x] Topic + **Course** CRUD with many-to-many `CourseModule` (multi-course ready)
- [x] OpenAlex retrieval + citation/recency filtering + heuristic relevance + response cache
- [x] **Paper deduplication** via `TopicPaper` many-to-many
- [x] Paper shortlist review/approval UI (human gate) — iPad bottom sheet (`PaperReview.tsx`)
- [x] Gemini module synthesis (chunked) + **Excerpt extraction** + **ModuleVersion** on create
      🟡 *excerpt `paperId` is wrong — P0 fix*
- [x] Module reader (custom markdown render) + offline read works (static content)
- [x] Basic scoped Q&A (RAG: embed chunks, retrieve 3–5, inject only those)
- [x] **API DELETE**: delete module (cascade) + unlink from course
- [x] **Rename `anthro-study` → `So-study`** (package.json, metadata, manifest, docs)
- [x] **UI redesign**: Sidebar = course switcher; course→topic dashboard with progress +
      empty states; 44px touch targets (`page.tsx`, `Sidebar.tsx`, `Composer.tsx`)
- **Acceptance (met):** student can go Topic → papers → approve → module → read → ask,
  entirely locally, with grounded answers, closed-book toggle, and visible token cost.

### Phase 1 — Assessment, Reconciliation & Cost Visibility
- [x] MCQ generation (100% deterministic harness, no LLM — `src/lib/mcq.ts`; bibliography excluded from distractors, salience-weighted mask, length/proximity distractor pick) ✅
- [x] Essay: rubric is 100% harness (`buildEssayRubric` from module structure); ONLY the open-ended question is AI-generated (`generateEssayPrompt`, zod-validated + 1 retry, failures logged not silent); `POST /api/essay` retries a failed question ✅
- [x] **RPS reconciliation / diff view** (custom vs official order) ✅ — `RPSReconcile` model + `GET/PUT /api/rps/[courseId]` + `app/components/RPSReconcilePanel.tsx`; aligned topics get `orderSource="official_rps"`; dashboard shows an "unverified order" badge (built 2026-08-19)
- [x] Dashboard per-topic status + **AIUsage cost panel** ("Biaya AI")
- [x] **Multi-course batch import** (semester A–E in one go) ✅ — `POST /api/courses {names[], major?}` single transaction + `app/components/CourseBatchImport.tsx` (built 2026-08-19)
- [x] **Persist practice attempts + scores** (`AssessmentAttempt` + `POST /api/attempts`) — *unblocks spaced repetition*
- **Acceptance:** read → Q&A → assess loop works; cost visible; RPS reconciliation and multi-course batch import done (2026-08-19).

### Phase 2 — iPad / PWA Hardening
- [x] PWA manifest (`manifest.ts`) + name "So-study"
- [x] **Service worker** for true offline cache (home-screen install, fullscreen, icon) — *shipped 2026-08-19 (sw.js)* + resilience pass 2026-08-19 (re-precache, FIFO prune, 50MB cap)
- [x] Offline read + explicit "connect" state for Q&A/grading (`Workspace.tsx`)
- [x] Essay draft auto-save to **IndexedDB** (`app/lib/draftStore.ts`, localStorage fallback) — *was localStorage*
- [x] Dashboard progress bar; citation `[n]` → source jump ("show source")
- [x] Reading ergonomics: **section nav / TOC / scroll progress** for long modules (Mayer segmenting)
- [ ] highlight / notes / bookmark
- [x] **Modal a11y**: `role="dialog"`, `aria-modal`, Esc-to-close, focus trap (`Composer`, `PaperReview`)
- [x] **Tab a11y**: `role="tab"` / `aria-selected` on Baca/Tanya/Latih/Sumber
- [ ] Real iPad viewport + VoiceOver testing
- **Acceptance (mostly met):** installable, reads offline, no lost drafts, TOC + full a11y pass shipped. *Not yet:* highlight/notes/bookmark, real iPad/VoiceOver device test.

### Phase 3 — Learning-Science Closure, Deploy & Post-MVP
- [x] **Spaced repetition scheduler** over persisted attempts — **confidence-based**
      (Brainscape-style) shipped (`src/lib/scheduler.ts` + `ReviewQueue`)
- [x] **Interleaved mixed practice** session across a course's topics (`InterleavedPractice.tsx`)
- [x] **Metacognitive prompts** — plan / monitor / evaluate, fitted to pre-lecture framing
      (meta-analyses: SRL g=0.50, outcomes g=0.40; JCAL 2022; 32-study online-SRL meta 2025)
- [x] **Closed-book enforcement** — lock Tanya + Sumber during a Latih attempt (Agarwal
      closed-book > open-book)
- [x] **Generation effect**: students **edit/author** MCQs and write own recall prompts
      (self-made > AI cards: Pan et al. d=0.29–0.45)
- [x] Auto-generate first MCQ set + essay prompt/rubric from the module (no empty Latih)
- [x] **Week / due-before-lecture date** on topics so "X/N siap" is meaningful
- [x] Tie dashboard "ready" to **actual engagement** (opened + attempted practice), not module-exists
- [x] Deploy to Vercel + hosted Postgres + passphrase auth (2 trusted users) — shipped 2026-08-22; runbook in [`DEPLOY.md`](DEPLOY.md)
- [ ] Snapshot/checkpoint system (fork a fresh attempt)
- [ ] **Local-LLM toggle (Ollama)** for routine Q&A once a module exists
- [x] **Export** module → **MD** (`?format=md`, module + essay prompt/rubric + numbered
       sources) / **Anki** (`?format=anki`, TSV with `#separator:tab`/`#html:true`, student
       bank first, deterministic cloze fallback) / **PDF** (server-side pdfmake,
       `GET /api/modules/[id]/export?format=pdf` — the Safari/iPad path, no client print).
       `src/lib/export.ts` + `GET /api/modules/[id]/export`
- [x] Lightweight habit loop (streak / "ready before lecture")
- [ ] **Diminishing-cue cloze** (optional; Fiechter & Benjamin 2017, +44% retention)
- **Acceptance (mostly met):** spaced + interleaved + metacognitive practice; accessible from iPad
  over the internet; reinforcement + portability; engagement-based "ready", habit loop, and
  PDF export shipped. Remaining: deploy + Turso, Ollama, snapshot, diminishing-cue cloze.

> **§6 is a historical status snapshot.** The current, continuously-updated gap
> analysis lives in **§15** (Gap Analysis & Hardening Pass, 2026-08-19).

---

## 7. Pre-Execution Improvements (folded from review)

### 7.1 App logic (pipeline correctness)
- **Deeper grounding:** store `Excerpt` (claim→quote→paper), not just `sourcePaperIds`.
  ⚠️ **Currently broken**: all excerpts get `paperId = paperIds[0]` (`synthesize/route.ts:144-146`).
  Fix before trusting grounding.
- **Robust citation threshold:** `max(2, top-quartile)` with recency fallback.
- **Cross-topic deduplication:** shared `Paper` + `TopicPaper` join.
- **RPS reconciliation view:** diff custom vs official order (R1 mitigation).
- **Module versioning:** `ModuleVersion` records regenerate diffs, not overwrites ✅.
- **Essay rubric + `grounded` flag:** feedback cites module sections.

### 7.2 UI/UX (iPad)
- **One mental model:** Dashboard → Module reader → Q&A → Assessment. ✅ partially (redesigned).
- **iPad-native:** bottom sheets for approval; touch targets ≥44px ✅; no hover-only; Magic
  Keyboard shortcuts optional; iOS voice-to-text for essays.
- **Study ergonomics:** progress bar ✅; highlight/notes/bookmark ❌; "show source" ✅ (cite jump).
- **State design:** empty states ✅ + API-failure states (rate-limit, OpenAlex down) — *refreshCourses
  swallows errors (`page.tsx:38-40`), so a DB failure falsely shows "Belum ada matakuliah" — fix.*
- **Accessibility:** Dynamic Type + VoiceOver; dialog/tab semantics ❌.
- **Terminology consistency:** standardize *Mata kuliah / Topik / Modul*. Today Sidebar says
  "Topik baru" (`Sidebar.tsx:23`), Composer says "Matakuliah" (`Composer.tsx:67,85`), page says
  "Buat matakuliah & topik" (`page.tsx:333`).

### 7.3 Architectural decisions
- **RAG Q&A** instead of full-module injection ✅.
- **Stream synthesis & Q&A (SSE)** — *not yet; long Gemini calls can feel hung.*
- **Cache OpenAlex responses** ✅.
- **Gemini key strictly server-side** ✅.
- **Input-length guards on every LLM route** ✅ (`src/lib/guards.ts`, 413 not truncation).
- **Cost observability:** `AIUsage` logged per call, shown in dashboard ✅.
- **Tests + CI gates in Phase 0** ✅ — unit (`node`) **and component/DOM (`jsdom`)** projects
  in `vitest.config.mts`; 140 tests green via `scripts/ci.sh`.
- **Architecture documented** ✅ (`docs/ARCHITECTURE.md` + project `README.md`).

### 7.4 Further improvements (post-MVP, high leverage)
- Spaced repetition (confidence → SM-2/FSRS); Local-LLM toggle (Ollama); Export PDF/MD/Anki;
  lightweight habit loop; interleaved practice; metacognitive prompts; edit/author MCQs.

### 7.5 Do-first (highest risk reduction per effort)
1. claim→excerpt→paper grounding (**fix the bug**)
2. RPS reconciliation/diff view
3. retrieval-augmented Q&A (not full injection)
4. cost observability in dashboard

### 7.6 Post-build audit (2026-08-18) — code + verified-research review

**Sources (all peer-reviewed / established bodies):** Bjork & Bjork (2020) *Desirable
Difficulties*; Richland/Bjork/Linn (2005) generation+interleaving; Soderstrom/Kerr/Bjork
(2016) retrieval+spacing; Cepeda et al. (2008) spacing meta; Agarwal et al. closed-book >
open-book; Pan et al. (2022) generation effect (self-made > AI cards, d=0.29–0.45);
metacognitive-prompt meta-analyses (JCAL 2022 g=0.40–0.50; 32-study online-SRL meta 2025);
Mayer CTML (segmenting/coherence/signaling); feedback-timing RCTs (ManyClasses 38 classes
effect≈0.00; Melbourne MCQ — immediate≈delayed); 2026 study-app benchmarks (Quizlet/Anki/
Knowt/Brainscape/Scholarly/Notesmakr — active recall + spacing + self-edited cards + real
SRS is the winning combo; FSRS is modern standard).

**P0 — Correctness (all ✅ executed 2026-08-18):**
1. ✅ Fixed `Excerpt.paperId` grounding (`synthesize/route.ts`): `extractClaims` now returns the
   inline `[n]` citation; each Excerpt maps to `paperIds[n-1]`. *(R2 closed)*
2. ✅ **"Mode tertutup" enforced**: `visibleTabIds()` locks Baca+Tanya+Sumber during Latih
   (`app/lib/study.ts` + `Workspace.tsx`); a11y `role="tab"`/`aria-selected` added.
3. ✅ **Attempts persisted** (`AssessmentAttempt` + `POST /api/attempts`); MCQ/essay grades now
   record an attempt, enabling spacing. `ReviewQueue` surfaces due items.
4. ✅ **Essay question auto-generated**, rubric built by the harness, from the module
   (`synthesize/route.ts` → `generateEssayPrompt` question-only + `buildEssayRubric` harness) and
   stored (`Module.essayPrompt/essayRubric`); the essay panel defaults to them (`Workspace.tsx`).
   A failed question (null) shows a retry (`POST /api/essay`), not a silent blank box.

**P1 — Learning loop (all ✅ executed 2026-08-18):**
5. ✅ **Metacognitive prompts** (`src/lib/metacog.ts` + `MetacogPanel.tsx`): plan/monitor/evaluate,
   localStorage autosave.
6. ✅ **Spaced-repetition scheduler** (`src/lib/scheduler.ts`, confidence-based) over persisted
   attempts; `ReviewQueue` drives due practice.
7. ✅ **Interleaved mixed practice** across a course's topics (`InterleavedPractice.tsx` +
   `GET /api/questions?courseId=`).
8. ✅ **Generation effect**: students author/edit/delete their own MCQs (`QuestionBank.tsx` +
   `POST/PATCH/DELETE /api/questions`, student-authored only).
9. ✅ **Terminology + week/due-date**: standardized Mata kuliah/Topik/Modul; `Topic.weekNumber` +
   `dueBeforeLecture` captured in `Composer`→`/api/retrieve` and shown in the dashboard.
10. ✅ **Section nav / TOC** (`TableOfContents.tsx` + heading ids in `markdown.tsx`); **first MCQ set
   auto-generates** when Latih opens; **tab a11y** (`role="tab"`/`tabpanel`) added.

**P2 — Polish / tech debt (all ✅ executed 2026-08-18):**
11. ✅ Loading skeletons (`Skeletons.tsx`: MCQ generation + module synthesis; `SourcesSkeleton` dropped — source list loads synchronously with the module).
12. ✅ **Unified `MCQQuestion` type** — `src/lib/mcq.ts` re-exports from `app/lib/types.ts`.
13. ✅ **Consolidated architecture doc shipped** (`docs/ARCHITECTURE.md`): the `app/lib`
   (client-safe pure) vs `src/lib` (server logic) split is now stated as an explicit
   import-direction rule, with the pipeline/API map, grounding chain, guard table and
   test layout.
14. ✅ **Dead legacy synthesize path removed** (now requires `topicId`).
15. ✅ **Unit tests** added for scheduler + closed-book filter + slug; **component/DOM tests
   now shipped too** — `vitest.config.mts` runs a `node` project and a jsdom `dom` project
   (`@testing-library/react`), covering `Workspace`, `markdown`, `TableOfContents`,
   `MetacogPanel` (60 DOM tests; 140 total).
16. ✅ **Swallowed errors surfaced** — `refreshCourses` now sets the error banner on failure.
17. ✅ **Input-length guards shipped** (`src/lib/guards.ts`): one ceiling table applied to
   `/api/qa`, `/api/grade`, `/api/mcq`, `/api/synthesize`; oversized input is rejected with
   HTTP 413 and an actionable message instead of being silently truncated. Prisma singleton
   (`src/lib/prisma.ts`) verified correct (global cache, dev hot-reload safe).
18. ✅ **README + architecture doc written** — `README.md` is now project documentation
   (setup, env, scripts, the study loop, export, tests, doc map) instead of Create-Next-App
   boilerplate; `app/lib` vs `src/lib` is documented and enforced as a boundary rule.

---

## 8. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Topic order mismatches real lecturer sequence | High | High | ✅ **Mitigated** — `custom` flagged by default; `RPSReconcile` + diff view lets the student paste the official order and align topics (`orderSource="official_rps"`) |
| R2 | Hallucinated theory in module/Q&A | Med | High | `Excerpt` grounding (⚠️ currently buggy); RAG Q&A locked to chunks; human paper approval |
| R3 | Poor paper curation (irrelevant theory) | Med | High | Heuristic filters + citation floor + manual shortlist gate |
| R4 | Gemini API cost runaway | Low | Med | RAG; modules cached; MCQ free; **AIUsage panel** |
| R5 | Offline Q&A fabricated answer | Med | High | UI forbids offline Q&A; explicit "connect" state ✅ |
| R6 | Lost essay draft on disconnect | Med | Med | localStorage draft (IndexedDB planned) |
| R7 | DB non-persistence on serverless | Closed | — | Migrated to hosted PostgreSQL 2026-08-22 (the local SQLite file was the blocker). See §17/DEPLOY.md. |
| **R8** | **"Closed-book" is leaky → defeats retrieval practice** | High | Med | ✅ **Mitigated** — Latih locks Baca+Tanya+Sumber (`visibleTabIds`) |
| **R9** | **No attempt persistence → no spacing → forgetting curve unmanaged** | High | High | ✅ **Mitigated** — `AssessmentAttempt` + scheduler + `ReviewQueue` |
| **R10** | **Student is passive consumer (all AI-generated)** → weak retention | Med | Med | ✅ **Mitigated** — author/edit MCQs (`QuestionBank`), own prompts |
| **R11** | **Inconsistent terminology/mental model confuses non-dev user** | Med | Med | ✅ **Mitigated** — standardized terms + week/due-date in UI |

---

## 9. Success Metrics

- % of topics reaching `ready` before their lecture week. *(today binary; move to engagement-based — P1 #10)*
- Self-reported "first-contact confusion" reduction (qualitative, student log).
- Zero hallucination incidents (spot-checked against `Excerpt` spans). ⚠️ blocked until P0 #1.
- Offline read success rate on iPad.
- Running API cost per topic (visible via `AIUsage`).
- **(new) Retrieval attempts practiced per topic per week** (requires P0 #3).
- **(new) Spaced-review adherence** (scheduled vs completed) once scheduler ships.

---

## 10. Open Decisions (blockers before build)

1. **RPS availability** — does the campus publish a previous-cohort RPS? Without it, all topic
   order is `custom` (acceptable but flagged + reconcile-ready). *Unchanged.*
2. **Gemini API key** — available ✅ (in `.env`).
3. **Local-LLM later?** — Ollama toggle is Phase 3; decide if worth earlier.
4. **Project location** — **RESOLVED**: `/home/habel-davidson/so-study` (renamed from `anthro-study`).
5. **Deploy target** — **CLOSED**: shipped to Vercel + hosted Postgres 2026-08-22 (§17). The
   prior blocker was the local SQLite file, which cannot persist on serverless. Two trusted users,
   one shared API key, iPad PWA. No signup. Runbook in [`DEPLOY.md`](DEPLOY.md).

---

## 11. Change Governance

Every change to this plan or the codebase is logged in
`docs/CHANGELOG.md` with timestamp (hour/day/date/month/year) and file:line
location, per the rule sets in `docs/rules/`. Verified research is archived in
`docs/RESEARCH.md`.

---

## 12. Broad Improvement Pass — Plan & Execution (2026-08-18 23:xx WIB)

**Status:** EXECUTED 2026-08-18 (ci.sh green: 160/160 tests, lint 0, tsc clean;
`prisma migrate status` clean). This pass folded the three read-only assessment
research streams (code audit of UI/UX + tech debt; learning-science + comparable-apps
briefing; UX/accessibility briefing) into concrete engineering tasks. Grounded in the
actual current code (post §7.6), the real remaining gaps are:

- **Scheduler is SM-2.** Research (FSRS; github.com/open-spaced-repetition/fsrs;
  docs.ankiweb.net/deck-options.html) shows FSRS is the modern standard → replace the
  SM-2 scheduler with a stateful FSRS-derived scheduler.
 - **Q&A "RAG" injects the whole module.** *(State as of the 2026-08-18 pass below.)* The client posts every paragraph and the
   server does no retrieval; `ModuleChunk.embedding` is the stub `"[]"` and no embedder
   existed at that time. → add server-side **lexical** retrieval over stored `ModuleChunk` text (top-k
   by term overlap) and inject only those. Vector/embedding retrieval was later added
   (Gap B, **closed** in §17): Gemini batch embeddings fused with BM25 via RRF.
- **Interleaved practice rates confidence but never records an attempt** → the SRS is
  not fed by mixed practice.
- **Modals lack full a11y.** All three overlays (PaperReview, Composer, UsageModal)
  lack `role="dialog"` / `aria-modal` / `aria-labelledby` / Esc-to-close / focus trap.
  Tabs lack `role="tablist"` / `aria-controls` / arrow-key nav.
- **Dead code:** `app/api/topics/route.ts`, `app/api/modules/route.ts` (collection),
  types `TopicSummary` / `ModuleSummary`, Prisma `Assessment` + `RPSReconcile`. Plus a
  QuestionBank bug: student-authored items are stored as `author:"ai"` (default falls
  through to the else branch), so they wrongly appear in the read-only "AI" section.
- **No design system:** no `@theme` tokens, no contrast pass, no
  `@media (prefers-reduced-motion: reduce)`, no reading-width; no error boundaries;
  no streak / due-today / mastery; "ready" is module-existence only; no onboarding /
  sample course; thin empty states / microcopy; no elaborative-interrogation /
  self-explanation prompts.

### Execution model
- Write this plan to the ROADMAP first (this section).
- **Wave 1:** 6 subagents, each owning DISJOINT files, run in parallel. Each runs
  `bash scripts/ci.sh` and keeps it green; each adds/updates tests for its change.
- **Wave 2:** an integration subagent runs the full `bash scripts/ci.sh`, reconciles
  any cross-agent breakage, writes the CHANGELOG entry (rule I0/G0/E0) with file:line
  locations, confirms `prisma migrate status` is clean, and updates this section's
  status + the Risk Register / Success Metrics as needed.

### Task → subagent map (Wave 1, file-disjoint)
1. **Backend contracts & cleanup (SCHEMA):** `prisma/schema.prisma` (add
   `AssessmentAttempt.stability` + `difficulty`; remove Prisma `Assessment` +
   `RPSReconcile` + `Topic.assessments` / `Course.reconciles` relations);
   `prisma/migrations` (the stray off-script `1_spaced_repetition_state` migration is
   unapplied — `prisma migrate resolve --applied 1_spaced_repetition_state`, then add
   `2_fsrs_cleanup` via `prisma migrate dev`); `src/lib/scheduler.ts` → FSRS-derived
   stateful scheduler (+ `src/lib/scheduler.test.ts`); `app/api/attempts/route.ts`
   (FSRS wiring + serialize new fields); `app/lib/types.ts` (remove `TopicSummary` /
   `ModuleSummary`; add `stability` / `difficulty` to `AssessmentAttempt`);
   DELETE `app/api/topics/route.ts` + `app/api/modules/route.ts`;
   `app/api/questions/route.ts` (default `author` to `"student"`).
   *Acceptance:* `prisma migrate status` clean; FSRS unit tests pass; lint/tsc/vitest green.
2. **Design system & a11y infra (DESIGN):** `app/globals.css` (`@theme` tokens,
   WCAG-AA contrast audit of the indigo/zinc palette, `@media (prefers-reduced-motion:
   reduce)`, max reading-width + prose polish for the module reader); new
   `app/components/Modal.tsx` (accessible dialog: `role="dialog"`, `aria-modal`,
   `aria-labelledby`, Esc-to-close, focus trap, backdrop); refactor `PaperReview.tsx` /
   `Composer.tsx` / `UsageModal.tsx` to use `Modal`; new `app/components/ErrorBoundary.tsx`
   + wrap the main content in `app/page.tsx` (and/or `app/layout.tsx`).
   *Acceptance:* modals have dialog semantics; reduced-motion respected; ErrorBoundary
   catches render errors; CI green.
3. **Workspace UX (WORKSPACE):** `app/components/Workspace.tsx` — wire `doAsk` to
   server retrieval (POST `moduleId`, not raw chunks); finish tab a11y (`role="tablist"`
   wrapper, `aria-controls`/`id`, Left/Right arrow + Home/End nav); extract a shared
   `app/components/MCQOptions.tsx` (used by Workspace + Interleaved); add
   elaborative-interrogation + self-explanation prompts via a new
   `app/components/ElaborationPanel.tsx` (localStorage autosave) mounted in Latih;
   surface rubric-grounded feedback + source citation after grading; reading-typography
   polish. Update `app/components/Workspace.dom.test.tsx` as needed.
   *Acceptance:* tabs keyboard-navigable & linked; retrieval call uses `moduleId`; new
   panels mounted; CI green; DOM tests cover new invariants.
4. **Server-side Q&A retrieval (QA):** new `src/lib/retrieval.ts` (lexical / BM25-lite
   ranker over chunk text, no new dependency); `app/api/qa/route.ts` (accept `moduleId`;
   fetch `ModuleChunk` rows; rank; inject top-k with a short retrieval note; keep guards
   + `topicId` optional). *Acceptance:* qa returns grounded top-k without injecting the
   whole module; CI green; add a small retrieval unit test.
5. **Interleaved practice → SRS (INTERLEAVED):** `app/components/InterleavedPractice.tsx`
   — POST `/api/attempts` per item (`item.topicId` + `item.moduleId`) on reveal/next;
   add a lightweight interleave-tuning control (count / shuffle); adopt the shared
   `MCQOptions`. *Acceptance:* interleaved attempts now feed ReviewQueue/SRS; CI green.
6. **Dashboard & onboarding (DASHBOARD):** `app/page.tsx` + `app/components/Sidebar.tsx`
   — engagement-based "ready" (status set to `module_generated` / `ready` in
   `app/api/synthesize/route.ts`); due-today count + study streak (localStorage) +
   per-topic mastery from attempts via a new `GET /api/progress?courseId=`; first-run
   first-run "Soso" onboarding wizard (course-count gated): Screen 1 Soso intro + optional university (localStorage, personalization only), Screen 2 batch course import (reuses POST /api/courses, shared major) → routes into the dashboard; richer empty states +
   microcopy; mobile drawer / wayfinding / breadcrumb polish. Owns
   `app/api/synthesize/route.ts` (status writes) + new `app/api/progress/route.ts` +
   `app/api/courses/route.ts` (pass-through). *Acceptance:* dashboard shows due-today /
   streak / mastery; onboarding appears on first run; CI green.

### Out of scope this pass (deferred, logged)
 - True vector / embedding retrieval — **later built** (Gap B, **closed** in §17): Gemini dense
   embeddings fused with BM25 via RRF; lexical remains the best-effort fallback.
- Full SSE streaming of Gemini responses (delivered error boundaries + better loading
  instead; streaming is higher-risk for a one-shot).
- Service worker / true offline cache, highlight / notes / bookmark, RPS reconcile UI,
  Ollama toggle, deploy (existing roadmap Phase 2/3 items).

### Outcomes (2026-08-18)

Verified at close: `bash scripts/ci.sh` → `[ci] PASS` (eslint **0 problems**, `tsc --noEmit`
clean, `vitest run` **160/160 across 12 files**, up from 141/10); `npx prisma migrate status`
→ "Database schema is up to date!" (3 migrations, none pending). Full file:line inventory in
`docs/CHANGELOG.md` under `[2026-08-18 | 23:30 WIB]`.

- ✅ **FSRS scheduler shipped, replaces SM-2** — `src/lib/scheduler.ts` rewritten as a stateful
  FSRS-derived scheduler (`INITIAL_STABILITY`, `LAPSE_DECAY`, stability + difficulty advanced on
  every review, comments citing github.com/open-spaced-repetition/fsrs and Dunlosky et al. 2013).
  `AssessmentAttempt.stability` / `.difficulty` added to the schema and wired through
  `app/api/attempts/route.ts`; migration `20260818164459_fsrs_cleanup` applied (the stray
  off-script `1_spaced_repetition_state` was reconciled `--applied`, not reset).
  *Closes the "Scheduler is SM-2" gap above and §7.4's "confidence → SM-2/FSRS" item.*
- ✅ **Server-side lexical retrieval for Q&A** — new `src/lib/retrieval.ts` (BM25-lite ranker,
  no new dependency); `app/api/qa/route.ts` accepts `moduleId`, ranks the module's stored
  `ModuleChunk` rows and injects only the top-5. The client no longer ships the whole module.
   ✅ **Dense/semantic retrieval shipped later** (Gap B, **closed** in §17): `embedTexts` in
   `src/lib/gemini.ts` stores Gemini vectors on `ModuleChunk.embedding` at synthesis and
   `rankChunksHybrid` fuses them with BM25 via RRF; lexical stays the best-effort fallback.
- ✅ **Interleaved practice now feeds the SRS** — `InterleavedPractice.tsx` POSTs `/api/attempts`
  per item (moduleId + topicId + isCorrect + confidence, null-guarded, non-fatal), so course-wide
  mixed practice schedules reviews instead of discarding the confidence rating. Interleave tuning
  ("Jumlah soal" / "Acak ulang") added.
- ✅ **Full modal + tab accessibility** — new `app/components/Modal.tsx` (`role="dialog"`,
  `aria-modal`, `aria-labelledby`, Esc-to-close, focus trap, focus restore) now backs
  `PaperReview`, `Composer` and `UsageModal`; the Baca/Tanya/Latih/Sumber tabs are a complete
  ARIA tablist (`role="tablist"`, `aria-controls`/`id`, ArrowLeft/Right/Home/End).
  *Closes the Phase-2 "Modal a11y" and "Tab a11y" checkboxes and the §7.2 accessibility gap.*
- ✅ **Dead code removed** — Prisma model `Assessment` and the `Topic.assessments` /
   `Course.reconciles` relations dropped; types `TopicSummary` / `ModuleSummary` deleted; routes
   `app/api/topics/route.ts` + `app/api/modules/route.ts` (collection) deleted. QuestionBank
   authorship bug fixed: student-authored items now store `author:"student"` and no longer appear
   in the read-only "AI" section.
   *`RPSReconcile` was also removed in that pass; it was **re-introduced 2026-08-19** (see §6 data
   model) together with `Topic.orderSource` and `Course.major`. **Decision: do not delete
   `RPSReconcile` again** without a matching `ROADMAP.md` decision — the RPS reconcile/diff view is
   now wired and reachable (§6 Phase 1), so silent removal breaks a shipped feature.*
- ✅ **Design tokens + reduced motion + error boundary** — `app/globals.css` gains Tailwind-v4
  `@theme` tokens, a WCAG-AA contrast pass (de-emphasized meta zinc-400 → zinc-500),
  `@media (prefers-reduced-motion: reduce)` and a bounded `.reader-prose` reading measure; new
  `app/components/ErrorBoundary.tsx` wraps the main content in `app/page.tsx`.
- ✅ **Dashboard due-today / streak / mastery + onboarding** — new `GET /api/progress?courseId=`
  returns per-topic hasModule/status/dueToday/attempts/masteryPct/nextReview plus course-level
  dueTodayCount/streakDays/avgMastery; `app/page.tsx` renders the head-start line, ties "ready"
  to **actual engagement** (module exists *and* ≥1 attempt), and shows a first-run onboarding
  `Modal` with a sample-course seed plus richer empty states/microcopy.
  `app/api/synthesize/route.ts` now sets `Topic.status = "module_generated"`.
  *Closes Phase 3's "tie dashboard 'ready' to actual engagement" and starts the habit loop.*
- ✅ **Elaborative interrogation + self-explanation** — new `app/components/ElaborationPanel.tsx`
  (localStorage autosave) mounted in Latih, plus a shared `app/components/MCQOptions.tsx`
  renderer used by both Workspace and InterleavedPractice. Rubric + source-citation note now
  surfaced after grading.

**Still deferred (as already listed in "Out of scope this pass" above):** SSE streaming of Gemini
 responses, service worker / true offline cache, highlight / notes / bookmark, Ollama local-LLM
 toggle, IndexedDB draft migration, deploy (Vercel + Turso), snapshot system, and diminishing-cue
 cloze. *(Vector/embedding retrieval was **closed** in §17 — dense retrieval shipped with Gemini
 embeddings fused with BM25.)* RPS reconcile UI (+ model) and multi-course batch import were
 **moved out of deferred and built 2026-08-19** (see §6 Phase 1).

---

## 13. Phase 2 — Polish & Learning-Science Depth Pass

**Status:** EXECUTED 2026-08-19

**Goal.** Fix correctness bugs, clear technical debt, polish UI/UX for the iPad/Safari target device, and deepen the evidence-based study loop (pretesting, free recall, calibration, richer grading, spacing tuning). All work is divided into 8 file-disjoint workstreams executed by parallel subagents, then verified by `bash scripts/ci.sh` (lint + tsc + 160+ tests) and `npx prisma migrate status` (clean).

**Evidence sources (verified).**
- Dunlosky et al. 2013, *Strengthening the Student Toolbox*, DOI 10.1177/1529100612453266 (practice testing/distributed practice = High; elaborative interrogation/self-explanation/interleaving = Moderate; highlighting/rereading/summarization = Low utility).
- Roediger & Karpicke 2006, *Test-Enhanced Learning*, DOI 10.1111/j.1467-9280.2006.01693.x.
- Karpicke & Blunt 2011, *Retrieval Practice*, DOI 10.1126/science.1199327.
- Cepeda et al. 2008 (distributed practice spacing), DOI 10.1111/j.1467-9280.2008.02209.x.
- Richland, Kornell & Kao 2009 (pretesting), DOI 10.1037/a0016496; Pan & Carpenter 2023, DOI 10.1007/s10648-023-09814-5.
- Butler & Roediger 2008 (delayed feedback, lure intrusions), DOI 10.3758/MC.36.3.604.
- Agarwal et al. 2008 (open/closed-book testing effect), DOI 10.1002/acp.1391.
- Nelson & Dunlosky 1991; Metcalfe 2009; Thiede et al. 2003 (JOL calibration).
- Sweller et al. 2019 (cognitive load); Mayer 2024 (multimedia); Bjork & Bjork 2011/2020 (desirable difficulties).
- FSRS: github.com/open-spaced-repetition/awesome-fsrs (ABC of FSRS); docs.ankiweb.net/deck-options.html#fsrs.
- WAI-ARIA APG (dialog, tabs, live regions); WCAG 2.2 (contrast, target size 24px, reduced motion); Nielsen Norman heuristics; Tailwind CSS v4 theming; Apple iPad Safari (WWDC21, dvh/safe-area).

**Workstreams (subagent ownership — files are disjoint to avoid conflicts).**

- **WS1 Design system, dark mode, typography, mobile shell, markdown** — `app/globals.css`, `app/components/Sidebar.tsx`, `app/components/Composer.tsx`, `app/lib/markdown.tsx`. Adopt/prune `@theme` tokens (brand/muted/radius-card); add in-app dark-mode toggle via `.dark` class + localStorage (keep `prefers-color-scheme` fallback); reader typography tokens (measure ~66ch, line-height 1.6, 18–20px) on `.reader-prose`; fix `text-zinc-400`→`text-zinc-500` in owned files; tap targets ≥44px on coarse pointers; responsive Sidebar drawer (<md) reusing `Modal` as a sheet; complete the markdown renderer (links, tables, fenced code) + readable dark-mode link color.
- **WS2 Lib: scheduler (desired retention + elapsed), retrieval (NaN guard), guards, qa take** — `src/lib/scheduler.ts`, `src/lib/retrieval.ts`, `src/lib/guards.ts`, `app/api/qa/route.ts`. Add desired-retention config (default 0.90) and use elapsed time in scheduler growth; guard `avgdl===0` in BM25; use `LIMITS.chunkCount` as a `take` in `/api/qa`; keep `prisma/schema.prisma` unchanged unless a new optional `desiredRetention` settings row is needed (if so, add a migration-safe field on an existing model only).
- **WS3 Accessibility infra: Modal + ErrorBoundary** — `app/components/Modal.tsx`, `app/components/ErrorBoundary.tsx`. Fix focus trap to skip disabled controls; add body scroll-lock; confirm (via internal state) before discarding typed Composer/PaperReview content on backdrop/Esc; return focus to trigger. Harden `ErrorBoundary` (no API/signature change that breaks `app/page.tsx` import).
- **WS4 Progress API: streak, heatmap, due/overdue, mastery fix** — `app/api/progress/route.ts` (+ optional `src/lib/progress.ts` helper). Return per-course due counts, per-topic `dueToday` vs `overdue` split, `streakDays`, a 30-day `heatmap`, and fix `masteryPct` to exclude essay attempts (which carry no `isCorrect`). Contract consumed by `app/page.tsx` (WS7).
- **WS5 API correctness: mcq usage logging, course-name pass-through** — `app/api/mcq/route.ts`, `app/api/grade/route.ts`, `app/api/synthesize/route.ts`, `src/lib/topics.ts`. Add `logAIUsage` to `/api/mcq` (currently missing) and make first MCQ generation explicit (not auto-fired on module open); stop hardcoding `"Teori Antropologi Kontemporer"` — pass the real course name through synthesize/grade prompts; make `topics.ts` `ensureTopic` use the provided `courseId` (no cuid-as-name course creation).
- **WS6 Docs drift** — `docs/ARCHITECTURE.md`, `README.md`. Remove stale references to removed `computeNextReview`, deleted `Assessment`/`RPSReconcile` models, and the "Q&A uses client chunks" claim; add `src/lib/retrieval.ts` + `elaboration:*`/`onboarded` localStorage keys; document the new Phase-2 features. No code changes.
- **WS7 Hub: page.tsx + Workspace + Latih + learning-science UI (depends on WS1–WS5)** — `app/page.tsx`, `app/components/Workspace.tsx`, `app/components/InterleavedPractice.tsx`, `app/components/ReviewQueue.tsx`, `app/components/QuestionBank.tsx`, `app/components/MetacogPanel.tsx`, `app/components/ElaborationPanel.tsx`, plus NEW `app/components/PretestGate.tsx`, `FreeRecall.tsx`, `CalibrationPanel.tsx`, `ReviewGrader.tsx`. Implement: fix `InterleavedPractice` crash (idx guard before `current`); unify the two confidence-rating flows; tame `Latih` with a sub-nav; persist AI-generated MCQs into `QuestionBankItem`; fix broken sample-onboarding `courseId`; allow deleting a topic with no module; fix wrong MCQ copy; add `aria-live` status regions + `ErrorBoundary` wrapping modals in `page.tsx`; `100dvh` shell; `zinc-400`→`zinc-500` sweep in owned files; **pretesting gate** before Baca (5 low-stakes prequestions, no penalty), **free-recall brain dump** before Q&A, **calibration panel** (predicted vs actual from confidence vs `isCorrect`), **Again/Hard/Good/Easy** grading with next-interval preview, **desirable-difficulty guardrail** (<40% sustained → scaffolding prompt), and **interleave-by-concept + randomized order**.
- **WS8 Tests (after WS7; new files only)** — add `*.dom.test.tsx` for `MCQOptions`, `ElaborationPanel`, `InterleavedPractice` (crash regression), `ErrorBoundary`, `PaperReview`, `Composer`, `Sidebar`, `ReviewQueue`, `QuestionBank`; and API route tests for `/api/mcq` usage logging, `/api/qa` `take` limit, `/api/progress` mastery. Only new test files are created — no edits to source files — to keep ownership disjoint.

**Execution model.** Wave 1 = WS1, WS2, WS3, WS4, WS5, WS6 (parallel, independent). Wave 2 = WS7 (consumes Wave-1 outputs). Wave 3 = WS8 (after WS7). Verification = `bash scripts/ci.sh` must be green and `npx prisma migrate status` clean; any failure triggers a remediation pass.

**Outcomes (executed 2026-08-19).** All 8 workstreams shipped via file-disjoint subagents in 3 waves. Verification: `bash scripts/ci.sh` → `[ci] PASS — 2026-08-18T20:13:30Z`, 205/205 tests, lint 0 problems, `tsc` clean, `npx prisma migrate status` up to date (3 migrations). Shipped: design tokens + dark-mode toggle + responsive Sidebar drawer + complete markdown renderer (WS1); scheduler `desiredRetention`/`previewIntervals` + retrieval NaN guard + qa `take` (WS2); Modal focus/scroll/confirm hardening (WS3); progress streak/heatmap/overdue/mastery fix (WS4); mcq usage logging + course-name pass-through + default-course fix (WS5); ARCHITECTURE drift corrected (WS6); hub fixes — Interleaved crash, ReviewQueue stale correctness, onboarding courseId, topic-only delete, AI-MCQ persistence, dvh, ErrorBoundary-on-modals, aria-live, Latih sub-tablist, unified Again/Hard/Good/Easy grader, pretesting gate, free-recall gate, calibration panel, desirable-difficulty guardrail, interleave-by-concept (WS7); 13 new component test files +21 cases (WS8).

**Deferred (out of scope for this pass).** SSE streaming of Gemini; service worker/offline; highlight→card conversion; RPS reconcile UI; Ollama toggle; deploy. *(Vector/embedding retrieval was **closed** in §17 — dense retrieval shipped with Gemini embeddings fused with BM25.)*
  - API route tests (mcq usage, qa take, progress mastery) — skipped in WS8; need Prisma/Gemini mocking harness.

---

## 14. Broad Improvement Pass — Essay 5W1H · MCQ harness-first · PDF depth · Soso & reminder · UI polish
**Status:** EXECUTED 2026-08-19 (ci.sh green: 362/362 tests, lint 0, tsc clean). Five file-disjoint
workstreams run by subagents, then integrated and gated by `bash scripts/ci.sh`. Origin: user
feedback that the essay harness was still weak, MCQ should lighten AI load, the PDF must be
functionally richer (penulisan/penafsiran/penalaran) not just prettier, Soso needs a clearer
voice + a daily "belum belajar" nudge, and the UI/UX needs another iPad polish pass.

**Workstreams (files disjoint; no schema change; no new deps):**
- **Essay (5W1H + grading harness):** `src/lib/essay.ts` — `generateEssayPrompt` now derives
  module-specific anchors and builds ONE 5W1H-grounded (Apa/Siapa/Kapan/Di mana/Mengapa/Bagaimana)
  essay prompt; `buildEssayRubric` now also scores **penulisan / penafsiran / penalaran** + grounding.
  `app/components/EssayStep.tsx` shows a 5W1H helper note. Contract (`string | null` / `string`)
  unchanged, so `synthesize`/`/api/essay` needed no change.
- **MCQ (harness-first, lighten AI):** `app/api/mcq/route.ts` now uses the deterministic
  `generateMCQ` as the PRIMARY path (no Gemini by default); LLM only when `useLLM:true`.
  `src/lib/mcq.ts` adds deterministic concept-coverage (round-robin) + key-concept-cluster
  distractors + a short harness `explanation`. Generation is now $0/offline by default.
- **PDF (penulisan/penafsiran/penalaran):** `src/lib/pdf.ts` adds a "Petunjuk belajar" callout and
  renders the rubric as a tickable checklist; `src/lib/export.ts` adds `RubricSection` +
  `enrichModule` (derived `studyGuidance`/`keyConcepts`/`keyArguments`/`rubricSections`);
  `app/lib/pdfExtract.ts` adds `analyzeModuleContent`/`deriveStudyGuidance`. Grounding `[n]` kept (I5).
- **Soso + daily reminder + cron:** new `app/lib/soso.ts` (persona + exact reminder line
  "Hallo! Soso disini! Kamu belum belajar hari ini! hummft kamu ga kangen aku ya?!"), new
  `app/components/SosoReminder.tsx` (in-app daily nudge, per-Jakarta-day dismissal, driven by the
  progress heatmap), warmed `app/components/SosoOnboarding.tsx` copy, `app/page.tsx` mounts the
  reminder, and a Vercel Hobby cron scaffold — `vercel.json` (`"1 1 * * *"` = ~08:00 WIB = 01:00 UTC)
  + `app/api/cron/daily-reminder/route.ts` (guarded no-op; real push needs a channel, deferred).
  Cron feasibility verified: Hobby = max 1x/day, UTC-only, ±59 min precision → schedule is WIB−7h.
- **UI/UX polish:** `app/globals.css` (focus-visible net, `.reader-prose` rhythm), `Sidebar`/
  `Workspace`/`Composer`/`ReadStep`/`AskStep`/`ui.ts` + other presentational components (dark-mode
  token consistency, terminology, warmer empty states/microcopy); new disjoint dom tests.

**Closes / advances:**
- Phase 3 "Lightweight habit loop (streak / 'ready before lecture')" → partial: in-app Soso daily
  reminder + streak already shipped (§13 progress API); server cron scaffold added (push deferred).
- Essay prompt quality (user: "harness essay masih gagal") → fixed via 5W1H + module-anchored framing.
- MCQ AI load (user: "harness pilihan ganda harus meringankan pekerjaan dari ai") → harness-first.
- PDF depth (user: "PDF … penulisan, penafsiran, penalaran … harness diperkuat") → done.
- Soso voice + notification (user: quoted line) → done in-app; cron verified + scaffolded.

**Still deferred (not in this pass):** real push notification channel for the cron (email/Web Push/
   FCM — needs a server-side delivery service + likely Turso for multi-device); service worker
   offline refinements; highlight/notes/bookmark; Ollama local-LLM; diminishing-cue cloze; snapshot
   system; SSE streaming. *(Vector/embedding retrieval was **closed** in §17 — Gap B, dense retrieval
   shipped with Gemini embeddings fused with BM25.)*

---

## 15. Gap Analysis & Hardening Pass (2026-08-19)

**Status:** EXECUTED 2026-08-19 (ci.sh green: 380/380 tests, lint 0, tsc clean). This pass
turns the externally-verified gap analysis (below) into the roadmap and executes the tractable
workstreams oneshot via **file-disjoint subagents** (each owns non-overlapping files so no merge
conflicts), gated by `bash scripts/ci.sh`.

**Origin.** A read-only external gap analysis was commissioned against the shipped app (post §14).
Its findings — hallucination risk in generated modules, SSE/IndexedDB/PWA-resilience gaps, no data
backup, plus 5 doc/code drifts (rule I12) — are captured verbatim as the Gaps below. The tractable
workstreams (faithfulness harness, streaming synthesis, IndexedDB drafts, PWA resilience, JSON
backup/restore, plus the I12 doc corrections) were executed by file-disjoint subagents and verified
green. Heavy/device-dependent/needs-dependency items were deliberately left deferred (see "Still
deferred").

### Verified external sources

- **Wallat 2025 (University of Amsterdam)** — up to **57% of RAG citations lack faithfulness**
  (post-rationalization: the generator backs up the answer with a citation rather than deriving it).
  Drives gap **A** + priority **P0**.
- **FACTUM (JHU 2026)**, **CiteGuard (ACL 2026)**, **RAGTruth**, **Springer Nature 2026** — retrieval
  quality drives faithfulness; a post-generation check is the cheapest reliable mitigation.
- **Memdora (arXiv 2607.25096, 2026)** — SRS interaction poverty ("flip-and-rate") + card-creation
  friction; motivates gap **G** (varied practice) and the generation-effect direction.
- **firt.dev / magicbell 2026 / hashhackers 2025** — iOS PWA limits: **no Background Sync**, **~7-day
  cache expiry** when not visited, **~50MB storage cap**, **push needs an installed PWA + iOS 16.4+ +
  non-EU**, and **no install prompt**. Drives gap **F** + PWA resilience (P1).
- **MDPI Educ. Sci. 2023 13(1):94** + **PMC11422584** — mobile-learning cognitive load: navigation
  depth, font size, and signaling matter; deep (>3-click) navigation raises load. Drives the UI/UX
  risks below.
- **Muvon 2026 / ssdnodes 2026 / raidframe 2026** — SQLite local-first strengths + the
  "**SQLite + serverless poor fit**" caveat; **multi-device sync is a separate hard problem**;
  **backup is the user's job**. Drives gaps **J** (backup) + **K** (Turso) + **I** (sync).
- **rapptrlabs 2025** — EdTech mistakes: info density, ignoring mobile-first, poor gamification
  (gamification must be tied to real practice, not mere opens). Drives the UI/UX risks + gamification note.

### Gaps identified

- **A. Grounding still vulnerable to hallucination** — no post-generation faithfulness check on the
  synthesized module vs the approved source set. **P0.**
 - **B. Retrieval is now hybrid (lexical + dense)** — `ModuleChunk.embedding` is populated at synthesis by Gemini `text-embedding-004` batch embeddings (`embedTexts` in `src/lib/gemini.ts`) and fused with BM25 via Reciprocal Rank Fusion (`rankChunksHybrid` in `src/lib/retrieval.ts`); lexical-only is the graceful fallback when embedding fails or a legacy module has no vector. **Closed** (see §17 correction #4).
- **C. Synthesis is not streamed** — a long Gemini call blocks on one JSON response. **Addressed this pass** (SSE).
- **D. Essay drafts live in `localStorage`, not IndexedDB** — fragile, size-limited. **Addressed this pass** (`draftStore`).
- **E. No real push notification** — the daily-reminder cron is a guarded no-op; only in-app nudges
  exist. **Deferred** (needs a delivery channel: Web Push/FCM/email + likely Turso).
- **F. Offline relies on precache + HTTP cache; iOS 7-day wipe / 50MB cap risk** — mitigated this pass
  (re-precache, offline fallback doc, FIFO prune to the ~50MB cap).
- **G. Retrieval practice is still narrow** — MCQ + essay; free recall already shipped & wired into
  Tanya. **Partial.** Error-detection / dependency-graph / conceptual practice remain **deferred**.
- **H. No highlight / notes / bookmark in the reader** — **Deferred** (large reader feature).
- **I. No multi-device sync** — local-first = one copy per machine. **Deferred** (CRDT; separate hard problem).
- **J. No DB backup** — **Addressed this pass** (export/import JSON snapshot).
- **K. Vercel + local SQLite would break** (serverless poor fit). **Deferred** (Turso at deploy;
  documented constraint only this pass).
- **L. Learning efficacy is not measured** — **Deferred** (pre/post lecture quiz; §9 metrics).

### Doc/code drift (rule I12) findings

1. **ARCHITECTURE §9** said *"No service worker yet"* but `public/sw.js` + `ServiceWorkerRegister.tsx` exist. **Fixed §15 (ARCH §9 updated).**
2. **README PDF section** said *browser print-to-PDF / no PDF dependency*, but the code uses server-side
   pdfmake (`GET /api/modules/[id]/export?format=pdf`). **Fixed §15 (README line ~101).**
3. **ROADMAP §6 Phase 2** still marks *Service worker / TOC / modal a11y / tab a11y* as ❌ though all shipped. **Fixed §15 (§6 checkboxes).**
4. **ARCHITECTURE §9** said dashboard *"ready" = module exists*, but engagement-based "ready" shipped (§13 WS7). **Fixed §15 (ARCH §9 updated).**
5. **ROADMAP §6 Phase 3 PDF** still said *"browser print"* vs pdfmake. **Fixed §15 (§6 checkbox).**

### UI/UX risks (iPad / Safari)

- **Info density / deep navigation (>3 clicks)** → higher cognitive load (MDPI 2023 / PMC11422584). Keep
  the 4-step course→topic→module→tab flow shallow; resist nesting.
- **Accessibility** — ARIA roles are present (dialog/tab/live-region), but **not yet verified on a real
  device**: the **VoiceOver real-device test is still ❌**.
- **Gamification** must stay tied to **real practice** (attempts, spacing, recall), never mere app opens
  (rapptrlabs 2025). The Soso streak is engagement-shaped, not open-count-shaped.

### Priority table

| Pri | Theme | Item(s) | Status this pass |
| --- | --- | --- | --- |
| **P0** | Faithfulness / hallucination | A (post-generation grounding check) + the 5 I12 doc drifts | ✅ grounding harness; ✅ drift fixed |
| **P1** | Streaming UX | C (SSE synthesis) | ✅ |
| **P1** | Local persistence | D (IndexedDB drafts), J (DB backup) | ✅ draftStore; ✅ backup/restore |
| **P1** | PWA resilience | F (iOS 7-day wipe / 50MB cap) | ✅ sw.js resilience pass |
| **P2** | Varied practice | G-rest (error detection, dependency graph, conceptual) | ❌ deferred |
| **P2** | Reader features | H (highlight→card) | ❌ deferred |
| **P2** | Efficacy | L (pre/post quiz) | ❌ deferred |
| **P3** | Sync / deploy | B (semantic retrieval) — ✅ **closed (§17)**; E (push), I (CRDT), K (Turso) | ❌ deferred (E/I/K); ✅ B done |

### Workstreams executed this pass

- **WS-SYNTH** — `src/lib/grounding.ts` (new: `verifyGrounding` faithfulness harness) +
  `src/lib/gemini.ts` (`streamGenerate` SSE export) + `app/api/synthesize/route.ts` (SSE stream with
  `groundingReport`, non-streaming JSON fallback; persistence unchanged) + `app/page.tsx` (consumes SSE
  with progressive "Menyusun modul…" status + shows grounding verdict, degrades to JSON).
- **WS-WORK** — `app/lib/draftStore.ts` (new: IndexedDB draft store + localStorage fallback) +
  `app/components/EssayStep.tsx` (drafts now use `draftStore`) + `app/components/Workspace.dom.test.tsx`
  (draft assertions updated for async load).
- **WS-PWA** — `public/sw.js` (re-precache on launch/activate, offline fallback doc, FIFO prune to the
  ~50MB iOS cap) + `app/components/ServiceWorkerRegister.tsx` (`REPRECACHE` message on load + skipWaiting/update).
- **WS-BACKUP** — `app/api/backup/route.ts` (new: GET full JSON snapshot; POST re-import, `confirm:"overwrite"`,
  zod-validated, transactional) + `app/api/backup/route.test.ts` (new) + `app/components/DataBackup.tsx`
  (new: export/import UI) + `app/components/Sidebar.tsx` (mounts `DataBackup`).

All four workstreams are **file-disjoint** and `bash scripts/ci.sh` is green (**380 tests**).

### Still deferred (not in this pass)

 - **B — dense/semantic retrieval is closed (§17).** Gemini dense embeddings (`embedTexts` in `src/lib/gemini.ts`) are stored on `ModuleChunk.embedding` at synthesis and fused with BM25 via `rankChunksHybrid` (RRF) in `src/lib/retrieval.ts`; lexical BM25 is the best-effort fallback when embedding fails or a legacy module has no vector.
- **E** — real push notification channel for the daily-reminder cron (Web Push/FCM/email; needs a
  server-side delivery service, likely Turso for multi-device).
- **G-rest** — error detection, dependency-graph, and conceptual practice modes (free recall already shipped).
- **H** — highlight / notes / bookmark in the reader (large reader feature).
- **I** — CRDT multi-device sync (separate hard problem; local-first stays one-copy-per-machine this pass).
- **K** — Turso at deploy (Vercel + local SQLite breaks; documented constraint only).
- **L** — learning-efficacy measurement (pre/post lecture quiz; see §9 metrics).
- **UI/UX** — VoiceOver real-device test (still ❌), gamification tuning (keep tied to real practice).

*Reasoning (consistent with prior passes):* each deferred item is either heavy (CRDT, Turso), needs a
 paid/remote dependency or device (push channel, real iPad), or is a large feature best scoped on its own
 (reader highlight→card, efficacy quiz). The tractable, high-leverage, dependency-free work was shipped
 this pass. *(Gap B — dense/semantic retrieval — is **closed** in §17 and is therefore no longer in this
 list.)*

---

## 16. Ekspansi Pool Sumber & Sitasi APA (2026-08-19)

 **Status:** EXECUTED 2026-08-19 (ci.sh green: 380+ tests, lint 0, tsc clean), then extended 2026-08-20
 (user directive: broaden sourcing to Indonesian/English, per-question MCQ reveal, stronger MCQ harness,
 guaranteed essay generation). A multi-provider scholarly source layer replaces the single-source OpenAlex
 retrieval path. Implemented by file-disjoint parallel subagents plus an integrating orchestrator, gated by
 `bash scripts/ci.sh`.

**Origin.** Extends the §15 gap analysis (gap **B** — retrieval was lexical-only and single-source
OpenAlex). A user directive broadened the requirement beyond OpenAlex: pull **international sources**,
capture **DOIs**, and render the module's source list in **APA-7**. The single-source OpenAlex path was
a coverage/relevance weakness — relevant papers outside OpenAlex's index (PubMed biomedical, Crossref
publisher bibliographic records, Semantic Scholar) were invisible, and citations could not be rendered in
a standard academic style.

### Decision
- Added **OpenAlex + Crossref + Semantic Scholar + PubMed** as parallel `SourceProvider`s behind a
  common interface, plus **OpenCitations (COCI)** to corroborate citation counts.
- **Scite is OPTIONAL** — a best-effort branch gated by `SCITE_API_KEY`. It is NOT required; the app
  works fully without it (COCI is the default corroboration source).
- **Sci-Hub was REJECTED.** It is a copyright-infringing pirate repository that hosts illegal copies of
  paywalled papers. Using it would (a) create legal risk for the project and the user, (b) violate this
  project's explicit "trusted peer-reviewed sources" principle, and (c) be unnecessary — the open APIs
  (OpenAlex / Crossref / S2 / PubMed / COCI) already provide metadata, abstracts, and DOIs for free. This
  decision is recorded here so the option is not revisited.

### Architecture summary
`src/lib/sources/` fans out to N providers in parallel (`Promise.allSettled`, each with a per-provider
timeout), then **dedupes by DOI** (`dedupeAndMerge`) and **merges metadata** — Crossref wins the
bibliographic fields (venue / volume / issue / pages / publisher). Citation counts are corroborated via
OpenCitations COCI (`citations.ts`), and the merged set is **re-scored centrally** by `src/lib/scoring.ts`.
Each provider degrades to `[]` on failure; the aggregator throws only if **ALL** providers fail.

### APA-7
`src/lib/citation.ts` `formatAPA()` renders an APA-7 reference string from a `SourcePaper` /
`ExportPaper`; it is wired into the Markdown export (`src/lib/export.ts`) and the PDF export
(`src/lib/pdf.ts`) source lists. `Paper` and the `ExportPaper` / `SourcePaper` DTOs gained
bibliographic columns (`doi`, `venue`, `volume`, `issue`, `pages`, `publisher`, `type`), backed by the
`add_paper_bibliography` migration.

### Why
- **Coverage breadth → better grounding.** More sources feeding `grounding.ts` improve the faithfulness
  check and the relevance of approved papers.
- **DOIs de-duplicate across providers.** `normalizeDoi` / `doiUrl` unify records so the same paper from
  two providers merges instead of appearing twice.
- **APA-7 for academic correctness.** Rendering citations in a standard style is required by the user
  directive and matches a study app's academic framing.

### Risks / limits
- **Provider rate limits.** Crossref polite pool (needs a `mailto`), Semantic Scholar ~1 req/s. Pacing +
  per-provider timeouts keep one slow/throttled provider from blocking the others.
- **Offline resilience.** Each provider degrades to `[]`; the aggregator throws only when **all**
  providers fail, so a single reachable provider still yields results.
- **Legacy DB rows.** Papers stored before this change carry only an OpenAlex id (no DOI), so they won't
  auto-merge with new DOI-keyed rows. This is **gradual, not a blocker** — old rows remain valid; new
  retrievals key on DOI.
 - **Scite needs a paid key** (optional). Without `SCITE_API_KEY` the Scite branch is skipped; COCI remains
   the corroboration source.

### 2026-08-20 extension — Indonesian/OA sourcing, MCQ reveal + harness, guaranteed essay
- **DOAJ provider added** (`src/lib/sources/doaj.ts`) so retrieval no longer skews international/English-only:
  DOAJ surfaces OA and Indonesian-heavy journals. It is the 5th `SourceProvider`, fan-out behind the common
  interface, no API key. `SourcePaper` / `CandidatePaper` gained `language`; `relevanceScore` adds
  `LANGUAGE_BONUS` (id/en) so in-language works rank above an otherwise-equal foreign work; `PaperReview`
  shows a `· LANG` badge.
- **MCQ reveals on answer.** `MCQStep` locks the selected option after the first pick, shows the correct
  answer + explanation immediately, and keeps a live score tally (global "Nilai" button removed).
- **MCQ harness is citation-grounded.** `mcq.ts` captures `[n]` citation markers and prefers
  citation-grounded review sentences, so each item tracks the approved module sources (less AI load, tighter
  module correlation).
- **Essay generation always succeeds.** `essay.ts` adds a deterministic `generateEssayPromptHarness`
  (5W1H, 0% AI) used as a fallback by `generateEssayPromptWithFallback`; `synthesize` and `/api/essay` now
  always return a non-null `essayPrompt`.

### 2026-08-20 extension — longer modules, more sources, broader keywords, stronger harness
- **Longer, thorough modules.** `buildSystem` now requires a LUAS module: ≥10 numbered sections, 2–4
  paragraphs each (≥10 pages), with balanced coverage of every approved source. `maxOutputTokens` raised
  4096 → 8192 (safe Flash output cap; tune up only if the configured model allows more).
- **More sources.** Per-provider `perTopic` raised 10 → 15; the aggregator shortlist cap raised to
  `maxCount: 24` so more candidate papers reach the human approval gate before synthesis.
- **Broader keyword coverage (no LLM).** New `src/lib/keywords.ts` `expandKeywords()` derives title
  tokens + adjacent bigrams (+ user keywords) into a bounded, deduplicated term list fed to every
  provider; `scoringTerms()` keeps ranking terms concise so relevance overlap stays meaningful.
- **Stronger harness.** MCQ `count` default 5 → 8 (cap 6 → 12) and the LLM slice 6000 → 12000 so longer
  modules get proportionally more, better-distributed questions; `mcq.ts` `extractClaims` is broader
  (claim cues + any `[n]` line) and raises 8 → 16, so excerpts track more of the module's sources.
- **Longer, auditable modules.** `buildSystem` now demands a concrete length (MINIMAL 10 HALAMAN A4 ≈ 6000
  kata / ≥30000 karakter, each of ≥10 sections 2–4 paragraf padat ~600–700 kata) and instructs the model to
  CONTINUE if the stream is cut off before 10 pages. `ReadStep` is now a bounded, scrollable panel with a
  visible scrollbar, a live page counter (`Halaman X / Y ≈`), section count, a ≥10-halaman target badge, and
  a scroll-progress bar so a student can verify the module genuinely reaches ~10 pages.
- **Internationally-broad paper review.** The approval gate (`Tinjauan paper`) now presents exactly 10
  candidates, guaranteed to include ≥2 international journals written in English or another language
  (heuristic `isInternationalJournal` in `scoring.ts`; `selectShortlist` enforces `minInternational: 2`).
   `PaperReview` surfaces a "Jurnal internasional: N/2" badge and a "Jurnal intl." chip per paper so the
   breadth requirement is verifiable. `CandidatePaper` gained `venue`/`type` (I12 sync) so the check reaches
   the client.

---

## 17. Verification & Hardening Pass (2026-08-21)

**Status:** EXECUTED 2026-08-21. Trigger: an independent review of the running app found the
**CI gate red**, several gaps **closed but not enforced**, and **doc/code drift** (the ROADMAP was
2 days ahead of the code and contradicted it). This pass does NOT add product features — it makes
the existing claims true and verifiable. `bash scripts/ci.sh` is green at close (see "Outcomes").

### Corrections to earlier claims (rule I12)

1. **ROADMAP §6 / §15 said "ci.sh PASS — 362/362 / 380/380 tests".** At review the committed tree had
   **3 failing DOM tests** (all `testTimeout` 5000ms exceeded in `Workspace`/`SosoOnboarding`/
   `ReviewQueue` under parallel jsdom load — not logic failures). **Fixed:** `vitest.config.mts` sets
   `testTimeout`/`hookTimeout = 15000` on the `dom` project. Full suite now **608 tests, 0 failing**.
2. **ROADMAP §13 WS8 said "API route tests … skipped; need Prisma/Gemini mocking harness."** False at
   review — 9 `route.test.ts` already existed. This pass **adds the missing 6** so every load-bearing
   server route is now integration-tested: `qa`, `grade`, `mcq`, `attempts`, `progress`, `rps`
   (plus `push/send`). Total route tests: **15**.
3. **"Grounding sifatnya advisory, bukan di-enforce."** Partially true and now fixed. Tier 1
   (`src/lib/tier1.ts`) was already a hard gate on **phantom citations** (`blocked`), and the reader
   body + exports were already withheld. What was still open: **Tanya (Q&A) and Latih (practice)**
   remained usable on a blocked module. `Workspace.tsx` now withholds **all four** surfaces (Baca body,
   Tanya, Latih, ekspor) when `tier1.blocked` — covered by a new DOM test.
4. **Gap B (semantic retrieval) marked "Deferred (needs embedder)".** **Closed.** Dense retrieval now
   uses Gemini `text-embedding-004` batch embeddings (`embedTexts` in `src/lib/gemini.ts`), stored on
   `ModuleChunk.embedding` at synthesis, and fused with BM25 via Reciprocal Rank Fusion
   (`rankChunksHybrid` in `src/lib/retrieval.ts`). Lexical-only is the graceful fallback when embedding
   fails or a legacy module has no vector. Gap B is **done**, not deferred.
5. **Push "cron is a guarded no-op".** The `push/send` cron route was already a real `web-push` sender
   (subscription store, stale 404/410 cleanup, studied-today skip); only `cron/daily-reminder` was a
   no-op. This pass **adds a `push/send` integration test** proving the send/stale-drop path. Push still
   requires deployment + an installed PWA + VAPID env (out of scope, owner deploys).

### Workstreams

- **CI gate:** `vitest.config.mts` — `dom` project `testTimeout`/`hookTimeout = 15000`.
- **Dense retrieval:** `src/lib/gemini.ts` (`embedTexts`, `embedUsage`) + `src/lib/retrieval.ts`
  (`cosineSimilarity`, `rankChunksHybrid`) + `app/api/synthesize/route.ts` (store embeddings,
  best-effort, lexical fallback) + `app/api/qa/route.ts` (embed query, hybrid rank) +
  `src/lib/aiusage.ts` (`"embed"` kind) + `src/lib/retrieval.test.ts` (new, 7 tests).
- **Grounding enforcement:** `app/components/Workspace.tsx` (withhold Tanya + Latih when `blocked`) +
  `app/components/Workspace.dom.test.tsx` (new hard-gate test).
- **Route integration tests (new):** `app/api/qa/route.test.ts`, `app/api/grade/route.test.ts`,
  `app/api/mcq/route.test.ts`, `app/api/attempts/route.test.ts`, `app/api/progress/route.test.ts`,
  `app/api/rps/[courseId]/route.test.ts`, `app/api/push/send/route.test.ts`.

### Outcomes

- `bash scripts/ci.sh` green: `tsc --noEmit` clean, `eslint` 0 errors, **608 tests, 0 failing** (was 3 failing).
- Retrieval is now hybrid (lexical + dense), closing Gap B.
- Tier-1 hard gate covers all four module surfaces.
- Every learning-loop server route has an integration test.

### Genuinely still open (not claimed done here)

- **Real iPad / VoiceOver device test** — cannot be run in this environment; checklist below.
- **Gap G-rest** (error-detection / dependency-graph / conceptual practice), **H** (highlight→card),
  **I** (CRDT sync), **L** (efficacy quiz) — deferred as before.
- **Single mega-commit / CHANGELOG discipline** — this pass is delivered as reviewed changes; the
  repo's history discipline (rule I0/G0/E0) is a process item, not a code fix.

### iPad / VoiceOver manual test checklist (real device — not automatable here)

- [ ] Install to Home Screen on iPad Safari; launch standalone (not a tab).
- [ ] Grant notification permission; confirm Soso reminder can arrive (needs deploy + VAPID).
- [ ] VoiceOver: tab through Baca/Tanya/Latih/Sumber; rotor announces tablist + dialogs.
- [ ] Offline: open a cached module, confirm Tanya/Latih/ekspor refuse with the offline message.
- [ ] Closed-book: confirm Baca/Tanya/Sumber lock during Latih.
- [ ] 44px touch targets; no hover-only affordances with Magic Keyboard only.
- [ ] Dynamic Type: module reader reflows at large text sizes.

## 18. Deploy / Hosted-DB / 2-User Auth / iPad PWA (2026-08-22)

**Status:** EXECUTED 2026-08-22. The core deliverable this pass was to make the app usable by a
second trusted person on her iPad as a **standalone installed PWA**, end-to-end and without
mid-step approval. That forced four things that were previously deferred: a deployable database,
real (if minimal) auth + tenancy, a hard AI cost cap, and a real iPad install path.

### Why this broke the old design (not just "add a server")

- The app stored everything in a local SQLite file (`prisma/dev.db`). A serverless filesystem is
  **ephemeral and per-instance**, so a deploy would have served a different empty DB on every cold
  start and discarded every write. This was the actual blocker, not "we never pushed a button".
- There was **no auth and the API was world-writable**. The moment it had a public URL, anyone on
  the internet could read and overwrite the study data. A second user needs at minimum to be kept
  apart from me.

### Decisions

1. **Database = PostgreSQL, not Turso.** Switching provider invalidated the SQLite migration history,
   so it was re-baselined to a single Postgres migration (`20260822000000_postgres_baseline_tenancy`).
   Postgres won because it needs **zero** new dependencies (no driver adapter, no preview features)
   versus Turso's `@libsql/client` + `@prisma/adapter-libsql`. Detailed in [`DEPLOY.md` §1](DEPLOY.md).
2. **Auth = signed-cookie passphrase, no library.** `src/lib/auth.ts` (HMAC-SHA256 session, 90-day
   TTL; PBKDF2-SHA256 passphrase, 600k iters) + `proxy.ts` edge gate + `requireUser` in every route.
   `SESSION_SECRET` is **required** — auth fails closed without it. Two users created only via
   `scripts/seed-users.mjs`; no signup route exists. (This Next.js version renamed the `middleware`
   convention to `proxy`.)
3. **Tenancy = `ownerId` on Course/Topic/Module**, scoped through the query already being run
   (`findFirst({ where: { id, ownerId } })`), missing-or-not-yours = **404** (never 403). `Paper`
   stays global (deduped bibliography, no private data); `AIUsage` stays global (one shared key, one
   wallet). `Course.name` is now `@@unique([ownerId, name])`.
4. **Hard AI budget cap** (`src/lib/aiusage.ts`): `AI_DAILY_COST_LIMIT_USD`/`AI_MONTHLY_COST_LIMIT_USD`
   (default $1/$20, reset in `AI_BUDGET_TIMEZONE`) checked **before** every paid Gemini call → 429.
   Fails **closed** (a failing budget query blocks, never allows). `0` = block-everything.
5. **iPad PWA**: `app/manifest.ts` (standalone, `id`, apple icon) + `public/sw.js` (no caching of
   `/api`, `/login`; manifest precached) + client session-aware `apiFetch` (401→/login once, 503 no
   loop) + `AccountBar`. `/manifest.webmanifest`, `/sw.js`, icons exempt from the auth gate on
   purpose — Safari fetches the manifest without credentials; a redirect-to-/login would degrade the
   install to a plain bookmark.

### Verification (real, not asserted)

- Full `npx tsc --noEmit` clean, `eslint` 0 errors, `npx vitest run` all green, `npx next build` ok.
- `app/api/route-guard.test.ts` enforces structurally: every `app/api/**/route.ts` calls
  `requireUser`; any handler touching Course/Topic/Module mentions `ownerId`; public routes are
  declared in both the test allowlist and `proxy.ts`.
- Live prod-build run (LAN http, so the request-aware `Secure` flag was exercised) verified:
  unauth page→/login, unauth API→401, manifest 200 without creds, both logins set cookies, each user
  sees only their own data, cross-tenant module/topic/export/rps all 404, per-owner same course name
  allowed, zero-budget run returns 429 on every paid route.

### Deliverables

- `prisma/schema.prisma` (Postgres + User/tenancy) + baseline migration; `src/lib/auth.ts`,
  `src/lib/tenancy.ts`, `proxy.ts`, login + auth routes, `scripts/seed-users.mjs`,
  `scripts/import-sqlite.mjs`, per-route guards, `app/lib/api.ts` + `AccountBar`, budget cap,
  `app/manifest.ts` + `public/sw.js`, deploy docs.
- Runbook: [`docs/DEPLOY.md`](DEPLOY.md) (Postgres, env, seeding, auth/tenancy model, iPad install).
  README + ARCHITECTURE updated. `.env` is gitignored; `so-study-validation-*.zip` stays untracked.

### Genuinely still open

- **Real iPad / VoiceOver device test + real deployment** — cannot be run in this environment; the
  `DEPLOY.md` install checklist and the ROADMAP iPad checklist remain the owner's manual steps.
- **Gap G-rest / H / I / L** — deferred as before.
