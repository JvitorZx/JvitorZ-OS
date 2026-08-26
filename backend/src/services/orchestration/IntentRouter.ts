import type {
  CapabilityAccess,
  OrchestrationIntent,
  OrchestrationPlan,
  OrchestrationRequest,
  OrchestrationStep,
} from '../../domains/orchestration';

const searchable = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

export const classifyOrchestrationIntent = (value: string): OrchestrationIntent => {
  const text = searchable(value);
  if (/sincron/.test(text) && /(youtube|outcome|revis)/.test(text)) return 'controlled_sync_review';
  if (/ultimo teste|deu certo|funcionou|resultado|outcome|foi fraco/.test(text)) return 'outcome_status';
  if (/como esta.*canal|estado.*canal|status.*canal|saude.*canal/.test(text)) return 'channel_status';
  if (/serie.*vale|vale.*serie|continuar.*serie/.test(text)) return 'series_viability';
  if (/o que.*gravar|vale gravar|jogo.*testar|proximo video/.test(text)) return 'next_content';
  return 'general_operations';
};

type StepTemplate = [string, string, string[], CapabilityAccess, boolean?];

const TEMPLATES: Record<OrchestrationIntent, { objective: string; steps: StepTemplate[] }> = {
  next_content: {
    objective: 'Recomendar o próximo teste editorial com base em evidências internas.',
    steps: [
      ['performance', 'performance.read', [], 'read'],
      ['analytics', 'analytics.read', ['performance'], 'read'],
      ['decision', 'creator-intelligence.decide', ['analytics'], 'write'],
      ['response', 'planner.respond', ['decision'], 'read'],
    ],
  },
  outcome_status: {
    objective: 'Explicar o resultado editorial mais recente e sua atualidade.',
    steps: [
      ['outcomes', 'decision-outcomes.read', [], 'read'],
      ['review-state', 'outcome-refresh.inspect', ['outcomes'], 'read'],
      ['response', 'planner.respond', ['review-state'], 'read'],
    ],
  },
  channel_status: {
    objective: 'Consolidar a situação atual do canal e seus riscos operacionais.',
    steps: [
      ['performance', 'performance.read', [], 'read'],
      ['analytics', 'analytics.read', ['performance'], 'read'],
      ['supervisor', 'supervisor.read', ['analytics'], 'read'],
      ['response', 'planner.respond', ['supervisor'], 'read'],
    ],
  },
  series_viability: {
    objective: 'Avaliar a continuidade de uma série sem transformar associação em causalidade.',
    steps: [
      ['performance', 'performance.read', [], 'read'],
      ['analytics', 'analytics.read', ['performance'], 'read'],
      ['outcomes', 'decision-outcomes.read', ['analytics'], 'read'],
      ['decision', 'creator-intelligence.decide', ['analytics', 'outcomes'], 'write'],
      ['response', 'planner.respond', ['decision'], 'read'],
    ],
  },
  controlled_sync_review: {
    objective: 'Sincronizar dados explicitamente e revisar outcomes que receberam evidência nova.',
    steps: [
      ['youtube-sync', 'youtube.sync', [], 'external_side_effect'],
      ['review-state', 'outcome-refresh.inspect', ['youtube-sync'], 'read'],
      ['refresh', 'outcome-refresh.run', ['review-state'], 'write'],
      ['supervisor', 'supervisor.read', ['refresh'], 'read', true],
      ['response', 'planner.respond', ['review-state'], 'read'],
    ],
  },
  general_operations: {
    objective: 'Consolidar o estado operacional disponível sem inventar capacidades.',
    steps: [
      ['supervisor', 'supervisor.read', [], 'read'],
      ['response', 'planner.respond', ['supervisor'], 'read'],
    ],
  },
};

export const createOrchestrationPlan = (request: OrchestrationRequest): OrchestrationPlan => {
  const intent = classifyOrchestrationIntent(request.intent);
  const template = TEMPLATES[intent];
  const steps: OrchestrationStep[] = template.steps.map(([
    id, capabilityId, dependencies, access, optional = false,
  ]) => ({ id, capabilityId, objective: capabilityId, dependencies, access, optional }));
  const refreshStep = steps.find(({ capabilityId }) => capabilityId === 'outcome-refresh.run');
  if (refreshStep) {
    refreshStep.condition = {
      stepId: 'review-state',
      dataField: 'reviewAvailable',
      operator: 'greater_than',
      value: 0,
    };
  }
  const missingData = intent === 'controlled_sync_review' && !request.sync
    ? ['sync parameters'] : [];
  return {
    intent,
    objective: template.objective,
    steps,
    capabilities: [...new Set(steps.map(({ capabilityId }) => capabilityId))],
    requiresWrite: steps.some(({ access }) => access === 'write'),
    hasExternalSideEffect: steps.some(({ access }) => access === 'external_side_effect'),
    missingData,
  };
};
