import { backendEnvPath, loadEnv } from './core/config/loadEnv';
import app from './app';

loadEnv();

const port = Number(process.env.PORT || 4000);

app.listen(port, () => {
  console.log(`JvitorZ OS backend running on port ${port}`);
  console.log(`Google OAuth env loaded from ${backendEnvPath}`);
  console.log(`Google OAuth CLIENT_ID in use: ${process.env.GOOGLE_CLIENT_ID ?? 'undefined'}`);
});
