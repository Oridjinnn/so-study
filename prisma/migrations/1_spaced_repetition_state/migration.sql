-- AlterTable AssessmentAttempt: add SM-2 spaced-repetition state.
-- Intervals now expand across reviews instead of a flat confidence lookup.
ALTER TABLE "AssessmentAttempt" ADD COLUMN "intervalDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AssessmentAttempt" ADD COLUMN "repetitions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AssessmentAttempt" ADD COLUMN "easeFactor" REAL NOT NULL DEFAULT 2.5;
