-- Two-tier accuracy verification cache on Module (rule I6: schema is the source
-- of truth, every change is a migration).
--
-- verifyReport   Tier 1 deterministic report (JSON). Carries the hard gate.
-- criticReport   Tier 2 AI-critic report (JSON). Advisory flags only.
-- verifiedAt     when the cached pair was produced.
-- repairAttempts bounded targeted-regeneration counter (2-attempt cap).
--
-- Additive and backward compatible: existing modules keep NULL reports, which
-- the UI renders as "belum diperiksa" rather than as a clean bill of health.
-- AlterTable
ALTER TABLE "Module" ADD COLUMN "verifyReport" TEXT;
ALTER TABLE "Module" ADD COLUMN "criticReport" TEXT;
ALTER TABLE "Module" ADD COLUMN "verifiedAt" DATETIME;
ALTER TABLE "Module" ADD COLUMN "repairAttempts" INTEGER NOT NULL DEFAULT 0;
