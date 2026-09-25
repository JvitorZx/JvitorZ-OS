ALTER TABLE "ChannelProfile" ADD COLUMN "usesLegacyWorkspaceData" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChannelProfile" ADD COLUMN "legacyDataAdoptedAt" TIMESTAMP(3);
