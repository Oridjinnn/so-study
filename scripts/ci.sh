#!/usr/bin/env bash
# CI gate — mirrors the rule sets (E3 / G10): gates before run, tests required.
# Stops at the first failure (set -e). Reproduce locally: bash scripts/ci.sh
set -euo pipefail

echo "[ci] prisma generate"
npx prisma generate

echo "[ci] lint"
npm run lint

echo "[ci] typecheck"
npx tsc --noEmit

echo "[ci] unit tests"
npx vitest run

echo "[ci] PASS — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
