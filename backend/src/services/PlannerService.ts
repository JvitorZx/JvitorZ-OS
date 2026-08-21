import type { Conversation } from '@prisma/client';
import { DatabaseService } from '../database/DatabaseService';
import {
  ConversationRepository,
  ConversationWithMessages,
} from '../database/repositories/ConversationRepository';

export interface CreateConversationInput {
  title?: string;
  projectId?: string;
}

export type PlannerConversationSummary = Pick<
  Conversation,
  'id' | 'projectId' | 'title' | 'createdAt' | 'updatedAt'
>;

export type PlannerConversationDetails = PlannerConversationSummary & {
  messages: ConversationWithMessages['messages'];
};

const DEFAULT_CONVERSATION_TITLE = 'Nova conversa';

export class PlannerService {
  private conversationRepository?: ConversationRepository;

  constructor(conversationRepository?: ConversationRepository) {
    this.conversationRepository = conversationRepository;
  }

  private get repository(): ConversationRepository {
    if (!this.conversationRepository) {
      this.conversationRepository = new ConversationRepository(DatabaseService.client);
    }

    return this.conversationRepository;
  }

  async createConversation(input: CreateConversationInput = {}): Promise<Conversation> {
    const title = input.title?.trim() || DEFAULT_CONVERSATION_TITLE;
    const projectId = input.projectId?.trim() || null;

    return this.repository.create({
      projectId,
      title,
      context: null,
    });
  }

  async listConversations(): Promise<PlannerConversationSummary[]> {
    const conversations = await this.repository.findAll();

    return conversations.map(({ id, projectId, title, createdAt, updatedAt }) => ({
      id,
      projectId,
      title,
      createdAt,
      updatedAt,
    }));
  }

  async getConversationById(id: string): Promise<PlannerConversationDetails | null> {
    const conversation = await this.repository.findById(id.trim());

    if (!conversation) {
      return null;
    }

    const { projectId, title, createdAt, updatedAt, messages } = conversation;

    return {
      id: conversation.id,
      projectId,
      title,
      createdAt,
      updatedAt,
      messages,
    };
  }
}
