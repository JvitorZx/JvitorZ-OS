export const operatorRegistry = [
  {
    id: 'manager', name: 'Gerente de Operações', route: '/manager', status: 'AVAILABLE',
    responsibility: 'Interpreta pedidos e coordena capacidades registradas.', source: 'Orquestrador local',
  },
  {
    id: 'content-planner', name: 'Planejador de Conteúdo', route: '/planner', status: 'AVAILABLE',
    responsibility: 'Transforma contexto, memória e performance em decisões editoriais.', source: 'Planner + OpenAI configurável',
  },
  {
    id: 'ctr', name: 'Operador de CTR', route: '/analytics/ctr', status: 'NOT_CONFIGURED',
    responsibility: 'Analisa CTR e impressões observadas sem inventar causalidade.', source: 'YouTube Analytics persistido', dynamic: true,
  },
  {
    id: 'retention', name: 'Operador de Retenção', route: '/analytics/retention', status: 'NOT_CONFIGURED',
    responsibility: 'Analisa duração, percentual médio e watch time disponíveis.', source: 'YouTube Analytics persistido', dynamic: true,
  },
  {
    id: 'long-form', name: 'Operador de Longos', route: '/analytics/long-form', status: 'NOT_CONFIGURED',
    responsibility: 'Compara conteúdos explicitamente classificados como long-form.', source: 'Snapshots de performance', dynamic: true,
  },
  {
    id: 'shorts', name: 'Operador de Shorts', route: '/analytics/shorts', status: 'NOT_CONFIGURED',
    responsibility: 'Compara conteúdos explicitamente classificados como Shorts.', source: 'Snapshots de performance', dynamic: true,
  },
  {
    id: 'automation-runner', name: 'Executor de Automações', route: '/automations', status: 'AVAILABLE',
    responsibility: 'Executa e governa planos aprovados com controle operacional.', source: 'Runtime local de automações',
  },
  {
    id: 'future-operators', name: 'Novos operadores', route: null, status: 'PLANNED',
    responsibility: 'Expansão futura sobre o mesmo contrato de lifecycle e capacidades.', source: 'Roadmap',
  },
];
