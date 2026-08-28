export class PlannerModule {
  async getInfo() {
    const configured = Boolean(process.env.OPENAI_API_KEY?.trim());
    return {
      id: 'content-planner',
      name: 'Planejador de Conteudo',
      status: configured ? 'CONNECTED' : 'NOT_CONFIGURED',
      available: configured,
      message: configured
        ? 'Planner inteligente configurado.'
        : 'Planner persistente disponível; respostas de IA exigem configuração da OpenAI.',
      timestamp: new Date().toISOString(),
    };
  }
}
