# Research & Ideation Intelligence

## Responsabilidades

A Sprint 49 amplia o Research Engine para transformar evidencias internas em sessoes auditaveis, candidatos de jogos, direcoes editoriais e ideias estruturadas. As fronteiras permanecem separadas:

- Research descobre candidatos, evidencias, lacunas e limitacoes;
- Editorial Decision decide e compara oportunidades;
- Strategic Planning organiza a execucao;
- Production executa o workflow somente depois de um handoff explicito.

O provider atual (`InternalResearchProvider`) usa somente dados persistidos do canal: Analytics, tendencias, series, patterns, ideias e audiencia. Nao existe scraping, volume de busca, tendencia externa ou concorrente inferido. Ausencia de fonte externa permanece uma limitacao visivel.

## Research Session

Uma sessao possui objetivo, query, filtros, jogo/formato opcionais, restricoes, status, versao de execucao, fontes, resultados, ranking, evidencias, lacunas e eventos de auditoria. Os estados sao `DRAFT`, `RUNNING`, `COMPLETED`, `FAILED` e `ARCHIVED`.

Executar uma sessao concluida e idempotente. `rerun` cria uma nova sessao e preserva a anterior. A execucao usa lock por sessao e claim condicional no banco; chamadas concorrentes nao multiplicam snapshots. Falha parcial de provider preserva os resultados validos e marca qualidade/limitacoes. Freshness (`RECENT`, `AGING`, `STALE`, `MISSING`) pertence ao snapshot e nunca e promovida silenciosamente.

Cada `ResearchEvidenceItem` guarda origem, classificacao (`fact`, `inference` ou `hypothesis`), resumo, valor/unidade opcionais, datas, freshness, confianca e contexto minimo. `ResearchSessionEvent` e append-only. `ResearchContentGap` registra lacuna, relevancia, risco, freshness e acao possivel sem alegar demanda externa.

## Game e Content Research

Game Research filtra candidatos de tipo `GAME` gerados pelas fontes reais da sessao. Content Research combina os patterns ja persistidos com lacunas e repeticao interna. Nenhum nome de jogo e promovido por regra fixa.

Repeticao usa identidade estrutural e similaridade deterministica entre jogo, serie, formato, premissa, evento central e promessa. Ela serve como alerta; nao transforma similaridade em causalidade nem exige infraestrutura vetorial.

## Video Ideas

Uma ideia guarda titulo de trabalho, jogo, serie, formato, premissa, acontecimento central, promessa, motivo temporal, esforco, riscos, suposicoes, hipotese, fit, score e proveniencia da sessao/oportunidade. O ciclo de vida e:

`CANDIDATE -> SHORTLISTED -> SELECTED -> PLANNED`

`REJECTED` exige motivo; `ARCHIVED` preserva historico; uma ideia pode ser marcada explicitamente como experimento. Edicoes mantem a origem e nao executam Production.

Chaves de identidade impedem duplicatas exatas. Similaridade alta gera aviso e incentiva outro angulo, mas nao apaga ideias. Selecionar uma ideia registra memoria revisavel somente nessa acao explicita. O handoff ao Planner usa `candidateKey=idea:<id>` e e idempotente: retries retornam o item existente.

## Opportunity Score

O score e comparativo dentro do conjunto observado. Ele considera dez dimensoes quando disponiveis: evidencia, confianca, freshness, compatibilidade, novidade, saturacao, esforco, fit estrategico, riscos e lacunas. Cada componente registra valor, contribuicao, origem e ausencia.

`scoreDetails` explica o total e o `qualityGate`. Dado ausente permanece ausente e reduz a qualidade; nao vira zero. O resultado nao e probabilidade de sucesso, previsao de views ou garantia de performance.

## Integracoes

- Gerente reconhece pedidos de ideias, proximo jogo e baixo esforco e executa somente a capability modular `research.discover`, alem da resposta final;
- Planner pode receber uma ideia apenas pelo handoff explicito;
- Creator Memory recebe feedback somente em transicoes humanas controladas;
- Supervisor aplica o gate `READY`, `READY_WITH_WARNINGS`, `INSUFFICIENT_EVIDENCE`, `STALE` ou `NEEDS_REVIEW` sem recalcular Research;
- Analytics e Series sao fontes de evidencia, nao dependencias acopladas na rota;
- Packaging e Production continuam etapas posteriores e nao sao iniciadas automaticamente.

## UI e seguranca

A workspace Pesquisa possui Sessoes, Jogos, Conteudo, Ideias e Shortlist. Ela usa o client central, lifecycle `mount/unmount`, single-flight por acao e tokens de geracao para ignorar respostas obsoletas. Conteudo persistido e renderizado com `textContent`; erros ficam no feedback local acessivel.

Listagens sao limitadas no client e no backend. Payloads e filtros sao estritos. Erros HTTP nao expoem Prisma, stack, credencial ou payload de provider.

## Limitacoes atuais

- o provider funcional e somente interno;
- nao ha scraping, web research ou integracao vidIQ;
- freshness e avaliada sobre os snapshots disponiveis, sem cronjob novo;
- similaridade e lexical/estrutural, nao semantica por embeddings;
- score organiza evidencia relativa e nao substitui decisao humana;
- o handoff cria pauta no plano, mas nao inicia Packaging, Production ou publicacao.
