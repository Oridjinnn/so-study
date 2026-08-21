# Rule Set — CODE GENERATION

**Purpose (function):** Governs *how the AI produces code text* — the act of
writing new code, edits, or scaffolding. This set answers: "Is the generated
code itself well-formed, safe, minimal, and traceable?"

**Correlation:** Output of this set becomes the input to CODE IMPLEMENTATION
(conformance to architecture) and is later exercised by CODE EXECUTION (running
it). The three are a chain: generate → implement conformantly → execute safely.

**Basis:** NASA JPL "Power of 10" (rules of thumb for safety-critical code) +
Google Style Guides + Microsoft Secure Development Lifecycle (SDL) + Amazon
"Ownership & API" principles + MISRA-C spirit + Linux kernel coding style.

---

## G0. META RULE — Change Logging (applies to all three rule sets)
Every change, however small (a one-line edit, a rename, a config tweak), MUST be
recorded in `docs/CHANGELOG.md` with:
- Timestamp: **hour, day (weekday), date, month, year** (WIB).
- **File location and line range** affected.
- A one-line description of what changed and why.
This is non-negotiable; nothing is "too small to log."

---

## G1. No code without an explicit spec + acceptance criteria
Generated code must map to a documented requirement (roadmap/whitepaper/rules).
Do not "improve" beyond the stated need (YAGNI). If the requirement is ambiguous,
stop and ask — do not guess scope.

## G2. Single responsibility
One function/module does one thing. No god-objects, no multi-concern handlers.

## G3. Prefer the standard library; no new dependency without justification
Big-tech rule: minimize surface area. A new dependency requires a stated reason
and must be version-pinned. Default to built-ins.

## G4. No recursion; all loops bounded (NASA #2)
Every loop has a fixed, stated upper bound. No `while(true)`, no unbounded
recursion. Iteration count must be statically derivable or explicitly capped.

## G5. Function size limit (NASA #4)
No function exceeds ~60 lines / one screen. Split, don't stretch.

## G6. Smallest scope (NASA #6)
Declare every variable at the narrowest scope that is sufficient. No module-level
mutable globals unless explicitly justified and logged.

## G7. Check every return value; handle errors (NASA #7)
No ignored return values. Every external call (DB, API, FS) is wrapped with
explicit error handling. No silent failures.

## G8. No hardcoded secrets (MS SDL)
API keys, DB URLs, tokens → environment variables / secret store only. Never
embedded in generated source.

## G9. Deterministic & idempotent where feasible
Given the same inputs, generation produces the same structure. Side effects are
explicit and repeatable.

## G10. Tests accompany non-trivial code (Google)
Any function with logic > trivial gets a test. Generation is incomplete without it.

## G11. Comments explain "why", not "what" (Google/Linux)
Code says what; comments say why. No noise comments restating the code.

## G12. No unbounded memory growth after init (NASA #3, adapted)
No caches/collections that grow without a bound. Allocate within fixed limits;
module cache is bounded by topic count.

## G13. Zero warnings (NASA #10)
Generated code must compile/lint/type-check clean. Warnings are errors.

## G14. Traceable provenance
Generated modules/outputs reference their source (`sourcePaperIds`). AI output
is always attributable to inputs — no orphan claims.

## G15. Assert invariants (NASA #5)
Use assertions/validation for "impossible" conditions (e.g., paper approved
before synthesis). Fail fast, visibly.

---

## Severity
- **MUST** (G0, G1, G4, G7, G8, G13, G15): violation blocks the change.
- **SHOULD** (G2, G3, G5, G6, G9, G10, G11, G12, G14): strong default, justify if skipped.
