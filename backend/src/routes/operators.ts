import { Router } from 'express';
import { PlannerModule } from '../modules/planner/PlannerModule';

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

export default router;
