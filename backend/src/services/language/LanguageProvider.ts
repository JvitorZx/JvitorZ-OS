export const LANGUAGE_MESSAGE_ROLES = ['user', 'operator', 'system'] as const;

export type LanguageMessageRole = (typeof LANGUAGE_MESSAGE_ROLES)[number];

export interface LanguageMessage {
  role: LanguageMessageRole;
  content: string;
}

export interface LanguageGenerationLimits {
  maxContextCharacters: number;
  maxMessages: number;
  maxHistoryCharacters: number;
  maxOutputCharacters: number;
}

export interface LanguageGenerationInput {
  context: string | null;
  messages: readonly LanguageMessage[];
  limits: Readonly<LanguageGenerationLimits>;
}

export interface LanguageProvider {
  generate(input: LanguageGenerationInput): Promise<string>;
}

export class LanguageProviderUnavailableError extends Error {
  constructor(message = 'Language provider is unavailable') {
    super(message);
    this.name = 'LanguageProviderUnavailableError';
  }
}
