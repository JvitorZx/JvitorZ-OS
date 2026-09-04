import type { CreateChannelContextInput } from './ChannelContextService';
import { ChannelContextService } from './ChannelContextService';

export const JVITORZX_CHANNEL_ID = 'UCV-OcBRDccTTUCDp6ZiK3dQ';
export const CHANNEL_CONTEXT_BOOTSTRAP_SOURCE = 'bootstrap:sprint45';

type BootstrapEntry = { key: string; input: Omit<CreateChannelContextInput, 'source' | 'channelId'> };

const entries: BootstrapEntry[] = [
  { key: 'channel-identity', input: { type: 'FACT', status: 'CONFIRMED', category: 'CHANNEL', subject: 'JvitorZx', statement: 'O canal em operacao e JvitorZx.', confidence: 1, entityType: 'CHANNEL', entityId: JVITORZX_CHANNEL_ID } },
  { key: 'shorts-discovery', input: { type: 'DECISION', status: 'ACTIVE', category: 'STRATEGY', subject: 'Shorts', statement: 'Shorts sao atualmente o principal mecanismo de descoberta do canal.', confidence: .9, format: 'SHORTS' } },
  { key: 'long-form-watch-time', input: { type: 'LEARNING', status: 'ACTIVE', category: 'STRATEGY', subject: 'Long-form', statement: 'Videos longos geram proporcionalmente mais watch time por view, com distribuicao irregular.', confidence: .75, format: 'LONG_FORM' } },
  { key: 'content-pillars', input: { type: 'DECISION', status: 'ACTIVE', category: 'STRATEGY', subject: 'Pilares editoriais', statement: 'City Car Driving 2.0 e Forza Horizon 6 sao pilares recorrentes do canal.', confidence: .9, metadata: { games: ['City Car Driving 2.0', 'Forza Horizon 6'] } } },
  { key: 'repair-games-test', input: { type: 'EXPERIMENT', status: 'ACTIVE', category: 'CONTENT', subject: 'Jogos de reparo e oficina', statement: 'Jogos de reparo e oficina representam experimentacao recente em long-form.', confidence: 1, format: 'LONG_FORM' } },
  { key: 'sustainable-production', input: { type: 'DECISION', status: 'ACTIVE', category: 'PRODUCTION', subject: 'Producao sustentavel', statement: 'Producao sustentavel e preferivel a aumentar frequencia de forma desesperada.', confidence: 1 } },
  { key: 'city-car-effort', input: { type: 'FACT', status: 'CONFIRMED', category: 'PRODUCTION', subject: 'City Car Driving 2.0', statement: 'City Car Driving costuma ser mais simples de produzir e possui estrutura forte de serie e progressao.', confidence: .85, game: 'City Car Driving 2.0', series: 'City Car Driving 2.0' } },
  { key: 'city-car-performance', input: { type: 'LEARNING', status: 'ACTIVE', category: 'PERFORMANCE', subject: 'City Car Driving 2.0', statement: 'City Car Driving ja gerou videos longos acima da media observada do canal.', confidence: .7, game: 'City Car Driving 2.0', format: 'LONG_FORM' } },
  { key: 'forza-production', input: { type: 'FACT', status: 'CONFIRMED', category: 'PRODUCTION', subject: 'Forza Horizon 6', statement: 'Forza pode performar bem, normalmente com custo de producao maior; carro, mod, som, tuning, descoberta e restauracao fornecem acontecimentos concretos.', confidence: .8, game: 'Forza Horizon 6' } },
  { key: 'repair-long-form-low-distribution', input: { type: 'FACT', status: 'CONFIRMED', category: 'EXPERIMENT_RESULT', subject: 'Dois longos de jogo de reparo', statement: 'O teste recente de dois videos longos de jogo de reparo teve distribuicao muito baixa.', confidence: 1, format: 'LONG_FORM', metadata: { observations: 2 } } },
  { key: 'repair-not-bad-game', input: { type: 'HYPOTHESIS', status: 'ACTIVE', category: 'INTERPRETATION', subject: 'Jogo de reparo', statement: 'A baixa distribuicao de dois videos nao e evidencia suficiente para concluir que o jogo e ruim.', confidence: .9, format: 'LONG_FORM' } },
  { key: 'return-validated-content', input: { type: 'DECISION', status: 'ACTIVE', category: 'STRATEGY', subject: 'Retorno temporario', statement: 'Apos o teste, a decisao foi retornar temporariamente a conteudo mais validado e analisar distribuicao, CTR, retencao, impressoes e watch time separadamente.', confidence: 1, occurredAt: '2026-08-31T12:00:00.000Z' } },
  { key: 'shorts-2026-08-01-07', input: { type: 'FACT', status: 'CONFIRMED', category: 'SHORTS_METRICS', subject: 'Shorts 01-07/08/2026', statement: 'Na janela, Shorts registraram 7.698 views, duracao media de 20 segundos e percentual medio assistido de 29,1%.', confidence: 1, format: 'SHORTS', periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-08-07T23:59:59.999Z', metadata: { views: 7698, averageViewDurationSeconds: 20, averageViewPercentage: 29.1 } } },
  { key: 'shorts-2026-08-08-27', input: { type: 'FACT', status: 'CONFIRMED', category: 'SHORTS_METRICS', subject: 'Shorts 08-27/08/2026', statement: 'Na janela, Shorts registraram 5.638 views, duracao media de 24 segundos e percentual medio assistido de 34,05%.', confidence: 1, format: 'SHORTS', periodStart: '2026-08-08T00:00:00.000Z', periodEnd: '2026-08-27T23:59:59.999Z', metadata: { views: 5638, averageViewDurationSeconds: 24, averageViewPercentage: 34.05 } } },
  { key: 'shorts-2026-08-25-31', input: { type: 'FACT', status: 'CONFIRMED', category: 'SHORTS_METRICS', subject: 'Shorts 25-31/08/2026', statement: 'Na janela, Shorts registraram 1.868 views, duracao media de 28 segundos e percentual medio assistido de 41,04%.', confidence: 1, format: 'SHORTS', periodStart: '2026-08-25T00:00:00.000Z', periodEnd: '2026-08-31T23:59:59.999Z', metadata: { views: 1868, averageViewDurationSeconds: 28, averageViewPercentage: 41.04 } } },
  { key: 'shorts-consumption-improved', input: { type: 'LEARNING', status: 'ACTIVE', category: 'SHORTS_INTERPRETATION', subject: 'Consumo dos Shorts', statement: 'Entre as janelas observadas, a distribuicao caiu enquanto duracao media e percentual medio assistido melhoraram entre quem recebeu os Shorts.', confidence: .85, format: 'SHORTS', periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-08-31T23:59:59.999Z' } },
  { key: 'shorts-feed-testing', input: { type: 'HYPOTHESIS', status: 'ACTIVE', category: 'SHORTS_INTERPRETATION', subject: 'Testes no feed', statement: 'O YouTube pode ter reduzido o volume inicial de testes dos Shorts no feed; faltam shown in feed e viewed versus swiped away para confirmar.', confidence: .35, format: 'SHORTS', periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-08-31T23:59:59.999Z', metadata: { missingMetrics: ['shownInFeed', 'viewedVsSwipedAway'] } } },
  { key: 'shorts-recovery-signal', input: { type: 'HYPOTHESIS', status: 'ACTIVE', category: 'SHORTS_INTERPRETATION', subject: 'Recuperacao de distribuicao', statement: 'Houve sinais de recuperacao da distribuicao no fim de agosto, ainda sem evidencia suficiente para uma conclusao firme.', confidence: .45, format: 'SHORTS', periodStart: '2026-08-25T00:00:00.000Z', periodEnd: '2026-08-31T23:59:59.999Z' } },
  { key: 'youtube-2026-metric-change', input: { type: 'PLATFORM_CHANGE', status: 'ACTIVE', category: 'YOUTUBE', subject: 'Metricas publicas e qualificadas', statement: 'Em 2026 houve mudanca relevante na apresentacao ou contabilizacao de views e metricas qualificadas; desempenho nao deve ser avaliado apenas por views publicas.', confidence: .8, occurredAt: '2026-01-01T00:00:00.000Z', metadata: { evaluateTogether: ['publicViews', 'engagedViews', 'impressions', 'ctr', 'viewedVsSwipedAway', 'shownInFeed', 'retention', 'averageViewDuration', 'watchTime', 'trafficSources'] } } },
  { key: 'do-not-repost-low-distribution', input: { type: 'DECISION', status: 'ACTIVE', category: 'SHORTS_STRATEGY', subject: 'Repost de Shorts', statement: 'Nao apagar ou repostar Shorts somente porque receberam pouca distribuicao.', confidence: 1, format: 'SHORTS' } },
  { key: 'bilibili-catalog', input: { type: 'HYPOTHESIS', status: 'ACTIVE', category: 'DISTRIBUTION', subject: 'Bilibili', statement: 'Republicar futuramente parte do catalogo em outras plataformas, como Bilibili, e uma possibilidade a avaliar; nao existe integracao ativa.', confidence: .25 } },
  { key: 'packaging-city-car', input: { type: 'DECISION', status: 'ACTIVE', category: 'PACKAGING', subject: 'Identidade City Car Driving 2.0', statement: 'Usar identidade preto e laranja, numero de episodio evidente, continuidade visual, logo consistente e acontecimento real; titulo ligado a missao, progressao, problema ou evento concreto.', confidence: 1, game: 'City Car Driving 2.0', series: 'City Car Driving 2.0', entityType: 'PACKAGING_IDENTITY', entityId: 'city-car-driving-2' } },
  { key: 'packaging-forza', input: { type: 'DECISION', status: 'ACTIVE', category: 'PACKAGING', subject: 'Identidade Forza Horizon 6', statement: 'Usar o carro como protagonista, visual cinematografico ou agressivo, logo do jogo e texto curto; descoberta, raridade, restauracao, mod, tuning e transformacao podem sustentar a embalagem.', confidence: 1, game: 'Forza Horizon 6', entityType: 'PACKAGING_IDENTITY', entityId: 'forza-horizon-6' } },
  { key: 'identity-before-ctr', input: { type: 'DECISION', status: 'ACTIVE', category: 'PACKAGING', subject: 'Identidade antes de otimizacao', statement: 'Agentes de CTR e futuros agentes de titulo ou thumbnail devem respeitar a identidade atual; otimizar CTR nao deve apagar a identidade do JvitorZx.', confidence: 1 } },
];

export class ChannelContextBootstrap {
  constructor(private readonly service = new ChannelContextService()) {}

  async run() {
    const results = [];
    for (const entry of entries) {
      results.push(await this.service.createBootstrap(`${CHANNEL_CONTEXT_BOOTSTRAP_SOURCE}:${entry.key}`, {
        ...entry.input, source: CHANNEL_CONTEXT_BOOTSTRAP_SOURCE, channelId: JVITORZX_CHANNEL_ID,
        sourceReference: entry.key,
      }));
    }
    return { total: results.length, created: results.filter(({ created }) => created).length, existing: results.filter(({ created }) => !created).length };
  }
}

export const channelContextBootstrapEntries = entries;
