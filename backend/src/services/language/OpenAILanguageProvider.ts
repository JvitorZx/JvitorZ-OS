import type OpenAI from 'openai';
import type {
  LanguageGenerationInput,
  LanguageMessageRole,
  LanguageProvider,
} from './LanguageProvider';
import { LanguageProviderUnavailableError } from './LanguageProvider';

export const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
export const OPENAI_CHARACTERS_PER_TOKEN_ESTIMATE = 4;

type OpenAIResponsesClient = Pick<OpenAI, 'responses'>;

export type OpenAIClientFactory = (apiKey: string) => Promise<OpenAIResponsesClient>;
export type OpenAIEnvironmentReader = (name: string) => string | undefined;

export interface OpenAILanguageProviderOptions {
  clientFactory?: OpenAIClientFactory;
  environmentReader?: OpenAIEnvironmentReader;
}

export class OpenAILanguageProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAILanguageProviderError';
  }
}

export class OpenAIConfigurationError extends LanguageProviderUnavailableError {
  constructor() {
    super('OpenAI language provider is not configured');
    this.name = 'OpenAIConfigurationError';
  }
}

export class OpenAIRequestError extends OpenAILanguageProviderError {
  constructor() {
    super('OpenAI language generation request failed');
    this.name = 'OpenAIRequestError';
  }
}

export class OpenAIInvalidResponseError extends OpenAILanguageProviderError {
  constructor() {
    super('OpenAI language provider returned no usable text');
    this.name = 'OpenAIInvalidResponseError';
  }
}

const defaultEnvironmentReader: OpenAIEnvironmentReader = (name) => process.env[name];

const defaultClientFactory: OpenAIClientFactory = async (apiKey) => {
  const { default: OpenAIClient } = await import('openai');
  return new OpenAIClient({ apiKey });
};

const toOpenAIRole = (
  role: LanguageMessageRole,
): 'user' | 'assistant' | 'system' => {
  switch (role) {
    case 'user':
      return 'user';
    case 'operator':
      return 'assistant';
    case 'system':
      return 'system';
  }
};

const toMaxOutputTokens = (maxOutputCharacters: number): number =>
  Math.max(1, Math.ceil(maxOutputCharacters / OPENAI_CHARACTERS_PER_TOKEN_ESTIMATE));

export class OpenAILanguageProvider implements LanguageProvider {
  private readonly clientFactory: OpenAIClientFactory;
  private readonly environmentReader: OpenAIEnvironmentReader;

  constructor(options: OpenAILanguageProviderOptions = {}) {
    this.clientFactory = options.clientFactory ?? defaultClientFactory;
    this.environmentReader = options.environmentReader ?? defaultEnvironmentReader;
  }

  async generate(input: LanguageGenerationInput): Promise<string> {
    const apiKey = this.environmentReader('OPENAI_API_KEY')?.trim();

    if (!apiKey) {
      throw new OpenAIConfigurationError();
    }

    const model = this.environmentReader('OPENAI_MODEL')?.trim() || DEFAULT_OPENAI_MODEL;
    const maxOutputTokens = toMaxOutputTokens(input.limits.maxOutputCharacters);

    let outputText: unknown;

    try {
      const client = await this.clientFactory(apiKey);
      const response = await client.responses.create({
        model,
        instructions: input.context ?? undefined,
        input: input.messages.map(({ role, content }) => ({
          role: toOpenAIRole(role),
          content,
        })),
        max_output_tokens: maxOutputTokens,
        store: false,
      });
      outputText = response.output_text;
    } catch {
      throw new OpenAIRequestError();
    }

    if (typeof outputText !== 'string') {
      throw new OpenAIInvalidResponseError();
    }

    const normalizedText = outputText.trim().slice(0, input.limits.maxOutputCharacters).trim();

    if (!normalizedText) {
      throw new OpenAIInvalidResponseError();
    }

    return normalizedText;
  }
}
