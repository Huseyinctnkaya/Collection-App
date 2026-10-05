-- CreateTable
CREATE TABLE "BulkOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "operationId" TEXT,
    "mutation" TEXT NOT NULL,
    "stagedPath" TEXT NOT NULL,
    "rowNumbers" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BulkOperation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BulkOperation_operationId_key" ON "BulkOperation"("operationId");

-- CreateIndex
CREATE INDEX "BulkOperation_jobId_idx" ON "BulkOperation"("jobId");

-- CreateIndex
CREATE INDEX "BulkOperation_jobId_status_idx" ON "BulkOperation"("jobId", "status");
