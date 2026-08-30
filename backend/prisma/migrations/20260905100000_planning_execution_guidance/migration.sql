-- Add persistent execution guidance to every planned item.
ALTER TABLE "PlannedContentItem" ADD COLUMN "executionState" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "PlannedContentItem" ADD COLUMN "executionAction" TEXT NOT NULL DEFAULT 'Revisar item e preparar a proxima acao.';
ALTER TABLE "PlannedContentItem" ADD COLUMN "executionConfidence" REAL;
ALTER TABLE "PlannedContentItem" ADD COLUMN "executionContext" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "PlannedContentItem" ADD COLUMN "executionStartedAt" DATETIME;
ALTER TABLE "PlannedContentItem" ADD COLUMN "executionEndedAt" DATETIME;

-- Preserve the operational meaning of legacy item statuses.
UPDATE "PlannedContentItem" SET "executionState" = 'completed', "executionEndedAt" = "completedAt" WHERE "status" = 'COMPLETED';
UPDATE "PlannedContentItem" SET "executionState" = 'skipped', "executionEndedAt" = "updatedAt" WHERE "status" = 'CANCELLED';
UPDATE "PlannedContentItem" SET "executionState" = 'paused' WHERE "status" = 'PAUSED';
UPDATE "PlannedContentItem" SET "executionState" = 'in_progress', "executionStartedAt" = "updatedAt" WHERE "status" = 'IN_PROGRESS';

-- At most one item can be actively executing inside a plan.
CREATE UNIQUE INDEX "PlannedContentItem_one_in_progress_per_plan" ON "PlannedContentItem"("planId") WHERE "executionState" = 'in_progress';
CREATE INDEX "PlannedContentItem_planId_executionState_position_idx" ON "PlannedContentItem"("planId", "executionState", "position");

CREATE TABLE "PlanningExecutionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "itemTitle" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "confidence" REAL,
    "strategicContext" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanningExecutionEvent_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanningExecutionEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlannedContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PlanningExecutionEvent_planId_createdAt_idx" ON "PlanningExecutionEvent"("planId", "createdAt");
CREATE INDEX "PlanningExecutionEvent_itemId_createdAt_idx" ON "PlanningExecutionEvent"("itemId", "createdAt");
CREATE INDEX "PlanningExecutionEvent_state_createdAt_idx" ON "PlanningExecutionEvent"("state", "createdAt");
