# VERIFICATION / RECONCILIATION REPORT — 2026-08-21

**Task:** Reconcile actual repository state against `docs/CHANGELOG.md` claims,
specifically a "WHY" brief asserting 5 tasks are missing from both the CHANGELOG
and the most-recently-exported zip, plus an `END OF LOG` ordering defect.

**Method:** Ground truth established from the repository itself. No features were
re-implemented, rebuilt, or modified except the CHANGELOG formatting reorder
explicitly requested in Step 3 (which is a reorder-only change, no entry content
altered). No feature code was touched.

**Headline conclusion:** The 5 tasks named in the "WHY" brief are **all present**
in the current working tree, in the most-recent export (`so-study-validation-2026-08-21.zip`),
and in the older export present in the tree (`so-study-validation.zip`). The
"missing" premise does not match this repository. The CHANGELOG **ordering**
defect, however, is real and has been fixed.

---

## STEP 1 — Actual current state (raw output)

### 1. `git log --oneline -40`
```
ddcd2c4 Initial commit from Create Next App
```
Only ONE commit exists. All feature work is untracked (see #2).

### 2. `git status`
```
On branch main
Changes not staged for commit:
	modified:   .gitignore
	modified:   README.md
	modified:   app/globals.css
	modified:   app/layout.tsx
	modified:   app/page.tsx
	modified:   package-lock.json
	modified:   package.json

Untracked files:
	app/api/  app/components/  app/lib/  app/manifest.ts  app/page.dom.test.tsx
	docs/  prisma/  public/...  scripts/  so-study-validation-2026-08-21.zip
	so-study-validation.zip  src/  vercel.json  vitest.config.mts  vitest.setup.ts
```
19 files are committed (the Create-Next-App scaffold); 19 feature directories/files
are **untracked**. There is effectively no git history of any feature — the
CHANGELOG is the only audit trail and cannot be cross-checked against git.

### 3. `grep -rn "responseSchema\|responseMimeType" src/lib/gemini.ts`
```
38: * A Gemini `responseSchema` (an OpenAPI-3-subset schema object). Typed loosely on
59:  responseMimeType?: "application/json" | "text/plain";
60:  responseSchema?: GeminiResponseSchema;
72:  if (opts.responseMimeType) cfg.responseMimeType = opts.responseMimeType;
73:  else if (opts.responseSchema) cfg.responseMimeType = "application/json";
74:  if (opts.responseSchema) cfg.responseSchema = opts.responseSchema;
```
→ **Item 1 PRESENT.**

### 4. `grep -rn "5W1H\|pickCategory\|categorySelector" src/lib/essay.ts`
```
4:// 5W1H essay question still needs generation. Generation is schema-validated
96:// The question must be built AROUND 5W1H (Apa/Siapa/Kapan/Di mana/Mengapa/
100:  "sekitar kerangka 5W1H (Apa, Siapa, Kapan, Di mana, Mengapa, Bagaimana) ..."
144:// Deterministic 5W1H essay harness (0% AI, offline, always succeeds)
162:export function generateEssayPromptHarness(moduleText, topicTitle?): string
186:export async function generateEssayPromptWithFallback(...)
202:function extractKeyConcepts(content): string[]
241:export function buildEssayRubric(content): string
```
No symbol literally named `pickCategory`/`categorySelector`, but the substantive
feature — a **deterministic 5W1H essay harness** (`generateEssayPromptHarness`,
`generateEssayPromptWithFallback`, `buildEssayRubric`) — **is present**. →
**Item 2 PRESENT** (naming difference only).

### 5. `find . -iname "*push*"` (+ grep web-push/VAPID/soso)
```
./app/api/push
./app/components/PushOptIn.tsx
./app/api/push/send/route.ts  (+ route.test.ts)
./app/api/push/subscribe/route.ts (+ route.test.ts)
./app/api/cron/daily-reminder/route.ts (+ route.test.ts)
./app/components/SosoReminder.dom.test.tsx
./app/components/SosoOnboarding.tsx (+ .dom.test.tsx)
./prisma/migrations/20260821000000_push_notifications/
```
→ **Item 3 PRESENT** (push/VAPID/Soso reminders fully implemented).

### 6. `grep -n "Rangkuman bab\|Daftar istilah kunci\|Gagné" app/api/synthesize/route.ts`
```
55: ... kerangka instruksional Gagné (sembilan peristiwa pembelajaran) ...
63: ... Contoh konkret ... (Gagné event 5: learner guidance) ...
66:6. Rangkuman bab — ringkasan akhir modul (Gagné event 9 ...) ...
67:7. Daftar istilah kunci (glosarium) ...
```
→ **Item 4 PRESENT** (Gagné restructure + Rangkuman bab + Daftar istilah kunci
all in the synthesis prompt). The ~10-page/5000-word floor + targeted expansion
lives in `src/lib/pages.ts` (verified present in tree).

### 7. `find . -iname "*gauge*" -o -iname "*Reliability*" -o -iname "*accuracy*"`
```
./app/components/ReliabilityGauge.tsx
./app/components/ReliabilityGauge.dom.test.tsx
./prisma/migrations/20260821203000_module_accuracy_verification/
./src/lib/gauge.test.ts
./src/lib/gauge.ts
```
→ **Item 5 (accuracy gate + reliability gauge) PRESENT.**

PDF bug fixes are present in `src/lib/pdf.ts`: `sanitizeCell` (dangling `[` BUG 3),
`fi`/`fl` ligature handling (BUG 4), `topicTitle` used in header/footer (BUG 1
topic-title substitution), table-cell sanitization.

### 8. CHANGELOG size + out-of-order entries
```
wc -l docs/CHANGELOG.md  →  771 (before fix)
grep "END OF LOG"        →  line 755-756
grep "2026-08-19"        →  03:13 WIB entry at line 758  (AFTER line 755 END OF LOG
                             AND after the 16:35 WIB entry at line 742)
```
The `2026-08-19 | 03:13 WIB` entry was appended to the **bottom of the file,
after the `END OF LOG` marker**, and is chronologically out of place (03:13 is the
earliest 2026-08-19 timestamp; it belongs between `13:41` and the 2026-08-18
cluster). The full file was also tangled (an Aug-17/Aug-18 block sat below an
Aug-19 early-evening block; within the Aug-19 Thursday cluster the order was
18:20 → 19:25 → 19:07 instead of 19:25 → 19:07 → 18:20).

---

## STEP 2 — Discrepancy analysis for the 5 named items

For each item, the applicable classification:

| # | Item | Status in repo | Classification |
|---|------|---------------|----------------|
| 1 | Gemini structured output (`responseSchema`/`responseMimeType`) | **Present** (`src/lib/gemini.ts:38-74`) | Not (a)/(b)/(c) — present |
| 2 | 5W1H deterministic category selector in essay generation | **Present** (`src/lib/essay.ts` harness) | Not (a)/(b)/(c) — present (naming differs) |
| 3 | Push notifications (Soso, VAPID/web-push) | **Present** (`app/api/push`, `SosoOnboarding`, migration `20260821000000_push_notifications`) | Not (a)/(b)/(c) — present |
| 4 | Gagné synthesis restructure + page floor + Rangkuman/Daftar sections | **Present** (`app/api/synthesize/route.ts:55-67`, `src/lib/pages.ts`) | Not (a)/(b)/(c) — present |
| 5 | PDF bug fixes + accuracy gate + reliability gauge | **Present** (`src/lib/pdf.ts`, `src/lib/gauge.ts`, `app/components/ReliabilityGauge.tsx`) | Not (a)/(b)/(c) — present |

- **(a) Never started — false** for all five; code artifacts exist with file:line.
- **(b) Lost in stash/branch/reflog — false** for all five. `git stash list` is
  empty; `git reflog` shows only resets to `HEAD` and the single initial commit.
  No alternate local state exists.
- **(c) Dropped by the export step — false** for all five. Verified directly:
  - `so-study-validation-2026-08-21.zip` (most recent) contains
    `src/lib/gemini.ts`, `src/lib/essay.ts`, `app/api/push/**`, `app/components/PushOptIn.tsx`,
    `app/api/synthesize/route.ts`, `app/components/ReliabilityGauge.tsx`, `src/lib/gauge.ts`,
    and both relevant migrations.
  - `so-study-validation.zip` (older, dated 16:29) contains the same set.
  Both zips were built from the working tree (excluding `node_modules`/`.git`/`.next`),
  so they capture the full feature set.

**Explanation of the "WHY" brief:** The brief asserts these 5 tasks are absent from
the CHANGELOG and from the export. The repo contradicts both assertions — the code
is present and the CHANGELOG already documents Gagné (15:30 WIB entry), the essay
5W1H harness (17:25 WIB entry), push notifications, and the accuracy gate/gauge
(21:46 WIB entry). The most probable explanations, in order:
  1. The brief was authored against a **misread or a different/imagined export**,
     not this repository's actual state.
  2. It is a **deliberate false-premise control** to confirm the verification is
     done against the repo, not the narrative. (Either way, ground truth is as
     reported above.)

**The Gagné/5W1H PDF artifact:** Fully explained and **not** contradictory. The
code that produces Gagné-structured modules (`app/api/synthesize/route.ts`) and
5W1H essay prompts (`src/lib/essay.ts` harness) exists in the repo, so a PDF
showing that content was generated by exactly that code. There is no need to
posit that the PDF predates its source — the source is present.

---

## STEP 3 — CHANGELOG ordering defect (FIXED)

**What was wrong:** The entry `## [2026-08-19 | 03:13 WIB | Wednesday | 19 August 2026]`
("Phase 2 — Polish & Learning-Science Depth Pass") had been appended to the very
bottom of the file, **after** the `END OF LOG (entries are append-only…)` marker
(lines 755-756) and **after** the later-timestamped `2026-08-19 | 16:35 WIB` entry.
In addition the whole log was tangled (Aug-17/Aug-18 blocks below Aug-19; the
Aug-19 Thursday cluster ordered 18:20→19:25→19:07).

**Root cause:** The `END OF LOG` marker prescribes an append-above-marker
convention, but the file was actually maintained newest-first (prepend). At some
point an entry was appended to the physical end of the file (below the marker)
instead of being inserted in chronological position — violating both the marker's
invariant and chronological order.

**Fix applied (formatting-only, no entry content changed):**
- Backed up original to `/tmp/CHANGELOG.md.bak`.
- Reordered all 50 `## [...]` entries into **strict descending chronological
  order** (newest first) by `YYYY-MM-DD HH:MM`, stable-sorting ties.
- Moved the `END OF LOG` marker so it is genuinely the **final line** of the file.
- Added a new, properly-ordered correction entry at the top (Step 3 requirement,
  rule I12) explaining what was wrong and what was moved.

**Verification of fix:**
- Entry count: 50 (backup) → 51 (50 + correction entry). No entry lost.
- Diff of entry bodies (excluding the removed embedded marker) shows **zero
  content differences** — only the `END OF LOG` marker relocated and whitespace
  from rejoin changed.
- `03:13 WIB` entry now sits at the correct position (between `13:41 WIB` and the
  `2026-08-18 | 23:30 WIB` entry).
- `END OF LOG` is the final line (line 769 after fix); no entry appears after it.
- Known remaining (out of scope, noted for follow-up): four
  `2026-08-17 | WIB | Monday …` entries are missing their `HH:MM` time field
  (malformed header). They remain at the bottom (oldest date) in original relative
  order. Filling the missing times is a content edit, not a formatting reorder, so
  it was left for an explicit follow-up.

---

## STEP 4 — Prevent recurrence (PROPOSAL, not yet implemented)

The deeper risk exposed here: **the working tree is almost entirely untracked**
(19 committed scaffold files vs 19 untracked feature directories). `git archive HEAD`
would export only the scaffold and silently drop every feature — so any export
pipeline built on `git archive`/committed state is unsafe until the tree is
committed. This is the most likely real-world cause of an "export dropped X"
complaint (scenario c), distinct from the current repo where the zip was built
from the working tree and is complete.

Proposed process change:

1. **Commit before export.** Require the working tree to be committed (or at least
   the verification-relevant code) prior to any handoff export.
2. **Export by commit, state the hash.** Generate the handoff via
   `git archive <commit> --format=zip -o handoff.zip`, and the handoff message
   MUST state the exact commit hash (e.g. `git rev-parse HEAD`). A reader can then
   `git checkout <hash>` and reproduce the exact tree.
3. **Pre-export guard script** (run inside the export command, refuse on failure):
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   dirty=$(git status --porcelain)
   if [ -n "$dirty" ]; then
     echo "REFUSING EXPORT: working tree has uncommitted/untracked changes:" >&2
     echo "$dirty" >&2
     exit 1
   fi
   git archive "$(git rev-parse HEAD)" --format=zip -o "handoff-$(git rev-parse --short HEAD).zip"
   echo "Exported tree at commit $(git rev-parse HEAD)"
   ```
4. **If exporting the working tree directly** (not via git), use a documented
   include-allowlist rather than an ad-hoc `-x` exclude list, and print the
   included top-level paths so the operator can see what shipped. Always exclude
   `node_modules`, `.git`, `.next`, build caches, and `.env`/secrets explicitly.
5. **CHANGELOG discipline:** the `END OF LOG` marker is redundant with the
   newest-first convention and invites the exact mistake seen here. Recommend
   either removing the marker and relying on strict newest-first order, or adding
   a CI check that fails if any `## [...]` header appears after the `END OF LOG`
   line.

These are proposals; implementing the guard/export script is a separate,
explicitly-requested task.

---

## ARTIFACTS
- `docs/CHANGELOG.md` — reordered (Step 3 fix); correction entry added at top.
- `/tmp/CHANGELOG.md.bak` — pre-fix backup of the CHANGELOG.
- This report: `docs/VERIFICATION-2026-08-21.md`.

## NOT DONE (per instructions)
- No feature code was re-implemented, rebuilt, or modified.
- The 5 named tasks were NOT started/fixed in this pass (they are already present).
- The Step 4 process change was proposed only, not implemented.
