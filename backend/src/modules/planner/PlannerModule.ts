export class PlannerModule {
  async getInfo() {
    return {
      id: 'content-planner',
      name: 'Planejador de Conteudo',
      status: 'ready',
      message: 'Planner module active (teste)',
      timestamp: new Date().toISOString(),
    };
  }
}
