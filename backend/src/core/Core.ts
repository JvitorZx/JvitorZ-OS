import ModuleManager from './ModuleManager';
import { CoreConfig, ModuleConstructor } from './types';

export default class Core {
  private moduleManager: ModuleManager;
  private config: CoreConfig;

  constructor(config: CoreConfig) {
    this.config = config;
    this.moduleManager = new ModuleManager();
  }

  initialize(): void {
    // Inicializar o sistema e preparar os módulos
  }

  registerModule(module: ModuleConstructor): void {
    this.moduleManager.register(module);
  }

  getModuleManager(): ModuleManager {
    return this.moduleManager;
  }

  getConfig(): CoreConfig {
    return this.config;
  }
}
