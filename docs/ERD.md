# ERD

## Diagrama textual das entidades

User
├── id
├── email
├── name
├── role
├── createdAt
└── updatedAt

Project
├── id
├── name
├── description
├── ownerId -> User.id
├── createdAt
└── updatedAt

Conversation
├── id
├── projectId -> Project.id
├── title
├── context
├── createdAt
└── updatedAt

Message
├── id
├── conversationId -> Conversation.id
├── sender
├── text
├── libraryItem -> LibraryItem (opcional)
└── createdAt

Operator
├── id
├── name
├── description
├── status
├── createdAt
└── updatedAt

LibraryItem
├── id
├── projectId -> Project.id
├── sourceMessageId -> Message.id (opcional, único, ON DELETE SET NULL)
├── title
├── type
├── content
├── createdAt
└── updatedAt

ConversationLibraryItem
├── conversationId -> Conversation.id (ON DELETE CASCADE)
├── libraryItemId -> LibraryItem.id (ON DELETE CASCADE)
└── createdAt

Automation
├── id
├── projectId -> Project.id
├── name
├── description
├── trigger
├── action
├── enabled
├── createdAt
└── updatedAt

Setting
├── id
├── key
├── value
├── description
├── createdAt
└── updatedAt

AnalyticsSnapshot
├── id
├── projectId -> Project.id
├── metrics
├── summary
└── createdAt

## Relacionamentos

- User 1:N Project
- Project 1:N Conversation
- Conversation 1:N Message
- Project 1:N LibraryItem
- Message 1:0..1 LibraryItem
- Conversation N:N LibraryItem, via ConversationLibraryItem
- Project 1:N Automation
- Project 1:N AnalyticsSnapshot

## Observações

- As entidades suportam projetos de conteúdo, conversas, mensagens, artefatos persistidos e dados de análise.
- `LibraryItem.sourceMessageId` garante no máximo um artefato por mensagem de origem; itens legados sem origem permanecem válidos.
- `ConversationLibraryItem` usa chave composta entre conversa e item, não copia conteúdo e é removido em cascata com qualquer lado da associação.
- A modelagem preserva a arquitetura de futuro com PostgreSQL sem alterar o frontend ou as APIs.
