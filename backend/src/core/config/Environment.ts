import { loadEnv } from './loadEnv';

export default class Environment {
  constructor() {
    loadEnv();
  }

  validate(): void {
    // Validar variáveis obrigatórias
  }

  getVariable(name: string): string | undefined {
    return process.env[name];
  }
}
