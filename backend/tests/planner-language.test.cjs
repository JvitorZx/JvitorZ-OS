const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
  DEFAULT_LANGUAGE_GENERATION_LIMITS,
  mapConversationToLanguageInput,
} = require('../dist/services/language/PlannerLanguageInput');

const createMessage = (sender, text, second) => ({
  sender,
  text,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)),
});

const createConversation = ({ context = null, messages = [] } = {}) => ({
  context,
  messages,
});

class FakeLanguageProvider {
  constructor(response = 'Resposta deterministica') {
    this.response = response;
    this.inputs = [];
  }

  async generate(input) {
    this.inputs.push(input);
    return this.response;
  }
}

describe('Planner language input', () => {
  test('maps a populated conversation context', () => {
    const input = mapConversationToLanguageInput(createConversation({ context: 'Planeje um video curto.' }));

    assert.equal(input.context, 'Planeje um video curto.');
  });

  test('maps a null context deterministically', () => {
    const input = mapConversationToLanguageInput(createConversation({ context: null }));

    assert.equal(input.context, null);
  });

  test('orders messages chronologically without relying on source order', () => {
    const conversation = createConversation({
      messages: [
        createMessage('operator', 'Terceira', 3),
        createMessage('user', 'Primeira', 1),
        createMessage('system', 'Segunda', 2),
      ],
    });

    const input = mapConversationToLanguageInput(conversation);

    assert.deepEqual(input.messages.map(({ content }) => content), ['Primeira', 'Segunda', 'Terceira']);
  });

  test('maps user sender explicitly', () => {
    const input = mapConversationToLanguageInput(
      createConversation({ messages: [createMessage('user', 'Pergunta', 1)] }),
    );

    assert.deepEqual(input.messages[0], { role: 'user', content: 'Pergunta' });
  });

  test('maps operator sender explicitly', () => {
    const input = mapConversationToLanguageInput(
      createConversation({ messages: [createMessage('operator', 'Resposta', 1)] }),
    );

    assert.deepEqual(input.messages[0], { role: 'operator', content: 'Resposta' });
  });

  test('maps system sender explicitly', () => {
    const input = mapConversationToLanguageInput(
      createConversation({ messages: [createMessage('system', 'Instrucao', 1)] }),
    );

    assert.deepEqual(input.messages[0], { role: 'system', content: 'Instrucao' });
  });

  test('keeps histories from different conversations isolated', () => {
    const first = mapConversationToLanguageInput(
      createConversation({ messages: [createMessage('user', 'Somente A', 1)] }),
    );
    const second = mapConversationToLanguageInput(
      createConversation({ messages: [createMessage('user', 'Somente B', 1)] }),
    );

    assert.deepEqual(first.messages.map(({ content }) => content), ['Somente A']);
    assert.deepEqual(second.messages.map(({ content }) => content), ['Somente B']);
  });

  test('history limits preserve the most recent messages and characters', () => {
    const limits = {
      maxContextCharacters: 10,
      maxMessages: 3,
      maxHistoryCharacters: 8,
      maxOutputCharacters: 20,
    };
    const conversation = createConversation({
      context: '1234567890extra',
      messages: [
        createMessage('user', 'old', 1),
        createMessage('system', 'middle', 2),
        createMessage('operator', 'new', 3),
        createMessage('user', 'latest', 4),
      ],
    });

    const input = mapConversationToLanguageInput(conversation, limits);

    assert.equal(input.context, '1234567890');
    assert.deepEqual(input.messages, [
      { role: 'operator', content: 'ne' },
      { role: 'user', content: 'latest' },
    ]);
    assert.deepEqual(input.limits, limits);
  });

  test('does not mutate the original input', () => {
    const conversation = createConversation({
      context: 'Contexto original',
      messages: [
        createMessage('operator', 'Depois', 2),
        createMessage('user', 'Antes', 1),
      ],
    });
    const originalMessageOrder = [...conversation.messages];

    const input = mapConversationToLanguageInput(conversation);
    input.messages[0].content = 'Alterado';
    input.limits.maxMessages = 1;

    assert.deepEqual(conversation.messages, originalMessageOrder);
    assert.equal(conversation.messages[1].text, 'Antes');
    assert.deepEqual(DEFAULT_LANGUAGE_GENERATION_LIMITS, {
      maxContextCharacters: 4_000,
      maxMessages: 30,
      maxHistoryCharacters: 16_000,
      maxOutputCharacters: 4_000,
    });
  });

  test('fake provider receives the exact neutral input and returns a deterministic response', async () => {
    const provider = new FakeLanguageProvider('Resposta fixa');
    const input = mapConversationToLanguageInput(
      createConversation({
        context: 'Contexto',
        messages: [createMessage('user', 'Mensagem atual', 1)],
      }),
    );

    const response = await provider.generate(input);

    assert.equal(response, 'Resposta fixa');
    assert.equal(provider.inputs.length, 1);
    assert.deepEqual(provider.inputs[0], input);
  });
});
