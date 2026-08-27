import { Router } from 'express';
import { DashboardService } from '../services/DashboardService';
import {
  getSafeGoogleRequestError,
  GoogleService,
  isGoogleReauthenticationRequired,
  isGoogleTemporarilyUnavailable,
} from '../services/GoogleService';

type DashboardRouteDependencies = {
  dashboardService: Pick<DashboardService, 'getDashboard'>;
  googleService: Pick<GoogleService, 'isAuthenticated'>;
};

export const createDashboardRouter = ({
  dashboardService = new DashboardService(),
  googleService = new GoogleService(),
}: Partial<DashboardRouteDependencies> = {}): Router => {
  const router = Router();
  router.get('/', async (req, res) => {
    const authenticated = googleService.isAuthenticated();
    const authUrl = `${req.protocol}://${req.get('host')}/api/auth/google`;
    try {
      const dashboardData = await dashboardService.getDashboard({ youtubeConnected: authenticated });
      return res.json({ ...dashboardData, unauthorized: !authenticated, ...(!authenticated ? { authUrl } : {}) });
    } catch (error) {
      const safeError = getSafeGoogleRequestError(error);

      const reauthenticationRequired = isGoogleReauthenticationRequired(error);
      if (reauthenticationRequired || isGoogleTemporarilyUnavailable(error)) {
        console.warn(reauthenticationRequired
          ? 'Google OAuth reauthentication required at route /api/dashboard'
          : 'Google temporarily unavailable at route /api/dashboard', safeError);
        try {
          const dashboardData = await dashboardService.getDashboard({ youtubeConnected: false });
          return res.status(200).json({
            ...dashboardData,
            unauthorized: reauthenticationRequired,
            youtubeUnavailable: !reauthenticationRequired,
            ...(reauthenticationRequired ? { authUrl } : {}),
          });
        } catch (fallbackError) {
          console.error('Local dashboard fallback failed', getSafeGoogleRequestError(fallbackError));
          return res.status(500).json({ error: 'Failed to fetch dashboard data' });
        }
      }

      console.error('Google request failed at route /api/dashboard', safeError);
      return res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
  });
  return router;
};

export default createDashboardRouter();
