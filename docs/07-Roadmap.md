# Roadmap

Este documento registra fases gerais e entregas concluídas do JvitorZ OS.

## Fases do Projeto

- **FASE 1 - Fundação** — em andamento
  - GitHub
  - Estrutura
  - Documentação
  - README
  - Backend
- **FASE 2 - Infraestrutura**
- **FASE 3 - Google Cloud**
- **FASE 4 - YouTube APIs**
- **FASE 5 - OpenAI**
- **FASE 6 - n8n**
- **FASE 7 - Primeiro Operador**
- **FASE 8 - Dashboard**
- **FASE 9 - JvitorZ OS Alpha**

## Sprint 13 — Persistência do Planejador

**Status: CONCLUÍDA**

### Entregas

- criação persistida de conversas;
- listagem e histórico de conversas;
- abertura de conversa por ID com mensagens;
- criação e persistência de mensagens;
- ordenação cronológica das mensagens;
- fluxo Nova Conversa;
- troca entre conversas sem mistura de mensagens;
- `Conversation.context` como prompt-base por conversa;
- remoção de `localStorage["planner.prompt.base"]`;
- integração frontend, API client e backend;
- proteção contra respostas assíncronas obsoletas;
- feedback visual e acessível de erros;
- testes automatizados com `node:test` e SQLite em memória.

### Backlog não bloqueador

- reordenar conversas por atividade após criação de mensagem;
- adicionar loading e estado vazio mais elaborados;
- otimizar a consulta usada apenas para validar existência de conversa;
- consolidar enum/tipos compartilhados de `sender`;
- dividir o controller do Planner em unidades menores;
- persistir `activeConversationId` após reload;
- adicionar testes futuros em navegador real.

## Observações

A Sprint 13 encerra o fluxo vertical de persistência do Planejador. IA, respostas automáticas e títulos automáticos permanecem fora deste escopo.
