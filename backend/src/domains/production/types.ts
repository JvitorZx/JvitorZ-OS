export const PRODUCTION_FORMATS = ['LONG_FORM', 'SHORT'] as const;
export const PRODUCTION_STATUSES = ['PLANNED', 'IN_PRODUCTION', 'IN_REVIEW', 'READY_TO_PUBLISH', 'PUBLISHED', 'ANALYZED', 'COMPLETED', 'CANCELLED'] as const;
export const PRODUCTION_STEP_STATES = ['NOT_STARTED', 'AVAILABLE', 'IN_PROGRESS', 'WAITING_USER', 'BLOCKED', 'COMPLETED', 'SKIPPED', 'FAILED', 'CANCELLED', 'OUTDATED'] as const;
export const PRODUCTION_MODES = ['MANUAL', 'ASSISTED', 'AUTOMATED'] as const;
export const PRODUCTION_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export const PRODUCTION_ASSET_ROLES = ['RAW_VIDEO', 'EDITED_VIDEO', 'TRANSCRIPT', 'THUMBNAIL_SOURCE', 'AUDIO', 'OTHER'] as const;

export type ProductionFormat = typeof PRODUCTION_FORMATS[number];
export type ProductionStatus = typeof PRODUCTION_STATUSES[number];
export type ProductionStepState = typeof PRODUCTION_STEP_STATES[number];
export type ProductionMode = typeof PRODUCTION_MODES[number];
export type ProductionPriority = typeof PRODUCTION_PRIORITIES[number];
export type ProductionAssetRole = typeof PRODUCTION_ASSET_ROLES[number];

export interface ProductionStepTemplate {
  key: string;
  label: string;
  mode: ProductionMode;
  capability?: string;
  required: boolean;
  skippable: boolean;
  dependencies: string[];
  availability?: 'AVAILABLE' | 'MANUAL_ONLY';
}

export interface ResolvableProductionStep {
  key: string;
  label: string;
  position: number;
  state: string;
  mode: string;
  required: boolean;
  skippable: boolean;
  dependencies: unknown;
}

export interface ProductionNextAction {
  type: 'START' | 'CONTINUE' | 'RETRY' | 'WAIT_USER' | 'UNBLOCK' | 'REVIEW_STALE' | 'PUBLISH_EXTERNALLY' | 'NONE';
  stepKey: string | null;
  label: string;
  reason: string;
  ready: boolean;
}
