# Operadores

## Contrato operacional

Operadores especializados de canal expõem um contrato comum:

- `status`: `AVAILABLE`, `LIMITED` ou `NOT_CONFIGURED`;
- `facts`: métricas observadas e sua fonte;
- `signals`: desvios e padrões classificados;
- `insights`: interpretações limitadas pelos dados;
- `recommendations`: próximas ações possíveis;
- `missingData`: lacunas explícitas;
- `confidence`: confiança de `0` a `1`;
- `evidence`: snapshots persistidos que sustentam a análise.

O Hub também usa `PLANNED` para capacidades futuras que não possuem navegação funcional.

## Operadores de canal

### CTR

Usa `impressions` e `ctr` oficiais de `VideoReachSnapshot`, com metadados de `VideoPerformanceSnapshot`. Fontes de audiência podem aparecer apenas como contexto, sem atribuir causalidade automática a thumbnail, título, tema ou origem.

### Retenção

Usa duração média, percentual médio assistido e watch time. O provider atual não oferece curva granular; por isso a análise declara essa lacuna e não afirma onde ocorre abandono.

### Long-form

Considera apenas snapshots explicitamente classificados como long-form, VOD ou vídeo longo. Consolida views, watch time, retenção média e inscritos disponíveis e, quando sincronizados, principal fonte, país, dispositivo e status de inscrição do mesmo formato.

### Shorts

Considera somente snapshots explicitamente classificados como Shorts. Contexto de audiência usa apenas linhas `SHORTS`, incluindo Shorts feed quando fornecido oficialmente. Não estima engaged views nem compara percentuais de universos incompatíveis.

## Integrações

- API: `GET /api/operators/channel` e `GET /api/operators/channel/:id`.
- Analytics: workspaces contextuais em `#/analytics/ctr`, `#/analytics/retention`, `#/analytics/long-form` e `#/analytics/shorts`.
- Gerente: capabilities read-only `channel-operator.*`, selecionadas por intenção natural e combináveis.
- Supervisor: consome apenas resumo de status, confiança, amostra e dados ausentes; não executa operadores nem produz mutações.

Os operadores consultam dados persistidos já sincronizados. Abrir uma análise nunca dispara uma chamada ao YouTube.

## Estado live após sincronização

- CTR fica `LIMITED` enquanto impressões e CTR reais não forem fornecidas pela fonte atual; views não são usadas para inventar essas métricas.
- Retenção usa AVD, percentual médio e watch time reais, mas permanece `LIMITED` sem curva granular.
- Long-form fica `AVAILABLE` somente com amostra classificada como `LONG_FORM` pelo `creatorContentType` do YouTube.
- Shorts fica `AVAILABLE` somente com amostra classificada como `SHORTS` pelo mesmo campo oficial.

`sampleSize`, `confidence`, `lastDataAt`, evidências e lacunas vêm do mesmo `ChannelOperatorService` consumido pelo Hub, Analytics, Gerente, Supervisor e Dashboard. Assim, disponibilidade possui a mesma semântica em todas as telas.
# Operador de CTR e qualidade de Reach

O operador CTR usa somente `VideoReachSnapshot` do YouTube Reporting. Ele mostra impressões, CTR mediano, baselines compatíveis, amostra, freshness, qualidade e evidências. Sinais de embalagem são associações: o sistema não afirma que uma thumbnail causou o resultado e não prevê views.

Quando o relatório não existe, o operador permanece `LIMITED`/`NOT_CONFIGURED` e recomenda configurar o provider. Quando existe dado real, fica `AVAILABLE`, ainda que sinalize stale ou inconsistência na qualidade.

## Audience Intelligence

O `AudienceIntelligenceService` é read-only e consolida fontes, países, dispositivos, subscribed status e termos de busca realmente disponíveis. O Gerente reconhece perguntas sobre origem de views, recomendação, país, dispositivo e inscritos e combina os operadores Long-form e Shorts. Ausência permanece em `missingData`; Supervisor mostra qualidade e fatos sem disparar sync.
