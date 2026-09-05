# Research Providers

## Contrato

`ResearchProvider` é uma fronteira modular:

```text
supports(intent) -> boolean
search(ResearchQuery) -> ResearchProviderResult
```

O resultado comum contém fonte, evidências e candidatos. Cada fonte informa provider, origem `INTERNAL`/`EXTERNAL`, data de coleta, freshness, qualidade e limitações. Cada evidência informa classificação, relevância, confiança, instante observado e contexto mínimo.

## Provider atual

`InternalResearchProvider` lê apenas dados persistidos do JvitorZ OS:

- `VideoPerformanceSnapshot`;
- `TrendSignal`;
- `SeriesDefinition`;
- `ContentPattern`;
- `VideoIdea`;
- `AudienceSnapshot`.

Ele não chama YouTube, OpenAI ou rede externa. O provider não mede demanda de mercado e nunca apresenta associação interna como causalidade ou previsão de views.

## Providers futuros

YouTube, vidIQ, web search e outras fontes devem implementar o mesmo contrato. Um adapter futuro deve:

- avaliar configuração somente quando usado;
- não derrubar o sistema quando indisponível;
- não logar token, credencial, query privada ou payload bruto;
- respeitar termos de uso, quota e freshness;
- preservar conflito com outras fontes;
- normalizar dados sem fabricar campos ausentes.

Nenhum scraping frágil ou nova credencial foi introduzido na Sprint 37.

Na Sprint 49, o mesmo provider alimenta Research Sessions persistentes. A sessao copia apenas evidencia normalizada, score e contexto minimo necessarios para reconstruir a decisao daquele momento. Game Research, Content Research e Video Ideas nao adicionam uma chamada externa implicita.

## Cache e degraded mode

Pesquisas idênticas e ainda válidas reutilizam o registro recente. Reexecuções explícitas criam histórico comparável. Se todos os providers falharem, um last-known-good pode ser exibido apenas como `STALE_FALLBACK`; sem resultado anterior, a API responde indisponibilidade segura.

Uma run de sessao concluida e idempotente; rerun cria outra sessao. Falha parcial preserva os providers bem-sucedidos e registra qualidade `PARTIAL`. `RECENT`, `AGING`, `STALE` e `MISSING` descrevem a evidencia observada e nao sao convertidos em atualidade por mera leitura.
