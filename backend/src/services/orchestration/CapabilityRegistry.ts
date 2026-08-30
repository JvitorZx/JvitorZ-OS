import type {
  CapabilityDefinition,
  CapabilityExecutor,
  OperatorCapability,
  RegisteredCapability,
} from '../../domains/orchestration';
import { validateCapabilityMetadata } from './PlanRiskClassifier';

export class CapabilityNotFoundError extends Error {
  constructor(id: string) {
    super(`Capability ${id} is not registered`);
    this.name = 'CapabilityNotFoundError';
  }
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, RegisteredCapability>();

  register(definition: CapabilityDefinition, execute: CapabilityExecutor): this {
    validateCapabilityMetadata(definition);
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
      ...(definition.capabilityTags ? { capabilityTags: [...definition.capabilityTags] } : {}),
    }));
  }

  findByCapability(capability: OperatorCapability): RegisteredCapability[] {
    return [...this.capabilities.values()]
      .filter(({ definition }) => definition.availability === 'available'
        && definition.capabilityTags?.includes(capability))
      .sort((left, right) => left.definition.id.localeCompare(right.definition.id));
  }

  findUnavailableByCapability(capability: OperatorCapability): CapabilityDefinition[] {
    return [...this.capabilities.values()]
      .map(({ definition }) => definition)
      .filter((definition) => definition.availability === 'unavailable'
        && definition.capabilityTags?.includes(capability))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}
