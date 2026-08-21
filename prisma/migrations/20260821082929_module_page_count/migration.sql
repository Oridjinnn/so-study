-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "studentName" TEXT,
    "lastNotificationCopyId" TEXT,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("id", "lastNotificationCopyId", "studentName", "updatedAt") SELECT "id", "lastNotificationCopyId", "studentName", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
