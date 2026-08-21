# Rule Set — CODE EXECUTION

**Purpose (function):** Governs *how code is run* — local runs, tests, CI,
deploys, and any AI-triggered execution. This set answers: "When we run the
code, is it isolated, reproducible, observable, and fail-safe?"

**Correlation:** Executes what CODE GENERATION produced and what CODE
IMPLEMENTATION conformed. If generation/implementation are sound but execution
is reckless (unpinned deps, no sandbox, silent failures), the system still
breaks. Execution is the gate that proves the other two.

**Basis:** NASA fail-stop philosophy + Microsoft SDL (threat modeling, least
privilege) + Google "reproducible builds" + Amazon "operate what you build" +
Chaos/defense-in-depth + the app's own anti-fabrication safety principle.

---

## E0. META RULE — Change Logging
Same as G0: every execution-related change (CI script, deploy config, env, run
command) is logged in `docs/CHANGELOG.md` with hour/day/date/month/year and
file:line. Every *run* that matters is also logged with timestamp + file:line.

---

## E1. Isolate execution (least privilege)
Run in a sandbox / container / ephemeral env. No execution with elevated
privileges. The AI agent runs with only the access it needs, nothing more.

## E2. Pin everything (reproducible)
Lockfiles committed (`package-lock.json`, etc.). Builds are reproducible: same
input → same artifact. No floating versions in CI.

## E3. Gates before run (NASA #10 spirit)
Static analysis + linter + type-check MUST pass before any execution/test/deploy.
A red gate stops the pipeline; it does not "warn and continue."

## E4. No network to unapproved hosts
Outbound calls limited to approved endpoints (OpenAlex, Semantic Scholar,
Gemini, Turso). Everything else denied by default.

## E5. Fail-stop, never fake (app safety principle)
On error: stop, log, surface the error. Never substitute a generic/fabricated
result. Mirrors the app's rule: offline Q&A must say "connect", not invent.

## E6. Enforce resource limits
Every run has a timeout and memory cap. A hung process is killed and reported,
not left to exhaust the host.

## E7. Secrets never in logs (MS SDL)
Redact secrets from all execution output. Env-only secrets; logs scrubbed.

## E8. Idempotent execution
Re-running a step must not corrupt state (DB migrations are forward-only and
re-runnable; re-synthesis is blocked if a module already exists unless forced).

## E9. Every execution is observable
Record: what ran, when (timestamp), where (file:line / route), exit status,
duration. This feeds the changelog/audit trail.

## E10. Human approval before risky execution
Destructive or external-effect actions (deploy, DB migration to prod, paid API
call at scale) require explicit human confirmation. No autonomous destructive runs.

## E11. Defensive degradation
If a dependency is down (e.g., Gemini API), the system degrades gracefully:
reads still work offline; generation waits. No cascade failure, no silent skip.

## E12. AI code execution is bounded
When the AI executes code on the user's behalf, it operates within this rule set
only. It may not disable gates, suppress errors, or expand its own privileges.

---

## Severity
- **MUST** (E0, E1, E2, E3, E5, E7, E9, E10, E12): violation blocks the run.
- **SHOULD** (E4, E6, E8, E11): strong default; justify deviation in changelog.
