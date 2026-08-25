import type { VideoIdea } from '@prisma/client';
import type { ResearchEvidence } from './types';

export interface ResearchProvider {
  readonly name: string;
  research(idea: VideoIdea): Promise<ResearchEvidence[]>;
}
