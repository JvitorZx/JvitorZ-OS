import dotenv from 'dotenv';

export default class Environment {
  constructor() {
    dotenv.config();
  }

  validate(): void {
    // Validar variáveis obrigatórias
  }

  getVariable(name: string): string | undefined {
    return process.env[name];
  }
}
