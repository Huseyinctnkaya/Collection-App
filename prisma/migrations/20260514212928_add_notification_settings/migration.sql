-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "email" TEXT,
    "slackWebhookUrl" TEXT,
    "notifyOnComplete" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnFail" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_shop_key" ON "NotificationSetting"("shop");
