import {
  LanguageGenerationInput,
  LanguageGenerationLimits,
  LanguageMessage,
  LanguageMessageRole,
} from './LanguageProvider';

export interface PlannerLanguageMessageSource {
  sender: string;
  text: string;
  createdAt: Date | string;
}

export interface PlannerConversationLanguageSource {
  context: string | null;
  messages: readonly PlannerLanguageMessageSource[];
}

export const DEFAULT_LANGUAGE_GENERATION_LIMITS: Readonly<LanguageGenerationLimits> = Object.freeze({
  maxContextCharacters: 4_000,
  maxMessages: 30,
  maxHistoryCharacters: 16_000,
  maxOutputCharacters: 4_000,
});

const mapSenderToRole = (sender: string): LanguageMessageRole => {
  switch (sender) {
    case 'user':
      return 'user';
    case 'operator':
      return 'operator';
    case 'system':
      return 'system';
    default:
      throw new Error(`Unsupported planner message sender: ${sender}`);
  }
};

const toTimestamp = (value: Date | string): number => {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const validateLimits = (limits: LanguageGenerationLimits): void => {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
};

const selectRecentMessages = (
  messages: readonly PlannerLanguageMessageSource[],
  limits: LanguageGenerationLimits,
): LanguageMessage[] => {
  const chronologicalMessages = messages
    .map((message, index) => ({ message, index }))
    .sort(
      (left, right) =>
        toTimestamp(left.message.createdAt) - toTimestamp(right.message.createdAt) ||
        left.index - right.index,
    )
    .slice(-limits.maxMessages);

  const selected: LanguageMessage[] = [];
  let remainingCharacters = limits.maxHistoryCharacters;

  // Walk backwards so the character budget always favors the newest history.
  for (let index = chronologicalMessages.length - 1; index >= 0 && remainingCharacters > 0; index -= 1) {
    const source = chronologicalMessages[index].message;
    const content = source.text.slice(0, remainingCharacters);

    selected.unshift({
      role: mapSenderToRole(source.sender),
      content,
    });
    remainingCharacters -= content.length;
  }

  return selected;
};

export const mapConversationToLanguageInput = (
  conversation: PlannerConversationLanguageSource,
  configuredLimits: Readonly<LanguageGenerationLimits> = DEFAULT_LANGUAGE_GENERATION_LIMITS,
): LanguageGenerationInput => {
  const limits: LanguageGenerationLimits = { ...configuredLimits };
  validateLimits(limits);

  return {
    context: conversation.context?.slice(0, limits.maxContextCharacters) ?? null,
    messages: selectRecentMessages(conversation.messages, limits),
    limits,
  };
};
