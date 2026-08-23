-- CreateTable
CREATE TABLE "ConversationLibraryItem" (
    "conversationId" TEXT NOT NULL,
    "libraryItemId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("conversationId", "libraryItemId"),
    CONSTRAINT "ConversationLibraryItem_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversationLibraryItem_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "LibraryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ConversationLibraryItem_conversationId_createdAt_libraryItemId_idx" ON "ConversationLibraryItem"("conversationId", "createdAt", "libraryItemId");

-- CreateIndex
CREATE INDEX "ConversationLibraryItem_libraryItemId_idx" ON "ConversationLibraryItem"("libraryItemId");
