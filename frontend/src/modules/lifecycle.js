const noop = () => {};

export const createModuleLifecycle = (module, context) => {
  let controller = null;

  const getController = () => {
    if (!controller) {
      controller = module.createController?.(context) ?? {
        mount: noop,
        unmount: noop,
      };
    }

    return controller;
  };

  return {
    mount(container) {
      getController().mount?.(container, context);
    },
    unmount() {
      controller?.unmount?.();
    },
  };
};
