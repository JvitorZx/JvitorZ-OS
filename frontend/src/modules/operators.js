import { createPanel, html } from '../design-system/index.js';
import { operatorRegistry } from '../operators/registry.js';

const STATUS_LABELS = {
  AVAILABLE: 'Disponível',
  LIMITED: 'Limitado',
  NOT_CONFIGURED: 'Não configurado',
  PLANNED: 'Planejado',
};

const createTextElement = (tag, text, className = '') => {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
};

const formatLastData = (value) => {
  if (!value) return 'Sem dados coletados';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Data indisponível'
    : `Último dado: ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)}`;
};

const isRegisteredRoute = (route, modules) => {
  if (!route) return false;
  return modules.some((module) => module.route === route
    || (module.allowSubroutes && route.startsWith(`${module.route}/`)));
};

export const createOperatorsController = ({ api, modules }) => {
  let mountedPanel = null;
  let generation = 0;

  const mount = (root) => {
    const panel = root?.querySelector?.('.operators-panel');
    if (!panel || panel === mountedPanel) return;
    mountedPanel = panel;
    const token = ++generation;
    const list = panel.querySelector('[data-operator-list]');
    const feedback = panel.querySelector('[data-operator-feedback]');
    const isCurrent = () => panel === mountedPanel && token === generation;
    const setFeedback = (message = '', variant = '') => {
      feedback.textContent = message;
      feedback.hidden = !message;
      feedback.className = `performance-feedback ${variant}`.trim();
    };
    const render = (analyses = []) => {
      const dynamicById = new Map(analyses.map((analysis) => [analysis.id, analysis]));
      const items = operatorRegistry.map((definition) => {
        const analysis = definition.dynamic ? dynamicById.get(definition.id) : null;
        const operator = analysis ? { ...definition, ...analysis } : definition;
        const navigable = operator.status !== 'PLANNED' && isRegisteredRoute(operator.route, modules);
        const item = document.createElement('li');
        item.className = 'operator-card';
        const heading = document.createElement('div');
        heading.className = 'operator-card-heading';
        heading.append(
          createTextElement('strong', operator.name),
          createTextElement('span', STATUS_LABELS[operator.status] ?? operator.status, `operator-status ${String(operator.status).toLowerCase().replace('_', '-')}`),
        );
        item.append(
          heading,
          createTextElement('p', operator.responsibility),
          createTextElement('small', `Fonte: ${operator.source}`),
          createTextElement('small', analysis
            ? formatLastData(analysis.lastDataAt)
            : operator.status === 'PLANNED' ? 'Disponibilidade futura' : 'Serviço interno disponível'),
        );
        if (navigable) {
          const action = document.createElement('a');
          action.className = 'operator-card-action';
          action.href = `#${operator.route}`;
          action.textContent = operator.status === 'NOT_CONFIGURED' ? 'Ver dados necessários' : 'Abrir operador';
          item.append(action);
        } else {
          item.append(createTextElement('span', 'Em breve', 'operator-card-action disabled'));
        }
        return item;
      });
      list.replaceChildren(...items);
    };

    render();
    panel.setAttribute('aria-busy', 'true');
    api.listChannelOperators().then((analyses) => {
      if (!isCurrent()) return;
      render(Array.isArray(analyses) ? analyses : []);
      setFeedback();
    }).catch(() => {
      if (!isCurrent()) return;
      setFeedback('Não foi possível atualizar o estado dos operadores do canal.', 'error');
    }).finally(() => {
      if (isCurrent()) panel.setAttribute('aria-busy', 'false');
    });
  };

  const unmount = () => {
    mountedPanel = null;
    generation += 1;
  };

  return { mount, unmount };
};

export const operatorsModule = {
  id: 'operators',
  route: '/operators',
  pageTitle: 'Operadores',
  pageEyebrow: 'Capacidades do sistema',
  label: 'Operadores',
  render: () => createPanel({
    eyebrow: 'Hub de Operadores',
    title: 'Capacidades reais e planejadas',
    className: 'operators-panel',
    body: html`
      <div class="performance-feedback" data-operator-feedback role="status" aria-live="polite" hidden></div>
      <ul class="operator-grid" data-operator-list></ul>
    `,
  }),
  createController: createOperatorsController,
};
