-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LibraryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "sourceMessageId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "content" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LibraryItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LibraryItem_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LibraryItem" ("content", "createdAt", "id", "projectId", "title", "type", "updatedAt") SELECT "content", "createdAt", "id", "projectId", "title", "type", "updatedAt" FROM "LibraryItem";
DROP TABLE "LibraryItem";
ALTER TABLE "new_LibraryItem" RENAME TO "LibraryItem";
CREATE UNIQUE INDEX "LibraryItem_sourceMessageId_key" ON "LibraryItem"("sourceMessageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
