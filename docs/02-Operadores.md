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

Usa somente `impressions`, `ctr` e views de `VideoPerformanceSnapshot`. Compara CTR com a mediana observada e não atribui causalidade automática a thumbnail, título ou tema.

### Retenção

Usa duração média, percentual médio assistido e watch time. O provider atual não oferece curva granular; por isso a análise declara essa lacuna e não afirma onde ocorre abandono.

### Long-form

Considera apenas snapshots explicitamente classificados como long-form, VOD ou vídeo longo. Consolida views, watch time, retenção média e inscritos disponíveis.

### Shorts

Considera somente snapshots explicitamente classificados como Shorts. Não estima engaged views nem métricas ausentes e não inclui clipping.

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
