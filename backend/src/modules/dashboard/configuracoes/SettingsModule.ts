export class SettingsModule {
  async getSettings() {
    // Responsável por retornar as configurações do dashboard.
    return {
      theme: 'default',
      notificationsEnabled: false,
    };
  }
}
