# Google Integration

Este módulo prepara a autenticação OAuth2 para o Google Cloud.

## Responsabilidades

- `GoogleAuth.ts`: configura o cliente OAuth2 e gera a URL de autorização.
- `GoogleClient.ts`: centraliza clientes de APIs Google, como YouTube. Ainda não contém lógica específica.
- `index.ts`: exporta as classes para uso no backend.
