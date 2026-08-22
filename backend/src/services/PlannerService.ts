import type { Conversation, Message } from '@prisma/client';
import { DatabaseService } from '../database/DatabaseService';
import {
  ConversationRepository,
  ConversationWithMessages,
} from '../database/repositories/ConversationRepository';
import { MessageRepository } from '../database/repositories/MessageRepository';

export interface CreateConversationInput {
  title?: string;
  projectId?: string;
}

export const PLANNER_MESSAGE_SENDERS = ['user', 'system', 'operator'] as const;
export type PlannerMessageSender = (typeof PLANNER_MESSAGE_SENDERS)[number];

export interface CreateMessageInput {
  sender: PlannerMessageSender;
  text: string;
}

export interface UpdateConversationContextInput {
  context: string;
}

export const isPlannerMessageSender = (value: unknown): value is PlannerMessageSender =>
  typeof value === 'string' && PLANNER_MESSAGE_SENDERS.includes(value as PlannerMessageSender);

export type PlannerConversationSummary = Pick<
  Conversation,
  'id' | 'projectId' | 'title' | 'createdAt' | 'updatedAt'
>;

export type PlannerConversationDetails = PlannerConversationSummary & Pick<Conversation, 'context'> & {
  messages: ConversationWithMessages['messages'];
};

const DEFAULT_CONVERSATION_TITLE = 'Nova conversa';

export class PlannerService {
  private conversationRepository?: ConversationRepository;
  private messageRepository?: MessageRepository;

  constructor(
    conversationRepository?: ConversationRepository,
    messageRepository?: MessageRepository,
  ) {
    this.conversationRepository = conversationRepository;
    this.messageRepository = messageRepository;
  }

  private get repository(): ConversationRepository {
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

    const { projectId, title, context, createdAt, updatedAt, messages } = conversation;

    return {
      id: conversation.id,
      projectId,
      title,
      context,
      createdAt,
      updatedAt,
      messages,
    };
  }

  async createMessage(conversationId: string, input: CreateMessageInput): Promise<Message | null> {
    const conversation = await this.repository.findById(conversationId.trim());

    if (!conversation) {
      return null;
    }

    return this.messages.create({
      conversationId: conversation.id,
      sender: input.sender,
      text: input.text.trim(),
    });
  }

  async updateConversationContext(
    conversationId: string,
    input: UpdateConversationContextInput,
  ): Promise<Conversation | null> {
    const conversation = await this.repository.findById(conversationId.trim());

    if (!conversation) {
      return null;
    }

    // An empty or whitespace-only value explicitly clears the conversation context.
    const context = input.context.trim() || null;
    return this.repository.updateContext(conversation.id, context);
  }
}
