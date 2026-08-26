import type {
  CapabilityDefinition,
  CapabilitySideEffect,
  OrchestrationPlan,
  PlanRiskAssessment,
} from '../../domains/orchestration';

export class CapabilityMetadataError extends Error {
  constructor(id: string) {
    super(`Capability ${id} has inconsistent side-effect metadata`);
    this.name = 'CapabilityMetadataError';
  }
}

const SIDE_EFFECT_ORDER: CapabilitySideEffect[] = [
  'READ_ONLY', 'INTERNAL_WRITE', 'EXTERNAL_READ', 'EXTERNAL_WRITE',
];

export const validateCapabilityMetadata = (definition: CapabilityDefinition): void => {
  const valid = (
    definition.sideEffect === 'READ_ONLY'
      ? definition.access === 'read' && !definition.persistentMutation
      : definition.sideEffect === 'INTERNAL_WRITE'
        ? definition.access === 'write' && definition.persistentMutation
        : definition.sideEffect === 'EXTERNAL_READ'
          ? definition.access === 'external_side_effect'
          : definition.access === 'external_side_effect' && definition.persistentMutation
  );
  if (!valid || (definition.maxAffectedItems !== undefined
    && (!Number.isInteger(definition.maxAffectedItems) || definition.maxAffectedItems < 1))) {
    throw new CapabilityMetadataError(definition.id);
  }
};

export const classifyPlanRisk = (plan: OrchestrationPlan): PlanRiskAssessment => {
  const sideEffectLevel = plan.steps.reduce<CapabilitySideEffect>((highest, step) => (
    SIDE_EFFECT_ORDER.indexOf(step.sideEffect) > SIDE_EFFECT_ORDER.indexOf(highest)
      ? step.sideEffect : highest
  ), 'READ_ONLY');
  const internalWrites = plan.steps.filter(({ sideEffect }) => sideEffect === 'INTERNAL_WRITE');
  const externalReads = plan.steps.filter(({ sideEffect }) => sideEffect === 'EXTERNAL_READ');
  const externalWrites = plan.steps.filter(({ sideEffect }) => sideEffect === 'EXTERNAL_WRITE');
  const unbounded = plan.steps.some(({ persistentMutation, maxAffectedItems }) => (
    persistentMutation && maxAffectedItems === undefined
  ));
  const highVolume = plan.steps.some(({ maxAffectedItems = 0 }) => maxAffectedItems > 50);

  let riskLevel: PlanRiskAssessment['riskLevel'] = 'LOW';
  if (externalWrites.length > 0 || externalReads.some(({ persistentMutation }) => persistentMutation)
    || unbounded || highVolume) riskLevel = 'HIGH';
  else if (externalReads.length > 0 || internalWrites.length > 0) riskLevel = 'MEDIUM';

  const requiredApprovals = externalWrites.length > 0
    || externalReads.some(({ persistentMutation }) => persistentMutation)
    || unbounded || highVolume || internalWrites.length > 1 ? 1 : 0;
  const reasons = [
    ...(internalWrites.length ? [`${internalWrites.length} persistent internal write step(s)`] : []),
    ...(externalReads.length ? [`${externalReads.length} external read step(s)`] : []),
    ...(externalWrites.length ? [`${externalWrites.length} external write step(s)`] : []),
    ...(unbounded ? ['At least one persistent mutation has no explicit volume bound'] : []),
    ...(highVolume ? ['At least one step may affect more than 50 items'] : []),
  ];
  if (reasons.length === 0) reasons.push('All steps are read-only');

  return {
    riskLevel,
    sideEffectLevel,
    requiredApprovals,
    reasons,
    validityMinutes: riskLevel === 'HIGH' ? 15 : riskLevel === 'MEDIUM' ? 30 : 60,
  };
};
