import type { ResearchIntent, ResearchProviderResult, ResearchQuery, ResearchSourceKind } from './types';

export interface ResearchProvider {
  readonly id: string;
  readonly sourceKind: ResearchSourceKind;
  supports(intent: ResearchIntent): boolean;
  search(query: ResearchQuery): Promise<ResearchProviderResult>;
}
