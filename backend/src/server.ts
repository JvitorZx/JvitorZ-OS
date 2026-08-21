import { loadEnv } from './core/config/loadEnv';
import app from './app';

loadEnv();

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST?.trim() || '127.0.0.1';

const server = app.listen(port, host, () => {
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;

  console.log(`JvitorZ OS backend running at http://${host}:${listeningPort}`);
});

export default server;
