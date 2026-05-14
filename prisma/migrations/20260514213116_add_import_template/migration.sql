-- CreateTable
CREATE TABLE "ImportTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columnMap" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ImportTemplate_shop_idx" ON "ImportTemplate"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ImportTemplate_shop_name_key" ON "ImportTemplate"("shop", "name");
