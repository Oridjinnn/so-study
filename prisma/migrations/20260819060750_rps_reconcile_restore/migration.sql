-- CreateTable
CREATE TABLE "RPSReconcile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "officialOrder" TEXT NOT NULL,
    "customOrder" TEXT NOT NULL,
    "reconciledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RPSReconcile_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "weekNumber" INTEGER,
    "dueBeforeLecture" DATETIME,
    "orderSource" TEXT NOT NULL DEFAULT 'custom',
    "status" TEXT NOT NULL,
    CONSTRAINT "Topic_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Topic" ("courseId", "dueBeforeLecture", "id", "orderSource", "status", "title", "weekNumber") SELECT "courseId", "dueBeforeLecture", "id", "orderSource", "status", "title", "weekNumber" FROM "Topic";
DROP TABLE "Topic";
ALTER TABLE "new_Topic" RENAME TO "Topic";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RPSReconcile_courseId_key" ON "RPSReconcile"("courseId");
