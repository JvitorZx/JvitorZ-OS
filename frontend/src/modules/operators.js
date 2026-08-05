import { createPanel, html } from '../components.js';
import { operatorRegistry } from '../operators/registry.js';

const getStatusLabel = (status) => {
  const labels = {
    connected: 'Conectado',
    ready: 'Pronto',
    planned: 'Planejado',
  };

  return labels[status] ?? 'Pendente';
};

export const operatorsModule = {
  id: 'operators',
  label: 'Operadores',
  render() {
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
                  <div>
                    <span>${operator.name}</span>
                    <small>${operator.description}</small>
                  </div>
                  <strong class="operator-status ${operator.status}">${getStatusLabel(operator.status)}</strong>
                </li>
              `,
            )
            .join('')}
        </ul>
      `,
    });
  },
};
