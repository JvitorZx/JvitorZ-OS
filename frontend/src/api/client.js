export const createApiClient = (baseUrl) => ({
  async getDashboard() {
    const response = await fetch(`${baseUrl}/api/dashboard`);

    if (response.status === 401) {
      return {
        unauthorized: true,
        authUrl: `${baseUrl}/api/auth/google`,
      };
    }

    if (!response.ok) {
      throw new Error(`Erro ${response.status} ao carregar dashboard`);
    }

    return response.json();
  },
});
