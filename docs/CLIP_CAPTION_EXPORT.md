# Clip Caption Export

Sprint 53 acrescenta exportacao computada de legendas SRT/VTT a jobs de renderizacao aprovados. Validada com 1.220 testes, build, Prisma e smoke HTTP/browser. Nao cria migration, ASR, modelo de linguagem, nova transcricao, legendas queimadas nem publicacao. Commit e sincronizacao constam do relatorio final.

## Fonte temporal e disponibilidade

O job precisa estar SUCCEEDED e passar pela mesma verificacao de fonte, selecao e saida usada pelo preview de video. O exportador usa o analysisId do job para localizar o TimedTranscript original, e os limites do snapshot renderizado. Ele consulta todos os segmentos que se sobrepoem a esse intervalo, sem depender apenas da lista editorial de evidencias do candidato.

Depois de ler os segmentos, o job e verificado novamente. Se a selecao, fonte ou saida mudar durante a leitura, a exportacao e bloqueada. Jobs FAILED, CANCELLED, INTERRUPTED, desatualizados ou ainda em processamento nao exportam legendas. Um job valido sem segmentos utilizaveis retorna `available: false`; o download retorna 409. Nao inventa fala ou tempos para preencher a ausencia.

Nenhum arquivo de legenda e persistido no banco ou storage do servidor. JSON e downloads sao derivados sob demanda. As verificacoes existentes podem marcar um job antigo como OUTPUT_OUTDATED; isso preserva a regra de validade do renderer.

## Transformacao e avisos

Cada cue conserva o texto do segmento real e seu ID como sourceSegmentId. Ordenacao deterministica por inicio, posicao original e ID. Inicio/fim sao limitados ao intervalo do corte e deslocados para zero. Sobreposicoes reais permanecem sobrepostas, com aviso; o exportador nao inventa uma sequencia sem sobreposicao.

Quando apenas parte de um segmento cruza o limite do clip, o intervalo e limitado, mas o texto completo desse segmento permanece. Um aviso explicito pede revisao: o sistema nao sabe quais palavras pertencem a cada subintervalo. Segmentos sem texto utilizavel ou com tempo invalido sao omitidos com aviso, sem completar lacunas ficticias.

Unicode e multiplas linhas de fala sao preservados. Quebras CRLF/CR sao normalizadas; linhas vazias, espacos nas bordas e controles como NUL sao removidos. O DTO apresenta texto legivel. SRT/VTT escapam `&`, `<` e `>` em entidades, preservando o texto visual e evitando markup executavel/cues inseridos pelo conteudo. Assim `-->` dentro da fala deixa de ser delimitador estrutural. A compatibilidade visual de entidades em SRT pode variar conforme o player; o arquivo permanece texto UTF-8 seguro.

SRT utiliza `HH:MM:SS,mmm`; WebVTT utiliza `HH:MM:SS.mmm` e cabecalho WEBVTT. Horas nao reiniciam em 24 e aceitam mais de dois digitos. Numeracao de cues e gerada pelo sistema, nunca extraida da fala.

## API e UI

| Metodo | Resultado |
| --- | --- |
| GET /api/renders/jobs/:id/captions | jobId, available, reasons, cueCount, durationMs, cues, formats, warnings |
| GET/HEAD /api/renders/jobs/:id/captions/srt | Download UTF-8 com attachment `jobId.srt` |
| GET/HEAD /api/renders/jobs/:id/captions/vtt | Download UTF-8 com attachment `jobId.vtt` |

Cue: index, startMs, endMs, text e sourceSegmentId. Formatos aceitos sao estritamente srt e vtt; formato invalido ou query desconhecida retorna 400, job ausente 404, indisponibilidade/desatualizacao 409. Downloads usam nosniff e cache privado/no-store. O nome do arquivo deriva somente do ID validado do job.

No workspace Renders, jobs aprovados oferecem **Conferir legendas**. O operador inspeciona texto e avisos antes de usar os links de download SRT/VTT. A opcao **Mostrar legendas na previa** utiliza uma track WebVTT separada no navegador, sem gravar texto no MP4. A UI utiliza DOM seguro para o texto das falas. O export nao altera o video renderizado.

## Validacao e limites

Testes cobrem deslocamento temporal, segmentos parciais, sobreposicoes, Unicode, multiline, controles, hora longa, limites exatos, fonte vazia, markup/cue injection, SRT/VTT, HTTP/HEAD e headers. Integracoes com render real verificam o transcript correto e bloqueiam alteracoes antes/durante a exportacao.

A qualidade linguistica e temporal depende do transcript existente; nao ha alinhamento palavra a palavra, revisao automatica de traducao ou detecao de falantes. A duracao das legendas acompanha o intervalo editorial do snapshot, sujeito a pequena tolerancia de duracao do MP4 ja documentada no renderer.
