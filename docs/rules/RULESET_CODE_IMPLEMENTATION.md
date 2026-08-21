# Rule Set — CODE IMPLEMENTATION

**Purpose (function):** Governs *how generated code is written into the actual
codebase* — conformance to the project's architecture, data model, style, and
domain safety. This set answers: "Does the code fit the system and respect its
invariants?"

**Correlation:** Consumes CODE GENERATION output and is validated by CODE
EXECUTION. Generation can be locally clean yet wrong for *this* system;
implementation ensures it belongs here (correct schema, correct pipeline stage,
preserved human-in-the-loop gates, grounded LLM output).

**Basis:** NASA invariants + MISRA-C (no implicit behavior) + Linux kernel
style + Google style/API design + Amazon ownership + the app's grounding
philosophy (every claim sourced).

---

## I0. META RULE — Change Logging
Same as G0/E0: every implementation change (new file, schema migration, route,
UI page, config) is logged in `docs/CHANGELOG.md` with hour/day/date/month/year
and file:line. Schema changes additionally record the migration id.

---

## I1. Follow the declared architecture
Next.js App Router + TS + Tailwind + Prisma/Turso. New code lives where the
architecture says. No ad-hoc frameworks, no unapproved patterns.

## I2. Naming & style consistency (Google/Linux)
camelCase for TS identifiers, kebab-case for files, PascalCase for components.
Consistent with the existing codebase; run the formatter, no exceptions.

## I3. No implicit behavior (MISRA spirit)
Every function/route declares its I/O contract explicitly. No hidden side
effects, no magic globals, no undocumented state mutation.

## I4. Preserve human-in-the-loop gates (domain safety)
- Topic order is human-input; `order_source` flagged `custom` when not from RPS.
- Paper shortlist requires human approval before synthesis.
These gates are invariants — never auto-bypass them for "convenience."

## I5. Ground every LLM output (anti-hallucination)
Module content carries `sourcePaperIds` and a `Sources` block. Q&A is locked to
the module. No LLM response may present claims outside its sources.

## I6. Schema changes are migrations + changelog
No manual DB edits in prod. Every schema change = a migration file + a changelog
entry. Backward compatibility or a documented break.

## I7. Bounded state (NASA #3 adapted)
No unbounded caches/queues. The module cache is bounded by topic count; session
history is capped per topic.

## I8. Invariants asserted (NASA #5)
Validate preconditions: paper approved before synthesis; module exists before
Q&A; assessment linked to a topic. Fail fast with a clear message.

## I9. No swallowed errors
Catch blocks must handle or re-throw with context. Never empty `catch {}`.
Errors surface to the user or logs with meaning.

## I10. Smallest privilege & scope (NASA #6 / MS SDL)
API routes get only the DB/LLM access they need. No shared admin clients in the
client bundle. Server-only secrets stay server-side.

## I11. Reviews & ownership (Amazon)
Core logic (synthesis, Q&A scope, approval gate) requires a second pass/review
before merge. Ownership is explicit; "ship it" needs a named owner.

## I12. Docs stay in sync
When implementation changes behavior, update ROADMAP/whitepaper accordingly and
log it. Drift between docs and code is a defect.

---

## Severity
- **MUST** (I0, I1, I4, I5, I6, I8, I9, I10): violation blocks the change.
- **SHOULD** (I2, I3, I7, I11, I12): strong default; justify in changelog.
