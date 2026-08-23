import type { LibraryItem } from '@prisma/client';
import { DatabaseService } from '../database/DatabaseService';
import { ConversationRepository } from '../database/repositories/ConversationRepository';
import { LibraryItemRepository } from '../database/repositories/LibraryItemRepository';
import { MessageRepository } from '../database/repositories/MessageRepository';

const DEFAULT_LIBRARY_ITEM_TITLE = 'Resposta do Planner';
const PLANNER_LIBRARY_ITEM_TYPE = 'resource';

export interface SaveLibraryItemResult {
  item: LibraryItem;
  created: boolean;
}

const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && error.code === 'P2002';

const deriveLibraryItemTitle = (conversationTitle: string | null): string => {
  const normalizedTitle = conversationTitle?.trim();
  return normalizedTitle ? `Resposta - ${normalizedTitle}` : DEFAULT_LIBRARY_ITEM_TITLE;
};

export class LibraryServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryServiceError';
  }
}

export class LibraryConversationNotFoundError extends LibraryServiceError {
  constructor() {
    super('Conversation not found');
    this.name = 'LibraryConversationNotFoundError';
  }
}

export class LibraryMessageNotFoundError extends LibraryServiceError {
  constructor() {
    super('Message not found');
    this.name = 'LibraryMessageNotFoundError';
  }
}

export class LibraryMessageConversationMismatchError extends LibraryServiceError {
  constructor() {
    super('Message does not belong to conversation');
    this.name = 'LibraryMessageConversationMismatchError';
  }
}

export class LibraryMessageSenderNotAllowedError extends LibraryServiceError {
  constructor() {
    super('Only operator messages can be saved');
    this.name = 'LibraryMessageSenderNotAllowedError';
  }
}

export class LibraryService {
  private conversationRepository?: ConversationRepository;
  private messageRepository?: MessageRepository;
  private libraryItemRepository?: LibraryItemRepository;

  constructor(
    conversationRepository?: ConversationRepository,
    messageRepository?: MessageRepository,
    libraryItemRepository?: LibraryItemRepository,
  ) {
    this.conversationRepository = conversationRepository;
    this.messageRepository = messageRepository;
    this.libraryItemRepository = libraryItemRepository;
  }

  private get conversations(): ConversationRepository {
    if (!this.conversationRepository) {
      this.conversationRepository = new ConversationRepository(DatabaseService.client);
    }

    return this.conversationRepository;
  }

  private get messages(): MessageRepository {
    if (!this.messageRepository) {
      this.messageRepository = new MessageRepository(DatabaseService.client);
    }

    return this.messageRepository;
  }

  private get libraryItems(): LibraryItemRepository {
    if (!this.libraryItemRepository) {
      this.libraryItemRepository = new LibraryItemRepository(DatabaseService.client);
    }

    return this.libraryItemRepository;
  }

  async saveOperatorMessage(
    conversationId: string,
    messageId: string,
  ): Promise<SaveLibraryItemResult> {
    const conversation = await this.conversations.findById(conversationId.trim());

    if (!conversation) {
      throw new LibraryConversationNotFoundError();
    }

    const message = await this.messages.findById(messageId.trim());

    if (!message) {
      throw new LibraryMessageNotFoundError();
    }

    if (message.conversationId !== conversation.id) {
      throw new LibraryMessageConversationMismatchError();
    }

    if (message.sender !== 'operator') {
      throw new LibraryMessageSenderNotAllowedError();
    }

    const existing = await this.libraryItems.findBySourceMessageId(message.id);
    if (existing) return { item: existing, created: false };

    try {
      const item = await this.libraryItems.create({
        projectId: conversation.projectId,
        sourceMessageId: message.id,
        title: deriveLibraryItemTitle(conversation.title),
        type: PLANNER_LIBRARY_ITEM_TYPE,
        content: message.text,
      });
      return { item, created: true };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const concurrentItem = await this.libraryItems.findBySourceMessageId(message.id);
        if (concurrentItem) return { item: concurrentItem, created: false };
      }

      throw error;
    }
  }

  async listItems(): Promise<LibraryItem[]> {
    return this.libraryItems.findAll();
  }

  async getItemById(id: string): Promise<LibraryItem | null> {
    return this.libraryItems.findById(id.trim());
  }
}
