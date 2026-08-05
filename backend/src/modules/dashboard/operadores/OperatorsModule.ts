export class OperatorsModule {
  async getOperatorsStatus() {
    // Responsável por retornar o status e configurações dos operadores do dashboard.
    return {
      availableOperators: [],
      activeOperators: [],
    };
  }
}
