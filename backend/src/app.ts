import cors, { CorsOptions } from 'cors';
import express, { ErrorRequestHandler, json, urlencoded } from 'express';
import { loadEnv } from './core/config/loadEnv';
import routes from './routes';

loadEnv();

const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';
const configuredFrontendOrigin = process.env.FRONTEND_ORIGIN?.trim() || DEFAULT_FRONTEND_ORIGIN;
const frontendOriginUrl = new URL(configuredFrontendOrigin);

if (!['http:', 'https:'].includes(frontendOriginUrl.protocol) || frontendOriginUrl.origin !== configuredFrontendOrigin.replace(/\/$/, '')) {
  throw new Error('FRONTEND_ORIGIN must be a valid HTTP(S) origin without a path');
}

const allowedFrontendOrigin = frontendOriginUrl.origin;

class CorsOriginNotAllowedError extends Error {
  constructor() {
    super('CORS origin not allowed');
    this.name = 'CorsOriginNotAllowedError';
  }
}

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || origin === allowedFrontendOrigin) {
      callback(null, true);
      return;
    }

    callback(new CorsOriginNotAllowedError());
  },
};

const app = express();

app.use(cors(corsOptions));
app.use(json());
app.use(urlencoded({ extended: true }));

app.use('/api', routes);

app.get('/', (_req, res) => {
  res.status(200).json({ project: 'JvitorZ OS', version: '0.1.0', status: 'online' });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const corsErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof CorsOriginNotAllowedError) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  next(error);
};

app.use(corsErrorHandler);

export default app;
