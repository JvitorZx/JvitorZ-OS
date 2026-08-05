import path from 'path';
import dotenv from 'dotenv';

const envPath = path.resolve(__dirname, '../../../.env');
let loaded = false;

export const loadEnv = (): void => {
  if (loaded) {
    return;
  }

  dotenv.config({
    path: envPath,
    override: true,
  });

  loaded = true;
};

export const backendEnvPath = envPath;

loadEnv();
