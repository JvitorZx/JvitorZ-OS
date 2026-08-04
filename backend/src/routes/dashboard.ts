import { Router } from 'express';
import { DashboardService } from '../services/DashboardService';

const router = Router();
const dashboardService = new DashboardService();

router.get('/', async (_req, res) => {
  try {
    const dashboardData = await dashboardService.getDashboard();
    return res.json(dashboardData);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

export default router;
