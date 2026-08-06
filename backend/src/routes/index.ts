import { Router } from 'express';
import authRoutes from './auth';
import youtubeRoutes from './youtube';
import dashboardRoutes from './dashboard';
import operatorsRoutes from './operators';

const router = Router();

router.use('/auth', authRoutes);
router.use('/youtube', youtubeRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/operators', operatorsRoutes);

router.get('/', (_req, res) => {
  res.json({ message: 'JvitorZ OS backend route is working' });
});

export default router;
