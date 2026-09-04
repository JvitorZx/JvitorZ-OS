import type { ProductionFormat, ProductionNextAction, ProductionStepTemplate, ResolvableProductionStep } from './types';

const commonStart: ProductionStepTemplate[] = [
  { key: 'PREPARING', label: 'Preparacao', mode: 'MANUAL', required: true, skippable: false, dependencies: [] },
  { key: 'EDITING', label: 'Edicao', mode: 'MANUAL', required: true, skippable: false, dependencies: ['PREPARING'] },
];
const commonEnd: ProductionStepTemplate[] = [
  { key: 'PACKAGING', label: 'Embalagem', mode: 'ASSISTED', capability: 'packaging', required: true, skippable: false, dependencies: [] },
  { key: 'REVIEW', label: 'Revisao do Supervisor', mode: 'ASSISTED', capability: 'supervision', required: true, skippable: false, dependencies: ['PACKAGING'] },
];

export const productionWorkflowFor = (format: ProductionFormat): ProductionStepTemplate[] => {
  if (format === 'SHORT') return [...commonStart, { ...commonEnd[0], dependencies: ['EDITING'] }, commonEnd[1]].map((step) => ({ ...step, dependencies: [...step.dependencies] }));
  const workflow: ProductionStepTemplate[] = [
    ...commonStart,
    { key: 'CHAPTERS', label: 'Capitulos', mode: 'MANUAL', required: false, skippable: true, dependencies: ['EDITING'], availability: 'MANUAL_ONLY' },
    { key: 'SHORTS', label: 'Recortes Shorts', mode: 'MANUAL', required: false, skippable: true, dependencies: ['CHAPTERS'], availability: 'MANUAL_ONLY' },
    { ...commonEnd[0], dependencies: ['SHORTS'] }, commonEnd[1],
  ];
  return workflow.map((step) => ({ ...step, dependencies: [...step.dependencies] }));
};

const dependencies = (step: ResolvableProductionStep): string[] => Array.isArray(step.dependencies)
  ? step.dependencies.filter((item): item is string => typeof item === 'string') : [];

export const resolveProductionNextAction = (status: string, rawSteps: readonly ResolvableProductionStep[]): ProductionNextAction => {
  if (status === 'CANCELLED' || status === 'COMPLETED') return { type: 'NONE', stepKey: null, label: 'Nenhuma acao', reason: `Producao ${status.toLowerCase()}.`, ready: false };
  if (status === 'READY_TO_PUBLISH') return { type: 'PUBLISH_EXTERNALLY', stepKey: null, label: 'Publicar externamente', reason: 'Todas as etapas obrigatorias foram aprovadas; nenhuma publicacao sera feita automaticamente.', ready: true };
  if (status === 'PUBLISHED' || status === 'ANALYZED') return { type: 'NONE', stepKey: null, label: 'Acompanhar resultado', reason: 'A publicacao ja foi associada; Analytics e memoria permanecem em fluxos proprios.', ready: false };
  const steps = [...rawSteps].sort((a, b) => a.position - b.position);
  const terminal = new Set(['COMPLETED', 'SKIPPED']);
  for (const step of steps) {
    if (terminal.has(step.state)) continue;
    const blockedBy = dependencies(step).filter((key) => !terminal.has(steps.find((item) => item.key === key)?.state ?? 'NOT_STARTED'));
    if (blockedBy.length) continue;
    if (step.state === 'FAILED') return { type: 'RETRY', stepKey: step.key, label: `Tentar novamente: ${step.label}`, reason: 'A tentativa anterior falhou sem corromper o workflow.', ready: true };
    if (step.state === 'OUTDATED') return { type: 'REVIEW_STALE', stepKey: step.key, label: `Revisar: ${step.label}`, reason: 'Uma mudanca anterior tornou este resultado desatualizado; o historico foi preservado.', ready: true };
    if (step.state === 'WAITING_USER') return { type: 'WAIT_USER', stepKey: step.key, label: `Continuar: ${step.label}`, reason: 'A etapa aguarda uma decisao explicita do usuario.', ready: true };
    if (step.state === 'BLOCKED') return { type: 'UNBLOCK', stepKey: step.key, label: `Desbloquear: ${step.label}`, reason: 'A etapa possui um bloqueio registrado.', ready: false };
    if (step.state === 'IN_PROGRESS') return { type: 'CONTINUE', stepKey: step.key, label: `Continuar: ${step.label}`, reason: 'A etapa ja foi iniciada e pode ser retomada.', ready: true };
    return { type: 'START', stepKey: step.key, label: `Iniciar: ${step.label}`, reason: step.mode === 'MANUAL' ? 'Etapa manual disponivel.' : 'Capacidade assistida disponivel.', ready: true };
  }
  return { type: 'NONE', stepKey: null, label: 'Nenhuma acao disponivel', reason: 'Nao existe etapa executavel no estado atual.', ready: false };
};
