import type { LibraryItem } from '@prisma/client';
import { Router } from 'express';
import { PlannerModule } from '../modules/planner/PlannerModule';
import {
  ConversationLibraryConversationNotFoundError,
  ConversationLibraryItemNotFoundError,
  ConversationLibraryLimitReachedError,
  ConversationLibraryPersistenceError,
  ConversationLibraryService,
} from '../services/ConversationLibraryService';
import {
  LibraryConversationNotFoundError,
  LibraryMessageConversationMismatchError,
  LibraryMessageNotFoundError,
  LibraryMessageSenderNotAllowedError,
  LibraryService,
} from '../services/LibraryService';
import {
  isPlannerMessageSender,
  PlannerEditorialIntelligenceUnavailableError,
  PlannerLanguageGenerationError,
  PlannerLanguageProviderUnavailableError,
  PlannerService,
} from '../services/PlannerService';
import { OpenAILanguageProvider } from '../services/language/OpenAILanguageProvider';
import {
  CreatorIntelligenceService,
} from '../services/creator-intelligence/CreatorIntelligenceService';
import { EditorialDecisionService } from '../services/creator-intelligence/EditorialDecisionService';
import { DecisionOutcomeService } from '../services/creator-intelligence/DecisionOutcomeService';
import { OutcomeRefreshService } from '../services/creator-intelligence/OutcomeRefreshService';
import { createCreatorIntelligenceRouter } from './creatorIntelligence';

const createDefaultPlannerService = (
  creatorIntelligenceService: CreatorIntelligenceService,
  conversationLibraryService: ConversationLibraryService,
  editorialDecisionService: EditorialDecisionService,
): PlannerService =>
  new PlannerService(
    undefined,
    undefined,
    new OpenAILanguageProvider(),
    creatorIntelligenceService,
    conversationLibraryService,
    editorialDecisionService,
  );

const toLibraryItemResponse = ({
  id,
  projectId,
  title,
  type,
  content,
  createdAt,
  updatedAt,
}: LibraryItem) => ({ id, projectId, title, type, content, createdAt, updatedAt });

export const createOperatorsRouter = (
  plannerService?: PlannerService,
  libraryService: LibraryService = new LibraryService(),
  conversationLibraryService: ConversationLibraryService = new ConversationLibraryService(),
  creatorIntelligenceService: CreatorIntelligenceService = new CreatorIntelligenceService(),
  editorialDecisionService?: EditorialDecisionService,
  decisionOutcomeService?: DecisionOutcomeService,
  outcomeRefreshService?: OutcomeRefreshService,
): Router => {
  const router = Router();
  const planner = new PlannerModule();
  const resolvedEditorialDecisionService = editorialDecisionService
    ?? new EditorialDecisionService(creatorIntelligenceService);
  const resolvedDecisionOutcomeService = decisionOutcomeService ?? new DecisionOutcomeService();
  const resolvedOutcomeRefreshService = outcomeRefreshService ?? new OutcomeRefreshService();
  const resolvedPlannerService = plannerService
    ?? createDefaultPlannerService(
      creatorIntelligenceService,
      conversationLibraryService,
      resolvedEditorialDecisionService,
    );

router.use('/creator-intelligence', createCreatorIntelligenceRouter(
  creatorIntelligenceService,
  undefined,
  resolvedEditorialDecisionService,
  resolvedDecisionOutcomeService,
  resolvedOutcomeRefreshService,
));

router.get('/planner', async (_req, res) => {
  try {
    const info = await planner.getInfo();
    return res.json(info);
  } catch (error) {
    console.error('Error in /api/operators/planner:', error);
    return res.status(500).json({ error: 'Failed to fetch planner info' });
  }
});

router.get('/planner/conversations', async (_req, res) => {
  try {
    const conversations = await resolvedPlannerService.listConversations();
    return res.status(200).json(conversations);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Failed to list planner conversations (${errorName})`);
    return res.status(500).json({ error: 'Failed to list conversations' });
  }
});

router.get('/planner/conversations/:id', async (req, res) => {
  const id = req.params.id?.trim();

  if (!id) {
    return res.status(400).json({ error: 'id must be a non-empty string' });
  }

  try {
    const conversation = await resolvedPlannerService.getConversationById(id);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.status(200).json(conversation);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Failed to fetch planner conversation (${errorName})`);
    return res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

router.patch('/planner/conversations/:id/context', async (req, res) => {
  const id = req.params.id?.trim();

  if (!id) {
    return res.status(400).json({ error: 'id must be a non-empty string' });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'body must be an object' });
  }

  const body = req.body as Record<string, unknown>;
  const unsupportedFields = Object.keys(body).filter((field) => field !== 'context');

  if (unsupportedFields.length > 0) {
    return res.status(400).json({ error: 'body contains unsupported fields' });
  }

  if (typeof body.context !== 'string') {
    return res.status(400).json({ error: 'context must be a string' });
  }

  try {
    const conversation = await resolvedPlannerService.updateConversationContext(id, {
      context: body.context,
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.status(200).json(conversation);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Failed to update planner conversation context (${errorName})`);
    return res.status(500).json({ error: 'Failed to update conversation context' });
  }
});

router.post('/planner/conversations/:id/messages', async (req, res) => {
  const id = req.params.id?.trim();

  if (!id) {
    return res.status(400).json({ error: 'id must be a non-empty string' });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'body must be an object' });
  }

  const body = req.body as Record<string, unknown>;
  const unsupportedFields = Object.keys(body).filter((field) => !['sender', 'text'].includes(field));

  if (unsupportedFields.length > 0) {
    return res.status(400).json({ error: 'body contains unsupported fields' });
  }

  if (!isPlannerMessageSender(body.sender)) {
    return res.status(400).json({ error: 'sender must be user, system, or operator' });
  }

  if (typeof body.text !== 'string' || body.text.trim().length === 0) {
    return res.status(400).json({ error: 'text must be a non-empty string' });
  }

  try {
    const message = await resolvedPlannerService.createMessage(id, {
      sender: body.sender,
      text: body.text,
    });

    if (!message) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.status(201).json(message);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Failed to create planner message (${errorName})`);
    return res.status(500).json({ error: 'Failed to create message' });
  }
});

router.post('/planner/conversations/:id/reply', async (req, res) => {
  const id = req.params.id?.trim();

  if (!id) {
    return res.status(400).json({ error: 'id must be a non-empty string' });
  }

  if (
    req.body !== undefined &&
    (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length > 0)
  ) {
    return res.status(400).json({ error: 'body must be empty' });
  }

  try {
    const reply = await resolvedPlannerService.generateReply(id);

    if (!reply) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.status(201).json(reply);
  } catch (error) {
    if (error instanceof PlannerLanguageProviderUnavailableError) {
      console.error(`Planner reply provider unavailable (${error.name})`);
      return res.status(503).json({ error: 'Language provider is unavailable' });
    }

    if (error instanceof PlannerLanguageGenerationError) {
      console.error(`Planner reply generation failed (${error.name})`);
      return res.status(502).json({ error: 'Failed to generate planner reply' });
    }

    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Failed to persist planner reply (${errorName})`);
    return res.status(500).json({ error: 'Failed to persist planner reply' });
  }
});

router.get('/planner/conversations/:id/editorial-recommendation', async (req, res) => {
  const id = req.params.id?.trim();
  if (!id) {
    return res.status(400).json({ error: 'id must be a non-empty string' });
  }

  try {
    const recommendation = await resolvedPlannerService.getEditorialRecommendation(id);
    if (!recommendation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    return res.status(200).json(recommendation);
  } catch (error) {
    if (error instanceof PlannerEditorialIntelligenceUnavailableError) {
      return res.status(503).json({ error: 'Creator intelligence is unavailable' });
    }
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Failed to get planner editorial recommendation (${errorName})`);
    return res.status(500).json({ error: 'Failed to get editorial recommendation' });
  }
});

router.get('/planner/conversations/:id/channel-learnings', async (req, res) => {
  const id = req.params.id?.trim();
  if (!id) return res.status(400).json({ error: 'id must be a non-empty string' });
  try {
    const learnings = await resolvedPlannerService.getChannelLearnings(id);
    if (!learnings) return res.status(404).json({ error: 'Conversation not found' });
    return res.status(200).json(learnings);
  } catch (error) {
    if (error instanceof PlannerEditorialIntelligenceUnavailableError) {
      return res.status(503).json({ error: 'Creator intelligence is unavailable' });
    }
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Failed to get planner channel learnings (${errorName})`);
    return res.status(500).json({ error: 'Failed to get channel learnings' });
  }
});

router.post(
  '/planner/conversations/:conversationId/messages/:messageId/library',
  async (req, res) => {
    const conversationId = req.params.conversationId?.trim();
    const messageId = req.params.messageId?.trim();

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId must be a non-empty string' });
    }

    if (!messageId) {
      return res.status(400).json({ error: 'messageId must be a non-empty string' });
    }

    if (
      req.body !== undefined &&
      (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length > 0)
    ) {
      return res.status(400).json({ error: 'body must be empty' });
    }

    try {
      const result = await libraryService.saveOperatorMessage(conversationId, messageId);
      return res.status(result.created ? 201 : 200).json(toLibraryItemResponse(result.item));
    } catch (error) {
      if (error instanceof LibraryConversationNotFoundError) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (error instanceof LibraryMessageNotFoundError) {
        return res.status(404).json({ error: 'Message not found' });
      }

      if (error instanceof LibraryMessageConversationMismatchError) {
        return res.status(409).json({ error: 'Message does not belong to conversation' });
      }

      if (error instanceof LibraryMessageSenderNotAllowedError) {
        return res.status(422).json({ error: 'Only operator messages can be saved' });
      }

      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to save planner library item (${errorName})`);
      return res.status(500).json({ error: 'Failed to save library item' });
    }
  },
);

router.get('/planner/library', async (_req, res) => {
  try {
    const items = await libraryService.listItems();
    return res.status(200).json(items.map(toLibraryItemResponse));
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Failed to list planner library items (${errorName})`);
    return res.status(500).json({ error: 'Failed to list library items' });
  }
});

router.get('/planner/library/:id', async (req, res) => {
  const id = req.params.id?.trim();

  if (!id) {
    return res.status(400).json({ error: 'id must be a non-empty string' });
  }

  try {
    const item = await libraryService.getItemById(id);

    if (!item) {
      return res.status(404).json({ error: 'Library item not found' });
    }

    return res.status(200).json(toLibraryItemResponse(item));
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Failed to fetch planner library item (${errorName})`);
    return res.status(500).json({ error: 'Failed to fetch library item' });
  }
});

router.post(
  '/planner/conversations/:conversationId/library/:libraryItemId',
  async (req, res) => {
    const conversationId = req.params.conversationId?.trim();
    const libraryItemId = req.params.libraryItemId?.trim();

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId must be a non-empty string' });
    }

    if (!libraryItemId) {
      return res.status(400).json({ error: 'libraryItemId must be a non-empty string' });
    }

    if (
      req.body !== undefined &&
      (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length > 0)
    ) {
      return res.status(400).json({ error: 'body must be empty' });
    }

    try {
      const result = await conversationLibraryService.linkItem(conversationId, libraryItemId);
      return res.status(result.created ? 201 : 200).json(toLibraryItemResponse(result.item));
    } catch (error) {
      if (error instanceof ConversationLibraryConversationNotFoundError) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (error instanceof ConversationLibraryItemNotFoundError) {
        return res.status(404).json({ error: 'Library item not found' });
      }

      if (error instanceof ConversationLibraryLimitReachedError) {
        return res.status(422).json({ error: 'Conversation library limit reached' });
      }

      if (error instanceof ConversationLibraryPersistenceError) {
        console.error(`Failed to link conversation library item (${error.name})`);
        return res.status(500).json({ error: 'Failed to link library item' });
      }

      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to link conversation library item (${errorName})`);
      return res.status(500).json({ error: 'Failed to link library item' });
    }
  },
);

router.get('/planner/conversations/:conversationId/library', async (req, res) => {
  const conversationId = req.params.conversationId?.trim();

  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId must be a non-empty string' });
  }

  try {
    const items = await conversationLibraryService.listLinkedItems(conversationId);
    return res.status(200).json(items.map(toLibraryItemResponse));
  } catch (error) {
    if (error instanceof ConversationLibraryConversationNotFoundError) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (error instanceof ConversationLibraryPersistenceError) {
      console.error(`Failed to list conversation library items (${error.name})`);
      return res.status(500).json({ error: 'Failed to list conversation library items' });
    }

    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Failed to list conversation library items (${errorName})`);
    return res.status(500).json({ error: 'Failed to list conversation library items' });
  }
});

router.delete(
  '/planner/conversations/:conversationId/library/:libraryItemId',
  async (req, res) => {
    const conversationId = req.params.conversationId?.trim();
    const libraryItemId = req.params.libraryItemId?.trim();

    if (!conversationId) {
      return res.status(400).json({ error: 'conversationId must be a non-empty string' });
    }

    if (!libraryItemId) {
      return res.status(400).json({ error: 'libraryItemId must be a non-empty string' });
    }

    if (
      req.body !== undefined &&
      (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length > 0)
    ) {
      return res.status(400).json({ error: 'body must be empty' });
    }

    try {
      await conversationLibraryService.unlinkItem(conversationId, libraryItemId);
      return res.status(204).send();
    } catch (error) {
      if (error instanceof ConversationLibraryConversationNotFoundError) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (error instanceof ConversationLibraryPersistenceError) {
        console.error(`Failed to unlink conversation library item (${error.name})`);
        return res.status(500).json({ error: 'Failed to unlink library item' });
      }

      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error(`Failed to unlink conversation library item (${errorName})`);
      return res.status(500).json({ error: 'Failed to unlink library item' });
    }
  },
);

router.post('/planner/conversations', async (req, res) => {
  const { title, projectId } = req.body ?? {};

  if (title !== undefined && typeof title !== 'string') {
    return res.status(400).json({ error: 'title must be a string' });
  }

  if (projectId !== undefined && (typeof projectId !== 'string' || projectId.trim().length === 0)) {
    return res.status(400).json({ error: 'projectId must be a non-empty string' });
  }

  try {
    const conversation = await resolvedPlannerService.createConversation({ title, projectId });
    return res.status(201).json(conversation);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Failed to create planner conversation (${errorName})`);
    return res.status(500).json({ error: 'Failed to create conversation' });
  }
});

  return router;
};

export default createOperatorsRouter();
