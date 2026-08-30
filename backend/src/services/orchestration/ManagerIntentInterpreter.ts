import type { ManagerIntent, OrchestrationContext } from '../../domains/orchestration';

const searchable = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const cleanCandidate = (value: string): string => value
  .replace(/^(qual|compare|comparar|entre|e melhor|vale mais|devo escolher)\s+/i, '')
  .replace(/[?.!,;:]+$/g, '')
  .trim();

export const extractComparisonCandidates = (message: string): string[] => {
  const match = message.trim().match(/(?:compare\s+|entre\s+)?(.+?)\s+(?:ou|vs\.?|versus)\s+(.+?)(?:[?.!]|$)/i);
  if (!match) return [];
  return [...new Set([cleanCandidate(match[1]), cleanCandidate(match[2])].filter(Boolean))].slice(0, 5);
};

export const classifyManagerIntent = (message: string): ManagerIntent => {
  const text = searchable(message);
  if (!text) return 'UNKNOWN';
  if (/(o que estamos testando|experimento|hipotese|resultado do teste|o que aprendemos.*teste|hipotese.*confirmada)/.test(text)) return 'EXPERIMENT_STATUS';
  if (/(pesquise|pesquisar|procure|investigue|fora do meu canal|tema surgindo|jogo vale pesquisar|lacuna de conteudo)/.test(text)) return 'RESEARCH_DISCOVERY';
  if (/(ctr|taxa de clique|impressoes)/.test(text) && /retenc|consumo|assist/.test(text)) return 'CHANNEL_DIAGNOSIS';
  if (/qual dessas ideias|qual ideia.*melhor|compare.*ideias?/.test(text)) return 'IDEA_COMPARISON';
  if (extractComparisonCandidates(message).length >= 2) return 'IDEA_COMPARISON';
  if (/shorts?/.test(text)) return 'SHORTS_ANALYSIS';
  if (/videos? longos?|long.?form|vod/.test(text)) return 'LONGFORM_ANALYSIS';
  if (/(fonte|origem).*trafego|trafego|de onde.*(views|visualiz)|pesquisa.*youtube/.test(text)) return 'TRAFFIC_ANALYSIS';
  if (/audiencia|publico|pais|dispositivo|celular|inscrito/.test(text)) return 'AUDIENCE_ANALYSIS';
  if (/ctr|taxa de clique|impressoes/.test(text) && /retenc|consumo|assist/.test(text)) return 'CHANNEL_DIAGNOSIS';
  if (/ctr|taxa de clique|impressoes|embalagem|thumbnail|titulo/.test(text)) return 'CTR_ANALYSIS';
  if (/retenc|consumo|tempo assistido|watch time|duracao media/.test(text)) return 'RETENTION_ANALYSIS';
  if (/serie|episodio/.test(text)) return 'SERIES_ANALYSIS';
  if (/tendenc|crescendo|caindo|subindo|piorando|melhorando/.test(text)) return 'TREND_ANALYSIS';
  if (/risco|ameaca|problema.*agora|o que pode dar errado/.test(text)) return 'RISK_ANALYSIS';
  if (/oportunidade|melhor chance|potencial agora/.test(text)) return 'OPPORTUNITY_DISCOVERY';
  if (/o que.*gravo hoje|fila editorial|plano editorial|o que vem depois|o que fazer agora/.test(text)) return 'CONTENT_PLANNING';
  if (/planej|calendario|cronograma|organizar.*conteudo/.test(text)) return 'PLANNING';
  if (/o que.*gravar|devo gravar|proximo video|qual jogo|qual ideia|vale testar|continuar/.test(text)) {
    return 'CONTENT_DECISION';
  }
  if (/canal|views|visualiz|desempenho|performance|resultado/.test(text)) return 'CHANNEL_DIAGNOSIS';
  if (/conteudo|video|criador|youtube/.test(text)) return 'GENERAL_CREATOR_QUESTION';
  return 'UNKNOWN';
};

export const buildOrchestrationContext = (input: {
  message: string;
  projectId?: string | null;
  conversationId?: string | null;
}): OrchestrationContext => {
  const candidateLabels = extractComparisonCandidates(input.message);
  return {
    projectId: input.projectId?.trim() || null,
    conversationId: input.conversationId?.trim() || null,
    ...(candidateLabels.length ? { candidateLabels } : {}),
    relevantMemoryLimit: 5,
  };
};
