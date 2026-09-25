CREATE TABLE "ChannelProfile" (
  "id" TEXT NOT NULL,
  "projectId" TEXT,
  "youtubeChannelId" TEXT,
  "displayName" TEXT NOT NULL,
  "connectionState" TEXT NOT NULL DEFAULT 'DISCONNECTED',
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelProfile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChannelSnapshot" ADD COLUMN "channelProfileId" TEXT;

CREATE UNIQUE INDEX "ChannelProfile_projectId_key" ON "ChannelProfile"("projectId");
CREATE UNIQUE INDEX "ChannelProfile_youtubeChannelId_key" ON "ChannelProfile"("youtubeChannelId");
CREATE INDEX "ChannelProfile_isActive_idx" ON "ChannelProfile"("isActive");
CREATE INDEX "ChannelSnapshot_channelProfileId_collectedAt_idx" ON "ChannelSnapshot"("channelProfileId", "collectedAt");

ALTER TABLE "ChannelProfile" ADD CONSTRAINT "ChannelProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChannelSnapshot" ADD CONSTRAINT "ChannelSnapshot_channelProfileId_fkey" FOREIGN KEY ("channelProfileId") REFERENCES "ChannelProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
