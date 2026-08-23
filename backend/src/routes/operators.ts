import { Router } from 'express';
import { PlannerModule } from '../modules/planner/PlannerModule';
import {
  isPlannerMessageSender,
  PlannerLanguageGenerationError,
  PlannerLanguageProviderUnavailableError,
  PlannerService,
} from '../services/PlannerService';
import { OpenAILanguageProvider } from '../services/language/OpenAILanguageProvider';

const createDefaultPlannerService = (): PlannerService =>
  new PlannerService(undefined, undefined, new OpenAILanguageProvider());

export const createOperatorsRouter = (
  plannerService: PlannerService = createDefaultPlannerService(),
): Router => {
  const router = Router();
  const planner = new PlannerModule();

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
    const conversations = await plannerService.listConversations();
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
    const conversation = await plannerService.getConversationById(id);

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
    const conversation = await plannerService.updateConversationContext(id, {
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
    const message = await plannerService.createMessage(id, {
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
    const reply = await plannerService.generateReply(id);

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

router.post('/planner/conversations', async (req, res) => {
  const { title, projectId } = req.body ?? {};

  if (title !== undefined && typeof title !== 'string') {
    return res.status(400).json({ error: 'title must be a string' });
  }

  if (projectId !== undefined && (typeof projectId !== 'string' || projectId.trim().length === 0)) {
    return res.status(400).json({ error: 'projectId must be a non-empty string' });
  }

  try {
    const conversation = await plannerService.createConversation({ title, projectId });
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
