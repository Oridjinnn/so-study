# CHANGELOG — So-study

**Logging rule (G0 / E0 / I0):** Every change — large or small — is recorded here
with timestamp (hour, day, date, month, year) and the file + line location
affected. This file is the audit trail for all AI code execution under the
three rule sets in `docs/rules/`.

Format per entry:
`[YYYY-MM-DD | HH:MM WIB | Weekday | DD Month YYYY]`
- FILE: <path> (lines <range>, <new|edited>)
- CHANGE: <what>
- WHY: <reason / rule invoked>

---

## [2026-08-21 | 21:55 WIB | Friday | 21 August 2026]
- CHANGE: CHANGELOG formatting-only reorder (no entry content altered, added, or
  deleted). All 50 `## [...]` entries were sorted into strict DESCENDING
  chronological order (newest first) by `YYYY-MM-DD HH:MM`. The `END OF LOG
  (entries are append-only…)` marker was moved so it is genuinely the final line
  of the file — it had been sitting mid-file with an entry appended AFTER it.
- WHY: A reconciliation pass (task: reconcile repo state vs CHANGELOG) found the
  log was not in chronological order. Specific defect: the entry
  `## [2026-08-19 | 03:13 WIB | Wednesday | 19 August 2026]` ("Phase 2 — Polish &
  Learning-Science Depth Pass") had been appended to the very BOTTOM of the file,
  AFTER the `END OF LOG` marker and AFTER the later-timestamped
  `2026-08-19 | 16:35 WIB` entry. In strict chronological order that 03:13 entry
  belongs between the `2026-08-19 | 13:41 WIB` entry and the `2026-08-18 | 23:30
  WIB` entry (03:13 is the earliest 2026-08-19 entry). The full file was also
  tangled: an Aug-17/Aug-18 block sat below an Aug-19 early-evening block, and
  within the Aug-19 Thursday cluster the order was 18:20 → 19:25 → 19:07 (should
  be 19:25 → 19:07 → 18:20). All of this is now corrected by the sort. No entry
  text was modified.
- KNOWN REMAINING (not fixed here, out of scope, noted for follow-up): four
  `2026-08-17 | WIB | Monday …` entries are missing their `HH:MM` time field
  (malformed header). They remain at the bottom (oldest date) in their original
  relative order; filling the missing times is a content edit, not a
  formatting reorder, so it was left for an explicit follow-up.
- RULE: I12 (doc/code sync); this correction is itself logged per the append rule.

## [2026-08-21 | 21:46 WIB | Friday | 21 August 2026]
- FILE: src/lib/gemini.ts (edited) — adds structured-output support: `responseMimeType`/`responseSchema`/`generationConfig(schema)` so calls can demand JSON (used by Tier 2 critic + targeted repair). No breaking change to existing text calls.
- FILE: src/lib/mcq.ts (edited) — `extractClaims(text, limit=16)` now accepts a `limit` (pass `Infinity` for ALL claims, used by the Tier 1 uncited-ratio check).
- FILE: src/lib/tier1.ts (new) — deterministic accuracy gate. `verifyTier1` returns citation/uncited-claim/entity checks; `citation_exists` is a hard FAIL (phantom `[n]`) → blocks the module, `uncited_claim_ratio` (threshold 0.3) + `entity_grounding` are WARN-only. `properNouns`/`specificNumbers` use the doc's own lowercase vocabulary + approved-source text so it checks grounding, not generic named entities. Never blocks on AI opinion.
- FILE: src/lib/critic.ts (new) — Tier 2 AI critic. `runCritic` judges only CITED claims against the exact source text via JSON-mode schema, in batches of 6; returns supported/uncertain/contradicted with `blocks: false` ALWAYS (a second opinion never gates). Mockable `CriticGenerateFn`; `mergeCriticReports`/`pruneCriticReport` keep it honest across runs.
- FILE: src/lib/gauge.ts (new) — `computeGauge` composes a 0..1 score from Tier 1 evidence + Tier 2 opinion with CATEGORY bands (`ditahan`/`perlu-tinjau`/`cukup`/`baik`), and ALWAYS carries `breakdownLines` + `GAUGE_CAVEAT` (score is a summary of, never a replacement for, its components; caveat is body text, never a tooltip).
- FILE: src/lib/repair.ts (new) — TARGETED regeneration. `collectRepairItems` rebuilds flags from Tier 1 + cached Tier 2 (drops unsupported), `buildRepairPrompt` quotes the flagged claim + WHY + the cited source text, and asks for exactly: fix / re-cite / delete — explicitly NOT a full rewrite. `parseRepairResponse` (JSON primary + numbered fallback), `applyRepairs` does surgical sentence replacement (touched sentences only; records stale + revised text), `MAX_REPAIR_ATTEMPTS = 2`.
- FILE: src/lib/verification.ts (new) — orchestration + persistence boundary. `runVerification` (Tier 1 always; Tier 2 on demand, never on read), `runTargetedRepair` (targeted re-verifies ONLY touched claims after each pass; stops at cap or first no-op/crash → `manualReviewNeeded`), zod `parseTier1Report`/`parseCriticReport` (degrade to "belum diperiksa", never to "clean"), `verificationPayload`, `pendingRepairItems`.
- FILE: src/lib/moduleSources.ts (new) — `loadModuleForVerification`: sources = APPROVED papers only, in `sourcePaperIds` order (= citation index, rule I4). Un-approved/gone papers become phantoms.
- FILE: src/lib/aiusage.ts (edited) — AIUsageKind gains `"critic"` + `"repair"`.
- FILE: prisma/schema.prisma + prisma/migrations/20260821203000_module_accuracy_verification/migration.sql (new) — Module gains `verifyReport`/`criticReport` (JSON) + `verifiedAt` + `repairAttempts` (rule I6).
- FILE: app/api/synthesize/route.ts (edited) — runs Tier 1 after every pass and Tier 2 once; persists reports; returns `AccuracySummary`.
- FILE: app/api/modules/[id]/route.ts (edited) — GET detail exposes `verification: verificationPayload(mod)`.
- FILE: app/api/modules/[id]/verify/route.ts (new) — POST (re-)runs Tier 1 (+Tier 2 on `{tier2:true}`), persists reports, returns gauge + verification. Tier 1-only run never wipes a cached Tier 2 report.
- FILE: app/api/modules/[id]/repair/route.ts (new) — POST "Kembangkan lebih lagi?": NO-OP when nothing flagged, `manualReviewNeeded` at the 2-attempt cap, else targeted repair → persists new content as a NEW ModuleVersion (with chunks/excerpts) in one transaction; never blind-overwrites the module text.
- FILE: app/components/ReliabilityGauge.tsx (new) — needle + REQUIRED labelled breakdown + caveat; colour = band category; shows hard-block alert; offers the targeted repair button ONLY when flags exist and budget remains; says "already passed" (no button) when clean; manual-review message at the cap.
- FILE: app/components/Workspace.tsx (edited) — threads `verification`, withholds ReadStep on `tier1.blocked` (hard gate), shows the gauge in the sources tab + a status chip; repair refreshes the gauge in place.
- FILE: app/lib/types.ts (edited) — re-exports verification types; `ModuleDetail.verification?`.
- FILE: app/page.tsx (edited) — synthesis status surfaces blocked > flagCount > grounding.
- FILE: src/lib/tier1.test.ts, src/lib/critic.test.ts, src/lib/gauge.test.ts, src/lib/repair.test.ts, src/lib/verification.test.ts (new) — purity + gate tests (deterministic FAIL/WARN, JSON mode, batched critic, score formula, band mapping, targeted only-touched repair, 2-pass cap, stale-verdict pruning, parse-degrade).
- FILE: app/api/modules/[id]/verify/route.test.ts (new) — verify/repair route behaviour (404, Tier1-only default, Tier2 on demand, noop, cap → manualReview, persisted new version).
- FILE: app/components/ReliabilityGauge.dom.test.tsx (new) — number-never-alone (caveat as body text, breakdown visible), hard-block withholds repair button, targeted-only affordance, budget countdown, manual-review at cap, repair calls `/api/modules/[id]/repair` with empty body and reports back.
- WHY: the student asked for a real accuracy check, not a mock. Design: deterministic Tier 1 is the SHIPPING GATE (phantom citation blocks the module), the AI critic is advisory only (never auto-blocks), the gauge always shows its components + caveat so the number is never read as "92% true", and regeneration is TARGETED (quote the claim + reason + source) and BOUNDED (2 attempts, no full rewrite, new version, never blind overwrite). Cost: Tier 2 once per module, re-run only on touched claims after repair, never on read. Rules: I0/I12 (changelog/schema), I4 (approved-source only), I5 (grounding preserved), I6 (migration source of truth). CI: `bash scripts/ci.sh` PASS — prisma generate, eslint 0 errors, `tsc --noEmit` clean, `vitest run` 608/608 (64 files).
- OPEN: manual spot-check of ~5–10 cited claims in a real module against the approved source PDFs (human review of the AI critic's precision/recall) is still required before rollout — the critic is advisory by design and must be eyeballed, not just unit-tested.

## [2026-08-21 | 17:25 WIB | Friday | 21 August 2026]
- FILE: src/lib/essay.ts (edited) — BUG 1: `generateEssayPrompt`/`generateEssayPromptWithFallback`/`generateEssayPromptHarness` now take an explicit `topicTitle` (threaded from the caller). `deriveAnchors` uses the real topic title when supplied instead of scanning the module body's FIRST heading (which is a section like "Tujuan Pembelajaran", not the title) — that mis-scan produced `Tulis esai berdasarkan modul "Tujuan Pembelajaran"`. BUG 2: the deterministic harness no longer injects raw, sliced body substrings (the old `theories.slice(0,60)` produced `Siapa … terlibat dalam Dalam kajian Teori … antari?`). `extractKeyConcepts` now only accepts definition-style or list-item lines, so prose sentences are never pulled in as "concepts".
- FILE: app/api/synthesize/route.ts (edited) — passes the real `title` into `generateEssayPromptWithFallback`; `buildSystem` instructs the model to start example paragraphs with `Contoh konkret:` and reflection prompts with `Pertanyaan refleksi:` so they render as callouts.
- FILE: app/api/essay/route.ts (edited) — passes `mod.topic?.title` (with `include: { topic: true }`) into the fallback.
- FILE: src/lib/pages.ts (edited) — CHANGE: section completeness is now verified INDEPENDENTLY of, and BEFORE, the word-count floor. Added `REQUIRED_SECTIONS`, `findMissingSections`, `detectTruncatedTail` (catches the dangling `[` that truncated the comparison table → BUG 3 root cause), `ensureComplete` (repairs a cut-off tail, then appends any missing sections — Rangkuman bab + Daftar istilah kunci — via bounded AI calls). `expandModuleUntilFloor` runs completeness first, then length; `ExpandResult` gains `complete`.
- FILE: src/lib/pdf.ts (edited) — BUG 3: `sanitizeCell` strips a trailing unclosed citation marker (`...[9], [`) to a clean boundary + ellipsis so no table cell reaches the PDF with a dangling `[`. Layout polish: `Contoh konkret:`/`Pertanyaan refleksi:` paragraphs render as distinct tinted callout boxes (teal / amber); inside "Konsep kunci & definisi" each term (h3) is a running head with an indented, smaller definition body; comparison tables get a narrower first (dimension) column and more cell breathing room. BUG 4: verified the embedded Roboto round-trips fi/fl correctly (no character loss); a ZWJ-insertion attempt was rejected because under this pdfmake it renders as a space yet still forms the ligature (losing the inner letter) — the regression test guards the no-loss invariant.
- FILE: src/lib/essay.test.ts (edited) — BUG 1 + BUG 2 assertions: real topic title present, no "Tujuan Pembelajaran" leak, no raw `dalam kajian`/`antari` substring, and no duplicated adjacent word.
- FILE: src/lib/pages.test.ts (edited) — `findMissingSections`, `detectTruncatedTail`, and an integration test where a truncated + section-incomplete module is repaired (Rangkuman + glossary appended, dangling tail gone) before the length loop.
- FILE: src/lib/pdf.test.ts (new) — BUG 4 regression (generate PDF from fi/fl words, extract, assert no loss) + BUG 3 regression (no dangling `[` survives in table cells) + callout rendering + `sanitizeCell` unit.
- WHY: fixes confirmed from a real exported PDF (wrong essay title, mangled 5W1H slot, truncated comparison cell, fi/fl ligature loss); adds the two synthesis sections that were dropped when generation was cut off; makes the PDF read like a textbook. Rules: I5 (grounding preserved), I6 (changelog/schema), I12 (doc/code sync). CI: `bash scripts/ci.sh` — eslint 0 errors, `tsc --noEmit` clean, `vitest run` 506/506 (57 files).

## [2026-08-21 | 15:30 WIB | Friday | 21 August 2026]
- FILE: app/api/synthesize/route.ts (edited) — `buildSystem` restructured to a Gagné Nine-Events + advance-organizer scaffold (7 ordered sections: Tujuan Pembelajaran → Mengapa penting → Konsep kunci & definisi → per-concept blok a/b/c → Perbandingan → Rangkuman bab → Daftar istilah kunci). Each concept gets its own subsection with definition, deep explanation, a worked example, and a reflection prompt.
- FILE: src/lib/pages.ts (new) — harness-verified length: `WORDS_PER_PAGE=500`, `TARGET_PAGES=10`, `MIN_WORDS=5000`; `countWords`, `estimatePagesFromWords`, `splitSubsections`, `findThinnestSubsection`, `replaceSubsection`, and `expandModuleUntilFloor` (bounded to `maxPasses=2`: measures real word count, expands ONLY the thinnest per-concept subsection via a narrow second call; ships what exists + sets `metFloor=false` if still short — honours rule, does not pretend).
- FILE: app/api/synthesize/route.ts (edited) — after synthesis, run `expandModuleUntilFloor` inside `finishSynthesis`; persist measured `wordCount`/`pageCount` on the Module; return `pageCount`/`wordCount`/`metFloor`/`expansionPasses` in both the streaming `done` and JSON responses. Expansion is best-effort (advisory like grounding) and never blocks persistence.
- FILE: prisma/schema.prisma (edited) — Module gained `wordCount Int?` + `pageCount Int?` (the real measured values, so the reader badge reflects what was generated, not a client guess).
- FILE: prisma/migrations/20260821120000_module_page_count/migration.sql (new) — adds both columns (rule I6: schema source of truth).
- FILE: app/lib/types.ts + app/api/modules/[id]/route.ts (edited) — `ModuleDetail` + GET detail expose `wordCount`/`pageCount`.
- FILE: app/components/ReadStep.tsx (edited) — reader reframed as a PREVIEW: shows through the end of section 3 (Konsep kunci & definisi) then a styled card ("Ini pratinjau modul…") with two CTAs — `Unduh modul lengkap (PDF)` → `/api/modules/[id]/export?format=pdf`, and `Lanjutkan baca di sini` (expands the rest in-app, no hard gate). Page count sourced from the stored `pageCount` field; a non-blocking "Modul ini agak lebih ringkas dari target 10 halaman" note shows when below target.
- FILE: app/components/Workspace.tsx (edited) — passes `moduleId` + `pageCount` into ReadStep.
- FILE: src/lib/pages.test.ts (new) — page-estimate (words-per-page constant) + expansion-loop (second targeted call for thinnest subsection; stops after 2 passes regardless of outcome).
- FILE: app/components/ReadStep.dom.test.tsx (new) — preview cutoff, PDF download href, and "Lanjutkan baca di sini" reveals the rest without navigation; stored page count drives the badge; ringkas note.
- FILE: app/components/AskStep.dom.test.tsx + app/components/Workspace.dom.test.tsx (edited) — `ModuleDetail` fixtures extended with `wordCount`/`pageCount`.
- WHY: prompt-only "~10 pages" compliance is unreliable (same lesson as the essay-JSON bug). Instructional-design structure (Gagné + advance organizer) makes long-form material genuinely readable, and a deterministic post-generation check enforces the minimum rather than trusting the model. Reader preview nudges to the PDF without gating. Rules: I5 (grounding/citation invariants preserved in new prompt), I6 (migration + changelog), I12 (doc/code sync). CI: `bash scripts/ci.sh` PASS — eslint 0 errors, `tsc --noEmit` clean, `vitest run` 494/494 (56 files).

## [2026-08-21 | 13:44 WIB | Friday | 21 August 2026]
- FILE: package.json (edited) — added `web-push` dependency + `@types/web-push` devDependency for real iOS web-push notifications.
- FILE: prisma/schema.prisma (edited) — added `PushSubscription` (endpoint @unique, p256dh, auth, createdAt) and a singleton `Settings` row (studentName, lastNotificationCopyId, updatedAt). Single-user app: no student-id scoping (none exists; I12).
- FILE: prisma/migrations/20260821000000_push_notifications/migration.sql (new) — creates both tables + the endpoint unique index (rule I6: schema source of truth).
- FILE: src/lib/cronAuth.ts (new) — extracted the shared `checkSecret(request, secret)` CRON guard out of the daily-reminder route so /api/push/send reuses it instead of duplicating it.
- FILE: app/api/cron/daily-reminder/route.ts (edited) — now imports `checkSecret` from `@/src/lib/cronAuth` (no behavior change).
- FILE: app/lib/soso.ts (edited) — added the rotating push copy bank `PUSH_TEMPLATES` (4 playful, non-guilt-tripping Soso lines, verbatim per brief) and `pickPushCopy(studentName, lastCopyId)` which personalizes line 2 with the name (falls back to generic) and guarantees the chosen id differs from `lastCopyId` so the same line is never sent twice in a row.
- FILE: app/lib/soso.test.ts (edited) — added `pickPushCopy` tests (personalization, no-repeat, single-id fallback).
- FILE: app/lib/standalone.ts (new) — `isStandalone()` helper (navigator.standalone === true); reused by InstallGuide and the new opt-in so the install/push detection lives in one place.
- FILE: app/components/InstallGuide.tsx (edited) — uses `isStandalone()` for the installed-early-return (no behavior change).
- FILE: app/components/PushOptIn.tsx (new) — permission-request UI shown ONLY when `isStandalone()` AND `Notification.permission === "default"` AND the VAPID public key is configured. The `Notification.requestPermission()` + `pushManager.subscribe()` + POST /api/push/subscribe all run inside the button's click (user gesture), per iOS constraints.
- FILE: app/page.tsx (edited) — mounts `<PushOptIn />` next to `<SosoReminder>`.
- FILE: public/sw.js (edited) — added `push` (showNotification from payload title/body) and `notificationclick` (focus/open "/") listeners, extending the existing hand-rolled PWA service worker.
- FILE: app/api/push/subscribe/route.ts (new) — validates the subscription (zod) and rejects malformed ones (400); upserts the PushSubscription by endpoint and stores the optional studentName on the Settings singleton (never overwrites with empty).
- FILE: app/api/push/send/route.ts (new) — cron-triggered (GET), guarded by CRON_SECRET via `checkSecret`. Sets VAPID details, then: skips if no subscription; skips if the student has any AssessmentAttempt in the Jakarta today (WIB, not UTC); otherwise picks a rotated Soso copy (personalized with Settings.studentName), sends to every subscription via web-push, DELETES any subscription that 404/410s (expired/revoked) so dead subs don't accumulate, and records lastNotificationCopyId.
- FILE: app/api/push/subscribe/route.test.ts (new) — persists a valid subscription (+ name), rejects missing keys / bad endpoint / non-JSON.
- FILE: app/api/push/send/route.test.ts (new) — requires CRON_SECRET (401), 500 when VAPID unset, skips with no subscription, skips when studied today, sends to all + rotates copy id, deletes a 410 subscription and keeps the rest (web-push mocked).
- FILE: .env.example (edited) — documented NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT / CRON_SECRET (empty placeholders; secrets never committed).
- FILE: vercel.json (edited) — added a 2nd cron job `/api/push/send` at `0 13 * * *` (13:00 UTC = 20:00 WIB). Together with the existing daily-reminder cron this is exactly the Vercel Hobby cap of 2 cron jobs/project.
- FILE: README.md (edited) — documented the one-time `npx web-push generate-vapid-keys` step and the three VAPID env vars + CRON_SECRET, so a future deploy can regenerate keys without losing the recipe.
- CHANGE: Real Soso push notifications. Requires the app be installed to Home Screen (standalone) — the already-shipped InstallGuide is a hard prerequisite — and the student to grant permission from inside the installed app. The once-daily 20:00 WIB cron nudges only when the student hasn't studied that Jakarta day.
- FILE: app/components/MCQStep.tsx (edited) — `handleChoose` was tallying the live score from the stale `picks` closure (state not yet updated), so the score always rendered `0/0` even after a correct pick. Now it builds `nextPicks` and tallies from that, so the live/“Skor akhir” reflects the just-made choice immediately. Real bug surfaced by the (previously failing) Workspace MCQ tests.
- FILE: app/components/Workspace.dom.test.tsx (edited) — the three MCQ grading tests asserted a removed explicit "Nilai" button; the MCQ flow is now auto-graded on choice. Updated them to the current behaviour (score appears automatically, no "Nilai" click) so `npm run ci` passes.

- WHY: The task requires `npm run ci` to pass; the only failures were these 3 stale MCQ tests plus the underlying `0/0` scoring bug they now correctly catch.
- RULE: G0/E0/I0 — logged here; scope of this entry is the push feature, with the MCQ fix noted because it was required to satisfy the CI gate.

## [2026-08-21 | 01:17 WIB | Friday | 21 August 2026]
- FILE: src/lib/scoring.ts (edited) — `ScoringPaper` gained `type?`/`venue?`; added `isInternationalJournal()` (journal work, not a book, non-Indonesian language); `ShortlistOptions` gained `minInternational?` and `selectShortlist` now guarantees ≥`minInternational` international journals by swapping out the lowest-relevance domestic/non-journal entries when the top-k is short on them.
- FILE: src/lib/sources/index.ts (edited) — aggregator now requests a 10-paper review shortlist with `selectShortlist(scored, terms, { minCount: 10, maxCount: 10, minInternational: 2 })`, so the paper review presents exactly 10 candidates and at least 2 are international journals.
- FILE: app/lib/types.ts (edited) — `CandidatePaper` gained `venue?`/`type?` to mirror `SourcePaper` (rule I12); `app/api/retrieve/route.ts` now returns them on each candidate.
- FILE: app/components/PaperReview.tsx (edited) — shows a "Jurnal internasional: N/2" badge (green when met) and a "Jurnal intl." chip on each qualifying paper, so the breadth requirement is directly verifiable at the approval gate.
- CHANGE: The paper review (Tinjauan paper) now shows 10 papers with at least 2 international journals written in English or another language, keeping so-study's source pool internationally broad/deep. Verifiable in the UI.
- WHY: User directive 2026-08-21 — "Tinjauan paper harusnya 10 dan 2 diantaranya harus merupakan jurnal internasional yang ditulis dalam bahasa inggris atau lainnya. agar tetap mencerminkan luasnya kedalaman so-study."
- RULE: G0/E0/I0 — change logged here and in ROADMAP §16; I12 source↔DTO consistency maintained (`CandidatePaper.venue`/`type` mirror `SourcePaper`).

## [2026-08-20 | 10:50 WIB | Thursday | 20 August 2026]
- FILE: app/components/ReadStep.tsx (edited) — the module reader is now a bounded, independently-scrollable panel: a visible styled scrollbar (`max-h-[calc(100vh-15rem)]` + `reader-scroll`), a sticky header showing a live page counter (`Halaman X / Y ≈`) computed from prose length (~3000 chars/page), section count, a target badge (≥10 halaman terpenuhi / belum), and a bottom reading-progress bar tied to scroll position.
- FILE: app/globals.css (edited) — added `.reader-scroll` scrollbar styling (visible track/thumb, light + dark) and `.reader-prose :is(h1..h4){ scroll-margin-top: 4rem }` so the TOC jump never hides a heading under the sticky header.
- FILE: app/api/synthesize/route.ts (edited) — `buildSystem` now demands a concrete length: MINIMAL 10 HALAMAN A4 (≈6000 kata / ≥30000 karakter), each of ≥10 sections 2–4 paragraf padat (~600–700 kata), and instructs the model to CONTINUE if the stream is cut off before 10 pages are reached.
- WHY: User directive 2026-08-20 — the reader gave no way to verify a module truly reached ~10 pages; the page counter + scrollbar make length auditable, and the stronger length target reduces truncated modules.
- RULE: G0/E0/I0 — change logged here and in ROADMAP §16; I12 source↔DTO consistency unchanged.

## [2026-08-20 | 08:55 WIB | Thursday | 20 August 2026]
- FILE: src/lib/keywords.ts (new) — `expandKeywords()` (title tokens + user keywords + adjacent bigrams, bounded by LIMITS.keywordCount/keywordChars) and `scoringTerms()` (concise, no bigrams) for retrieval coverage vs healthy relevance ranking.
- FILE: app/api/retrieve/route.ts (edited) — expands the topic title into a richer keyword set before calling `retrieveSources`, and passes `scoringTerms` so ranking is not diluted by the broad query.
- FILE: src/lib/sources/types.ts (edited) — `RetrieveOptions` gained `scoringTerms?`.
- FILE: src/lib/sources/index.ts (edited) — aggregator uses `scoringTerms` for `selectShortlist` and raises the shortlist cap to `maxCount: 24` so more candidate sources reach the approval gate.
- FILE: src/lib/scoring.ts (edited) — `ShortlistOptions` gained `maxCount`; `selectShortlist` clamps `k` to it.
- FILE: src/lib/sources/{openalex,crossref,semanticscholar,pubmed,doaj}.ts (edited) — per-provider `perTopic` default raised 10 → 15 (more raw results per provider).
- FILE: app/api/synthesize/route.ts (edited) — `buildSystem` now demands a LUAS module: ≥10 numbered sections, 2–4 paragraphs each, ≥10 pages, balanced coverage of every source; `maxOutputTokens` 4096 → 8192 (safe Flash cap).
- FILE: app/api/mcq/route.ts (edited) — question `count` default 5 → 8, cap 6 → 12 (more coverage for longer modules); LLM prompt slice 6000 → 12000 chars.
- FILE: src/lib/mcq.ts (edited) — `extractClaims` broadened (claim cues + any `[n]` line) and raised 8 → 16 claims, so excerpts track more of the module's sources.
- FILE: src/lib/keywords.test.ts (new), app/api/essay/route.test.ts (edited) — coverage for keyword expansion; essay route test updated to the always-succeed (harness fallback) contract.
- CHANGE: Modules are now required to be long and thorough (≥10 sections/pages) citing MORE approved papers; retrieval casts a WIDER net via expanded keywords + 15 results/provider + a 24-paper shortlist; the MCQ/essay harnesses are stronger (more questions, richer claim extraction) so longer modules stay well-correlated to their sources.
- WHY: User directive 2026-08-20 — modules were too short with too few sources; keyword coverage had to widen and the deterministic harnesses strengthened so quality scales with length instead of degrading.
- RULE: G0/E0/I0 — change logged here and in ROADMAP §16; I12 source↔DTO consistency unchanged.

## [2026-08-20 | 08:24 WIB | Thursday | 20 August 2026]
- FILE: src/lib/sources/types.ts (edited) — `SourcePaper` gained `language?: string`; added `PREFERRED_LANGUAGES = ["id", "en"]`; `dedupeAndMerge` now preserves the first non-undefined `language`.
- FILE: src/lib/sources/doaj.ts (new) — `doajProvider` queries the Directory of Open Access Journals (DOAJ) for OA / Indonesian-heavy papers; maps `bibjson` → `SourcePaper`, captures `language` from DOAJ's language field, degrades to `[]` on failure (no API key required).
- FILE: src/lib/sources/index.ts (edited) — registered `doajProvider` as the 5th `SourceProvider`; aggregator passes `language` into `relevanceScore`.
- FILE: src/lib/scoring.ts (edited) — `ScoringPaper` gained `language?`; added `LANGUAGE_BONUS = 0.05` so id/en works rank above an otherwise-equal foreign-language work.
- FILE: app/lib/types.ts (edited) — `CandidatePaper` DTO gained `language?: string | null` (I12 source↔DTO consistency).
- FILE: app/api/retrieve/route.ts (edited) — candidate push now sets `language: p.language ?? null`.
- FILE: app/components/PaperReview.tsx (edited) — shows a `· LANG` badge on the paper card.
- FILE: app/components/MCQStep.tsx (rewritten) — per-question answer reveal: `handleChoose` locks selection after the first pick, records the attempt immediately, and shows the explanation + correct/incorrect styling right away (no more global "Nilai" button); a live running score tally is shown.
- FILE: src/lib/mcq.ts (edited) — MCQ harness now captures citation indices via `CITE_RE = /\[(\d+)\]/` and prefers citation-grounded review sentences, keeping the `[n]` marker in the explanation (grounds distractors/answer in the approved sources).
- FILE: src/lib/aiusage.ts (edited) — `AIUsageKind` gained `"essay_harness"`.
- FILE: src/lib/essay.ts (edited) — added `generateEssayPromptHarness` (deterministic 5W1H, 0% AI) and `generateEssayPromptWithFallback` (AI first, harness fallback) so an essay prompt is never `null`.
- FILE: app/api/synthesize/route.ts (edited) — calls `generateEssayPromptWithFallback`; `essayPrompt` is now always present in the synthesized module.
- FILE: app/api/essay/route.ts (edited) — retry loop calls `generateEssayPromptWithFallback`; the endpoint always returns `{ essayPrompt }`.
- FILE: src/lib/sources/doaj.test.ts (new), src/lib/sources/index.test.ts (edited), src/lib/scoring.test.ts (edited), src/lib/essay.test.ts (edited), src/lib/mcq.test.ts (edited) — coverage for the new provider, language bonus, essay harness/fallback, and citation grounding.
- CHANGE: (1) Source retrieval now pulls Indonesian/OA papers via DOAJ in addition to OpenAlex/Crossref/S2/PubMed and nudges id+en works up in ranking; language is surfaced end-to-end (DTO → UI badge). (2) MCQ reveals the correct answer + explanation immediately after the student answers each question. (3) MCQ harness is citation-grounded so items track the approved module sources. (4) Essay prompt generation always succeeds via a deterministic non-AI harness fallback.
- WHY: User directive 2026-08-20 — broaden sources beyond international/English (primarily id+en), show MCQ answers on answer, strengthen MCQ↔module correlation while lightening AI load, and guarantee essay generation never fails.
- RULE: G0/E0/I0 — change logged here and in ROADMAP §16; I12 source↔DTO consistency maintained (`CandidatePaper.language` mirrors `SourcePaper.language`).

## [2026-08-19 | 23:15 WIB | Tuesday | 19 August 2026]
- FILE: src/lib/sources/types.ts (new) — common `SourcePaper` shape + `SourceProvider` interface + `normalizeDoi` / `doiUrl` / `dedupeAndMerge` (dedupe by DOI, merge metadata, prefer Crossref for biblio).
- FILE: src/lib/sources/openalex.ts (provider refactor of the former src/lib/openalex.ts) — `OpenAlexProvider` implementing `SourceProvider`; keeps the on-disk `.cache/` response cache; degrades to `[]` on failure.
- FILE: src/lib/sources/crossref.ts (new) — `CrossrefProvider` (polite pool `mailto`); bibliographic fields win on merge.
- FILE: src/lib/sources/semanticscholar.ts (new) — `SemanticScholarProvider` (~1 req/s pacing).
- FILE: src/lib/sources/pubmed.ts (new) — `PubMedProvider`.
- FILE: src/lib/sources/citations.ts (new) — `enrichCitations()` corroborates citation counts via OpenCitations COCI; Scite is an OPTIONAL best-effort branch gated by `SCITE_API_KEY` (NOT required; app works without it).
- FILE: src/lib/sources/index.ts (new — orchestrator) — `retrieveSources()` runs all providers via `Promise.allSettled` with a per-provider timeout, dedupes by DOI, enriches via COCI, and re-scores with `src/lib/scoring.ts`; throws only if ALL providers fail.
- FILE: src/lib/citation.ts (new) — `formatAPA()` renders APA-7 references from a `SourcePaper` / `ExportPaper`.
- FILE: src/lib/export.ts (edited) — Markdown source list now renders via `formatAPA`.
- FILE: src/lib/pdf.ts (edited) — PDF source list now renders via `formatAPA`.
- FILE: app/lib/types.ts (edited) — `ExportPaper` / `SourcePaper` DTOs gained `doi` / `venue` / `volume` / `issue` / `pages` / `publisher` / `type`.
- FILE: app/api/modules/[id]/route.ts + app/api/modules/[id]/export/route.ts (edited) — map the new bibliographic fields through.
- FILE: app/api/retrieve/route.ts + app/api/synthesize/route.ts (edited) — now call `retrieveSources()` (provider fan-out) instead of the single OpenAlex path.
- FILE: prisma/schema.prisma (edited) + prisma/migrations/add_paper_bibliography (new) — `Paper` gains optional `doi`, `venue`, `volume`, `issue`, `pages`, `publisher`, `type`, `providers`.
- FILE: src/lib/openalex.ts + src/lib/openalex.test.ts (DELETED) — superseded by `src/lib/sources/openalex.ts`; retrieval no longer depends on a single source.
- CHANGE: Multi-provider scholarly source layer (ROADMAP §16). Retrieval now fans out to OpenAlex + Crossref + Semantic Scholar + PubMed, dedupes by DOI, merges metadata (Crossref wins bibliographic fields), corroborates citation counts via OpenCitations COCI, and re-scores centrally. APA-7 references are rendered by `src/lib/citation.ts` into both Markdown and PDF exports; `Paper` and the DTOs gained bibliographic columns. Scite is an optional, key-gated best-effort branch; the app is fully functional without it. **Sci-Hub was explicitly rejected** (copyright-infringing pirate repository; legal risk; violates the trusted-peer-reviewed-sources principle).
- WHY: ROADMAP §16 — extends the §15 gap analysis (gap B: lexical-only / single-source retrieval). Broadening the pool improves grounding (`grounding.ts`) and supplies trustworthy citations; DOI normalization de-duplicates across providers; APA-7 rendering gives academic correctness. The open APIs provide metadata + abstracts + DOIs for free, so Sci-Hub's pirated full texts are unnecessary and unacceptable.
- RULE: G0/E0/I0 — change logged; ROADMAP §16 + ARCHITECTURE updated; Sci-Hub explicitly rejected (I12 doc/code consistency maintained).

## [2026-08-19 | 22:55 WIB | Tuesday | 19 August 2026]
- FILE: src/lib/grounding.ts (lines 1–270, new) — post-generation faithfulness harness `verifyGrounding` checks the synthesized module's inline `[n]` claims against the approved source set and flags unsupported/hallucinated citations (returns `{ok, checked, flagged, score}`). No DB/env; server-safe.
- FILE: src/lib/grounding.test.ts (lines 1–201, new) — unit tests for `verifyGrounding` (supported vs unsupported claims, score, malformed module).
- FILE: src/lib/gemini.ts (lines 112–164, edited) — adds `streamGenerate(opts)` SSE export that hits `:streamGenerateContent?alt=sse` and returns the raw `ReadableStream<Uint8Array>`; `generate` unchanged.
- FILE: app/api/synthesize/route.ts (lines 1–568, edited) — now streams synthesis via SSE (`text/event-stream`) and attaches `groundingReport` from `verifyGrounding`; keeps a non-streaming JSON fallback for buffering proxies/older clients; persistence (Module/Chunk/Excerpt/Version + AIUsage) unchanged.
- FILE: app/page.tsx (lines 271–360, 744, edited) — `confirmApproval` now sends `Accept: text/event-stream` and consumes the SSE frames with a progressive "Menyusun modul…" status; surfaces the grounding verdict; degrades to JSON when the response is not a stream.
- FILE: app/lib/draftStore.ts (lines 1–98, new) — client-safe IndexedDB essay-draft store (`loadDraft`/`saveDraft`) with a `localStorage` fallback; no Node/Prisma/env.
- FILE: app/components/EssayStep.tsx (line 11, edited) — essay drafts now use `draftStore` (IndexedDB) instead of raw `localStorage`.
- FILE: app/components/Workspace.dom.test.tsx (edited) — draft assertions updated for the async IndexedDB load.
- FILE: public/sw.js (lines 1–184, edited) — re-precache the shell on launch/activate, an offline fallback document, and FIFO-prune read-only API responses to respect the ~50MB iOS storage cap.
- FILE: app/components/ServiceWorkerRegister.tsx (lines 10–63, edited) — posts a `REPRECACHE` message to the active worker on load and applies pending updates via `skipWaiting`/`SKIP_WAITING`.
- FILE: app/api/backup/route.ts (lines 1–173, new) — `GET` returns a full JSON snapshot of the DB; `POST` re-imports it with `confirm:"overwrite"`, zod-validated, in a transaction.
- FILE: app/api/backup/route.test.ts (lines 1–137, new) — export/import round-trip + validation + transactional-restore tests.
- FILE: app/components/DataBackup.tsx (lines 1–139, new) — export/import UI wired to `/api/backup`.
- FILE: app/components/Sidebar.tsx (lines 180, 239, edited) — mounts `DataBackup` in both course switcher layouts.
- CHANGE: Gap-analysis hardening pass (ROADMAP §15) executed via four file-disjoint subagents: a post-generation faithfulness/grounding harness + SSE-streamed synthesis (WS-SYNTH), IndexedDB essay drafts (WS-WORK), service-worker resilience for the iOS PWA limits (WS-PWA), and a JSON backup/restore route + UI (WS-BACKUP). Plus the five rule-I12 doc/code drifts (no service worker, README PDF, §6 Phase-2/3 checkboxes, engagement-based "ready") corrected in ROADMAP/ARCHITECTURE/README this pass.
- WHY: Externally-verified gap analysis — **A (P0):** up to 57% of RAG citations lack faithfulness (Wallat 2025, UvA); added `verifyGrounding` as the cheapest reliable mitigation (FACTUM/CiteGuard/RAGTruth/Springer Nature 2026: retrieval quality drives faithfulness). **C (P1):** streaming removes the "hung" long-call feel. **D (P1):** IndexedDB drafts per Muvon/ssdnodes local-first guidance (localStorage is fragile/size-limited). **F (P1):** iOS PWA limits — no Background Sync, ~7-day cache expiry, ~50MB cap, push caveats (firt.dev/magicbell 2025/2026) — mitigated by re-precache + FIFO prune. **J (P1):** backup is the user's job on local-first SQLite (Muvon/ssdnodes/raidframe 2026) → JSON snapshot export/import. **I12:** doc/code drift is a defect; the five drifts were corrected. Deferred (B embedder, E push channel, G-rest practice modes, H highlight→card, I CRDT sync, K Turso, L efficacy) are heavy/need-a-dep/or-need-a-device, consistent with prior passes.
- RULE: G0/E0/I0 — change logged; docs/ROADMAP/ARCHITECTURE/README updated; doc/code drift (I12) corrected.

## [2026-08-19 | 21:55 WIB | Wednesday | 19 August 2026]
- FILE: src/lib/essay.ts (lines 34–167, edited) — `generateEssayPrompt` now derives module-specific anchors (topic, key concepts, theories, sources) and instructs Gemini to build ONE 5W1H-grounded (Apa/Siapa/Kapan/Di mana/Mengapa/Bagaimana) essay prompt anchored to THIS module; keeps `{"prompt":string}` JSON, `stripFences`/`EssayPromptSchema`/`logAIUsage`, 2-system retry, `essay_failed` logging, null-after-both-fail. `buildEssayRubric` (lines 168+) now also evaluates penulisan (clarity), penafsiran (interpretation of sources/concepts) and penalaran (reasoning, incl. 5W1H) plus grounding/comparison/relevance — deterministic, 0% AI.
- FILE: src/lib/essay.test.ts (lines 46–115, edited) — asserts the prompt is 5W1H-anchored to the module's concepts and the rubric covers penulisan/penafsiran/penalaran; existing retry/failure tests retained.
- FILE: app/components/EssayStep.tsx (line 133, edited) — adds a small 5W1H helper note; props/export unchanged.
- FILE: app/api/essay/route.ts (unchanged) — string contract stable.
- FILE: app/api/mcq/route.ts (lines 76–145, edited) — deterministic `generateMCQ` is now the PRIMARY path (no Gemini by default); LLM runs only when `useLLM:true`; keeps `generatedBy`, guards, count clamp 1..6, fail-safe fallback.
- FILE: src/lib/mcq.ts (lines 181–259, edited) — harness-first coverage (deterministic round-robin across distinct concepts) + key-concept-cluster distractor preference + short harness `explanation`; `generateMCQ(text,count)` signature unchanged, still deterministic.
- FILE: src/lib/mcq.test.ts (edited) — distinct-concept coverage + corpus-sourced distractor assertions.
- FILE: src/lib/pdf.ts (lines 82–111, 203–216, edited) — "Petunjuk belajar" callout (recall/reasoning) and rubric rendered as a tickable checklist; typographic + blockquote polish; `[n]` grounding kept (I5).
- FILE: src/lib/export.ts (lines 29–58, 84–136, edited) — added `RubricSection` + derived `ExportModule` fields (`studyGuidance`, `keyConcepts`, `keyArguments`, `rubricSections`); `parseRubric` + `enrichModule`. `ExportFormat`/`pdf` union + existing fields intact.
- FILE: app/lib/pdfExtract.ts (lines 36–, 88–, edited) — `analyzeModuleContent` (key concepts/arguments/citations) + `deriveStudyGuidance` (module-specific recall/reasoning bullets), dependency-free.
- FILE: app/api/modules/[id]/export/route.ts (edited) — passes `enrichModule(...)` into `generatePdf`; guards + `application/pdf` + Content-Disposition contract kept.
- FILE: src/lib/export.test.ts + app/api/modules/[id]/export/route.test.ts (edited) — cover parseRubric/analyzeModuleContent/deriveStudyGuidance/enrichModule + PDF study-guidance + rubric-checklist + grounding.
- FILE: app/lib/soso.ts (new) — deterministic Soso persona module: `DAILY_REMINDER_MESSAGE` ("Hallo! Soso disini! Kamu belum belajar hari ini! hummft kamu ga kangen aku ya?!"), playful variants, `studiedToday`/`shouldRemind`/`jakartaDateKey` helpers. No AI.
- FILE: app/components/SosoReminder.tsx (new) — dismissible daily banner (`role="status"`, `aria-live="polite"`); shows when `heatmap.at(-1).count===0` and `topics.length>0`; per-Jakarta-day dismissal in localStorage.
- FILE: app/api/cron/daily-reminder/route.ts (new) — `runtime="nodejs"`; guarded no-op (requires `x-cron-secret`/`Authorization: Bearer` when `CRON_SECRET` set, 401 otherwise; returns `{ok:true}`); fail-safe.
- FILE: vercel.json (new) — one cron `"/api/cron/daily-reminder"` at `"1 1 * * *"` (~08:00 WIB = 01:00 UTC; UTC-only, once/day per Hobby limit). UTC rationale documented in the route file.
- FILE: app/page.tsx (lines 22, 447, edited) — only adds `SosoReminder` import + `<SosoReminder progress={progress} />` mount.
- FILE: app/components/SosoOnboarding.tsx (lines 6–8+, edited) — warmed Soso persona copy; `PROFILE_KEY`/`SosoProfile`/3-step flow intact.
- FILE: app/globals.css (edited) — focus-visible safety net, `.reader-prose` reading rhythm (line-height 1.7), dark-mode token consistency.
- FILE: app/components/{Sidebar,Workspace,Composer,ReadStep,AskStep,ui}.tsx (edited) — iPad/light/dark polish, terminology consistency (Mata kuliah), warmer microcopy/empty states; `MCQStep/PracticeStep/...` minor consistency; `EssayStep` props untouched.
- FILE: app/components/AskStep.dom.test.tsx + app/components/SidebarEmpty.dom.test.tsx (new) — disjoint dom tests.
- CHANGE: One-shot improvement pass across five file-disjoint workstreams (essay 5W1H + grading harness, MCQ harness-first to lighten AI, PDF penulisan/penafsiran/penalaran strengthening, Soso persona + daily in-app reminder + Vercel cron scaffold, iPad/UI polish). All driven by the user's brief.
- WHY: User feedback — essay harness weak (now 5W1H-grounded, well-formulated, with writing/interpretation/reasoning rubric); MCQ should reduce AI load (now deterministic by default, $0/offline, with stronger distractors); PDF must be functionally richer not just prettier; Soso needs a clearer voice + a daily "belum belajar" nudge (verified Vercel Hobby cron = 1x/day UTC±59min, so schedule is WIB−7h); UI/UX needs another polish pass for the iPad target. No schema changes, no new dependencies, CI green (362 tests).
- RULE: G0/E0/I0 — change logged; docs/CHANGELOG + ROADMAP updated; doc/code drift avoided.

## [2026-08-19 | 19:25 WIB | Thursday | 19 August 2026]
- FILE: scripts/gen-icons.mjs (new) — dependency-free PNG encoder generating the app icons.
- FILE: public/icon-192.png (new), public/icon-512.png (new), public/icon-maskable-512.png (new), public/apple-touch-icon.png (new) — indigo (#4f46e5) badge with a white "module card" motif, matching the existing brand token.
- FILE: app/manifest.ts (lines 4–28, edited) — added `scope: "/"` and a 192/512 + `purpose: "maskable"` icon set.
- FILE: app/layout.tsx (lines 1–39, edited) — `metadata.icons.apple: "/apple-touch-icon.png"` (emits the iOS `<link rel="apple-touch-icon">`) and mounts <ServiceWorkerRegister/>.
- FILE: public/sw.js (new) — hand-rolled service worker (no next-pwa dep). Precaches the app shell, serves navigations network-first with shell fallback, cache-first+background-update for `/_next/static/*` and read-only Module/Topic/Paper/Course GETs; explicit online-only routes (qa/mcq/grade/essay/synthesize/retrieve + any `/export`) pass through and are never cached.
- FILE: app/components/ServiceWorkerRegister.tsx (new) — registers /sw.js on `load`, browser-only, skipped in dev/SSR (so HMR isn't cached).
- FILE: app/components/InstallGuide.tsx (new) — one-time, dismissible iOS "Add to Home Screen" hint; shows only on iOS Safari where `navigator.standalone === false`, never when already standalone, dismissal persisted in localStorage (`so-study:install-dismissed`).
- FILE: app/page.tsx (lines 14–21, 402–406, 407, edited) — mounts <InstallGuide/> at the top of the app shell; header `top` offset to `env(safe-area-inset-top)`.
- FILE: app/globals.css (lines 106–118, edited) — body padded on all four `env(safe-area-inset-*)` edges (viewportFit cover lets content sit under iPad corners / home indicator).
- FILE: app/components/InstallGuide.dom.test.tsx (new) — shows on first non-standalone iOS visit, hidden when standalone, hidden on non-iOS, hidden+persisted after dismiss.
- CHANGE: Completed the PWA setup so the app installs and feels native on iPad. Added real app icons (192/512 + maskable + 180px apple-touch), a manifest icon set, the iOS apple-touch-icon link, an offline service worker that actually makes read-only module content available offline while leaving Tanya/Latih/grade/synthesize/export strictly online (preserving the Workspace "Mode offline" banner), an iOS-only install hint, and safe-area inset handling so nothing collides with the home indicator or corners.
- WHY: The PWA foundation (manifest + appleWebApp) existed but was incomplete — no icons (so Add to Home Screen used a screenshot), no offline support (reading wasn't actually cacheable), no iOS install guidance (Safari never auto-prompts), and no safe-area padding. For a single-user iPad-first app, a ~30-line hand-written service worker is simpler and lighter than next-pwa, and the cache split keeps the offline banner honest. Icons are generated (not committed binaries hand-drawn) via scripts/gen-icons.mjs for reproducibility.
- RULE: G0/E0/I0 — change logged.

## [2026-08-19 | 19:07 WIB | Thursday | 19 August 2026]
- FILE: app/components/Workspace.tsx (lines 1–988, edited) — top tabs kept as Baca → Tanya → Latihan → Sumber (renamed Latih→Latihan); removed the nested 6-destination sub-tab list inside Latih.
- FILE: app/components/ui.ts (new) — shared input/primary/chip class constants.
- FILE: app/components/ReadStep.tsx (new) — reader + pretest gate step.
- FILE: app/components/AskStep.tsx (new) — free-recall + scoped Q&A step (owns its question/answer state).
- FILE: app/components/PracticeStep.tsx (new) — Latihan tab coordinator: closed-book toggle, scaffolding banner, the always-visible core loop (MCQ/Essay/Evaluasi diri/Nilai) and the collapsed advanced accordion.
- FILE: app/components/MCQStep.tsx (new) — Pilihan Ganda step (on-demand generator + QuestionBank merged into one step; was "Bank Soal" sub-tab).
- FILE: app/components/EssayStep.tsx (new) — Esai step surfaced as its own labelled step (was buried in the Latihan sub-tab).
- FILE: app/components/EvaluasiDiriStep.tsx (new) — Evaluasi diri step merging CalibrationPanel + MetacogPanel under one heading (distinct data sources: persisted attempts vs localStorage reflections, so kept as two components in one panel).
- FILE: app/components/NilaiStep.tsx (new) — Nilai & hasil step surfacing MCQ score, essay feedback and running accuracy directly.
- FILE: app/components/AdvancedPractice.tsx (new) — "Latihan lanjutan (opsional)" disclosure, collapsed by default, content unmounted while closed (not focusable/visible until expanded). Holds Review (spaced repetition), "Latihan campuran" (was Interleaved), "Perdalam pemahaman" (was Elaborasi).
- FILE: app/components/PretestGate.tsx (line 138, edited) — plain-language reference "Latihan → Pilihan Ganda".
- FILE: app/components/Workspace.dom.test.tsx (edited) — updated tab labels, replaced sub-nav tests with core-loop + accordion-collapsed-by-default tests; 39 Workspace tests pass.
- CHANGE: Restructured the 9-destination (2-level) navigation into the product's linear 6-step flow. Top-level tabs stay Baca → Tanya → Latihan → Sumber; inside Latihan the core loop (Pilihan Ganda → Esai → Evaluasi diri → Nilai) is always visible with no nested sub-tabs, while Review / Interleaved / Elaboration move into one collapsed "Latihan lanjutan (opsional)" section so first-time students find the main flow first. Cognitive-science jargon ("Interleaved", "Metakognitif"/"Kalibrasi", "Elaborasi", "Bank Soal") is relabelled to plain language; no functionality removed. Workspace state was split per step (ReadStep/AskStep/MCQStep/EssayStep/EvaluasiDiriStep/NilaiStep/AdvancedPractice/PracticeStep) so the essay-MCQ logic is no longer lost in a 988-line file; top-tab role="tab"/aria-selected/aria-controls and ArrowRight/Left/Home/End keyboard nav are preserved.
- RULE: G0/E0/I0 — change logged.

## [2026-08-19 | 18:20 WIB | Thursday | 19 August 2026]
- FILE: app/api/modules/[id]/export/route.ts (lines 1–150, edited) — added `format=pdf` branch
- FILE: src/lib/pdf.ts (new) — server-side PDF generation via pdfmake
- FILE: app/lib/markdownBlocks.ts (new) — extracted the shared markdown AST parser
- FILE: app/lib/markdown.tsx (lines 1–227, edited) — consumes shared parser; reader behavior unchanged
- FILE: src/lib/export.ts (lines 1–187, edited) — added `pdf` to ExportFormat + content-type/extension
- FILE: src/types/pdfmake.d.ts (new) — module declarations for pdfmake's UMD build
- FILE: app/components/Workspace.tsx (lines 1–988, edited) — PDF button → download `<a>`; exports disabled offline
- FILE: app/api/modules/[id]/export/route.test.ts (new) — asserts `%PDF-`, `application/pdf`, Content-Disposition, grounded content
- FILE: src/lib/export.test.ts (edited), app/components/Workspace.dom.test.tsx (edited) — pdf is now a valid format / link
- CHANGE: Replaced the client-side `window.print()` "PDF" export with a real,
  server-generated PDF. `GET /api/modules/[id]/export?format=pdf` renders the
  module with pdfmake: headings/paragraphs/lists/quotes/tables/code keep real
  hierarchy and long-form spacing, a running header+footer carries the title and
  page numbers, and a grounding sources appendix preserves the `[n]` citations
  (I5 — an export must not launder a sourced module). The same markdown AST the
  reader uses (`app/lib/markdownBlocks.ts`) drives both, so they cannot drift.
- WHY: On iPad Safari the print path hides "Save as PDF" behind a pinch gesture
  (effectively undiscoverable on the primary device) and client print fidelity is
  fragile offline. A server file is a direct download. Chose pdfmake over a
  headless browser / @react-pdf+Geist to honour the zero-infra-cost constraint:
  no traced font files and no cold-start-heavy Chromium in the serverless
  function. Roboto ships inside pdfmake's virtual file system, so the export is a
  real embedded typeface (not base Helvetica/Times) with nothing extra to deploy.
  Workspace now links the PDF like the Anki export and disables all exports
  offline (same "you're offline" pattern as Tanya/Latih) so it never appears to hang.
- RULE: G0/E0/I0 — change logged.

## [2026-08-19 | 16:35 WIB | Wednesday | 19 August 2026]

### Amend Soso onboarding: name screen + no university scraper + optional PDF upload into RPS Reconcile
- Rules applied: G0/E0/I0/I1/I3/I5/I6/I12. Extends the first-run wizard (Soso) and RPSReconcilePanel; no schema/migration change; reuses existing batch-create backend.
- CHANGE 1 — `app/components/SosoOnboarding.tsx`: new Screen 0 asks the student's name (optional, single text input + Lanjut). The name is stored alongside `university` on a single client-side profile object (`localStorage` `soso.profile`, JSON `{name?, university?}`) — the same entity that held `university` (was `soso.university`; consolidated into `soso.profile`). Screen 1 greeting is personalized — `Halo {name}, aku Soso!` — and falls back to the generic `Halo, aku Soso!` when the name is blank (optional, like university). Screen order is now name → Soso/university → course batch. Added "← Kembali" between screens.
- CHANGE 2 — DECISION (rule I12): do NOT build a university scraper. Rationale logged below. The `university` field stays cosmetic-only, as already built — no fetch/lookup/automation is attached to it.
- CHANGE 3 — `app/components/RPSReconcilePanel.tsx` (+ new `app/lib/pdfExtract.ts`): added an optional "Unggah PDF" input beside the existing manual-entry path. `pdfExtract.ts` lazily imports `pdf-parse` (new dependency) to read text from a student-supplied PDF and writes it into the SAME `draft` textarea for review/edit. It is NOT auto-committed as the official order (human-approval principle preserved; Save stays manual). No external fetching. Empty extraction surfaces a "maybe scanned, enter manually" hint; a corrupt file surfaces an error alert.
- FILE: app/lib/pdfExtract.ts (new) + `npm install pdf-parse@^2.4.5` (dependency added; `package-lock.json` updated).
- Tests: app/components/SosoOnboarding.dom.test.tsx (rewritten — Screen 0 name first; name stored on profile; blank-name fallback to generic greeting; university stored on profile; batch POST + onFinished; major sent; 409 surfaced); app/page.dom.test.tsx (name screen first + advances to Soso welcome; returning user skips both); app/lib/pdfExtract.test.ts (real `pdf-parse` extracts text from a generated sample PDF buffer); app/components/RPSReconcilePanel.dom.test.tsx (+1 — uploaded PDF text populates the review textarea, not auto-submitted).
- DECISION (rule I12) — university scraper NOT built: RPS/jadwal data at Indonesian universities is generally gated behind a student/dosen login portal (SIAKAD, Sevima, Sisfo-style systems), not publicly scrapable. Reaching it programmatically would require storing the student's portal login credentials in the app and automating login — an unacceptable security liability for a lightweight single-user tool, and a likely Terms-of-Service violation for the portal regardless of who owns the credentials. Therefore `university` remains cosmetic-only; no scraper/lookup is attached.
- Docs: CHANGELOG (this entry). No schema/migration change.
- Verification: `bash scripts/ci.sh` → **`[ci] PASS — 2026-08-19T09:35:24Z`**, eslint **0 problems**, `tsc --noEmit` clean, `vitest run` **300/300 passed (35 files)**. `npx prisma migrate status` → up to date (5 migrations).

## [2026-08-19 | 15:38 WIB | Wednesday | 19 August 2026]

### First-run onboarding wizard ("Soso")
- Rules applied: G0/E0/I0/I1/I3/I5/I6/I12. Reuses the existing batch-create backend (POST /api/courses `{names[], major?}`) — no new backend path, no duplicated course-creation logic. No RPS auto-fetch / university lookup / scraping (scope boundary honoured).
- WHY: the landing dropped users straight into a course's empty-topic state with no guided first run. This builds the entry wizard in front of the existing Major + RPS UI (Changes 1 & 3 already wired) without touching that logic.
- FILE: app/components/SosoOnboarding.tsx (new) — full-screen (fixed overlay, not a modal) 2-screen wizard. Screen 1: Soso intro + optional `university` field (personalization only; whitespace-only trimmed so it never counts as filled; stored in localStorage `soso.university`). Screen 2: batch course entry reusing `splitCourseNames` from CourseBatchImport + one shared `major` field (functional since Change 1, drives retrieval/synthesis). Submit calls POST /api/courses; on success `onFinished()` → page refreshes courses and routes into the existing dashboard — no third confirmation screen.
- FILE: app/page.tsx (edited) — first-run detection is now by course count (`courses.length === 0` after load), not a localStorage flag, so returning users with ≥1 course skip the wizard. Replaced the old `onboarded` Modal + `seedSample` flow. Added `.soso-fade` keyframe (app/globals.css) for the Screen 1→2 fade/slide; reuses existing Tailwind transition utilities, no new animation dependency.
- DECISION (rule I12): `university` is stored client-side (localStorage), NOT a new DB table — settings already live client-side and the task said to avoid inventing one; it is display/personalization metadata only and is never sent to any fetch path.
- Tests added: app/components/SosoOnboarding.dom.test.tsx (5 — Screen 1 renders first, Lanjut stores trimmed university + advances, batch POST + onFinished, major sent, 409 collision surfaced without finishing); app/page.dom.test.tsx (2 — fresh profile → wizard, returning user → dashboard); app/api/courses/route.test.ts (+4 — batch dedupe, 409 conflict, major propagation to created courses, no-major create) via mocked prisma.
- Docs: CHANGELOG (this entry). No schema/migration change.
- Verification: `npm run ci` → **`[ci] PASS — 2026-08-19T08:37:59Z`**, eslint 0 problems, `tsc --noEmit` clean, `vitest run` **296/296 passed (34 files)**. `npx prisma migrate status` → up to date (5 migrations).

## [2026-08-19 | 14:33 WIB | Wednesday | 19 August 2026]

### Fix 2 confirmed bugs + shift essay pipeline toward 90% harness / 10% AI
- Rules applied: G0/E0/I0/I1/I3/I5/I6/I12. Both bugs confirmed by reading source (per directive); not reproduced via running the app. `npm run ci` baseline was 271/271 (30 files); `prisma migrate status` clean.
- BUG 1 confirmed: `app/api/synthesize/route.ts:152-166` built essayPrompt+essayRubric in one AI call, fed raw text to `JSON.parse` in a bare `try/catch` that silently set both to null on any malformed output (prose, unstripped fence, trailing comma) with zero logging and no UI signal — a blank free-text box looks like a working feature.
- BUG 2 confirmed: `src/lib/mcq.ts:106` called `collectTerms(text)` on raw `text`; the bibliography (author names / journal titles from References/Daftar Pustaka) was therefore in the term+distractor pool. Distractor pick was `pool.slice(0,12)` → first 3 in document order — no salience or plausibility weighting.
- FILE: package.json (edited, `zod` added as direct dependency — was only transitive; used for the essay JSON boundary) + `npm install zod`
- FILE: src/lib/essay.ts (new) — `generateEssayPrompt(moduleText, topicId?)`: single question-only AI call, schema-validated with `zod` (not ad-hoc `typeof`), strips markdown fences, retries once with a stricter system instruction on malformed output; every outcome logged via `logAIUsage` (`kind:"essay"` on success, `kind:"essay_failed"` on malformed/throw — never silent). `buildEssayRubric(content)`: deterministic harness (0% AI) built from the module's fixed structure — key concepts from the "Konsep kunci" section (else claim-like lines) become the high-score criteria, plus comparison/relevance criteria.
- FILE: src/lib/aiusage.ts (edited, `AIUsageKind` gains `"essay_failed"`)
- FILE: app/api/synthesize/route.ts (edited, lines ~148-167) — essay block now builds rubric via `buildEssayRubric` (no second Gemini call) and sets `essayPrompt` via `generateEssayPrompt`; failure stays non-fatal but is logged.
- FILE: src/lib/mcq.ts (edited) — Bug 2.1: terms collected from `studyProse(text)` so the bibliography can't leak into distractors. Bug 2.2: mask target chosen by `bestMaskTerm` (frequency-weighted, +bonus for "Konsep kunci" terms). Bug 2.3: `pickDistractors` excludes the answer AND any same-stem morphological variant, then prefers distractors of similar length (cheap, no LLM).
- FILE: app/api/essay/route.ts (new) — `POST /api/essay` regenerates ONLY the question for a module (Bug 1 fix #3 retry path); persists `essayPrompt` (null kept explicitly on failure so the UI keeps its retry affordance); guards body bytes + module existence.
- FILE: app/components/Workspace.tsx (edited) — when `detail.essayPrompt` is null the Esai panel shows an amber `role="alert"` "Gagal membuat pertanyaan esai — coba lagi." with a "Coba lagi" button calling `POST /api/essay` (harness rubric already present, so grading still works); never a silent blank box.
- Tests: src/lib/essay.test.ts (6 — success logs "essay", malformed JSON logs "essay_failed" + retries, recovery on stricter retry, throw → "essay_failed", fenced JSON accepted, deterministic harness rubric); app/api/essay/route.test.ts (4 — regenerate+persist, requires moduleId, 404, failure keeps null); src/lib/mcq.test.ts (+3 — bibliography terms absent from options, no morphological-variant distractor, frequent key-concept term wins the mask).
- Docs: ROADMAP §3/§6 updated (essay pipeline now 90% harness/10% AI; MCQ remains 100% harness; /api/essay added); ARCHITECTURE §3 + essay pipeline note updated. No schema/migration change.
- Verification: `bash scripts/ci.sh` → **`[ci] PASS — 2026-08-19T07:33:14Z`**, eslint 0 problems, `tsc --noEmit` clean, `vitest run` **285/285 passed (32 files)**. `npx prisma migrate status` → up to date (5 migrations).

## [2026-08-19 | 13:41 WIB | Wednesday | 19 August 2026]

### Close four open gaps (ROADMAP §6 Phase 1) — verify-first, no rebuild
- Rules applied: G0/E0/I0/I1/I3/I5/I6/I12. Verified the existing flow against ARCHITECTURE/CHANGELOG before changing (per the "verify-first" directive): Course→Topic wired, POST /api/retrieve→OpenAlex, paper gate enforced by `synthesize/route.ts`, RAG-scoped Q&A, attempts/review all present. CI baseline was green (205/205, 24 files); `prisma migrate status` clean.
- Premise corrections found during verify: (a) `orderSource` was NOT a schema default — hardcoded `"custom"` at `src/lib/topics.ts:54`; (b) Change 2 (paper-gate friction) was ~70% built already; (c) no standalone course form — `POST /api/courses` is called from `app/page.tsx:150` + seed. RPS reconciliation had been deleted and is now restored per the ROADMAP no-delete decision.
- FILE: prisma/schema.prisma (edited) + prisma/migrations/20260819060652_course_major + prisma/migrations/20260819060750_rps_reconcile_restore
- CHANGE: added `Course.major String?`; added `RPSReconcile` model (id, courseId @unique, officialOrder, customOrder, reconciledAt, updatedAt, FK to Course); `Topic.orderSource String @default("custom")`. Both migrations non-destructive (ALTER ADD COLUMN; CREATE + redefine Topic with default).
- WHY: I6 — schema change needs a migration. Enables Major-scoped retrieval/synthesis and RPS alignment.
- FILE: src/lib/openalex.ts (edited, `RetrieveOptions.major`, `cacheKey` includes major, major joined into `search` term only — NOT scoring terms, to avoid Indonesian-label miss on English abstracts)
- FILE: src/lib/topics.ts (edited, `resolveCourseMajor({courseId, topicId})` read-only)
- FILE: app/api/retrieve/route.ts (edited, calls `resolveCourseMajor` then `retrievePapers(title, keywords, {cache:true, major})`)
- FILE: app/api/synthesize/route.ts (edited, `buildSystem(courseName, major?)` exported; major injected as disciplinary framing; gate at lines ~67–75 unchanged — still requires approved papers)
- FILE: src/lib/scoring.ts (edited, `APPROVAL_MIN_COUNT=2`, `defaultApprovedIndices(papers)` = batch-relative top-quartile + floor, ties kept)
- FILE: app/components/PaperReview.tsx (edited, lazy `useState` initializer for default selection; primary "Approve & lanjut (N)"; zero-checked → blocked alert, never auto-approves nothing; per-paper uncheck override)
- FILE: src/lib/rps.ts (new, pure logic: `normalizeTitle`, `parseOfficialOrder`, `sortCustomOrder`, `diffTopicOrder` defensive dedup, `alignedTopicIds`, `summarizeDiff`; diff recomputed on read, not stored)
- FILE: app/api/rps/[courseId]/route.ts (new, GET → state; PUT → upsert officialOrder + align matched topics `orderSource="official_rps"`, guards in `guards.ts`)
- FILE: app/api/courses/route.ts (edited, batch `{names[], major?}` single transaction, conflict → 409; single upsert backfills major)
- FILE: src/lib/guards.ts (edited, `LIMITS.rpsText`, `rpsTopicCount`, `courseBatchCount`, `courseName`)
- FILE: app/lib/types.ts (edited, `ModuleRef`/`TopicRef` get `orderSource?`; `CourseSummary` gets `major?`; added RPS types)
- FILE: app/components/RPSReconcilePanel.tsx (new), app/components/CourseBatchImport.tsx (new), app/components/Composer.tsx (edited, object `ComposerSubmission`, major input), app/components/Sidebar.tsx (edited, `onBatchImport?`), app/page.tsx (edited, RPS + batch UI, `ensureCourseId` backfills major, `UnverifiedOrderBadge`)
- WHY: closes the 4 gaps (Major scope, gate friction, RPS restore, batch import) without rebuilding the flow.
- Tests added: src/lib/rps.test.ts (18), src/lib/scoring.test.ts (16), src/lib/openalex.test.ts (6), app/api/synthesize/route.test.ts (12), app/api/courses/route.test.ts (12), app/components/PaperReview.dom.test.tsx (6), app/components/Composer.dom.test.tsx (5), app/components/RPSReconcilePanel.dom.test.tsx (6), app/components/CourseBatchImport.dom.test.tsx (7). PaperReview dom test title-overmatch bug fixed (distinct titles + anchoring regexes).
- Docs: ROADMAP §6 data model marks `RPSReconcile` + `orderSource` + `Course.major` built; Phase 1 RPS reconcile + batch import marked ✅; R1 mitigated; no-delete decision added for `RPSReconcile`; ARCHITECTURE §3 + §4 updated.
- Verification: `bash scripts/ci.sh` → **`[ci] PASS — 2026-08-19T06:41:07Z`**, eslint **0 problems**, `tsc --noEmit` clean, `vitest run` **271/271 passed (30 files)**. `npx prisma migrate status` → **"Database schema is up to date!"** (5 migrations found, none pending).

## [2026-08-19 | 03:13 WIB | Wednesday | 19 August 2026]

### Phase 2 — Polish & Learning-Science Depth Pass (ROADMAP §13, EXECUTED)
- Rules applied: G0/E0/I0/I1/I3/I5/I6/I7–I9/I12. Plan written to ROADMAP §13 before code (rule I0). Executed via 8 file-disjoint subagents in 3 waves; verified green.
- WS1 Design & mobile (`app/globals.css`, `app/components/Sidebar.tsx`, `app/components/Composer.tsx`, `app/lib/markdown.tsx`): adopted `@theme` tokens (brand/muted/card/border/link/radius-card/reader-measure), class-based `.dark` + `prefers-color-scheme` fallback, `(pointer:coarse)` tap≥44px, `.reader-prose` 66ch/1.6; responsive Sidebar drawer (<md) via Modal sheet + dark toggle; `text-zinc-400`→`text-muted`/`zinc-500`; markdown now renders links/tables/fenced code with safe HREF.
- WS2 Lib (`src/lib/scheduler.ts`, `src/lib/retrieval.ts`, `src/lib/guards.ts`, `app/api/qa/route.ts`): scheduler gained `desiredRetention` (default 0.90) + elapsed-time growth + `previewIntervals()`; retrieval `avgdl===0` NaN guard; `/api/qa` now `.take(LIMITS.chunkCount)`.
- WS3 A11y (`app/components/Modal.tsx`, `app/components/ErrorBoundary.tsx`): focus trap skips disabled controls, body scroll-lock, `confirmClose` inline discard confirm, returns focus to trigger.
- WS4 Progress API (`app/api/progress/route.ts`): added `streakDays`, 30-day `heatmap`, `overdue` split, `dueTodayByCourse`; `masteryPct` now excludes essay attempts (was understated).
- WS5 API correctness (`app/api/mcq/route.ts`, `app/api/grade/route.ts`, `app/api/synthesize/route.ts`, `src/lib/topics.ts`): `/api/mcq` now logs AI usage (was the only unlogged Gemini route); grade/synthesize interpolate real `Course.name` (removed hardcoded "Teori Antropologi Kontemporer"); `topics.ts` default course is "Umum" (no cuid-as-name).
- WS6 Docs (`docs/ARCHITECTURE.md`): removed stale `computeNextReview`/`Assessment`/`RPSReconcile` refs, corrected Q&A to server-side BM25, added `retrieval.ts`/`/api/progress`/localStorage keys; README verified accurate.
- WS7 Hub (`app/page.tsx`, `app/components/Workspace.tsx`, `app/components/InterleavedPractice.tsx`, `app/components/ReviewQueue.tsx`, `app/components/QuestionBank.tsx`, `app/components/MetacogPanel.tsx`, `app/components/ElaborationPanel.tsx`, `app/api/questions/route.ts`, `app/lib/types.ts`, new `app/components/PretestGate.tsx`/`FreeRecall.tsx`/`CalibrationPanel.tsx`/`ReviewGrader.tsx`): fixed InterleavedPractice last-item crash (idx guard), ReviewQueue stale-correctness grading, onboarding missing `courseId`, topic-only delete (+`app/api/topics/[id]/route.ts`), AI-MCQ persistence (`author:"ai"`), wrong MCQ copy, removed MCQ auto-fire; `min-h-[100dvh]`, modals wrapped in ErrorBoundary, `aria-live`/`role="alert"` regions, Latih 6-way ARIA sub-tablist, unified Again/Hard/Good/Easy grader with `previewIntervals`, pretesting gate, free-recall gate, calibration panel, desirable-difficulty guardrail (<40%), interleave-by-concept + shuffle.
- WS8 Tests: 13 new `*.dom.test.tsx` (+21 cases); full suite 205 passed.
- Verification: `bash scripts/ci.sh` → `[ci] PASS — 2026-08-18T20:13:30Z`; `npx prisma migrate status` → up to date (3 migrations). Lint 0 problems, tsc clean, 205/205 tests.
- Evidence (verified): Dunlosky 2013 (10.1177/1529100612453266); Roediger & Karpicke 2006 (10.1111/j.1467-9280.2006.01693.x); Karpicke & Blunt 2011 (10.1126/science.1199327); Cepeda 2008; Richland/Kornell/Kao 2009 (10.1037/a0016496); Pan & Carpenter 2023; Butler & Roediger 2008 (10.3758/MC.36.3.604); Agarwal 2008 (10.1002/acp.1391); Nelson & Dunlosky 1991; Metcalfe 2009; Thiede 2003; Bjork & Bjork 2020; Sweller 2019; Mayer 2024; FSRS docs.ankiweb.net; WAI-ARIA APG; WCAG 2.2; NN heuristics; Tailwind v4; Apple iPad Safari WWDC21.

## [2026-08-18 | 23:30 WIB | Tuesday | 18 August 2026]
- FILE (SCHEMA / FSRS / dead-code): prisma/schema.prisma (lines 131–151, edited —
  `AssessmentAttempt.stability` `@default(1)` + `difficulty` `@default(5)`; REMOVED models
  `Assessment` and `RPSReconcile` plus the `Topic.assessments` / `Course.reconciles`
  back-relations; 180 lines total); prisma/migrations/1_spaced_repetition_state/ (stray
  off-script migration reconciled with `prisma migrate resolve --applied` first, no reset);
  prisma/migrations/20260818164459_fsrs_cleanup/migration.sql (new, applied via
  `prisma migrate dev` — 3 migrations now tracked); src/lib/scheduler.ts (lines 1–150,
  rewritten — FSRS-derived **stateful** scheduler: `INITIAL_STABILITY` (27), `LAPSE_DECAY`
  = 0.4 (29), `INITIAL_STATE` (39–43), `outcomeToGrade` (57), `review()` (81–140, updates
  stability *and* difficulty on every review), `isDue` (145); evidence comments at lines
  11–14 cite github.com/open-spaced-repetition/fsrs + Dunlosky et al. 2013 Table 4
  "distributed practice = High utility"); src/lib/scheduler.test.ts (lines 1–140, edited +
  new FSRS cases); app/api/attempts/route.ts (lines 1–164, edited — POST drives the FSRS
  `review()` and persists/serializes `stability`/`difficulty`); app/lib/types.ts (lines
  68–84, edited — removed unused `TopicSummary` / `ModuleSummary`; `AssessmentAttempt`
  gains `stability` + `difficulty`); app/api/topics/route.ts + app/api/modules/route.ts
  (DELETED — dead collection endpoints, no callers; `app/api/modules/[id]` retained);
  app/api/questions/route.ts (line 37, edited — `author: item.author === "ai" ? "ai" :
  "student"`).
- FILE (DESIGN SYSTEM / a11y infra): app/globals.css (lines 3–60, new `@theme` +
  `@theme inline` Tailwind-v4 design tokens; line 22 WCAG-AA contrast bump — de-emphasized
  meta text zinc-400 → zinc-500; lines 62–100 new `.reader-prose` reading measure +
  heading/list/link/blockquote rhythm; lines 102–114 new
  `@media (prefers-reduced-motion: reduce)`; 172 lines total); app/components/Modal.tsx
  (new, lines 1–113 — accessible dialog: `role="dialog"` (93), `aria-modal="true"` (94),
  `aria-labelledby` (95), Esc-to-close (48), focus trap (41–72), focus restored to the
  previously-focused element on unmount (79)); app/components/ErrorBoundary.tsx (new,
  lines 1–61); app/components/PaperReview.tsx (lines 5 + 38, edited),
  app/components/Composer.tsx (lines 4 + 53, edited), app/components/UsageModal.tsx
  (lines 4 + 22, edited) — all three overlays now render through `Modal` instead of
  hand-rolled divs; app/page.tsx (lines 13, 365, 501 — main content wrapped in
  `ErrorBoundary`); app/components/Modal.dom.test.tsx (new, lines 1–39).
- FILE (WORKSPACE UX): app/components/Workspace.tsx (lines 132–150 — `doAsk` now POSTs
  `moduleId` to `/api/qa` so retrieval happens server-side instead of shipping the whole
  module from the client; lines 268–271 ArrowLeft/ArrowRight/Home/End tab navigation;
  lines 372–390 tabs finished to the ARIA spec — `role="tablist"` wrapper +
  `aria-controls`/`id` pairing with each `tabpanel`; line 415 reader adopts `.reader-prose`;
  line 455 mounts `ElaborationPanel`; line 494 adopts shared `MCQOptions`; rubric +
  source-citation note surfaced after grading; 633 lines total);
  app/components/MCQOptions.tsx (new, lines 1–57 — one MCQ option renderer shared by
  Workspace + InterleavedPractice); app/components/ElaborationPanel.tsx (new, lines 1–88 —
  elaborative-interrogation + self-explanation prompts with localStorage autosave);
  app/components/Workspace.dom.test.tsx (lines 1–441, edited — asserts tablist semantics,
  arrow-key nav, and that the Tanya fetch carries `moduleId`).
- FILE (SERVER-SIDE Q&A RETRIEVAL): src/lib/retrieval.ts (new, lines 1–112 — BM25-lite
  lexical ranker over stored `ModuleChunk` text: `RankedChunk`/`RetrievableChunk` (11–20),
  `rankChunks()` (54–110) with tf·idf plus the BM25 saturation + length-normalization term;
  **no new dependency**); app/api/qa/route.ts (lines 5, 34, 46–70, edited — accepts
  `moduleId`, loads that module's `ModuleChunk` rows, ranks them against the question and
  injects only the top-5; the legacy client-supplied `chunks` path is kept as a fallback;
  guards and optional `topicId` unchanged; 96 lines total); src/lib/retrieval.test.ts (new,
  lines 1–43, 6 tests).
- FILE (INTERLEAVED PRACTICE → SRS): app/components/InterleavedPractice.tsx (line 5 adopts
  `MCQOptions`; lines 46–70 new `recordAttempt()` POSTs `/api/attempts` per item with
  `moduleId` + `topicId` + `isCorrect` + `confidence`, guarded against a null `moduleId`
  and non-fatal on failure; line 173 invokes it on reveal; line 270 renders via
  `MCQOptions`; lines 242–258 new "Jumlah soal" + "Acak ulang" interleave-tuning controls;
  341 lines total).
- FILE (DASHBOARD / ONBOARDING): app/api/progress/route.ts (new, lines 1–111 —
  `GET ?courseId=` returns per-topic `hasModule`/`status`/`dueToday`/`attempts`/
  `masteryPct`/`nextReview` plus course-level `dueTodayCount`/`streakDays`/`avgMastery`);
  app/page.tsx (lines 40–49 progress types, 65–66 state, 108–113 progress fetch, 123 + 296
  first-run flag, 306–307 engagement-based "ready" = module exists **and** ≥1 attempt,
  322–327 + 403–407 due-today / streak / average-mastery head-start line, 531–557 first-run
  onboarding `Modal` with a "buat mata kuliah & topik contoh" seed, plus richer empty states
  and microcopy; 561 lines total); app/api/synthesize/route.ts (line 259, edited — sets
  `Topic.status = "module_generated"` on successful module creation so the lifecycle pill and
  the dashboard agree).
- CHANGE: Integration pass closing ROADMAP §12 ("Broad Improvement Pass"). Six file-disjoint
  workstreams landed and were reconciled into one green build. (1) **FSRS** replaces the
  SM-2/confidence scheduler: attempts now carry per-item `stability` + `difficulty` that the
  scheduler advances on every review (lapses multiply stability by `LAPSE_DECAY`, marginal
  recalls raise difficulty), so the review interval is state-derived rather than recomputed
  from a single confidence rating. (2) **Q&A is now really retrieval-augmented**: the client
  posts a `moduleId` and the server ranks the module's stored chunks with a dependency-free
  BM25-lite ranker, injecting only the top-5 — previously the client shipped every paragraph
  and `ModuleChunk.embedding` was the stub `"[]"`. (3) **Interleaved practice feeds the SRS**:
  mixed practice previously collected a confidence rating and threw it away, so course-wide
  practice never scheduled a review. (4) **A11y**: one accessible `Modal` primitive now backs
  all three overlays (dialog semantics, Esc, focus trap, focus restore) and the Baca/Tanya/
  Latih/Sumber tabs are a complete ARIA tablist with arrow/Home/End navigation. (5) **Dead
  code removed**: Prisma `Assessment` + `RPSReconcile`, the `TopicSummary`/`ModuleSummary`
  types, and the two unused collection routes; the QuestionBank authorship bug is fixed so
  student-written items are stored as `"student"` and no longer surface in the read-only "AI"
  section. (6) **Design + resilience**: Tailwind-v4 `@theme` tokens, an AA contrast pass on
  the de-emphasized palette, reduced-motion support, a bounded reading measure, and an
  `ErrorBoundary` around the main content. (7) **Dashboard**: due-today / streak / mastery
  from real attempts, engagement-based "ready", and first-run onboarding with a sample course.
- WHY: ROADMAP §12 — the post-§7.6 audit found that several learning-science features were
  present in name but not in effect. Rule **I12** (doc/code drift): the roadmap claimed RAG
  Q&A and a spaced-repetition loop while the code injected whole modules and ignored
  interleaved confidence ratings. Rule **I6** (schema = migration + changelog): the
  `stability`/`difficulty` columns and the model removals ship as a tracked migration
  (`20260818164459_fsrs_cleanup`) with the stray `1_spaced_repetition_state` reconciled
  `--applied` rather than reset, so no data was lost. Evidence base: FSRS is the modern SRS
  standard (github.com/open-spaced-repetition/fsrs; docs.ankiweb.net/deck-options.html) and
  distributed practice is rated High-utility by Dunlosky et al. 2013 (Table 4); elaborative
  interrogation + self-explanation are the two "moderate utility" strategies in the same
  review, which is what `ElaborationPanel` operationalizes; interleaving only pays off if the
  attempts persist and re-surface (Bjork desirable difficulties; Cepeda et al. 2008 spacing
  meta); engagement-based "ready" replaces module-existence because a generated-but-unread
  module was being counted as preparation. A11y work satisfies the ROADMAP §2 hard
  requirement (VoiceOver + dialog/tab semantics on an iPad) and closes the §7.2 accessibility
  gap. Grounding is unchanged and still enforced: retrieval narrows the injected context but
  never invents it, and no application logic outside the listed files was touched.
- RULE: G0/E0/I0 (logged with timestamp + file:line). I1 (new modules placed per the
  `app/lib` client-safe vs `src/lib` server-logic boundary — `retrieval.ts`/`scheduler.ts`
  are server-side, `Modal`/`MCQOptions`/`ElaborationPanel`/`ErrorBoundary` are client
  components). I3 (`/api/progress` and the extended `/api/qa` state their I/O contract).
  I5 (retrieval narrows context without fabricating it; the legacy `chunks` path retained so
  no caller loses grounding). I6 (schema change shipped as a migration + this entry).
  I7/I8 (existing `src/lib/guards.ts` ceilings still applied before every Gemini call;
  interleaved attempt POST guards a null `moduleId` and fails soft). I9 (the progress fetch
  and the attempt POST degrade with a comment instead of breaking practice). I12 (ROADMAP §12
  status + Outcomes updated in the same pass). VERIFICATION re-run end-to-end:
  `bash scripts/ci.sh` → **`[ci] PASS — 2026-08-18T17:13:58Z`**, eslint **0 problems**,
  `tsc --noEmit` clean, `vitest run` **160/160 passed (12 files)** (was 141/141 across 10
  files: +FSRS scheduler, +6 retrieval, +Modal DOM, +Workspace tablist/arrow-nav cases).
  `npx prisma migrate status` → **"Database schema is up to date!"** (3 migrations found,
  none pending). Dead-symbol sweep of `app/lib/types.ts`, `prisma/schema.prisma`,
  `app/api/questions/route.ts` confirms `TopicSummary` / `ModuleSummary` / `RPSReconcile`
  are gone and the questions author default is `"student"`.

## [2026-08-18 | 23:00 WIB | Tuesday | 18 August 2026]
- FILE: app/api/modules/[id]/route.ts (lines 7–20, edited — DELETE now deletes the Topic, which cascades to the Module + all rows, matching the dialog); app/components/Workspace.tsx (line 198, delete confirmation unchanged but now accurate); .gitignore (lines 43–48, edited — ignore `prisma/*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm`); app/api/retrieve/route.ts (lines 1–4 + 12–40, edited — guards title length, keyword count, keyword chars, body bytes; imports guards); src/lib/guards.ts (LIMITS: +keywordCount 20, +keywordChars 1000); src/lib/openalex.ts (cacheKey slug sliced to 200 chars); app/api/synthesize/route.ts (lines 204–218, edited — re-synthesis wrapped in `prisma.$transaction`; corpus fenced with `<<<PAPER n START/END>>>` markers + instruction); src/lib/gemini.ts (lines 63–82, edited — API key moved from `?key=` query to `x-goog-api-key` header); app/lib/types.ts (CandidatePaper +`abstract`); app/api/papers/[topicId]/route.ts (payload +`abstract`); app/components/PaperReview.tsx (shows `p.abstract`); app/components/Skeletons.tsx (removed unused `SourcesSkeleton`); app/components/Workspace.tsx (imports+renders `MCQSkeleton` while MCQs load); app/page.tsx (imports+renders `SynthesisSkeleton` via new `synthesizing` state during /api/synthesize); package.json (scripts +`db:migrate` = `prisma migrate dev`); README.md (setup uses `db:migrate`, scripts table notes `db:push` is experiments-only + rule I6); prisma/migrations/0_init/migration.sql (new — baseline migration, non-destructively applied to existing dev.db via `prisma migrate resolve --applied`); docs/ROADMAP.md (§7.6 item 11 wording corrected: MCQ + synthesis skeletons shipped, SourcesSkeleton dropped — no async source load); docs/CHANGELOG.md (this entry)
- CHANGE: Addressed all WARNING-severity findings from the 2026-08-18 /review pass. (1) **Delete semantics** — `DELETE /api/modules/:id` now deletes the Topic (cascade removes Module, versions, chunks, excerpts, papers, sessions, attempts, question-bank). The confirmation dialog already promised "Topik, paper, dan seluruh riwayatnya ikut terhapus", so the old Module-only delete was a false claim; removing the Module left orphaned pending topics. (2) **DB not ignored** — `prisma/*.db*` were committed-able; `dev.db` is now gitignored as regenerateable state. (3) **Unguarded retrieve** — the free-text `/api/retrieve` now enforces the same guard table (title len, keyword count/chars, body bytes) as the LLM routes; cache-key slug bounded so a huge query can't forge a pathological filename. (4) **Non-atomic re-synthesis** — the chunk/excerpt refresh + module update is now a single `prisma.$transaction`, so a mid-flight failure can't leave a module with stale chunks and no excerpts. (5) **Approval gate abstraction** — `CandidatePaper` and the papers payload now carry `abstract`, shown (truncated) in the review sheet so the human gate sees what they approve; the synthesis corpus is fenced with explicit PAPER n START/END markers so the model can't mistake prose for source text. (6) **Gemini key in URL** — moved to the `x-goog-api-key` header (query strings leak into proxy/CDN/Gemini access logs). (7) **Migrations** — adopted `prisma migrate dev` as the schema source of truth (rule I6); created + baseline-applied an initial migration non-destructively (DB already matched the schema, so `migrate resolve --applied` recorded it without a reset; `migrate status` reports "up to date"). `db:push` kept for experiments only. (8) **Unused skeletons** — `SourcesSkeleton` removed (sources load synchronously with the module, so no async branch exists); `MCQSkeleton` wired into the Latih tab's loading state and `SynthesisSkeleton` into the compose/synthesis loading state; ROADMAP item 11 corrected to match.
- WHY: WARNING findings — correctness/security/drift issues, not style. Deletes must not lie to the user or orphan data; secret-bearing URLs and an unguarded ingest endpoint are real leaks; non-atomic persistence and missing migrations are data-integrity + I6 (schema=migrations+changelog) violations; unexplained dead UI (ROADMAP claiming shipped skeletons) is doc/code drift (I12).
- RULE: G0/E0/I0 (logged). I5/I7/I8 (retrieve guards bound + fail-fast, never truncate). I6 (schema now tracked via prisma/migrations + changelog entry). I10 (Gemini key out of URL/loggable path). I12 (ROADMAP + README + ARCHITECTURE consistent with code). CI re-run end-to-end: `bash scripts/ci.sh` PASS — eslint 0 problems, `tsc --noEmit` clean, `vitest run` **141/141** (10 files). `prisma migrate status` → "Database schema is up to date!" (1 migration, baseline applied, no reset).

---

## [2026-08-18 | 14:30 WIB | Tuesday | 18 August 2026]
- FILE: src/lib/export.ts (new, 1–178: pure MD/Anki formatters); app/api/modules/[id]/export/route.ts (new, 1–124: `GET ?format=md|anki`); src/lib/export.test.ts (new, 34 tests); app/components/Workspace.tsx (lines ~255–270 printModule(); header gains an "Ekspor modul" row with Markdown/Anki/PDF; `print:hidden` on delete button + tab bar); app/globals.css (lines 28–86, new `@media print` block); app/page.tsx (line 213, `print:hidden` on the app header); src/lib/guards.ts (new, 1–145: LIMITS table + guardLength/guardChars/guardCount/guardBodyBytes/firstGuardError/totalLength); src/lib/guards.test.ts (new, 25 tests); app/api/qa/route.ts + app/api/grade/route.ts + app/api/mcq/route.ts + app/api/synthesize/route.ts (guards applied before every Gemini call); src/lib/mcq.ts (lines 19–42: new `studyProse()` drops headings + bibliography before sentence splitting); src/lib/mcq.test.ts (+2 tests); vitest.config.mts (new: `node` + jsdom `dom` projects, `@` alias); vitest.setup.ts (new: jest-dom matchers, cleanup, localStorage reset, scrollIntoView/print stubs); app/lib/markdown.dom.test.tsx + app/components/TableOfContents.dom.test.tsx + app/components/MetacogPanel.dom.test.tsx + app/components/Workspace.dom.test.tsx (new, 60 DOM tests); package.json + package-lock.json (devDeps: jsdom, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event); README.md (rewritten: real project docs); docs/ARCHITECTURE.md (new, 9 sections); docs/ROADMAP.md (§7.6 items 13/15/17/18 → ✅, Phase 3 export → [x], §7.3 updated, header v4 status/date); docs/CHANGELOG.md (this entry)
- CHANGE: Closed the four remaining P2/Phase-3 items in one pass.
  (1) **Export** — `src/lib/export.ts` formats Markdown (module + generated essay
  prompt/rubric + numbered source list whose order matches the inline `[n]`) and Anki TSV
  (`#separator:tab`/`#html:true`/`#deck:So-study::<topic>`, HTML-escaped, tab/newline
  neutralised so no field can break the row/column layout). `GET /api/modules/[id]/export`
  streams either as a download (400 unknown format, 404 unknown module); it is read-only and
  spends no API call. Anki cards prefer the student's own question bank (generation effect)
  and fall back to the deterministic cloze generator. PDF is deliberately dependency-free:
  a `printModule()` that switches to Baca first (printing Latih would print the answers)
  plus an `@media print` block that drops the app chrome, unclips the scroll containers, and
  appends `href` after links so a printed module keeps its source URLs.
  (2) **Input-length guards** — one ceiling table (`src/lib/guards.ts`) applied to `/api/qa`,
  `/api/grade`, `/api/mcq` and `/api/synthesize` *before* the Gemini call, returning 413 with
  an actionable Indonesian message. Never truncates. Guards cover body bytes, question,
  chunk count, total chunk chars, essay answer, question text, rubric, module text, topic
  title, approved-paper count and assembled corpus.
  (3) **README + architecture doc** — README replaced (setup/env, scripts, the study loop and
  its two invariants, practice features, export table, cost, test layout, doc map);
  `docs/ARCHITECTURE.md` documents runtime shape, the `app/lib` (client-safe/pure) vs
  `src/lib` (server logic) split as an explicit import-direction rule with the actual
  cross-imports, per-stage pipeline/API map, grounding chain, data-model gotchas (JSON-as-text
  columns, `author` as an authz boundary, legacy `Assessment`), guard table, local-storage
  keys, offline rules, test layout and known debt.
  (4) **DOM/component tests** — `vitest.config.mts` splits a `node` project (pure logic) from
  a jsdom `dom` project (`*.dom.test.tsx`) with the `@` alias mirroring tsconfig; 60 DOM tests
  assert invariants rather than markup: closed-book hides Baca/Tanya/Sumber, offline never
  posts to `/api/qa` or `/api/grade`, MCQ grading posts an attempt, citations jump to Sumber,
  export links/print, draft autosave+restore, TOC/markdown anchors, metacog autosave scoping.
  Incidental fix found by smoke-testing the export: the deterministic cloze generator built
  cards out of headings and bibliography lines ("_____ BELAJAR: POLITIK BUDAYA" → "MODUL"),
  which would have shipped junk into the student's permanent Anki deck; `studyProse()` now
  strips heading lines and everything from a `Sources:`/`Sumber:` heading onward. This also
  improves the Latih MCQ fallback.
- WHY: ROADMAP §7.6 items 13, 15, 17, 18 and the Phase-3 export line were the last open
  polish/tech-debt items. Guards close the R4 (cost runaway) hole on every LLM route and honour
  I7 (bounded state) / I8 (assert preconditions, fail fast) without violating I5 (truncating a
  grounded prompt silently drops the sources an answer depends on). The export delivers
  portability/reinforcement while preserving the grounding (sources with URLs travel with the
  module) and the product framing (the export footer repeats "bekal awal sebelum kuliah, bukan
  pengganti kuliah", roadmap §3). The docs close I12 doc/code drift — the `app/lib` vs `src/lib`
  boundary existed only as scattered code comments, so nothing stopped a future change from
  importing Prisma into a client-safe module. DOM tests cover the layer where the audit's P0
  invariants actually live (closed-book, offline refusal, attempt persistence): those were
  previously verified by reading code only.
- RULE: G0/E0/I0 (logged). I1 (new code placed per the declared layering), I3 (each new route
  states its I/O contract; guards are explicit, no implicit truncation), I5 (export carries
  sources; guards never silently drop context), I7/I8 (bounded prompts, fail fast with a clear
  message), I9 (every new catch degrades with a comment — malformed bank options, unparseable
  sourcePaperIds), I10 (export route is read-only, no LLM, no secrets), I12 (ROADMAP + README +
  ARCHITECTURE updated with the code). CI re-run end-to-end: `bash scripts/ci.sh` PASS — eslint
  0 problems, `tsc --noEmit` clean, `vitest run` **140/140** (was 27; +34 export, +25 guards,
  +2 mcq, +60 DOM, node 80 / dom 60). Live smoke test on `localhost:3000` (never Vercel):
  `GET /` 200; MD export 200 with `Content-Disposition: attachment; filename="so-study-politik-budaya-dan-seni.md"`
  and sources in citation order; Anki export 200, 10 notes, every row exactly 2 tab-separated
  columns; `?format=pdf` 400; unknown module 404; oversized question/rubric/essay/module-text/
  title/context/chunk-count each 413 with the right message; a normal question still returns a
  grounded answer (200, 84 prompt tokens).

## [2026-08-18 | 13:11 WIB | Tuesday | 18 August 2026]
- FILE: prisma/schema.prisma (Topic.dueBeforeLecture, Module.essayPrompt/essayRubric, new models AssessmentAttempt + QuestionBankItem + back-relations); app/lib/types.ts (AssessmentAttempt, QuestionBankItem, ModuleDetail.essayPrompt/essayRubric, ModuleRef/TopicRef.weekNumber/dueBeforeLecture, canonical MCQQuestion re-used); src/lib/mcq.ts (extractClaims now returns {text, paperIndex}; MCQQuestion re-exported from app/lib/types — P2-12 unify); src/lib/aiusage.ts (AIUsageKind += "essay"|"mcq"); app/api/synthesize/route.ts (P0-1 grounding: each Excerpt mapped to its TRUE paper via inline [n]; P0-4 auto-generate + store essayPrompt/essayRubric; P2-14 removed dead no-topicId legacy path; requires topicId now); app/api/retrieve/route.ts (P1-9 persist weekNumber + dueBeforeLecture); app/api/courses/route.ts + modules/[id]/route.ts (serialize week/due + essay fields); app/components/Workspace.tsx (P0-2 closed-book now locks Baca+Tanya+Sumber during Latih; P0-3 records attempts on MCQ/essay grade; P0-4 essay panel defaults to generated prompt/rubric; P1-10 auto-generates first MCQ set; a11y role=tab/tabpanel; integrates MetacogPanel/QuestionBank/ReviewQueue/InterleavedPractice/TableOfContents; terminology matakuliah->mata kuliah); app/components/Composer.tsx (P1-9 Minggu ke- + Batas sebelum kuliah inputs; terminology); app/page.tsx (P1-9 week/due shown in dashboard + terminology; P2-16 refreshCourses now surfaces errors instead of swallowing; passes courseId to Workspace); app/lib/study.ts (new: visibleTabIds + slugifyHeading pure helpers; P2-15 unit-tested); app/lib/scheduler.ts + src/lib/scheduler.test.ts (S1: confidence-based spaced-repetition computeNextReview/isDue, 10 tests); app/api/attempts/route.ts (S1: POST records attempts w/ scheduledNextAt; GET due queue); app/components/ReviewQueue.tsx (S1); src/lib/metacog.ts + app/components/MetacogPanel.tsx (S2: plan/monitor/evaluate prompts, localStorage autosave); app/api/questions/route.ts + app/components/QuestionBank.tsx + app/components/InterleavedPractice.tsx (S3: author/edit MCQs = generation effect; course-wide interleaved practice); app/lib/markdown.tsx (P1-10 heading ids for TOC), app/components/TableOfContents.tsx + app/components/Skeletons.tsx + app/lib/study.test.ts (S4: TOC, loading skeletons, closed-book + slug unit tests); docs/ROADMAP.md (v4: P0/P1/P2 audit items marked executed); docs/CHANGELOG.md (this entry)
- CHANGE: Executed the full post-build audit (ROADMAP §7.6) in one pass. Foundation (me) laid shared contracts and fixed the shared-file items; four subagents (S1 attempts+scheduler, S2 metacog, S3 question-bank+interleaved, S4 TOC+skeletons+tests) built the independent verticals in parallel on disjoint new files. Result: every P0 correctness bug fixed (grounding, closed-book, attempt persistence, essay prompt), the P1 learning loop shipped (metacognitive prompts, spaced-repetition scheduler over persisted attempts, interleaved practice, student-authored MCQs, week/due-date + standardized terminology, TOC + tab a11y), and the P2 polish items done (type unify, dead-path removal, error surfacing, component/unit tests, skeletons).
- WHY: ROADMAP §7.6 — close the learning-science loop the audit identified. P0 integrity (R2 grounding, R8 leaky closed-book, R9 no spacing) blocked trust in the product; P1 realizes the core "head-start + retrieval practice" value prop (Bjork desirable difficulties; metacognitive meta-analyses g=0.40–0.50; Pan generation effect d=0.29–0.45; 2026 study-app benchmarks: active recall + spacing + self-edited cards = winning combo).
- RULE: G0/E0/I0 (logged). CI re-run end-to-end: `bash scripts/ci.sh` PASS — eslint clean (0 problems), `tsc --noEmit` clean, `vitest run` 27/27 (added 17 tests across scheduler + study). Local smoke test (dev server, never Vercel): GET / 200, /api/courses 200, /api/attempts 200, /api/questions 200, POST /api/synthesize without topicId -> 400 (dead path removed). No secrets in client; Gemini key server-side only.

---

## [2026-08-18 | 12:34 WIB | Tuesday | 18 August 2026]
- FILE: docs/ROADMAP.md (rewritten v3, lines 1–~330), docs/CHANGELOG.md (title -> So-study; this entry), docs/RESEARCH.md (to be extended with audit sources)
- CHANGE: Folded the 2026-08-18 code+research audit into the roadmap. Added per-item
  status (✅ done / 🟡 done-with-issues / ❌ not done) across Phases 0–3 based on the
  ACTUAL current code (not aspirational). Integrated the audit's findings as §7.6
  "Post-build audit" with prioritized P0 (correctness: excerpt paperId[0] bug, leaky
  closed-book, no attempt persistence, untethered essay), P1 (learning loop:
  metacognitive prompts, spaced-repetition scheduler, interleaving, generation effect,
  terminology+week/due-date, TOC, a11y), P2 (polish/tech debt: duplicate MCQQuestion
  type, two lib areas, dead legacy synthesize path, component tests, swallowed errors,
  input guards, Prisma singleton). Added planned `AssessmentAttempt` entity and noted
  `Excerpt.paperId` is currently wrong. Expanded Risk Register (R8 leaky closed-book,
  R9 no persistence, R10 passive consumption, R11 terminology) and Success Metrics
  (attempts practiced, spacing adherence). Updated Tech Decisions: DB = local SQLite
  now, Turso deferred; deploy deferred to Phase 3; project location resolved to
  /home/habel-davidson/so-study. Every audit claim carries file:line citations.
- WHY: User asked to make the review "part of the roadmap" and to show what's done vs
  not. The prior roadmap (v2) was plan-only with no done/not-done tracking, so progress
  was invisible. The audit's research (Bjork desirable difficulties, metacognitive-
  prompt meta-analyses g=0.40–0.50, Mayer CTML, feedback-timing RCTs, 2026 study-app
  benchmarks) is the evidence base for the P0/P1 fixes and is archived in docs/RESEARCH.md.
- RULE: G0/E0/I0 (logged). No code changes — documentation only, so E3/G10 not re-run
  (unchanged since 12:21 entry).

---

## [2026-08-18 | 12:21 WIB | Tuesday | 18 August 2026]
- FILE: docs/RESEARCH.md (new); app/page.tsx (rewritten: course→topic dashboard + progress + "ready before lecture" framing); app/components/Sidebar.tsx (rewritten: course switcher); app/components/Composer.tsx (defaultCourseId prop); app/components/Workspace.tsx (closed-book "mode tertutup" + retrieval-practice hint + 44px tab targets); app/layout.tsx + app/manifest.ts + package.json (rename anthro-study -> So-study); docs/whitepaper/* + docs/ROADMAP.md (project name -> So-study); docs/CHANGELOG.md (this entry)
- CHANGE: Re-grounded the UI/UX in the whitepaper's actual intent after user said it felt "weird / not suited." The app is a per-course, per-topic **pre-lecture head-start kit** (Read → Ask → Practice), not a chatbot. New navigation: Sidebar = course switcher; main = a course dashboard listing that course's topics (pending) and modules (ready) with a progress bar "X/N topik siap" and a persistent "head-start, not a substitute for lecture" note. Selecting a module opens the reader; selecting a topic opens the paper-approval gate. Workspace adds a closed-book "mode tertutup" so practice questions are answered before peeking (retrieval practice = highest-leverage activity per Roediger/Karpicke, Science 2006/2008; Karpicke & Blunt, Science 2011; Agarwal closed-book > open-book), plus an evidence-based hint and iPad-sized 44px tab targets. Product renamed anthro-study -> So-study everywhere (package.json, metadata, manifest, docs). Added docs/RESEARCH.md summarizing verified learning-science sources.
- WHY: User feedback that the UI was unfit for the use case. The prior layout mixed a sidebar of modules+topics with flat Baca/Tanya/Latih/Sumber tabs and no course container or progress — no single mental model, not iPad-native, no "ready before lecture" visibility. Research confirms: (1) retrieval practice >> rereading, (2) spaced + pre-lecture prep drives flipped-classroom gains, (3) tracking preparation per topic sustains compliance. The redesign makes the course/topic structure and the practice-first, retrieval-based loop explicit.
- RULE: G0/E0/I0 (logged), E3 (eslint clean 0 problems, tsc --noEmit clean), G10 (vitest 10/10 unchanged), G13 (no any), E4/I8/I10 (keys server-side).

---

## [2026-08-18 | 09:10 WIB | Tuesday | 18 August 2026]
- FILE: app/api/modules/[id]/courses/route.ts (added DELETE, lines ~48–85), app/api/modules/[id]/route.ts (added DELETE, lines ~7–21), app/components/Workspace.tsx (props + delJSON + removeFromCourse + deleteModule + header controls), app/page.tsx (handleModuleChanged/handleModuleDeleted callbacks passed to Workspace), docs/CHANGELOG.md (this entry)
- CHANGE: User can now (1) delete a module entirely and (2) unlink ("change") a module from a matakuliah. New `DELETE /api/modules/[id]/courses` removes a single CourseModule link (by courseId or courseName) without touching the module or its other links — paired with the existing POST "Tambah", this is how a module is moved to another matakuliah. New `DELETE /api/modules/[id]` deletes the module; Prisma cascade removes its versions/chunks/excerpts/course links and the associated topic (plus topic papers/sessions/assessments). UX: Workspace header has a "Hapus modul" button (window.confirm guard) and each course chip gets a "×" to lepas from that matakuliah; both refresh the sidebar via onModuleChanged, and delete clears the selection via onModuleDeleted.
- WHY: Direct follow-up to the user's request: "user can delete or change the modul to another matakuliah." The many-to-many CourseModule model (added 01:32) already allowed ADD; DELETE completes the edit/relocate capability so a mis-assigned matakuliah can be corrected or the module removed entirely.
- RULE: G0/E0/I0 (logged), E3 (eslint clean 0 problems, tsc --noEmit clean), G10 (vitest 10/10 unchanged), G13 (no any), E4/I8/I10 (API keys stay server-side; no client secrets).

---

## [2026-08-18 | 01:32 WIB | Tuesday | 18 August 2026]
- FILE: prisma/schema.prisma (CourseModule many-to-many + Course.name @unique), app/api/courses/route.ts (new: GET list grouped by course w/ modules + in-progress topics; POST create course), app/api/modules/[id]/courses/route.ts (new: link module to a course by id or name), app/api/synthesize/route.ts (accept courseId/courseIds, link module to courses), app/api/modules/[id]/route.ts (include courses), src/lib/topics.ts (ensureTopic accepts courseId), app/lib/types.ts (CourseSummary/ModuleRef/TopicRef/MCQQuestion.explanation), app/components/Sidebar.tsx (grouped by matakuliah), app/components/Composer.tsx (pick/create matakuliah), app/components/Workspace.tsx (shows matakuliah chips + add-to-course + MCQ explanation), app/page.tsx (courses fetch, module selection, course-aware flow), app/api/mcq/route.ts (rewritten: LLM conceptual MCQ w/ salvage parser; deterministic fallback kept), docs/CHANGELOG.md (this entry)
- CHANGE: Rethink driven by user feedback that the UI conflated matakuliah and modul and that MCQ was nonsense. (1) Decoupled modul from a single matakuliah: added `CourseModule` join so a Module belongs to MANY Courses (old Module->Topic->Course 1:1:1 silently locked it). Sidebar is now grouped by Matakuliah, listing each module under every course it belongs to; Composer lets you pick/create the matakuliah; Workspace shows the module's courses and can add it to more. Hardcoded course name removed from header/sidebar. (2) Replaced the broken MCQ generator (mechanical cloze-fill with repeated random-word distractors) with an LLM that writes conceptual understanding questions (why/how/compare), 4 distinct plausible options, and a short grounded explanation; grading highlights correct/wrong + shows the explanation. Deterministic generator retained only as an offline fallback.
- WHY: matakuliah != modul; a concept module (e.g. Teori Pertukaran Simbolik) is reusable across courses (Antropologi, Sosiologi). The old MCQ tested nothing important and reused the same distractor pool every question — exactly the "choices are the same / not intuitive" complaint.
- RULE: G0/E0/I0 (logged), E3 (eslint clean), G10 (tsc clean; tests 10/10), G13 (no any). E2E smoke (local dev, never Vercel): `/api/courses` 200 grouped by course; linking a module to a second course makes it appear under both; `/api/mcq` returns generatedBy:"llm" with distinct conceptual questions + explanations (verified on real module content).

---

## [2026-08-18 | 00:40 WIB | Tuesday | 18 August 2026]
- FILE: app/api/topics/route.ts (new), app/components/Sidebar.tsx (rewritten: topic list + status pills), app/page.tsx (topics fetch + handleSelectTopic re-opens gate), app/lib/markdown.tsx (clickable [n] citations), app/lib/types.ts (TopicSummary added), app/components/Workspace.tsx (onCite -> Sumber tab + highlight/scroll), app/api/modules/[id]/route.ts (preserve sourcePaperIds order), app/api/synthesize/route.ts (prompt requires inline [n] citations), docs/CHANGELOG.md (this entry)
- CHANGE: Two UI/UX improvements. (1) Topic status visibility: new `GET /api/topics` returns topics with status + moduleId; Sidebar now lists Topics (not just modules) with a colored status pill (Menunggu / Paper diambil / Disetujui / Modul dibuat / Siap) so the retrieval->approval->synthesis lifecycle is observable. Clicking a topic with a module opens it; clicking one without re-opens its `PaperReview` approval gate (fetch `/api/papers/[id]`). (2) Inline "show source": synthesis prompt now requires inline `[n]` citations mapped to a numbered "Sources:" list; `Markdown` renders `[n]` as clickable superscripts; clicking jumps to the Sumber tab and highlights/scrolls the matching paper. `GET /api/modules/[id]` now preserves `sourcePaperIds` order so citation index n maps to the correct paper.
- WHY: ROADMAP Phase 2 + trust/grounding. #1 makes the human gate visible between steps (previously a topic was invisible until synthesized). #2 surfaces claim->paper grounding inline in the reader instead of a separate tab.
- RULE: G0/E0/I0 (logged), E3 (eslint clean, 0 problems), G10 (tsc clean; tests 10/10), G13 (no any). E2E smoke (local dev, never Vercel): `/api/topics` 200 with statuses; re-synthesized approved topic -> content contains `[1]`/`[2]` markers + ordered Sources; `/api/modules/[id]` sourcePapers order matches citation indices.

---

## [2026-08-18 | 00:16 WIB | Tuesday | 18 August 2026]
- FILE: src/lib/openalex.ts (already real; verified live), src/lib/topics.ts (new), app/api/retrieve/route.ts (new), app/api/papers/[topicId]/route.ts (new: GET + PATCH), app/api/synthesize/route.ts (edited: gated to approved papers; extracted ensureTopic), app/lib/types.ts (CandidatePaper added), app/components/PaperReview.tsx (new), app/page.tsx (gated flow), .gitignore (.cache/ added), docs/CHANGELOG.md (this entry)
- CHANGE: Completed the deferred "paper retrieval/approval gate" (ROADMAP §6 Phase 0). OpenAlex retrieval was already real and network-verified (live works?yes; cached to .cache/openalex). Added a two-step gated flow: (1) `POST /api/retrieve` calls OpenAlex, caches the response, upserts candidate Papers + TopicPaper(approved:false) for the topic and returns them; (2) `GET /api/papers/[topicId]` lists candidates with approval state, `PATCH /api/papers/[topicId]` sets the approved subset (the human gate). Synthesis now enforces the gate: with a `topicId` it synthesizes ONLY from approved TopicPapers (400 if none approved); the legacy title-only path still retrieves+synthesizes in one shot. UI: Composer -> `POST /api/retrieve` -> new `PaperReview` bottom sheet (checkboxes, source links, relevance/citations) -> PATCH approvals -> `POST /api/synthesize` with topicId. `ensureTopic` extracted to src/lib/topics.ts and shared. `.cache/` gitignored.
- WHY: ROADMAP Phase 0 requires Topic -> papers -> human approve -> module -> read; previously synthesis fetched+used ALL papers inline, ignoring TopicPaper.approved. The human review/approval gate (R1 mitigation, grounded sourcing) was missing. User directed: build real OpenAlex calls now.
- RULE: G0/E0/I0 (logged), E3 (lint + tsc clean, 0 problems), G10 (tests 10/10), E4/I8/I10 (API keys server-side only), react-hooks/set-state-in-effect disabled only where effects drive fetches (page.tsx:3). E2E smoke (local dev, never Vercel) confirmed: retrieve 200 (real OpenAlex), GET 200, gate 400 when unapproved, PATCH approve 200, synthesize 200 (real Gemini, ~1574in/1637out tokens).

---

## [2026-08-18 | 00:02 WIB | Tuesday | 18 August 2026]
- FILE: app/components/Workspace.tsx (verified, no change); docs/CHANGELOG.md (this entry, added)
- CHANGE: Verified lint gates after the UI/UX rework. Confirmed `react-hooks/set-state-in-effect` is triggered only in `app/page.tsx` (already disabled at line 3 via the established convention); `Workspace.tsx` has no effects, so no disable directive was added there (an added/vestigial disable would itself emit an "unused eslint-disable" warning). Re-ran gates: `eslint .` clean (0 errors/warnings), `tsc --noEmit` clean, `vitest run` 10/10. Local smoke test (dev server, never Vercel): `GET /` 200, `/manifest.webmanifest` 200, `/api/usage` 200, `/api/modules/<existing-id>` 200, `/api/modules/nonexistent` 404. UI/UX phase gates are green.
- WHY: Close out the remaining "Workspace.tsx eslint-disable" item from the UI/UX phase checklist; the premise was incorrect, so the fix was a no-op confirmation rather than an edit.
- RULE: E3 (lint + tsc clean before run), G10 (tests pass 10/10), G0/E0/I0 (logged).

---

## [2026-08-17 | 22:31 WIB | Monday | 17 August 2026]
- FILE: project root / package.json (33 lines, edited) + app/ tsconfig.json next.config.ts eslint.config.mjs .gitignore README.md AGENTS.md CLAUDE.md node_modules/
- CHANGE: Scaffolded Next.js (App Router) + TypeScript + Tailwind + ESLint baseline via create-next-app into `/home/habel-davidson/anthro-study`; `docs/` preserved (not clobbered). Renamed package name to `anthro-study`.
- WHY: Phase 0 execution start (ROADMAP §6). Baseline gives a runnable, correctly-configured Next.js app with zero-config Vercel deploy path.
- RULE: I1 (architecture conformance), G3 (justified deps), G0/E0/I0 (logged).

## [2026-08-17 | 22:31 WIB | Monday | 17 August 2026]
- FILE: package.json (scripts added) + node_modules/
- CHANGE: Installed `prisma@^6`, `@prisma/client@^6`, `vitest@^4` (dev). Added scripts: test, ci, db:generate, db:push.
- WHY: ORM for the v2 schema + a test runner required by rule G10. Pinned Prisma to v6 because v7 removed `url` from schema (needs prisma.config.ts + adapter) — v6 keeps `url=env()` and `prisma db push` simple for local-first Phase 0 (documented in schema header for Turso swap at deploy).
- RULE: G3 (justified dep), G13 (pinned/clean), G0/E0/I0 (logged).

## [2026-08-17 | 22:31 WIB | Monday | 17 August 2026]
- FILE: prisma/schema.prisma (lines 1–143, new)
- CHANGE: Created Prisma schema with all v2 entities: Course, Topic, Paper, TopicPaper (many-to-many join), Module, ModuleChunk (RAG embeddings), Excerpt (claim→quote→paper grounding), ModuleVersion (regenerate diffs), QASession, Assessment (rubric + grounded), RPSReconcile (custom vs official diff), AIUsage (cost). Validated OK; `prisma db push` created dev.db and synced.
- WHY: Canonical data model from ROADMAP §5 / WHITEPAPER_TECHNICAL §3. Grounding + versioning + reconciliation + cost observability encoded as schema.
- RULE: I1, I6 (schema=migration), I5 (grounding), I0/G0/E0/I0 (logged).

## [2026-08-17 | 22:31 WIB | Monday | 17 August 2026]
- FILE: src/lib/scoring.ts (lines 1–90, new); src/lib/openalex.ts (lines 1–128, new); src/lib/scoring.test.ts (lines 1–61, new)
- CHANGE: Pure deterministic `relevanceScore` + `selectShortlist` (max(2, top-quartile) floor + recency fallback) in scoring.ts; OpenAlex retrieval with local response caching + typed response in openalex.ts; 7 unit tests in scoring.test.ts (all passing).
- WHY: Stage 1 heuristic retrieval (ROADMAP §6 / WHITEPAPER §4). No LLM call; bounded token use; tests satisfy rule G10. Types satisfy G13 (no `any`, lint clean).
- RULE: G4/G5/G13 (clean, typed, bounded), G10 (tests), E3 (gates), G0/E0/I0 (logged).

## [2026-08-17 | 22:31 WIB | Monday | 17 August 2026]
- FILE: scripts/ci.sh (lines 1–18, new, chmod +x); .env (lines 1–4, new)
- CHANGE: CI gate script: `prisma generate` → `npm run lint` → `npx tsc --noEmit` → `npx vitest run`, failing fast (set -e). `.env` sets `DATABASE_URL="file:./dev.db"` and empty `ANTHROPIC_API_KEY`.
- WHY: Rule E3 (gates before run) + G10 (tests required) + I10 (secrets via env). CI executed end-to-end: PASS (generate/lint/typecheck/7 tests).
- RULE: E3, G13 (zero warnings), I8 (invariants), G0/E0/I0 (logged).

## [2026-08-17 | 22:31 WIB | Monday | 17 August 2026]
- FILE: dev.db (created via `prisma db push`)
- CHANGE: Local SQLite database materialized and synced with schema (143 lines). Verify step for Phase 0 foundation.
- WHY: Local-first runnable store; Turso swap documented for Vercel deploy (ROADMAP §4/§6).
- RULE: I6 (schema→db), G0/E0/I0 (logged).

## [2026-08-17 | 22:12 WIB | Monday | 17 August 2026]
- FILE: docs/ROADMAP.md (lines 1–251, rewritten v2)
- CHANGE: Folded pre-execution review into the roadmap. Added Section 7
  "Pre-Execution Improvements" (4 areas + do-first list). Sharpened data model:
  added `Course` (multi-course), `TopicPaper` many-to-many join (paper
  deduplication), `Excerpt` (claim→quote→paper), `ModuleVersion` (regenerate
  diffs), `RPSReconcile` (custom vs official diff), `AIUsage` (cost). Revised
  Phase 0 to include CI/tests + RAG Q&A + OpenAlex caching + dedupe; pulled
  RPS reconcile + multi-course batch import earlier (Phase 1). Risk register R1/R2
  mitigations updated. Renumbered Change Governance to Section 11.
- WHY: User instruction "okay do it" — incorporate the four-area improvement
  review so the agent builds from a sharper spec. Addresses wrong grounding (R2)
  and wrong order (R1) failure modes while protecting running-cost constraint.
- RULE: G0/E0/I0 — change logged.

## [2026-08-17 | 22:12 WIB | Monday | 17 August 2026]
- FILE: docs/whitepaper/WHITEPAPER_TECHNICAL.md (lines 1–306, rewritten v2)
- CHANGE: Updated technical whitepaper to v2. New data model with `Course`,
  `TopicPaper`, `ModuleChunk` (embeddings for RAG), `Excerpt`, `ModuleVersion`,
  `RPSReconcile`, `AIUsage`. Stage 1 now caches OpenAlex responses + uses
  `max(2, top-quartile)` citation floor. Stage 2 extracts `Excerpt` rows + chunks
  + embeddings + `ModuleVersion`. Stage 3 rewritten as retrieval-augmented Q&A
  (embed → retrieve 3–5 chunks → inject only those, streamed). Added cost
  observability (AIUsage panel) and Section 9 "Pre-Execution Improvements
  (incorporated)". Stack table updated (RAG, Ollama, CI).
- WHY: Keep technical spec consistent with the improved roadmap; gives the agent
  concrete schema + pipeline detail for grounding, RAG, and cost visibility.
- RULE: G0/E0/I0 — change logged.

## [2026-08-17 | 21:59 WIB | Monday | 17 August 2026]
- FILE: docs/whitepaper/WHITEPAPER_ABOUT.md (lines 1–132, rewritten)
- CHANGE: Translated the "About" whitepaper from Indonesian to English. All
  project documents are now English. Structure and content preserved (10 sections,
  Mermaid flow, cost/non-goals/safety). Line count 129 -> 132.
- WHY: User requirement: "all of it needs to be written in english."
- RULE: G0/E0/I0 — change logged.

## [2026-08-17 | 21:25 WIB | Monday | 17 August 2026]
- FILE: docs/CHANGELOG.md (lines 1–<this>, new file)
- CHANGE: Created this changelog; seeded with entries for all six documents.
- WHY: Satisfy the requirement that ALL changes are logged with timestamp and
  file:line location for AI code-execution accountability.
- RULE: G0 / E0 / I0 — meta rule instantiated.

## [2026-08-17 | 21:24 WIB | Monday | 17 August 2026]
- FILE: docs/rules/RULESET_CODE_IMPLEMENTATION.md (lines 1–79, new file)
- CHANGE: Created rule set #3 — CODE IMPLEMENTATION (architecture conformance,
  human-in-the-loop gates, grounding, schema=migration+changelog). 12 rules + I0 meta.
- WHY: Ensures generated code fits THIS system and respects domain safety.
- RULE: G0/E0/I0 — entry created.

## [2026-08-17 | 21:23 WIB | Monday | 17 August 2026]
- FILE: docs/rules/RULESET_CODE_GENERATION.md (lines 1–87, new file)
- CHANGE: Created rule set #1 — CODE GENERATION (NASA + Google/MS SDL/Amazon/
  MISRA/Linux). 15 rules + G0 meta logging rule.
- WHY: First of three correlated rule sets for AI code execution.
- RULE: G0/E0/I0 — entry created.

## [2026-08-17 | 21:23 WIB | Monday | 17 August 2026]
- FILE: docs/rules/RULESET_CODE_EXECUTION.md (lines 1–76, new file)
- CHANGE: Created rule set #2 — CODE EXECUTION (isolation, pinned deps, gates,
  fail-stop, observability, human approval). 12 rules + E0 meta.
- WHY: Governs how generated/implemented code is run.
- RULE: G0/E0/I0 — entry created.

## [2026-08-17 | 21:21 WIB | Monday | 17 August 2026]
- FILE: docs/whitepaper/WHITEPAPER_ABOUT.md (lines 1–129, new file — original ID;
  superseded by English version at 21:59)
- CHANGE: Created "About" whitepaper (originally Indonesian).
- WHY: Explain what the app is to a non-technical reader.
- RULE: G0/E0/I0 — entry created.

## [2026-08-17 | 21:21 WIB | Monday | 17 August 2026]
- FILE: docs/whitepaper/WHITEPAPER_TECHNICAL.md (lines 1–198, new file —
  superseded by v2 above)
- CHANGE: Created "Technical" whitepaper (English) v1.
- WHY: Explain the architecture to developers/agent.
- RULE: G0/E0/I0 — entry created.

## [2026-08-17 | 21:20 WIB | Monday | 17 August 2026]
- FILE: docs/ROADMAP.md (lines 1–180, new file — superseded by v2 above)
- CHANGE: Created detailed project roadmap v1.
- WHY: Source-of-truth plan per user request.
- RULE: G0/E0/I0 — entry created.

## [2026-08-17 | WIB | Monday | 17 August 2026]
- FILE: .env (lines 1–4); docs/whitepaper/WHITEPAPER_TECHNICAL.md; docs/whitepaper/WHITEPAPER_ABOUT.md; docs/ROADMAP.md; docs/rules/RULESET_CODE_EXECUTION.md
- CHANGE: Swapped the LLM provider from Anthropic/Claude to Google Gemini. `.env` now sets `GEMINI_API_KEY` (was `ANTHROPIC_API_KEY`); all provider-identity references in the planning docs updated to Gemini.
- WHY: Use Gemini as the generation/synthesis/grading backend. Rule I8 (secrets via env) preserved; key kept server-side (rule E4/I10).
- RULE: E4, I8, I10, G0/E0/I0 (logged).

## [2026-08-17 | WIB | Monday | 17 August 2026]
- FILE: src/lib/gemini.ts (new); src/lib/prisma.ts (new); src/lib/aiusage.ts (new); app/api/synthesize/route.ts (new); app/api/qa/route.ts (new); app/api/grade/route.ts (new)
- CHANGE: Implemented the Gemini-backed LLM service layer the whitepaper specifies. `gemini.ts` is a fetch-based `generate()` client (no SDK dep, key from `GEMINI_API_KEY`, default model `gemini-3.6-flash`, overridable via `GEMINI_MODEL`). `prisma.ts` is the client singleton; `aiusage.ts` logs every call to the `AIUsage` table with token counts + estimated cost. Three route handlers cover Stage 2/3/4: `/api/synthesize` (retrieve → bounded synthesis), `/api/qa` (RAG-scoped, refuses out-of-source), `/api/grade` (rubric-grounded essay feedback). All server-side only.
- WHY: Continuation of the Anthropic→Gemini switch; makes the LLM features in the planning docs actually executable. Validated the key live (HTTP 200 on `gemini-3.6-flash`).
- RULE: E4 (key server-side, not NEXT_PUBLIC_), I8/I10 (secrets via env, logged not printed), G10 (tests pass: 7/7), E3 (lint + tsc clean).

## [2026-08-17 | WIB | Monday | 17 August 2026]
- FILE: app/page.tsx (rewritten); app/api/mcq/route.ts (new); app/api/modules/route.ts (new); app/api/synthesize/route.ts (edited: persistence); src/lib/mcq.ts (new); src/lib/mcq.test.ts (new); prisma/schema.prisma (Paper.sourceUrl @unique); app/layout.tsx (metadata)
- CHANGE: (1) Replaced boilerplate `page.tsx` with a minimal local test UI (Tailwind) that drives Synthesize / Q&A / Grade / MCQ from the browser. (2) Added deterministic MCQ generator (`mcq.ts`, no API) + `/api/mcq` route + exact-match grading in UI; unit-tested (10/10 tests pass). (3) Wired Module/Excerpt persistence into `/api/synthesize`: upserts Papers (dedupe by sourceUrl) + TopicPaper links, then stores Module + ModuleChunk + ModuleVersion (re-synthesis = new version, never overwrite) + Excerpt rows; added `/api/modules` GET to list stored modules. Schema: `Paper.sourceUrl` now `@unique` (supports Stage-1 dedupe); migrated via `prisma db push --accept-data-loss` + `prisma generate`.
- WHY: Execution of the three requested next steps. UI lets the user test locally before any Vercel deploy; MCQ avoids API cost; persistence makes synthesized modules durable (whitepaper §4).
- RULE: E4 (key server-side), G10 (tests 10/10), G13/E3 (lint + tsc clean via `npm run lint`/`tsc --noEmit`), I8/I10 (secrets via env), G0/E0/I0 (logged).

## [2026-08-17 | WIB | Monday | 17 August 2026]
- FILE: app/page.tsx (rewritten); app/layout.tsx (metadata + viewport); app/globals.css (base font/theme); app/manifest.ts (new); app/lib/types.ts (new); app/lib/markdown.tsx (new); app/components/Sidebar.tsx (new); app/components/Composer.tsx (new); app/components/Workspace.tsx (new); app/components/UsageModal.tsx (new); app/api/modules/[id]/route.ts (new); app/api/usage/route.ts (new)
- CHANGE: Full UI/UX rework to match the product described in the whitepaper (course-aware, per-topic study kit) instead of the flat dev harness. New app shell: sticky header (online dot, "Biaya AI", "+ Modul"), left sidebar listing stored modules, and a Workspace with four tabs — Baca (rendered Markdown reader), Tanya (RAG-scoped Q&A), Latih (deterministic MCQ + rubric-grounded essay grade, with localStorage draft autosave), Sumber (source papers for grounding + module version history). Composer modal drives synthesis. Added two read-only endpoints the UI needs: `/api/modules/[id]` (content + source papers + versions) and `/api/usage` (cost summary for the Biaya AI panel). PWA manifest + theme-color/appleWebApp metadata added for iPad "Add to Home Screen". Offline state detected and surfaced; read stays available, Tanya/Latih ask for connection.
- WHY: User directed UI/UX to be fully worked on before further backend. The app as built diverged from the whitepaper's product framing (it was a raw 4-box test page); this aligns the front-end to the intended Read→Ask→Test + grounding/cost flow. Backend features not yet present in UI (paper retrieval/approval gates, RPS reconcile) remain deferred to the backend phase.
- RULE: G0/E0/I0 (logged), E3/G10 (lint + tsc clean), E4/I8/I10 (no secrets in client; API keys stay server-side), react-hooks/set-state-in-effect disabled only where effects drive API fetches (per existing convention).

---
END OF LOG (entries are append-only; new changes go above this line with a new dated block).
