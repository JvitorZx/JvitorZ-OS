export const CHANNEL_CONTEXT_TYPES = [
  'FACT', 'HYPOTHESIS', 'DECISION', 'EXPERIMENT', 'LEARNING', 'PLATFORM_CHANGE',
] as const;
export type ChannelContextType = (typeof CHANNEL_CONTEXT_TYPES)[number];

export const CHANNEL_CONTEXT_STATUSES = ['ACTIVE', 'CONFIRMED', 'REJECTED', 'SUPERSEDED'] as const;
export type ChannelContextStatus = (typeof CHANNEL_CONTEXT_STATUSES)[number];

export interface ChannelContextFilters {
  projectId?: string | null;
  type?: ChannelContextType;
  status?: ChannelContextStatus;
  category?: string;
  entityType?: string;
  entityId?: string;
  periodFrom?: Date;
  periodTo?: Date;
  currentOnly?: boolean;
  limit?: number;
}

export interface ChannelContextResolutionQuery {
  projectId?: string | null;
  text?: string;
  types?: ChannelContextType[];
  entityType?: string;
  entityId?: string;
  game?: string;
  series?: string;
  format?: string;
  subject?: string;
  limit?: number;
  maxCharacters?: number;
}
