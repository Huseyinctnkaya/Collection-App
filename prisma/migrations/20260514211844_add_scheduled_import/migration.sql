-- CreateTable
CREATE TABLE "ScheduledImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileData" BLOB NOT NULL,
    "fileType" TEXT NOT NULL,
    "duplicateStrategy" TEXT NOT NULL DEFAULT 'skip',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ScheduledImport_shop_scheduledAt_idx" ON "ScheduledImport"("shop", "scheduledAt");
