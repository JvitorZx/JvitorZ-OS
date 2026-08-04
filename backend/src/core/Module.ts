import { ModuleOptions } from './types';

export default abstract class Module {
  public readonly name: string;
  public readonly options: ModuleOptions;

  constructor(name: string, options: ModuleOptions = {}) {
    this.name = name;
    this.options = options;
  }

  initialize(): void {
    // Método de inicialização do módulo
  }

  shutdown(): void {
    // Método de finalização do módulo
  }
}
