import { Router } from 'express';
import authRoutes from './auth';
import youtubeRoutes from './youtube';
import dashboardRoutes from './dashboard';
import operatorsRoutes from './operators';
import orchestratorRoutes from './orchestrator';
import automationsRoutes from './automations';
import channelOperatorsRoutes from './channelOperators';
import integrationsRoutes from './integrations';
import reachRoutes from './reach';
import audienceRoutes from './audience';
import temporalIntelligenceRoutes from './temporalIntelligence';
import managerRoutes from './manager';
import researchRoutes from './research';
import planningRoutes from './planning';
import monitoringRoutes from './monitoring';
import channelContextRoutes from './channelContext';
import packagingRoutes from './packaging';
import productionRoutes from './production';
import chaptersRoutes from './chapters';
import shortsRoutes from './shorts';
import mediaRoutes from './media';
import renderRoutes from './renders';

const router = Router();

router.use('/auth', authRoutes);
router.use('/youtube', youtubeRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/operators', operatorsRoutes);
router.use('/orchestrator', orchestratorRoutes);
router.use('/automations', automationsRoutes);
router.use('/operators/channel', channelOperatorsRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/operators/creator-intelligence/reach', reachRoutes);
router.use('/operators/creator-intelligence/audience', audienceRoutes);
router.use('/operators/creator-intelligence', temporalIntelligenceRoutes);
router.use('/manager', managerRoutes);
router.use('/research', researchRoutes);
router.use('/planning', planningRoutes);
router.use('/monitoring', monitoringRoutes);
router.use('/context', channelContextRoutes);
router.use('/packaging', packagingRoutes);
router.use('/production', productionRoutes);
router.use('/chapters', chaptersRoutes);
router.use('/shorts', shortsRoutes);
router.use('/media', mediaRoutes);
router.use('/renders', renderRoutes);

router.get('/', (_req, res) => {
  res.json({ message: 'JvitorZ OS backend route is working' });
});

export default router;
