# Local Media Source Registry & Probe

Sprint 51 acrescenta registro e inspecao de arquivos locais de video ao Library existente. Validada com 1.160 testes, build, Prisma, 35 migrations, integridade SQLite e smoke HTTP/browser; o commit e a sincronizacao remota constam do relatorio final.

## Uso e modelo

O workspace `#/media` lista fontes locais, estado, duracao, codecs, resolucao e audio. A inscricao usa uma raiz permitida e caminho relativo do arquivo; pode relacionar o mesmo LibraryItem a Production como RAW_VIDEO ou EDITED_VIDEO. O arquivo original permanece no lugar: nenhum storage adicional, upload, download ou copia de midia e criado. O preview e oferecido por ID da fonte, sem URL de arquivo arbitraria.

LocalMediaSource e uma extensao 1:1 de LibraryItem. Guarda rootId, relativePath, identidade unica da localizacao, fingerprint de stat, tamanho em string, metadados do probe, estado, codigo de erro e datas. A migration `20260916120000_local_media_sources` e a 35a do conjunto; nao redefine tabelas existentes. ProductionAssetRelation permanece a unica relacao de assets da producao.

## Configuracao das raizes

`MEDIA_ALLOWED_ROOTS` aceita um array JSON de diretorios locais absolutos, por exemplo `["D:\\Videos\\Finalizados"]`. Nao deve receber URL, UNC ou caminho de rede. Sem configuracao, usa `backend/media`, criada vazia quando consultada. A regra `/media/` em `backend/.gitignore` protege apenas essa pasta de midia, preservando o codigo do servico no Git.

A API devolve apenas IDs estaveis e labels derivados do nome da pasta, sem caminhos absolutos. O padrao aparece como `Midia do projeto (backend/media)`. O ID depende da raiz normalizada, com case folding no Windows; trocar a configuracao torna registros de raizes removidas explicitamente indisponiveis. Os caminhos relativos permanecem visiveis para o usuario identificar os arquivos.

Extensoes aceitas: mp4, mov, mkv, webm, avi e ts. Traversal, componentes ambiguos, URL, drive absoluto, UNC, alternate data streams, encoding de caminho, diretorios e links simbolicos/junctions no caminho sao rejeitados. Depois de realpath, o arquivo precisa permanecer sob a raiz real; raiz real de rede tambem e rejeitada.

## Probe real e estados

ffprobe e descoberto no PATH, sem instalar ou baixar componentes. O processo usa spawn sem shell, com argumentos separados e janela oculta no Windows. A inspecao limita protocolos a `file` e formatos a `mov,matroska,webm,avi,mpegts`; playlists disfarçadas de mp4 nao sao aceitas. Somente duracao, formato, codecs, dimensoes e existencia de audio sao solicitados. stdout/stderr e caminhos absolutos nao sao retornados ao frontend.

O probe possui timeout de 15 segundos e limite total de saida de 128 KB; health possui limites menores. Erros e metadata incompleta nao geram valores inventados. Falta de ffprobe retorna capacidade indisponivel e permite registrar a referencia como UNAVAILABLE para inspecao futura. Erro de formato/probe gera ERROR. READY exige video com duracao e dimensoes utilizaveis. Metadados de stat antes e depois do processo precisam coincidir: arquivo mudado durante o probe e rejeitado como fonte instavel.

| Estado | Significado |
| --- | --- |
| READY | Probe valido; arquivo acessivel e sem mudanca detectada |
| CHANGED | Stat divergiu, ou arquivo retornou apos indisponibilidade; reprobe necessario |
| OFFLINE | Arquivo/raiz indisponivel ou acesso negado |
| UNAVAILABLE | ffprobe nao esta instalado/disponivel |
| ERROR | Probe falhou, expirou, excedeu limites ou metadata nao e valida |

Fingerprint e uma deteccao operacional baseada em dev/inode/tamanho/mtime/ctime, nao um hash criptografico do conteudo. Nao existe watcher de filesystem: consulta de fonte/listagem/preview verifica o arquivo. A aceitacao de uma nova fingerprint exige reprobe explicito. Reprobe preserva IDs e LibraryItem. Atualizacoes concorrentes usam comparacao de fingerprint e updatedAt; uma verificacao antiga nao sobrescreve um reprobe mais recente.

## Preview

GET/HEAD `/api/media/sources/:id/preview` exige fonte READY e atual. A abertura verifica realpath, abre um handle e compara fstat com a fingerprint autorizada e com uma nova resolucao do caminho. O stream utiliza esse mesmo handle, sem reabrir o caminho. A resposta suporta um unico Range de bytes, inclusive suffix e intervalo aberto, com Content-Range e 206; intervalos invalidos ou multiplos retornam 416. HEAD responde apenas cabecalhos. O stream fecha ao terminar ou quando o cliente desconecta. Cache e privado/no-store, com nosniff.

Codecs podem nao ser reproduziveis no navegador mesmo quando o container e aceito pelo probe. Esta sprint nao transcodifica ou remuxa arquivos. Arquivos podem mudar apos a abertura em um filesystem mutavel; a verificacao elimina substituicao entre autorizacao e abertura, mas nao constitui snapshot imutavel da midia. A etapa futura de renderizacao devera revalidar a fonte antes e depois do trabalho.

## Integracoes e API

Registro pode associar o LibraryItem existente a Production pelo servico de assets. Mudanca/indisponibilidade detectada e reprobe com alteracao invalidam analises Shorts CURRENT e output dependente, preservando historico. O contrato renderReady da Sprint 50 nao foi alterado; nenhum renderer e introduzido.

| Metodo e rota em /api/media | Resultado |
| --- | --- |
| GET /health | available, capability e reason sanitizado |
| GET /roots | IDs e labels permitidos |
| GET /sources | Ate 200 fontes com estado verificado |
| GET /sources/:id | Fonte e relacoes Production |
| POST /sources | rootId, relativePath, title?, productionId?, role?; retorna source/created |
| POST /sources/:id/reprobe | Reprobe explicito; retorna source/changed |
| GET ou HEAD /sources/:id/preview | Stream local autorizado por ID |

Campos de Source: id, libraryItemId, rootId, relativePath, title, status, fingerprint, sizeBytes, durationMs, formatName, videoCodec, audioCodec, width, height, hasAudio, probeAt, lastCheckedAt, errorCode, previewUrl e productions. Nao inclui caminho absoluto nem stdout/stderr do processo. lastCheckedAt acompanha o probe ou a ultima transicao de estado persistida; leituras sem mudancas nao geram escrita desnecessaria.

## Validacao

Testes geram fixture pequena de video/audio com ffmpeg em diretorio temporario isolado e usam ffprobe real. Cobrem paths maliciosos, junction escape, playlist disfarçada, metadados reais, falta de executavel, timeout/limite de saida, arquivo alterado durante probe, compare-and-set concorrente, duplicacao, Library/Production, invalidacao Shorts, preview Range/HEAD e integridade SQLite/foreign keys. O banco pessoal e os arquivos pessoais nao sao utilizados pelos testes.
