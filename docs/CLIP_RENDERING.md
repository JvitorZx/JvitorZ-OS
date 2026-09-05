# Controlled Local Clip Rendering

Sprint 52 implementa renderizacao local explicita de candidatos Shorts selecionados e revisados. Validada com 1.195 testes, build, Prisma, 36 migrations, integridade SQLite e smoke HTTP/browser; commit e sincronizacao constam do relatorio final.

## Fluxo e perfis

Shorts CURRENT → candidato SELECTED → etapa SHORTS COMPLETED → mesmo asset da producao registrado em Midia e READY → preflight → pedido explicito → fila serial local → FFmpeg → verificacao ffprobe → Library e preview por ID.

O preflight e somente leitura: nao gera clips nem muda Production. Ele reutiliza o fingerprint de fonte da Sprint 50 por uma funcao compartilhada, escolhe exatamente o mesmo asset preferido (EDITED_VIDEO antes de RAW_VIDEO) e exige o LocalMediaSource desse LibraryItem. Nao substitui silenciosamente uma fonte ausente por outra disponivel. Confere stat atual, duracao real, limites do corte, transcript atual e etapas anteriores.

| Layout | Comportamento |
| --- | --- |
| FIT (padrao) | Preserva a imagem inteira e completa 720×1280 com barras pretas |
| CENTER_CROP (explicito) | Preenche 720×1280 e recorta centralmente as sobras |

Saida MP4 com H.264, yuv420p e AAC quando a fonte possui audio. Fonte sem audio permanece sem audio; se a fonte possui audio e a saida perde essa faixa, a verificacao rejeita o resultado. FFmpeg recebe inicio e duracao reais em segundos, mapas explicitos de primeira faixa de video e primeira faixa de audio opcional. Nao implementa reframing inteligente, legendas queimadas, publicacao ou previsao de performance.

## Persistencia e worker

Migration `20260917120000_clip_render_jobs` adiciona ClipRenderJob, a 36a migration. O job referencia ClipCandidate, LocalMediaSource e LibraryItem de saida, mantendo productionId/analysisId e snapshot editorial. A combinacao snapshotKey+attempt e unica. O snapshot contem IDs, fingerprints, limites, titulo/hook, layout e perfil; nao contem caminhos absolutos.

Enqueue repetido com o mesmo snapshot retorna o job existente, inclusive falha anterior; uma nova tentativa de falha/cancelamento/interrupcao exige retry explicito e cria outro ID/attempt. Mudanca de layout ou de snapshot cria trabalho distinto. A fila executa um job por vez por instancia local do servico. O backend deve executar uma unica instancia desse worker para o mesmo banco; nao existe promessa de coordenacao distribuida entre processos.

Estados persistidos: QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED e INTERRUPTED. Ao inicializar o servico em um processo novo, jobs QUEUED/RUNNING antigos sao marcados INTERRUPTED e nao sao reexecutados silenciosamente. Inicializacao ocorre no primeiro acesso operacional a jobs/health; preflight permanece somente leitura. Falha interna de banco encerra o worker, tenta marcar pendencias como INTERRUPTED e sinaliza indisponibilidade; nao inicia um loop infinito de tentativas. Reiniciar e solicitar retry e explicito.

Cancelamento aborta o processo e impede a associacao de uma saida como aprovada. Progresso e limitado a 95 durante o processamento e chega a 100 somente apos verificacao e persistencia. Timeout padrao de 10 minutos, stderr limitado a 128 KB, stdout de progresso a 512 KB e buffer parcial a 16 KB. O processo usa spawn sem shell, janela oculta no Windows, protocolo de entrada `file` e whitelist fechada de containers. Nenhum comando ou path fornecido pelo usuario e interpolado em shell.

## Fonte, saida e validacao

Fonte e selecao sao revalidadas antes/depois do FFmpeg, depois do ffprobe e dentro da transacao que salva o resultado. Edicao, rejeicao, regeneracao, alteracao de fonte ou invalidacao detectada durante o processo impedem SUCCEEDED. ffprobe confere dimensoes 720×1280, codec H.264, AAC quando presente, audio coerente com a fonte e duracao com tolerancia tecnica de 350 ms. Stat da saida tambem precisa permanecer estavel durante o probe.

Os arquivos ficam exclusivamente em `backend/rendered`, ignorada por `/rendered/` no Git. O nome e gerado a partir do ID do job, nunca do caminho/titulo do usuario. FFmpeg usa `-n`: nao sobrescreve arquivos existentes. Fontes originais nunca sao apagadas, alteradas ou movidas. Falhas e cancelamentos podem deixar saida parcial isolada nessa pasta; ela nao recebe LibraryItem nem preview aprovado e nao e apagada automaticamente.

A saida aprovada cria um LibraryItem de tipo video e fica relacionada pelo proprio ClipRenderJob. Nao foi inventado um novo role ProductionAssetRelation. Nao cria LocalMediaSource para a saida, porque as raizes de entrada nao incluem automaticamente a pasta de renderizacao.

GET/list/preview revalidam jobs SUCCEEDED. Se candidato/fonte/arquivo de saida mudou, o job passa para FAILED com `OUTPUT_OUTDATED`, preservando referencia e historico; preview antigo e bloqueado. O preview abre handle autorizado dentro da pasta de saida, verifica fstat e caminho atual, e transmite desse mesmo handle, com GET/HEAD e Range unico. Caminhos arbitrarios, IDs invalidos e links de saida nao sao aceitos.

## API e workspace

Workspace `#/renders/:candidateId`, acessivel a partir dos candidatos selecionados em Shorts. A UI apresenta preflight, escolha explicita do layout, estado, progresso, falhas, retry/cancel e preview aprovado.

| Metodo em /api/renders | Resultado |
| --- | --- |
| GET /health | available/capability/reason e worker SERIAL_LOCAL |
| GET /candidates/:id/preflight | eligible, reasons, source, clip, profiles, defaultLayout |
| GET /jobs?productionId=... | Ate 100 jobs, mais recentes primeiro |
| GET /jobs/:id | Job atual, com snapshot e outputMetadata |
| POST /jobs | candidateId e layout opcional; `{job, created}` |
| POST /jobs/:id/cancel | Job cancelado |
| POST /jobs/:id/retry | `{job, created}` de tentativa explicita |
| GET/HEAD /jobs/:id/preview | MP4 aprovado, por ID, com Range |

Erro interno nao retorna stack, stdout/stderr bruto ou caminhos absolutos. Sem FFmpeg/ffprobe, health informa indisponibilidade e execucao nao inventa uma saida.

## Limites conhecidos e testes

Stat e deteccao operacional, nao snapshot imutavel nem hash integral da midia. Arquivos podem mudar em filesystem mutavel; as verificacoes recusam divergencias detectadas antes de aprovar ou servir resultados. FIT pode ter barras; CENTER_CROP nao acompanha rostos/acao. Nao existe limpeza automatica de saidas parciais ou fila distribuida. Custos de CPU, disco e codecs continuam locais.

Testes usam fixture sintetica gerada por ffmpeg em diretorio temporario e banco isolado. Validam cortes reais FIT/CENTER_CROP, perfil/duracao/audio, fonte muda e perda indevida de audio, preservacao do original, identidade concorrente, fila serial, cancelamento, restart, retry, falha de banco sem loop, alteracoes durante/depois, Range/HEAD e integridade SQLite. O wrapper do processo tambem e testado com child controlado para timeout, abort e cap de stdout com linhas curtas.
