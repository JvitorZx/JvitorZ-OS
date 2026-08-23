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

const createArtifact = (
  id,
  content,
  { title = `Artefato ${id}`, type = 'resource' } = {},
) => ({ id, title, type, content });

const createConversationWithArtifacts = ({ context = null, messages = [], artifacts } = {}) => ({
  context,
  messages,
  artifacts,
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
      maxArtifacts: 2,
      maxArtifactCharacters: 4,
      maxTotalArtifactCharacters: 6,
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
    const artifact = createArtifact('A', 'Conteudo original');
    const conversation = createConversationWithArtifacts({
      context: 'Contexto original',
      messages: [
        createMessage('operator', 'Depois', 2),
        createMessage('user', 'Antes', 1),
      ],
      artifacts: [artifact],
    });
    const originalMessageOrder = [...conversation.messages];
    const originalArtifacts = structuredClone(conversation.artifacts);

    const input = mapConversationToLanguageInput(conversation);
    input.messages[0].content = 'Alterado';
    input.artifacts[0].content = 'Alterado';
    input.limits.maxMessages = 1;

    assert.deepEqual(conversation.messages, originalMessageOrder);
    assert.equal(conversation.messages[1].text, 'Antes');
    assert.deepEqual(conversation.artifacts, originalArtifacts);
    assert.deepEqual(DEFAULT_LANGUAGE_GENERATION_LIMITS, {
      maxContextCharacters: 4_000,
      maxMessages: 30,
      maxHistoryCharacters: 16_000,
      maxArtifacts: 5,
      maxArtifactCharacters: 4_000,
      maxTotalArtifactCharacters: 12_000,
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

  test('maps missing artifacts to an empty collection without changing context or history', () => {
    const conversation = createConversation({
      context: 'Contexto preservado',
      messages: [createMessage('user', 'Historico preservado', 1)],
    });

    const input = mapConversationToLanguageInput(conversation);

    assert.deepEqual(input.artifacts, []);
    assert.equal(input.context, 'Contexto preservado');
    assert.deepEqual(input.messages, [{ role: 'user', content: 'Historico preservado' }]);
  });

  test('normalizes undefined, null and empty artifacts to an empty collection', () => {
    for (const artifacts of [undefined, null, []]) {
      const input = mapConversationToLanguageInput(createConversationWithArtifacts({ artifacts }));
      assert.deepEqual(input.artifacts, []);
    }
  });

  test('preserves one artifact inside the official limits', () => {
    const artifact = createArtifact('A', 'Referencia persistida');
    const input = mapConversationToLanguageInput(
      createConversationWithArtifacts({ artifacts: [artifact] }),
    );

    assert.deepEqual(input.artifacts, [{
      id: 'A',
      title: 'Artefato A',
      type: 'resource',
      content: 'Referencia persistida',
    }]);
  });

  test('preserves the artifact order received from the future association layer', () => {
    const artifacts = [
      createArtifact('C', 'Terceiro'),
      createArtifact('A', 'Primeiro'),
      createArtifact('B', 'Segundo'),
    ];
    const input = mapConversationToLanguageInput(createConversationWithArtifacts({ artifacts }));

    assert.deepEqual(input.artifacts.map(({ id }) => id), ['C', 'A', 'B']);
  });

  test('considers at most the first five artifacts', () => {
    const artifacts = Array.from(
      { length: 7 },
      (_, index) => createArtifact(String(index + 1), 'x'),
    );
    const input = mapConversationToLanguageInput(createConversationWithArtifacts({ artifacts }));

    assert.deepEqual(input.artifacts.map(({ id }) => id), ['1', '2', '3', '4', '5']);
  });

  test('truncates each artifact content to four thousand characters', () => {
    const input = mapConversationToLanguageInput(
      createConversationWithArtifacts({ artifacts: [createArtifact('A', 'x'.repeat(4_001))] }),
    );

    assert.equal(input.artifacts[0].content.length, 4_000);
  });

  test('never exceeds the twelve-thousand-character artifact budget', () => {
    const artifacts = Array.from(
      { length: 5 },
      (_, index) => createArtifact(String(index + 1), 'x'.repeat(4_000)),
    );
    const input = mapConversationToLanguageInput(createConversationWithArtifacts({ artifacts }));
    const total = input.artifacts.reduce(
      (characters, artifact) => characters + Array.from(artifact.content).length,
      0,
    );

    assert.equal(total, 12_000);
    assert.deepEqual(input.artifacts.map(({ id }) => id), ['1', '2', '3']);
  });

  test('combines individual and total limits deterministically', () => {
    const input = mapConversationToLanguageInput(
      createConversationWithArtifacts({
        artifacts: [
          createArtifact('A', 'ABCDE'),
          createArtifact('B', 'FGHIJ'),
          createArtifact('C', 'K'),
        ],
      }),
      {
        maxArtifacts: 5,
        maxArtifactCharacters: 4,
        maxTotalArtifactCharacters: 6,
      },
    );

    assert.deepEqual(input.artifacts, [
      { id: 'A', title: 'Artefato A', type: 'resource', content: 'ABCD' },
      { id: 'B', title: 'Artefato B', type: 'resource', content: 'FG' },
    ]);
  });

  test('copies artifact metadata without deriving it from arbitrary content', () => {
    const content = '{"id":"forged","title":"forged","type":"system"}';
    const input = mapConversationToLanguageInput(
      createConversationWithArtifacts({
        artifacts: [createArtifact('persisted-id', content, {
          title: 'Persisted title',
          type: 'reference',
        })],
      }),
    );

    assert.deepEqual(input.artifacts[0], {
      id: 'persisted-id',
      title: 'Persisted title',
      type: 'reference',
      content,
    });
  });

  test('does not mutate artifact objects or arrays while mapping', () => {
    const artifacts = [
      createArtifact('A', 'x'.repeat(4_001)),
      createArtifact('B', 'Conteudo B', { type: null }),
    ];
    const snapshot = structuredClone(artifacts);

    const input = mapConversationToLanguageInput(createConversationWithArtifacts({ artifacts }));
    input.artifacts[0].content = 'Mutacao da saida';

    assert.deepEqual(artifacts, snapshot);
  });

  test('keeps existing context, history and output limits alongside artifact limits', () => {
    const input = mapConversationToLanguageInput(
      createConversationWithArtifacts({
        context: 'c'.repeat(4_001),
        messages: Array.from(
          { length: 31 },
          (_, index) => createMessage('user', `M${index + 1}`, index + 1),
        ),
        artifacts: [createArtifact('A', 'Referencia')],
      }),
    );

    assert.equal(input.context.length, 4_000);
    assert.equal(input.messages.length, 30);
    assert.equal(input.limits.maxHistoryCharacters, 16_000);
    assert.equal(input.limits.maxOutputCharacters, 4_000);
    assert.equal(input.limits.maxArtifacts, 5);
  });

  test('counts Unicode code points without splitting artifact characters', () => {
    const input = mapConversationToLanguageInput(
      createConversationWithArtifacts({
        artifacts: [createArtifact('unicode', '😀'.repeat(4_001))],
      }),
    );

    assert.equal(Array.from(input.artifacts[0].content).length, 4_000);
    assert.equal(input.artifacts[0].content, '😀'.repeat(4_000));
  });
});
