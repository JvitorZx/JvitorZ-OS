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
├── title
├── type
├── content
├── createdAt
└── updatedAt

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
- Project 1:N Automation
- Project 1:N AnalyticsSnapshot

## Observações

- As entidades são projetadas para suportar projetos de conteúdo, conversas, mensagens e dados de análise.
- A modelagem preserva a arquitetura de futuro com PostgreSQL sem alterar o frontend ou as APIs.
