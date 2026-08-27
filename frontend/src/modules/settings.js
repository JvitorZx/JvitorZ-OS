import { createDetailList, createPanel } from '../design-system/index.js';

export const settingsModule = {
  id: 'settings',
  route: '/settings',
  pageTitle: 'Configurações',
  pageEyebrow: 'Sistema local',
  label: 'Configuracoes',
  render(_, context) {
    return createPanel({
      eyebrow: 'Configuracoes',
      title: 'Base do sistema',
      className: 'settings-panel',
      body: createDetailList([
        { label: 'API', value: context.apiBaseUrl },
        { label: 'Fonte', value: 'GET /api/dashboard' },
        { label: 'Operadores', value: 'frontend/src/operators/registry.js' },
      ]),
    });
  },
};
