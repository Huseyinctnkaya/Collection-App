-- CreateTable
CREATE TABLE "ImportAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "collectionHandle" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportAction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "bulkOperationId" TEXT,
    "rolledBack" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ImportJob" ("bulkOperationId", "createdAt", "errorCount", "fileName", "fileType", "id", "processedRows", "shop", "status", "successCount", "totalRows", "updatedAt") SELECT "bulkOperationId", "createdAt", "errorCount", "fileName", "fileType", "id", "processedRows", "shop", "status", "successCount", "totalRows", "updatedAt" FROM "ImportJob";
DROP TABLE "ImportJob";
ALTER TABLE "new_ImportJob" RENAME TO "ImportJob";
CREATE INDEX "ImportJob_shop_idx" ON "ImportJob"("shop");
CREATE TABLE "new_ScheduledImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileData" BLOB NOT NULL,
    "fileType" TEXT NOT NULL,
    "duplicateStrategy" TEXT NOT NULL DEFAULT 'skip',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recurrence" TEXT NOT NULL DEFAULT 'none',
    "nextRunAt" DATETIME,
    "jobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_ScheduledImport" ("createdAt", "duplicateStrategy", "fileData", "fileName", "fileType", "id", "jobId", "scheduledAt", "shop", "status") SELECT "createdAt", "duplicateStrategy", "fileData", "fileName", "fileType", "id", "jobId", "scheduledAt", "shop", "status" FROM "ScheduledImport";
DROP TABLE "ScheduledImport";
ALTER TABLE "new_ScheduledImport" RENAME TO "ScheduledImport";
CREATE INDEX "ScheduledImport_shop_scheduledAt_idx" ON "ScheduledImport"("shop", "scheduledAt");
CREATE INDEX "ScheduledImport_status_nextRunAt_idx" ON "ScheduledImport"("status", "nextRunAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ImportAction_jobId_idx" ON "ImportAction"("jobId");
