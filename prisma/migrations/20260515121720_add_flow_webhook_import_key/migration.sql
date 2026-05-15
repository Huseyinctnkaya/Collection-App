-- AlterTable
ALTER TABLE "NotificationSetting" ADD COLUMN "flowWebhookUrl" TEXT;

-- CreateTable
CREATE TABLE "ImportWebhookKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsed" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportWebhookKey_shop_key" ON "ImportWebhookKey"("shop");
