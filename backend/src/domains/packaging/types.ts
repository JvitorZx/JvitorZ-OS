export const PACKAGING_VARIANT_STATUSES = ['DRAFT', 'SELECTED', 'REJECTED', 'PUBLISHED', 'ARCHIVED'] as const;
export type PackagingVariantStatus = typeof PACKAGING_VARIANT_STATUSES[number];

export interface PackagingGenerationInput {
  projectId?: string | null;
  contentKey?: string;
  videoId?: string | null;
  game?: string | null;
  series?: string | null;
  episode?: number | null;
  format?: string | null;
  summary: string;
  keyEvents: string[];
  editorialObjective?: string | null;
  constraints?: string[];
  variationCount?: number;
}

export interface PackagingContextItem {
  id: string;
  type: string;
  subject: string;
  statement: string;
  confidence: number;
}

export interface ThumbnailBrief {
  concept: string;
  focus: string;
  composition: string;
  text: string;
  requiredElements: string[];
  optionalElements: string[];
  avoidElements: string[];
  complementsTitle: string;
}

export interface GeneratedPackagingVariant {
  key: string;
  title: string;
  angle: string;
  sourceEvent: string;
  thumbnailBrief: ThumbnailBrief;
  description: string;
  tags: string[];
  rationale: string;
  seriesFit: number;
  clickbaitRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  internalScore: number;
  contextUsed: string[];
}

export interface PackagingReview {
  valid: boolean;
  findings: Array<{ severity: 'INFO' | 'WARNING' | 'ERROR'; code: string; message: string }>;
}
