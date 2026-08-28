# Dashboard e Navegação

## Application Shell

O frontend usa uma shell operacional persistente:

```text
Sidebar -> Page Header -> Global State -> Main Workspace
```

A sidebar permanece disponível enquanto apenas a página selecionada ocupa `moduleHost`. O Dashboard não empilha todos os módulos como uma landing page.

## Rotas

O roteamento SPA continua baseado em hash e usa caminhos canônicos:

- `#/dashboard`
- `#/channel`
- `#/analytics`
- `#/planner`
- `#/library`
- `#/manager`
- `#/supervisor`
- `#/automations`
- `#/operators`
- `#/settings`

Hashes legados como `#channel` e `#content-planner` são normalizados. Refresh, back/forward e acesso direto preservam a página. Hash ausente ou inválido vai para `#/dashboard`.

O clique na sidebar atualiza sua seleção imediatamente; o `hashchange` continua sendo a fonte da montagem da página.

## Home operacional

`Dashboard` é uma síntese do produto: conexão do YouTube, IA, automações, operadores, prioridades, riscos e ações rápidas. Ferramentas completas permanecem em suas páginas responsáveis.

Sem OAuth Google válido, a rota do Dashboard retorna o estado local com uma ação de reconexão. Em indisponibilidade temporária do Google/YouTube, retorna o mesmo estado local com um aviso global discreto. Planner, Biblioteca, Gerente, Supervisor e Automações não ficam indisponíveis por esses estados.

O Dashboard e Configurações usam o contrato consolidado de `/api/integrations/status`. Integrações usam `NOT_CONFIGURED`, `AUTH_REQUIRED`, `CONNECTED`, `DEGRADED` e `ERROR`; disponibilidade de operadores continua separada em `AVAILABLE`, `LIMITED` e `NOT_CONFIGURED`. YouTube Data, Analytics e Reach aparecem como integrações distintas. Reach mostra também qualidade e freshness, sem apagar Analytics válido quando a Reporting API requer autorização ou está temporariamente indisponível. O Planner só aparece com IA conectada quando `OPENAI_API_KEY` está configurada, e o runtime de automações só aparece ativo quando sua configuração opt-in está habilitada.

Canal e Analytics mostram dados persistidos reais. Uma coleta externa bem-sucedida atualiza `lastSuccessAt`; uma falha temporária preserva o último canal conhecido, marca o estado como degradado e evita substituir valores reais por `--`. O resumo inicial mostra saúde de alcance/CTR e alertas de qualidade sem duplicar a análise detalhada disponível em Analytics.

Analytics possui as subrotas `#/analytics/audience` e `#/analytics/traffic`. Elas exibem fontes, países, dispositivos, status de inscrição, termos disponíveis, qualidade e freshness usando listas operacionais. O Dashboard mostra apenas principal fonte e país; o Supervisor mostra qualidade e lacunas. Erros e sync permanecem locais, sem usar `statePanel`.

## Lifecycle

Cada módulo segue `createController(context) -> { mount(container), unmount() }`. Ao mudar de rota, o módulo anterior é desmontado uma vez antes da substituição do DOM. Listeners, timers e respostas assíncronas pertencem ao controller local.

`statePanel` permanece exclusivo para estado global da aplicação. Erros internos de Planner, Analytics, Biblioteca, Operadores, Gerente ou Automações usam feedback local com `aria-live`.
