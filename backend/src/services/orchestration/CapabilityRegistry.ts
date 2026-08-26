import type {
  CapabilityDefinition,
  CapabilityExecutor,
  RegisteredCapability,
} from '../../domains/orchestration';

export class CapabilityNotFoundError extends Error {
  constructor(id: string) {
    super(`Capability ${id} is not registered`);
    this.name = 'CapabilityNotFoundError';
  }
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, RegisteredCapability>();

  register(definition: CapabilityDefinition, execute: CapabilityExecutor): this {
    if (this.capabilities.has(definition.id)) {
      throw new Error(`Capability ${definition.id} is already registered`);
    }
    this.capabilities.set(definition.id, { definition, execute });
    return this;
  }

  get(id: string): RegisteredCapability {
    const capability = this.capabilities.get(id);
    if (!capability) throw new CapabilityNotFoundError(id);
    return capability;
  }

  list(): CapabilityDefinition[] {
    return [...this.capabilities.values()].map(({ definition }) => ({
      ...definition,
      inputs: [...definition.inputs],
      outputs: [...definition.outputs],
      dependencies: [...definition.dependencies],
    }));
  }
}
