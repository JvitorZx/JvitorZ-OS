CREATE TABLE "ChannelSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subscriberCount" TEXT,
    "videoCount" TEXT,
    "viewCount" TEXT,
    "country" TEXT,
    "publishedAt" DATETIME,
    "collectedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ChannelSnapshot_channelId_key" ON "ChannelSnapshot"("channelId");
CREATE INDEX "ChannelSnapshot_collectedAt_idx" ON "ChannelSnapshot"("collectedAt");
