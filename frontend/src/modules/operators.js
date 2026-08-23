import { createPanel, html } from '../design-system/index.js';
import { operatorRegistry } from '../operators/registry.js';

const getStatusLabel = (status) => {
  const labels = {
    connected: 'Conectado',
    ready: 'Pronto',
    planned: 'Planejado',
  };

  return labels[status] ?? 'Pendente';
};

const renderOperatorContent = (operator, statusLabel, statusClass) => html`
  <div>
    <span>${operator.name}</span>
    <small>${operator.description}</small>
  </div>
  <strong class="operator-status ${statusClass}">${statusLabel}</strong>
`;

const renderOperator = (operator, registeredModuleIds) => {
  const isAvailable = registeredModuleIds.has(operator.id);

  if (isAvailable) {
    return html`
      <a
        class="operator-link"
        href="#${operator.id}"
        data-operator="${operator.id}"
        data-operator-available="true"
      >
        ${renderOperatorContent(operator, getStatusLabel(operator.status), operator.status)}
      </a>
    `;
  }

  const unavailableLabel = operator.status === 'planned' ? 'Planejado' : 'Em breve';
  return html`
    <div
      class="operator-link operator-link-unavailable"
      data-operator="${operator.id}"
      data-operator-available="false"
      aria-disabled="true"
    >
      ${renderOperatorContent(operator, unavailableLabel, 'planned')}
    </div>
  `;
};

export const operatorsModule = {
  id: 'operators',
  label: 'Operadores',
  render(_data, { modules = [] } = {}) {
    const registeredModuleIds = new Set(modules.map((module) => module.id));

    return createPanel({
      eyebrow: 'Operadores',
      title: 'Registro expansivel',
      className: 'operators-panel',
      body: html`
        <ul class="operator-list">
          ${operatorRegistry
            .map(
              (operator) => html`
                <li>
                  ${renderOperator(operator, registeredModuleIds)}
                </li>
              `,
            )
            .join('')}
        </ul>
      `,
    });
  },
};
