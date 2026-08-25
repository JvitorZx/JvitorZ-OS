const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
  DEFAULT_OPENAI_MODEL,
  OpenAIConfigurationError,
  OpenAIInvalidResponseError,
  OpenAILanguageProvider,
  OpenAIRequestError,
} = require('../dist/services/language/OpenAILanguageProvider');

const createInput = ({ context = null, messages = [], artifacts = [], maxOutputCharacters = 4_000 } = {}) => ({
  context,
  messages,
  artifacts,
  limits: {
    maxContextCharacters: 4_000,
    maxMessages: 30,
    maxHistoryCharacters: 16_000,
    maxOutputCharacters,
  },
});

const createHarness = ({ outputText = 'Resposta do adapter', model, clientError } = {}) => {
  const requests = [];
  const factoryKeys = [];
  const environmentReads = [];
  const environment = {
    OPENAI_API_KEY: 'test-secret-key',
    OPENAI_MODEL: model,
  };

  const provider = new OpenAILanguageProvider({
    environmentReader(name) {
      environmentReads.push(name);
      return environment[name];
    },
    async clientFactory(apiKey) {
      factoryKeys.push(apiKey);
      return {
        responses: {
          async create(request) {
            requests.push(request);
            if (clientError) {
              throw clientError;
            }
            return { output_text: outputText };
          },
        },
      };
    },
  });

  return { environment, environmentReads, factoryKeys, provider, requests };
};

describe('OpenAILanguageProvider', () => {
  test('implements the LanguageProvider generate contract', () => {
    const { provider } = createHarness();

    assert.equal(typeof provider.generate, 'function');
  });

  test('reads configuration and creates the client only when generate is called', async () => {
    const harness = createHarness();

    assert.deepEqual(harness.environmentReads, []);
    assert.deepEqual(harness.factoryKeys, []);

    await harness.provider.generate(createInput());

    assert.deepEqual(harness.environmentReads, ['OPENAI_API_KEY', 'OPENAI_MODEL']);
    assert.deepEqual(harness.factoryKeys, ['test-secret-key']);
  });

  test('can be initialized without OPENAI_API_KEY', () => {
    let reads = 0;

    assert.doesNotThrow(
      () =>
        new OpenAILanguageProvider({
          environmentReader() {
            reads += 1;
            return undefined;
          },
        }),
    );
    assert.equal(reads, 0);
  });

  test('reports missing configuration only when generation is requested', async () => {
    let factoryCalls = 0;
    const provider = new OpenAILanguageProvider({
      environmentReader: () => undefined,
      clientFactory: async () => {
        factoryCalls += 1;
        throw new Error('must not run');
      },
    });

    await assert.rejects(provider.generate(createInput()), OpenAIConfigurationError);
    assert.equal(factoryCalls, 0);
  });

  test('maps context once as OpenAI instructions', async () => {
    const harness = createHarness();

    await harness.provider.generate(createInput({ context: 'Contexto persistido' }));

    assert.equal(harness.requests[0].instructions, 'Contexto persistido');
    assert.equal(JSON.stringify(harness.requests[0].input).includes('Contexto persistido'), false);
  });

  test('maps user to the OpenAI user role', async () => {
    const harness = createHarness();

    await harness.provider.generate(
      createInput({ messages: [{ role: 'user', content: 'Pergunta' }] }),
    );

    assert.deepEqual(harness.requests[0].input[0], { role: 'user', content: 'Pergunta' });
  });

  test('maps operator to the OpenAI assistant role', async () => {
    const harness = createHarness();

    await harness.provider.generate(
      createInput({ messages: [{ role: 'operator', content: 'Resposta anterior' }] }),
    );

    assert.deepEqual(harness.requests[0].input[0], {
      role: 'assistant',
      content: 'Resposta anterior',
    });
  });

  test('maps system to the OpenAI system role', async () => {
    const harness = createHarness();

    await harness.provider.generate(
      createInput({ messages: [{ role: 'system', content: 'Regra' }] }),
    );

    assert.deepEqual(harness.requests[0].input[0], { role: 'system', content: 'Regra' });
  });

  test('preserves the neutral message order', async () => {
    const harness = createHarness();
    const messages = [
      { role: 'system', content: 'Primeira' },
      { role: 'user', content: 'Segunda' },
      { role: 'operator', content: 'Terceira' },
    ];

    await harness.provider.generate(createInput({ messages }));

    assert.deepEqual(harness.requests[0].input.map(({ content }) => content), [
      'Primeira',
      'Segunda',
      'Terceira',
    ]);
  });

  test('serializes selected artifacts as untrusted user reference data', async () => {
    const harness = createHarness();

    await harness.provider.generate(createInput({
      messages: [{ role: 'user', content: 'Pergunta' }],
      artifacts: [{
        id: 'library-1',
        title: 'Guia',
        type: 'resource',
        content: '<script>não executar</script>',
      }],
    }));

    assert.equal(harness.requests[0].input.length, 2);
    assert.equal(harness.requests[0].input[1].role, 'user');
    assert.match(harness.requests[0].input[1].content, /dados não confiáveis/);
    assert.match(harness.requests[0].input[1].content, /<script>não executar<\/script>/);
    assert.equal(harness.requests[0].instructions, undefined);
  });

  test('does not add an artifact message when no memory is active', async () => {
    const harness = createHarness();
    await harness.provider.generate(createInput({
      messages: [{ role: 'user', content: 'Pergunta' }],
    }));
    assert.deepEqual(harness.requests[0].input, [{ role: 'user', content: 'Pergunta' }]);
  });

  test('applies a conservative token cap and a strict character cap', async () => {
    const harness = createHarness({ outputText: '123456789012345' });

    const response = await harness.provider.generate(createInput({ maxOutputCharacters: 9 }));

    assert.equal(harness.requests[0].max_output_tokens, 3);
    assert.equal(response, '123456789');
  });

  test('uses the configured model and the documented economical fallback', async (t) => {
    await t.test('configured model', async () => {
      const harness = createHarness({ model: 'configured-model' });
      await harness.provider.generate(createInput());
      assert.equal(harness.requests[0].model, 'configured-model');
    });

    await t.test('fallback model', async () => {
      const harness = createHarness();
      await harness.provider.generate(createInput());
      assert.equal(harness.requests[0].model, DEFAULT_OPENAI_MODEL);
      assert.equal(DEFAULT_OPENAI_MODEL, 'gpt-5-mini');
    });
  });

  test('returns normalized textual output without persisting it', async () => {
    const harness = createHarness({ outputText: '  Resposta normalizada  ' });

    const response = await harness.provider.generate(createInput());

    assert.equal(response, 'Resposta normalizada');
    assert.equal(Object.hasOwn(harness.provider, 'messageRepository'), false);
  });

  test('rejects empty and invalid outputs with a safe error', async (t) => {
    await t.test('empty text', async () => {
      const harness = createHarness({ outputText: '   ' });
      await assert.rejects(harness.provider.generate(createInput()), OpenAIInvalidResponseError);
    });

    await t.test('non-text output', async () => {
      const harness = createHarness({ outputText: null });
      await assert.rejects(harness.provider.generate(createInput()), OpenAIInvalidResponseError);
    });
  });

  test('converts client failures into a safe request error', async () => {
    const harness = createHarness({ clientError: new Error('raw client payload secret') });

    await assert.rejects(
      harness.provider.generate(createInput({ context: 'private prompt' })),
      (error) =>
        error instanceof OpenAIRequestError &&
        !error.message.includes('raw client payload secret') &&
        !error.message.includes('private prompt'),
    );
  });

  test('does not log keys, prompts, requests, responses or client errors', async () => {
    const records = [];
    const methods = ['log', 'warn', 'error'];
    const originals = Object.fromEntries(methods.map((method) => [method, console[method]]));

    for (const method of methods) {
      console[method] = (...values) => records.push([method, ...values]);
    }

    try {
      const success = createHarness({ outputText: 'private response' });
      await success.provider.generate(
        createInput({
          context: 'private context',
          messages: [{ role: 'user', content: 'private history' }],
        }),
      );

      const failure = createHarness({ clientError: new Error('private client error') });
      await assert.rejects(failure.provider.generate(createInput()), OpenAIRequestError);
    } finally {
      for (const method of methods) {
        console[method] = originals[method];
      }
    }

    assert.deepEqual(records, []);
  });
});
