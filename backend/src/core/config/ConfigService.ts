import Environment from './Environment';

export default class ConfigService {
  private environment: Environment;

  constructor(environment: Environment) {
    this.environment = environment;
  }

  get(key: string): string | undefined {
    return this.environment.getVariable(key);
  }
}
