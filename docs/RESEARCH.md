# Research Notes — So-study (verified, trusted sources)

These findings ground the UX redesign. All sources are peer-reviewed / established
research bodies (Science, Psychological Science, Annual Review of Psychology,
PubMed-indexed journals, Springer, ACS). Captured 2026-08-18.

## 1. Retrieval practice is the highest-leverage study activity
- Roediger & Karpicke (2006), *Science* 319:966 — "The Critical Importance of
  Retrieval for Learning": repeated testing after learning produces large gains in
  delayed recall; repeated studying does NOT. Students' own confidence is uncorrelated
  with actual retention.
- Karpicke & Blunt (2011), *Science* 331:772 — retrieval practice (free recall)
  produces MORE learning than elaborative concept mapping, even on inference tests
  and even when the final test is a concept map.
- Roediger & Karpicke (2006), *Perspect. Psychol. Sci.* 1:181; Karpicke (2017)
  review — the "testing effect" generalizes across materials, ages, and test types.
- Agarwal et al. (2008) — **closed-book** quizzing beats open-book: looking up
  answers in the text leads to more forgetting than retrieving first.
  → So-study puts **Latih (practice / retrieval)** first in value, and offers a
    "mode tertutup" (closed-book) toggle so answering happens before peeking.

## 2. Spaced practice multiplies retention
- Cepeda et al. (2008), *Psychological Science* 19:1038 — optimal gap between
  study sessions scales with the retention interval (~10–20% of it). For semester
  retention, gaps of weeks/months double recall vs. massed study.
- Cepeda et al. (2006) meta-analysis (839 effect sizes) — spacing beats massing
  robustly.
- Karpicke & Roediger (2007) — expanding vs. fixed schedules; any spacing > massed.
  → Roadmap post-MVP SM-2 spaced repetition + timed re-review is well justified.
    Within v1, encourage re-taking quizzes across days before the lecture.

## 3. Pre-lecture preparation is the core driver of flipped-classroom gains
- PubMed 32720842 (2020) — both textbook reading AND video before a partially
  flipped cell-bio course independently improved exam scores.
- *Journal of Chemical Education* RCT (2019, 10.1021/acs.jchemed.9b00767) — the
  **online pre-class component accounts for most** of the flipped-classroom
  improvement; optimizing async pre-class design matters most.
- Meta-analysis, PMID 29943399 (2018) — flipped classroom outperforms lecture-based
  on exam scores/course grades (caution: high risk of bias in included studies).
- *Life Sciences Education* 2015 — flipped students prepare more *timely and
  accurately*; accuracy mediates exam gains, especially for lower-GPA & women.
- 2024 flipped-classroom study (Springer) — **consistent** preparation across the
  course beats initial-only or no preparation; dropping prep mid-course hurts.
  → So-study's framing ("head-start before lecture, not a substitute") is exactly
    right. The course dashboard tracks "X/N topik siap sebelum kuliah" to make
    preparation visible and sustained — directly targeting the #1 flipped-learning
    failure mode (non-compliance with pre-class work).

## 4. Design implications applied
- Lead with a **course → topic** structure aligned to the lecture schedule.
- Make **practice/retrieval** prominent and closed-book-capable.
- Show **progress toward "ready before lecture"** per course (progress bar + counts).
- Keep the "head-start, not a replacement" message pervasive (academic safety).
- iPad-native: ≥44px touch targets, bottom-sheet approval, clear single mental
  model (Dashboard → Read/Ask/Practice/Sources).

## 5. Additional findings (2026-08-18 audit)

### 5.1 Metacognitive prompts raise self-regulated learning AND outcomes
- Meta-analysis, *Journal of Computer Assisted Learning* (2022): metacognitive prompts
  significantly enhanced SRL activities (g = 0.50) and learning outcomes (g = 0.40).
  Effects were larger with task-specific, individual-adaptive prompts + feedback.
- 32-experiment meta-analysis on online SRL (2025): metacognitive prompts had a
  positive effect; effect moderated by prompt duration/method/learning environment.
- Implication: cheap, high-ROI addition. Fit So-study's pre-lecture framing with
  plan / monitor / evaluate prompts (e.g. "Apa yang kamu harapkan minggu ini?",
  "Seberapa yakin kamu paham ini?", "Apa yang masih abu-abu sebelum kuliah?").

### 5.2 Generation effect — self-made beats AI-made
- Pan et al. (2022) and 2026 study-app analyses (Knowt/Quizlet/Quizlet-vs-Anki
  comparisons): self-generated/edited cards outperform AI-generated ones by
  d = 0.29–0.45. Fully automated card generation trades retention for prep time.
- Implication: let the student **edit/author** MCQs and write their own recall
  prompts; treat AI output as a draft to verify/adapt (mirrors the human paper
  approval gate already in the pipeline).

### 5.3 Interleaving > blocking
- Rohrer (math-ed, real classrooms): spacing + interleaving beat blocked practice;
  learners often resist interleaving because it feels harder (illusion of mastery).
- Richland, Bjork & Linn (2005); Bjorklab desirable-difficulties work: interleaving
  aids transfer/integration. Implication: offer a mixed-practice session across a
  course's topics.

### 5.4 Feedback timing — immediate ≈ delayed (don't over-engineer)
- ManyClasses (38 classes, 2021): effect of immediate vs delayed feedback ≈ 0.00
  (HDI [-0.05, 0.05]); no credibly nonzero moderators.
- Melbourne medical MCQ RCT (2023, PMID 38017648): no significant difference between
  immediate post-item and delayed post-block feedback.
- Implication: So-study's immediate post-question explanation is fine; effort is
  better spent on *what* feedback says (elaborative, grounded), not *when*.

### 5.5 Benchmark vs comparable apps (verified, 2026)
- Winning combo across Quizlet / Anki / Knowt / Brainscape / Scholarly / Notesmakr:
  **active recall + spaced repetition + self-edited cards + a real SRS**. Most
  consumer apps paywall exactly the effective parts.
- So-study's moat: **source-grounded (OpenAlex) + pre-lecture framing + no paywall**.
  Protect it. FSRS is the modern standard (Anki default since 23.10); SM-2 fine for
  v1; confidence-based (Brainscape) is the simplest defensible start.
- Diminishing-cue cloze (Notesmakr; Fiechter & Benjamin 2017, +44% retention) is a
  nice optional for recall prompts.

## Caveat
These are general learning-science findings, not app-specific A/B tests. They
support the *structure and emphasis* of So-study; they do not validate specific
UI copy or Gemini-generated content quality (that needs the in-product
grounding/excerpt checks already in the whitepaper).
