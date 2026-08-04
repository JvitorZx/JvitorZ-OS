import Module from './Module';
import { ModuleConstructor } from './types';

export default class ModuleManager {
  private modules: Map<string, Module> = new Map();

  register(moduleConstructor: ModuleConstructor): void {
    const moduleInstance = new moduleConstructor();
    this.modules.set(moduleInstance.name, moduleInstance);
  }

  get(name: string): Module | undefined {
    return this.modules.get(name);
  }

  list(): Module[] {
    return Array.from(this.modules.values());
  }

  unregister(name: string): boolean {
    return this.modules.delete(name);
  }
}
