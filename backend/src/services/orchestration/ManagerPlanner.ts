import type {
  CapabilityDefinition,
  ManagerIntent,
  OperatorCapability,
  OrchestrationPlan,
  OrchestrationRequest,
  OrchestrationStep,
} from '../../domains/orchestration';
import { CapabilityRegistry } from './CapabilityRegistry';

interface ManagerPlanTemplate {
  objective: string;
  capabilities: OperatorCapability[];
}

const TEMPLATES: Record<ManagerIntent, ManagerPlanTemplate> = {
  CHANNEL_DIAGNOSIS: { objective: 'Diagnosticar o canal cruzando performance, qualidade, tendencias, formatos e trafego.', capabilities: ['data-quality', 'performance', 'analytics', 'trends', 'traffic-sources', 'shorts', 'long-form'] },
  CONTENT_DECISION: { objective: 'Produzir uma decisao editorial explicavel com memoria, evidencias e riscos.', capabilities: ['data-quality', 'performance', 'trends', 'series', 'decision-memory', 'editorial-decision'] },
  IDEA_COMPARISON: { objective: 'Comparar alternativas editoriais usando series, tendencias e o Decision Engine.', capabilities: ['data-quality', 'trends', 'series', 'long-form', 'decision-memory', 'editorial-decision'] },
  SERIES_ANALYSIS: { objective: 'Avaliar a saude e a continuidade de series com contexto temporal.', capabilities: ['data-quality', 'series', 'trends', 'decision-memory', 'editorial-decision'] },
  SHORTS_ANALYSIS: { objective: 'Diagnosticar Shorts por consumo, trafego, tendencia e qualidade dos dados.', capabilities: ['data-quality', 'shorts', 'retention', 'traffic-sources', 'trends'] },
  LONGFORM_ANALYSIS: { objective: 'Diagnosticar long-form por consumo, alcance, trafego e tendencia.', capabilities: ['data-quality', 'long-form', 'ctr', 'retention', 'traffic-sources', 'trends'] },
  CTR_ANALYSIS: { objective: 'Diagnosticar alcance e CTR sem inferir causalidade indevida.', capabilities: ['data-quality', 'ctr', 'trends'] },
  RETENTION_ANALYSIS: { objective: 'Diagnosticar retencao e consumo com a amostra disponivel.', capabilities: ['data-quality', 'retention', 'trends'] },
  TREND_ANALYSIS: { objective: 'Explicar tendencias e padroes temporais sem prever views.', capabilities: ['data-quality', 'trends', 'series'] },
  AUDIENCE_ANALYSIS: { objective: 'Consolidar audiencia, formatos e qualidade dos dados.', capabilities: ['data-quality', 'audience', 'shorts', 'long-form'] },
  TRAFFIC_ANALYSIS: { objective: 'Explicar fontes de trafego e mudancas de distribuicao observadas.', capabilities: ['data-quality', 'traffic-sources', 'trends'] },
  PLANNING: { objective: 'Transformar evidencias e memoria em uma fila editorial executavel.', capabilities: ['planning'] },
  CONTENT_PLANNING: { objective: 'Consultar ou gerar a fila editorial e explicar o que executar agora, depois ou aguardar.', capabilities: ['planning'] },
  EXPERIMENT_STATUS: { objective: 'Explicar hipoteses, testes ativos e resultados observados sem afirmar causalidade.', capabilities: ['experimentation'] },
  STRATEGIC_MONITORING: { objective: 'Consultar mudancas estrategicas relevantes e seus sinais auditaveis sem afirmar causalidade.', capabilities: ['monitoring'] },
  OPPORTUNITY_DISCOVERY: { objective: 'Identificar a melhor oportunidade atual usando o ranking editorial existente.', capabilities: ['data-quality', 'trends', 'series', 'decision-memory', 'editorial-decision'] },
  RESEARCH_DISCOVERY: { objective: 'Descobrir candidatos e evidências antes de submetê-los à decisão editorial.', capabilities: ['data-quality', 'research', 'trends', 'decision-memory', 'editorial-decision'] },
  RISK_ANALYSIS: { objective: 'Consolidar riscos editoriais e operacionais sem fabricar certeza.', capabilities: ['data-quality', 'supervision', 'decision-memory'] },
  GENERAL_CREATOR_QUESTION: { objective: 'Responder a pergunta do criador com o contexto interno estritamente necessario.', capabilities: ['data-quality', 'supervision', 'decision-memory'] },
  UNKNOWN: { objective: 'Explicar os dados disponiveis e indicar o contexto necessario para responder.', capabilities: ['data-quality', 'supervision'] },
};

const stepId = (capabilityId: string): string => capabilityId.replace(/[^a-z0-9]+/gi, '-');

const choose = (registry: CapabilityRegistry, tag: OperatorCapability): CapabilityDefinition | null =>
  registry.findByCapability(tag)[0]?.definition ?? null;

export const createManagerOrchestrationPlan = (
  request: OrchestrationRequest & { managerIntent: ManagerIntent },
  registry: CapabilityRegistry,
): OrchestrationPlan => {
  const template = TEMPLATES[request.managerIntent];
  const selected: CapabilityDefinition[] = [];
  const unavailable: string[] = [];
  for (const tag of [...template.capabilities, 'creator-context' as const, 'response' as const]) {
    const definition = choose(registry, tag);
    if (!definition) {
      const reason = registry.findUnavailableByCapability(tag)[0]?.unavailableReason;
      if (tag !== 'creator-context') unavailable.push(reason ? `${tag}: ${reason}` : `${tag} operator`);
      continue;
    }
    if (!selected.some(({ id }) => id === definition.id)) selected.push(definition);
  }

  const selectedIds = new Set(selected.map(({ id }) => id));
  const steps: OrchestrationStep[] = selected.map((definition) => {
    const dependencies = definition.dependencies
      .filter((dependency) => selectedIds.has(dependency))
      .map(stepId);
    return {
      id: stepId(definition.id),
      capabilityId: definition.id,
      objective: definition.responsibility,
      dependencies,
      access: definition.access,
      sideEffect: definition.sideEffect,
      persistentMutation: definition.persistentMutation,
      maxAffectedItems: definition.maxAffectedItems,
      inputs: [...definition.inputs],
      outputs: [...definition.outputs],
      optional: definition.id !== 'planner.respond',
    };
  });

  return {
    intent: request.managerIntent,
    objective: template.objective,
    steps,
    capabilities: steps.map(({ capabilityId }) => capabilityId),
    requiresWrite: steps.some(({ access }) => access === 'write'),
    hasExternalSideEffect: steps.some(({ access }) => access === 'external_side_effect'),
    missingData: unavailable,
  };
};
