import type { Conversation, EditorialDecision, Message } from '@prisma/client';
import { DatabaseService } from '../database/DatabaseService';
import {
  ConversationRepository,
  ConversationWithMessages,
} from '../database/repositories/ConversationRepository';
import { MessageRepository } from '../database/repositories/MessageRepository';
import {
  LanguageProviderUnavailableError,
  type LanguageProvider,
} from './language/LanguageProvider';
import { mapConversationToLanguageInput } from './language/PlannerLanguageInput';
import type {
  EditorialRecommendation,
  PlannerEditorialIntelligenceProvider,
} from './creator-intelligence/CreatorIntelligenceService';
import type { ConversationLibraryService } from './ConversationLibraryService';
import {
  EditorialDecisionService,
  isEditorialQuestion,
  parseEditorialDecisionArrays,
} from './creator-intelligence/EditorialDecisionService';
import type { OrchestratorService } from './orchestration/OrchestratorService';
import type { ManagerOrchestratorService } from './orchestration/ManagerOrchestratorService';

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

export class PlannerLanguageGenerationError extends Error {
  constructor(message = 'Unable to generate planner reply') {
    super(message);
    this.name = 'PlannerLanguageGenerationError';
  }
}

export class PlannerLanguageProviderUnavailableError extends PlannerLanguageGenerationError {
  constructor() {
    super('Language provider is not configured');
    this.name = 'PlannerLanguageProviderUnavailableError';
  }
}

export class PlannerEditorialIntelligenceUnavailableError extends Error {
  constructor() {
    super('Creator intelligence is unavailable');
    this.name = 'PlannerEditorialIntelligenceUnavailableError';
  }
}

export interface PlannerChannelLearning {
  category: string;
  subject: string;
  statement: string;
  confidence: number;
  classification: string;
  evidence: unknown;
}

export class PlannerService {
  private conversationRepository?: ConversationRepository;
  private messageRepository?: MessageRepository;
  private readonly languageProvider?: LanguageProvider;
  private readonly editorialIntelligence?: PlannerEditorialIntelligenceProvider;
  private readonly conversationLibraryService?: ConversationLibraryService;
  private readonly editorialDecisionService?: EditorialDecisionService;
  private readonly orchestrator?: Pick<OrchestratorService, 'run'>;
  private readonly manager?: Pick<ManagerOrchestratorService, 'query'>;

  constructor(
    conversationRepository?: ConversationRepository,
    messageRepository?: MessageRepository,
    languageProvider?: LanguageProvider,
    editorialIntelligence?: PlannerEditorialIntelligenceProvider,
    conversationLibraryService?: ConversationLibraryService,
    editorialDecisionService?: EditorialDecisionService,
    orchestrator?: Pick<OrchestratorService, 'run'>,
    manager?: Pick<ManagerOrchestratorService, 'query'>,
  ) {
    this.conversationRepository = conversationRepository;
    this.messageRepository = messageRepository;
    this.languageProvider = languageProvider;
    this.editorialIntelligence = editorialIntelligence;
    this.conversationLibraryService = conversationLibraryService;
    this.editorialDecisionService = editorialDecisionService;
    this.orchestrator = orchestrator;
    this.manager = manager;
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

  async generateReply(
    conversationId: string,
  ): Promise<(Message & { editorialDecision?: EditorialDecision; orchestrationExecutionId?: string }) | null> {
    const conversation = await this.repository.findById(conversationId.trim());

    if (!conversation) {
      return null;
    }

    const latestUserMessage = [...conversation.messages]
      .reverse()
      .find(({ sender }) => sender === 'user');
    if (latestUserMessage && this.manager && isEditorialQuestion(latestUserMessage.text)) {
      const orchestration = await this.manager.query({
        message: latestUserMessage.text,
        projectId: conversation.projectId,
        conversationId: conversation.id,
      });
      const message = await this.messages.create({
        conversationId: conversation.id,
        sender: 'operator',
        text: orchestration.answer,
      });
      const decisionId = typeof orchestration.decision?.decisionId === 'string'
        ? orchestration.decision.decisionId : null;
      const decision = decisionId && this.editorialDecisionService
        ? await this.editorialDecisionService.getById(decisionId)
        : null;
      if (decision && !decision.operatorMessageId) {
        await this.editorialDecisionService?.attachOperatorMessage(decision.id, message.id);
      }
      return Object.assign(message, {
        ...(decision ? { editorialDecision: decision } : {}),
        orchestrationExecutionId: orchestration.correlationId,
      });
    }
    if (latestUserMessage && this.orchestrator && isEditorialQuestion(latestUserMessage.text)) {
      const orchestration = await this.orchestrator.run({
        intent: latestUserMessage.text,
        projectId: conversation.projectId,
        conversationId: conversation.id,
      });
      const message = await this.messages.create({
        conversationId: conversation.id,
        sender: 'operator',
        text: orchestration.result.response,
      });
      const decisionId = orchestration.result.steps
        .find(({ capabilityId }) => capabilityId === 'creator-intelligence.decide')
        ?.output?.data?.decisionId;
      const decision = typeof decisionId === 'string' && this.editorialDecisionService
        ? await this.editorialDecisionService.getById(decisionId)
        : null;
      if (decision && !decision.operatorMessageId) {
        await this.editorialDecisionService?.attachOperatorMessage(decision.id, message.id);
      }
      return Object.assign(message, {
        ...(decision ? { editorialDecision: decision } : {}),
        orchestrationExecutionId: orchestration.execution.id,
      });
    }
    if (
      latestUserMessage
      && this.editorialDecisionService
      && isEditorialQuestion(latestUserMessage.text)
    ) {
      const { decision } = await this.editorialDecisionService.generate({
        question: latestUserMessage.text,
        projectId: conversation.projectId,
        conversationId: conversation.id,
      });
      const { evidence, risks, missingData, favorableEvidence, contraryEvidence, constraints } = parseEditorialDecisionArrays(decision);
      const confidence = Math.round(decision.confidence * 100);
      const evidenceClassification = evidence[0]
        ? ({ fact: 'Fato', inference: 'Inferência', recommendation: 'Recomendação' } as const)[evidence[0].classification]
        : null;
      const lines = [
        decision.recommendation,
        `Decisão: ${decision.category}${decision.score === null ? '' : ` · score ${decision.score}/100`}.`,
        `Confiança: ${confidence}%.`,
        evidence[0] ? `${evidenceClassification} principal: ${evidence[0].summary}` : null,
        favorableEvidence[0]?.summary ? `Evidência favorável: ${favorableEvidence[0].summary}` : null,
        contraryEvidence[0]?.summary ? `Evidência contrária: ${contraryEvidence[0].summary}` : null,
        risks[0] ? `Risco: ${risks[0]}` : null,
        constraints[0]?.summary ? `Restrição: ${constraints[0].summary}` : null,
        missingData[0] ? `Dado ausente: ${missingData[0]}` : null,
        `Próxima ação: ${decision.nextAction}`,
      ].filter((line): line is string => Boolean(line));
      const message = await this.messages.create({
        conversationId: conversation.id,
        sender: 'operator',
        text: lines.join('\n'),
      });
      if (!decision.operatorMessageId) {
        await this.editorialDecisionService.attachOperatorMessage(decision.id, message.id);
      }
      return Object.assign(message, { editorialDecision: decision });
    }

    if (!this.languageProvider) {
      throw new PlannerLanguageProviderUnavailableError();
    }

    const artifacts = this.conversationLibraryService
      ? await this.conversationLibraryService.listLinkedItems(conversation.id)
      : [];
    const input = mapConversationToLanguageInput({ ...conversation, artifacts });
    let generatedText: unknown;

    try {
      generatedText = await this.languageProvider.generate(input);
    } catch (error) {
      if (error instanceof LanguageProviderUnavailableError) {
        throw new PlannerLanguageProviderUnavailableError();
      }

      throw new PlannerLanguageGenerationError();
    }

    if (typeof generatedText !== 'string' || generatedText.trim().length === 0) {
      throw new PlannerLanguageGenerationError();
    }

    return this.messages.create({
      conversationId: conversation.id,
      sender: 'operator',
      text: generatedText.trim(),
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

  async getEditorialRecommendation(
    conversationId: string,
  ): Promise<EditorialRecommendation | null> {
    const conversation = await this.repository.findById(conversationId.trim());
    if (!conversation) return null;
    if (!this.editorialIntelligence) {
      throw new PlannerEditorialIntelligenceUnavailableError();
    }
    return this.editorialIntelligence.recommendEditorial(conversation.projectId);
  }

  async getChannelLearnings(conversationId: string): Promise<PlannerChannelLearning[] | null> {
    const conversation = await this.repository.findById(conversationId.trim());
    if (!conversation) return null;
    if (!this.editorialIntelligence?.getChannelLearnings) {
      throw new PlannerEditorialIntelligenceUnavailableError();
    }
    return this.editorialIntelligence.getChannelLearnings(conversation.projectId);
  }
}
