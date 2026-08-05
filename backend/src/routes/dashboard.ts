import { Router } from 'express';
import { DashboardService } from '../services/DashboardService';
import { GoogleService } from '../services/GoogleService';

const router = Router();
const dashboardService = new DashboardService();
const googleService = new GoogleService();

router.get('/', async (_req, res) => {
  if (!googleService.isAuthenticated()) {
    console.log('Google OAuth not authenticated at route /api/dashboard');
    return res.status(401).json({ error: 'Google OAuth not authenticated' });
  }

  try {
    const dashboardData = await dashboardService.getDashboard();
    return res.json(dashboardData);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

export default router;
