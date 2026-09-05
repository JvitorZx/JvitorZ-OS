# Shorts Intelligence e Clip Candidates

Sprint 50 implementa a etapa editorial de recortes dentro de Production. A validacao final e o checkpoint Git sao publicados no relatorio da sprint; este documento descreve o comportamento, sem declarar a sprint concluida.

## Fluxo

Production LONG_FORM → EDITING concluida → transcript temporal importado em Chapters → CHAPTERS concluida ou pulada → analise de Shorts → evidencia e revisao → shortlist/selecao → concluir SHORTS → Packaging. O workspace `#/shorts` permite escolher a producao, consultar versoes, gerar, regenerar explicitamente, editar, adicionar candidatos/variantes, arquivar e inspecionar evidencia. `#/shorts/:productionId` abre uma producao relacionada.

Nenhum MP4 e recortado, renderizado ou publicado. O operador existente de Analytics Shorts continua responsavel pelas metricas, com acesso pela navegacao existente.

## Deteccao, ranking e evidencia

O detector deterministico reconhece marcadores textuais genericos em portugues e ingles para erro, tensao, descoberta, conquista, desafio, reacao e transformacao. Ele utiliza somente segmentos reais e pode produzir uma lista vazia. O hook inicial e extraido da fala. Os limites incluem setup proximo e ate tres segmentos seguintes em busca de payoff; grandes lacunas e mudancas de capitulo restringem a expansao. Capitulos selecionados da mesma versao do transcript fornecem contexto e referencia de capitulo.

O score soma fatores explicaveis de acontecimento, payoff, contexto, densidade temporal e suporte do hook. Nao estima views, probabilidade de viralizacao nem causalidade. Hooks editados recalculam suporte lexical e deixam a origem manual explicita. Densidade nao significa que o menor corte seja o melhor. Os padroes editoriais sao 5 a 90 segundos, ate oito candidatos; nao sao limites de plataforma. Configuracao aceita inteiros positivos, ate 600 segundos e 30 candidatos como protecao de processamento editorial.

Cada candidato guarda apenas IDs e posicoes dos segmentos de evidencia. A API de evidencia recupera a fala original sob demanda; o transcript inteiro nao e duplicado. Start/end manuais precisam coincidir com bordas reais de segmentos, e nao podem cortar um segmento temporal ao meio. Isso conserva a evidencia; refinamento audiovisual em subsegmentos fica para uma etapa futura.

Intervalos com sobreposicao substancial sao deduplicados. Variantes sao criadas manualmente com uma justificativa, bordas distintas e vinculo ao momento original; nao sao geradas para todo candidato. Variantes irmas podem ser editadas e comparadas, mas somente uma variante do mesmo momento pode ser selecionada para handoff.

## Persistencia e concorrencia

Migration `20260915120000_shorts_intelligence` adiciona ShortAnalysis, ClipCandidate e ClipRevision (34 migrations no conjunto). ShortAnalysis relaciona Production e TimedTranscript por chaves estrangeiras; candidatos e revisoes pertencem a analise. Um indice parcial unico garante uma unica analise CURRENT por producao, e `(productionId, version)` e unico. A transacao adquire o lock de escrita SQLite antes de ler source/versao; concorrencia entre instancias nao depende apenas de locks locais. As chaves sao parametrizadas e a validacao permanece nos services/dominio.

Analise comum e refresh de UI reutilizam a versao CURRENT; mudar a configuracao exige regeneracao explicita. Regeneracao cria uma versao nova e marca a anterior SUPERSEDED, preservando edicoes, selecoes e revisoes. Nova versao temporal marca analises anteriores STALE e invalida SHORTS/Review na transacao da importacao. Reabrir EDITING ou alterar assets de video tambem invalida analises imediatamente. O fingerprint inclui transcript, estado/tentativas da edicao e referencia do asset. Listagem confere o fingerprint para detectar outras divergencias. Historico permanece consultavel; versoes STALE e SUPERSEDED nao sao editaveis.

Selecao repetida nao duplica revisoes. Editar candidato selecionado volta para SHORTLISTED, limpa revisao e invalida output concluido. Conclusao e handoff revalidam a fonte e as dependencias. Remocao editorial arquiva o candidato, preservando auditoria. Production nao permite concluir SHORTS manualmente contornando a revisao; pular a etapa opcional permanece disponivel.

## Supervisor, Gerente e contexto

Supervisor verifica bordas, correspondencia de evidencia, suporte textual do hook, clickbait evidente, duplicacao e quantidade excessiva. Ausencia de payoff/contexto e limitacao da heuristica produzem alertas; fala inventada, evidencia incoerente e hook sem suporte bloqueiam selecao. A revisao e persistida em ShortAnalysis e em revisoes; selecionar tambem valida o candidato e concluir revisa o conjunto selecionado.

Gerente reconhece pedidos de cortes/melhores momentos e utiliza `production.manage`, sem criar outro operador. Resolve producao por titulo/ID quando informado; havendo varias producoes sem referencia suficiente, informa a ambiguidade e nao analisa uma arbitrariamente. Ausencia de transcript e dependencias bloqueadas sao distintas e explicitas. O Gerente retorna candidatos/racional para selecao humana; nao seleciona silenciosamente um corte.

ChannelContextResolver fornece um snapshot seletivo de memoria real, com IDs, tipo, assunto e enunciado, para revisao editorial no workspace. Esse contexto nao altera a fala nem gera um LEARNING por selecao. Analytics e opcional e nao participa do score nesta versao; nenhum dado historico e inventado.

## API

Todas as rotas pertencem a `/api/shorts`.

| Metodo e rota | Resultado |
| --- | --- |
| GET /productions/:id | Analises e candidatos, versao decrescente |
| POST /productions/:id/analyze | `{analysis, created}`; aceita minDurationMs/maxDurationMs/maxCandidates |
| POST /productions/:id/regenerate | Nova versao explicita, mesma configuracao de entrada |
| GET /analyses/:id | Analise e historico |
| GET /candidates/:id | Candidato |
| PATCH /candidates/:id | Edicao startMs/endMs/title/hook |
| POST /analyses/:id/candidates | Candidato manual; variantOfId e variantReason opcionais |
| POST /candidates/:id/shortlist, select, reject, archive | Transicao editorial idempotente |
| GET /candidates/:id/evidence | Transcript ID e segmentos reais do intervalo |
| POST /analyses/:id/review | Revisao persistida do Supervisor |
| POST /analyses/:id/complete | `{analysis, production}` |
| GET /productions/:id/selected | Selecionados da analise CURRENT |
| GET /productions/:id/render-contract | Contrato futuro de renderizacao |

Erros de entrada retornam 400, ausencia 404 e conflito de estado/fonte 409. Falhas internas retornam mensagem generica sem stack, Prisma ou credenciais.

## Contrato futuro de renderizacao

`contractVersion: 1` identifica producao, analise, fingerprint e clips selecionados. Cada clip contem ID, sourceAssetId (Library), sourceVideoId quando conhecido, startMs/endMs, titulo/hook/game/series e caption range com transcriptId/segmentIds. O asset EDITED_VIDEO tem preferencia sobre RAW_VIDEO. Nao cria storage nem copia midia. Sem asset, `renderReady: false` e `missingData: ['source video asset']`; os intervalos continuam revisaveis, sem prometer um corte renderizavel.

## Limitacoes reais

Heuristica lexical nao compreende imagem, entonacao, ironia ou todos os idiomas. Marcadores podem exigir revisao manual e ausencia deles pode omitir bons cortes. Score mede evidencia editorial relativa, nao performance. ChapterEntry ID e referencia contextual historica; Chapters pode substituir suas entries em edicao, enquanto evidencia temporal continua vinculada ao transcript imutavel. Importacao e parsing temporal permanecem no Chapters existente. Analises antigas/variantes nao sao apagadas por regeneracao. Nenhuma integracao externa de publicacao ou renderizacao foi adicionada.
