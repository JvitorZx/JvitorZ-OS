import { Router } from 'express';
import { PlannerModule } from '../modules/planner/PlannerModule';
import { PlannerService } from '../services/PlannerService';

const router = Router();
const planner = new PlannerModule();
const plannerService = new PlannerService();

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

export default router;
