CREATE TABLE "AutomationRuntimeEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventType" TEXT NOT NULL,
  "status" TEXT,
  "details" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "AutomationRuntimeEvent_eventType_createdAt_idx" ON "AutomationRuntimeEvent"("eventType", "createdAt");
CREATE INDEX "AutomationRuntimeEvent_createdAt_idx" ON "AutomationRuntimeEvent"("createdAt");
