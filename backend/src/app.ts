import cors from 'cors';
import express, { json, urlencoded } from 'express';
import routes from './routes';

const app = express();

app.use(cors());
app.use(json());
app.use(urlencoded({ extended: true }));

app.use('/api', routes);

app.get('/', (_req, res) => {
  res.status(200).json({ project: 'JvitorZ OS', version: '0.1.0', status: 'online' });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

export default app;
