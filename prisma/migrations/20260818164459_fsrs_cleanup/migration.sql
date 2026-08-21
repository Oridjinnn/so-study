/*
  Warnings:

  - You are about to drop the `Assessment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RPSReconcile` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Assessment";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RPSReconcile";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AssessmentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "itemRef" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT,
    "score" REAL,
    "isCorrect" BOOLEAN,
    "confidence" INTEGER,
    "answeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "stability" REAL NOT NULL DEFAULT 1,
    "difficulty" REAL NOT NULL DEFAULT 5,
    "scheduledNextAt" DATETIME,
    CONSTRAINT "AssessmentAttempt_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentAttempt_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AssessmentAttempt" ("answeredAt", "confidence", "easeFactor", "id", "intervalDays", "isCorrect", "itemRef", "moduleId", "prompt", "questionType", "repetitions", "response", "scheduledNextAt", "score", "topicId") SELECT "answeredAt", "confidence", "easeFactor", "id", "intervalDays", "isCorrect", "itemRef", "moduleId", "prompt", "questionType", "repetitions", "response", "scheduledNextAt", "score", "topicId" FROM "AssessmentAttempt";
DROP TABLE "AssessmentAttempt";
ALTER TABLE "new_AssessmentAttempt" RENAME TO "AssessmentAttempt";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
