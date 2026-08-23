import type { LibraryItem } from '@prisma/client';
import { DatabaseService } from '../database/DatabaseService';
import { ConversationLibraryItemRepository } from '../database/repositories/ConversationLibraryItemRepository';
import { ConversationRepository } from '../database/repositories/ConversationRepository';
import { LibraryItemRepository } from '../database/repositories/LibraryItemRepository';

export const MAX_LINKED_LIBRARY_ITEMS = 5;

export interface LinkConversationLibraryItemResult {
  item: LibraryItem;
  created: boolean;
}

export interface UnlinkConversationLibraryItemResult {
  removed: boolean;
}

const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && error.code === 'P2002';

export class ConversationLibraryServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversationLibraryServiceError';
  }
}

export class ConversationLibraryConversationNotFoundError extends ConversationLibraryServiceError {
  constructor() {
    super('Conversation not found');
    this.name = 'ConversationLibraryConversationNotFoundError';
  }
}

export class ConversationLibraryItemNotFoundError extends ConversationLibraryServiceError {
  constructor() {
    super('Library item not found');
    this.name = 'ConversationLibraryItemNotFoundError';
  }
}

export class ConversationLibraryLimitReachedError extends ConversationLibraryServiceError {
  constructor() {
    super('Conversation library limit reached');
    this.name = 'ConversationLibraryLimitReachedError';
  }
}

export class ConversationLibraryPersistenceError extends ConversationLibraryServiceError {
  constructor() {
    super('Conversation library persistence failed');
    this.name = 'ConversationLibraryPersistenceError';
  }
}

export class ConversationLibraryService {
  private conversationRepository?: ConversationRepository;
  private libraryItemRepository?: LibraryItemRepository;
  private linkRepository?: ConversationLibraryItemRepository;

  constructor(
    conversationRepository?: ConversationRepository,
    libraryItemRepository?: LibraryItemRepository,
    linkRepository?: ConversationLibraryItemRepository,
  ) {
    this.conversationRepository = conversationRepository;
    this.libraryItemRepository = libraryItemRepository;
    this.linkRepository = linkRepository;
  }

  private get conversations(): ConversationRepository {
    if (!this.conversationRepository) {
      this.conversationRepository = new ConversationRepository(DatabaseService.client);
    }
    return this.conversationRepository;
  }

  private get libraryItems(): LibraryItemRepository {
    if (!this.libraryItemRepository) {
      this.libraryItemRepository = new LibraryItemRepository(DatabaseService.client);
    }
    return this.libraryItemRepository;
  }

  private get links(): ConversationLibraryItemRepository {
    if (!this.linkRepository) {
      this.linkRepository = new ConversationLibraryItemRepository(DatabaseService.client);
    }
    return this.linkRepository;
  }

  async linkItem(
    conversationId: string,
    libraryItemId: string,
  ): Promise<LinkConversationLibraryItemResult> {
    const normalizedConversationId = conversationId.trim();
    const normalizedLibraryItemId = libraryItemId.trim();
    const conversation = await this.conversations.findById(normalizedConversationId);
    if (!conversation) throw new ConversationLibraryConversationNotFoundError();

    const item = await this.libraryItems.findById(normalizedLibraryItemId);
    if (!item) throw new ConversationLibraryItemNotFoundError();

    try {
      const result = await this.links.createWithinLimit(
        conversation.id,
        item.id,
        MAX_LINKED_LIBRARY_ITEMS,
      );

      if (!result) throw new ConversationLibraryLimitReachedError();
      return { item: result.link.libraryItem, created: result.created };
    } catch (error) {
      if (error instanceof ConversationLibraryServiceError) throw error;

      if (isUniqueConstraintError(error)) {
        const existing = await this.links.findByConversationAndLibraryItem(
          conversation.id,
          item.id,
        );
        if (existing) return { item: existing.libraryItem, created: false };
      }

      throw new ConversationLibraryPersistenceError();
    }
  }

  async listLinkedItems(conversationId: string): Promise<LibraryItem[]> {
    const normalizedConversationId = conversationId.trim();
    const conversation = await this.conversations.findById(normalizedConversationId);
    if (!conversation) throw new ConversationLibraryConversationNotFoundError();

    try {
      const links = await this.links.findByConversationId(conversation.id);
      return links.map(({ libraryItem }) => libraryItem);
    } catch {
      throw new ConversationLibraryPersistenceError();
    }
  }

  async unlinkItem(
    conversationId: string,
    libraryItemId: string,
  ): Promise<UnlinkConversationLibraryItemResult> {
    const normalizedConversationId = conversationId.trim();
    const normalizedLibraryItemId = libraryItemId.trim();
    const conversation = await this.conversations.findById(normalizedConversationId);
    if (!conversation) throw new ConversationLibraryConversationNotFoundError();

    try {
      return {
        removed: await this.links.deleteLink(conversation.id, normalizedLibraryItemId),
      };
    } catch {
      throw new ConversationLibraryPersistenceError();
    }
  }
}
