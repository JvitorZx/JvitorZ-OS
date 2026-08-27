import { createPanel, html } from '../design-system/index.js';

const createTextElement = (tag, text, className = '') => {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
};

export const createLibraryController = ({ api }) => {
  let generation = 0;
  let mountedPanel = null;
  let openRequest = 0;
  let cleanup = () => {};

  const mount = (root) => {
    const panel = root?.querySelector?.('.library-page');
    if (!panel || panel === mountedPanel) return;
    cleanup();
    mountedPanel = panel;
    const mountToken = ++generation;
    const list = panel.querySelector('[data-library-page-list]');
    const reader = panel.querySelector('[data-library-page-reader]');
    const feedback = panel.querySelector('[data-library-page-feedback]');
    const isCurrent = () => panel === mountedPanel && mountToken === generation;
    const setFeedback = (message = '', variant = '') => {
      feedback.textContent = message;
      feedback.hidden = !message;
      feedback.className = `performance-feedback ${variant}`.trim();
    };
    const renderReader = (item) => {
      const title = createTextElement('h3', item.title?.trim() || 'Item da Biblioteca');
      const type = createTextElement('small', item.type?.trim() || 'resource', 'library-page-type');
      const content = createTextElement('pre', item.content ?? '', 'library-page-content');
      reader.replaceChildren(title, type, content);
      reader.hidden = false;
    };
    const openItem = async (id) => {
      const requestToken = ++openRequest;
      reader.setAttribute('aria-busy', 'true');
      try {
        const item = await api.getLibraryItem(id);
        if (!isCurrent() || requestToken !== openRequest) return;
        renderReader(item);
        setFeedback();
      } catch (error) {
        if (!isCurrent() || requestToken !== openRequest) return;
        setFeedback(error?.status === 404 ? 'Este item não está mais disponível.' : 'Não foi possível abrir o item.', 'error');
      } finally {
        if (isCurrent() && requestToken === openRequest) reader.setAttribute('aria-busy', 'false');
      }
    };
    const handleClick = (event) => {
      const button = event.target.closest?.('[data-library-page-item]');
      if (button?.dataset.libraryPageItem) openItem(button.dataset.libraryPageItem);
    };
    list.addEventListener('click', handleClick);
    panel.setAttribute('aria-busy', 'true');
    api.listLibraryItems().then((items) => {
      if (!isCurrent()) return;
      if (!Array.isArray(items) || !items.length) {
        list.replaceChildren(createTextElement('p', 'A Biblioteca ainda está vazia.', 'home-empty'));
        return;
      }
      list.replaceChildren(...items.map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'library-page-item';
        button.dataset.libraryPageItem = item.id;
        button.append(
          createTextElement('strong', item.title?.trim() || 'Item da Biblioteca'),
          createTextElement('small', item.type?.trim() || 'resource'),
        );
        return button;
      }));
      setFeedback();
    }).catch(() => {
      if (isCurrent()) setFeedback('Não foi possível carregar a Biblioteca. Tente novamente.', 'error');
    }).finally(() => {
      if (isCurrent()) panel.setAttribute('aria-busy', 'false');
    });
    cleanup = () => list.removeEventListener('click', handleClick);
  };

  const unmount = () => {
    cleanup();
    cleanup = () => {};
    mountedPanel = null;
    generation += 1;
    openRequest += 1;
  };

  return { mount, unmount };
};

export const libraryModule = {
  id: 'library',
  route: '/library',
  icon: 'library',
  label: 'Biblioteca',
  pageTitle: 'Biblioteca',
  pageEyebrow: 'Memória reutilizável',
  render: () => createPanel({
    eyebrow: 'Artefatos persistidos',
    title: 'Biblioteca do Planner',
    className: 'library-page',
    body: html`
      <div class="performance-feedback" data-library-page-feedback role="status" aria-live="polite" hidden></div>
      <div class="library-page-layout">
        <div class="library-page-list" data-library-page-list><p class="home-empty">Carregando Biblioteca...</p></div>
        <article class="library-page-reader" data-library-page-reader hidden></article>
      </div>
    `,
  }),
  createController: createLibraryController,
};
