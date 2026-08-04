# YouTubeService Architecture

Este documento descreve as responsabilidades futuras do `YouTubeService` e mapeia cada método para sua finalidade, dados retornados, dependências e possíveis consumidores.

## Canal

### getChannel()
- Objetivo
  - Buscar informações do canal do usuário autenticado no YouTube.
- Dados retornados
  - Metadados do canal, como título, descrição, ID do canal, imagem do canal, número de inscritos, número de vídeos e configurações de país/publicação.
- Dependências
  - `GoogleService` para autenticação e criação do cliente OAuth2.
  - API `google.youtube({ version: 'v3' }).channels.list`.
- Quem utilizará esse método
  - Dashboard para exibir dados do canal.
  - Operadores para verificar o estado do canal.
  - IA para fornecer contexto de canal ao usuário.

## Vídeos

### getVideos()
- Objetivo
  - Listar vídeos do canal do usuário ou de uma playlist padrão.
- Dados retornados
  - Lista de vídeos com título, ID, miniatura, data de publicação, duração, visualizações e status.
- Dependências
  - `GoogleService` para autenticação.
  - API `google.youtube({ version: 'v3' }).search.list` ou `playlistItems.list` dependendo do uso.
- Quem utilizará esse método
  - Dashboard para exibir biblioteca de vídeos.
  - Operadores para gerenciar conteúdo.
  - IA para navegar e referenciar o conteúdo do canal.

### getVideo(videoId: string)
- Objetivo
  - Buscar detalhes de um vídeo específico pelo ID.
- Dados retornados
  - Informações completas do vídeo, incluindo título, descrição, estatísticas, métricas, status de privacidade e conteúdo.
- Dependências
  - `GoogleService` para autenticação.
  - API `google.youtube({ version: 'v3' }).videos.list`.
- Quem utilizará esse método
  - Dashboard para exibir página de detalhes do vídeo.
  - Operadores para revisar vídeos individuais.
  - IA para analisar ou comentar um vídeo específico.

### getLatestVideo()
- Objetivo
  - Buscar o vídeo mais recente postado no canal do usuário.
- Dados retornados
  - Dados do vídeo mais recente: ID, título, miniatura, data de publicação e estatísticas iniciais.
- Dependências
  - `GoogleService` para autenticação.
  - API `google.youtube({ version: 'v3' }).search.list` com ordenação por data.
- Quem utilizará esse método
  - Dashboard para destacar conteúdo novo.
  - Operadores para monitorar lançamentos recentes.
  - IA para sugerir o vídeo mais atual ao usuário.

### searchVideos()
- Objetivo
  - Pesquisar vídeos com base em termos, tags ou filtros.
- Dados retornados
  - Resultados de pesquisa, incluindo vídeos relevantes e metadados básicos.
- Dependências
  - `GoogleService` para autenticação.
  - API `google.youtube({ version: 'v3' }).search.list`.
- Quem utilizará esse método
  - Dashboard de busca de conteúdo.
  - Operadores para encontrar vídeos específicos rapidamente.
  - IA para procurar referências ou exemplos em vídeos.

## Shorts

### getShorts()
- Objetivo
  - Listar ou buscar vídeos do tipo Shorts do canal do usuário.
- Dados retornados
  - Coleção de Shorts com títulos, miniaturas e estatísticas curtas.
- Dependências
  - `GoogleService` para autenticação.
  - API YouTube adequada para filtrar ou buscar vídeos curtos.
- Quem utilizará esse método
  - Dashboard para exibir conteúdo de Shorts.
  - Operadores focados em formato curto.
  - IA para recomendar ou analisar Shorts.

## Playlists

### getPlaylists()
- Objetivo
  - Listar playlists do canal do usuário.
- Dados retornados
  - Metadados de playlists, como título, ID, contagem de vídeos e descrição.
- Dependências
  - `GoogleService` para autenticação.
  - API `google.youtube({ version: 'v3' }).playlists.list`.
- Quem utilizará esse método
  - Dashboard para gerenciar playlists.
  - Operadores para revisar e organizar conteúdo.
  - IA para sugerir playlists ou navegar por coleções.

## Comentários

### getComments()
- Objetivo
  - Buscar comentários de vídeos ou threads de comentários do canal.
- Dados retornados
  - Comentários e respostas, incluindo autor, texto, data e métricas de engajamento.
- Dependências
  - `GoogleService` para autenticação.
  - API `google.youtube({ version: 'v3' }).commentThreads.list` ou `comments.list`.
- Quem utilizará esse método
  - Dashboard para moderação e análise de comentários.
  - Operadores para responder ou moderar engajamento.
  - IA para analisar sentimento ou resumo de comentários.

## Estatísticas

### getVideoStatistics()
- Objetivo
  - Obter estatísticas detalhadas de um vídeo específico.
- Dados retornados
  - Visualizações, likes, dislikes, comentários, compartilhamentos e métricas de engajamento.
- Dependências
  - `GoogleService` para autenticação.
  - API `google.youtube({ version: 'v3' }).videos.list` com `statistics`.
- Quem utilizará esse método
  - Dashboard para métricas por vídeo.
  - Operadores para avaliar desempenho de conteúdo.
  - IA para análise de desempenho e recomendações.

### getChannelStatistics()
- Objetivo
  - Obter estatísticas agregadas do canal.
- Dados retornados
  - Contagem de inscritos, visualizações totais, número de vídeos e métricas de crescimento.
- Dependências
  - `GoogleService` para autenticação.
  - API `google.youtube({ version: 'v3' }).channels.list` com `statistics`.
- Quem utilizará esse método
  - Dashboard de insights do canal.
  - Operadores para monitorar a saúde do canal.
  - IA para fornecer relatórios e tendências.

## Analytics

### getAnalytics()
- Objetivo
  - Buscar dados analíticos avançados do YouTube Analytics.
- Dados retornados
  - Relatórios de visualização, retenção, origem de tráfego e engajamento.
- Dependências
  - `GoogleService` para autenticação.
  - API `google.youtubeAnalytics({ version: 'v2' })` ou equivalente.
- Quem utilizará esse método
  - Dashboard analítico.
  - Operadores que precisam de relatórios detalhados.
  - IA para gerar insights e recomendações estratégicas.
