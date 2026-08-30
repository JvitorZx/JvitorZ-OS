import { DatabaseService } from '../../database/DatabaseService';
import { MonitoringSnapshotRepository } from '../../database/repositories/MonitoringSnapshotRepository';
import { StrategicSignalRepository } from '../../database/repositories/StrategicSignalRepository';
import {
  SIGNAL_SEVERITIES,
  SIGNAL_STATES,
  STRATEGIC_MONITORING_POLICY,
  STRATEGIC_MONITORING_RULES,
  STRATEGIC_SIGNAL_TYPES,
  buildStrategicSignalCandidates,
  monitoringEvaluationFingerprint,
  type SignalState,
  type StrategicMonitoringSource,
} from '../../domains/strategic-monitoring';
import { PersistedStrategicMonitoringSource } from './PersistedStrategicMonitoringSource';

export class StrategicMonitoringError extends Error { constructor(message: string) { super(message); this.name = 'StrategicMonitoringError'; } }
export class StrategicMonitoringValidationError extends StrategicMonitoringError { constructor(message: string) { super(message); this.name = 'StrategicMonitoringValidationError'; } }
export class StrategicSignalNotFoundError extends StrategicMonitoringError { constructor() { super('Strategic signal not found'); this.name = 'StrategicSignalNotFoundError'; } }
export class StrategicSignalConflictError extends StrategicMonitoringError { constructor(message: string) { super(message); this.name = 'StrategicSignalConflictError'; } }

const normalizedId = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) throw new StrategicMonitoringValidationError(`${field} is invalid`);
  return value.trim();
};
const reason = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) throw new StrategicMonitoringValidationError('reason is invalid');
  return value.trim();
};
const isUnique = (error: unknown): boolean => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');

export interface StrategicSignalListInput {
  projectId?: string | null;
  state?: string;
  severity?: string;
  type?: string;
  limit?: number;
}

export class StrategicMonitoringService {
  private readonly evaluationLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly signals = new StrategicSignalRepository(DatabaseService.client),
    private readonly snapshots = new MonitoringSnapshotRepository(DatabaseService.client),
    private readonly source: StrategicMonitoringSource = new PersistedStrategicMonitoringSource(),
    private readonly clock = () => new Date(),
  ) {}

  async evaluate(projectId?: string | null) {
    const normalizedProjectId = projectId == null || projectId === '' ? null : normalizedId(projectId, 'projectId');
    const lockKey = normalizedProjectId ?? 'global';
    const previous = this.evaluationLocks.get(lockKey) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const evaluatedAt = this.clock();
      await this.snapshots.ensureRules(STRATEGIC_MONITORING_RULES);
      const collected = await this.source.collect(normalizedProjectId, evaluatedAt);
      const candidates = buildStrategicSignalCandidates(collected.facts);
      const existingSignals = await this.signals.findAll({ projectId: normalizedProjectId, limit: 200 });
      const candidatesByKey = new Map(candidates.map((candidate) => [candidate.logicalKey, candidate]));
      const existingByKey = new Map(existingSignals.map((signal) => [signal.logicalKey, signal]));
      const projectedSignals = candidates.map((candidate) => {
        const existing = existingByKey.get(candidate.logicalKey);
        const remainsClosed = existing && ['RESOLVED', 'DISMISSED'].includes(existing.state)
          && existing.fingerprint === candidate.fingerprint && evaluatedAt < existing.cooldownUntil;
        return { logicalKey: candidate.logicalKey, fingerprint: remainsClosed ? existing.fingerprint : candidate.fingerprint,
          state: remainsClosed ? existing.state : existing?.fingerprint === candidate.fingerprint && !['RESOLVED', 'DISMISSED', 'STALE'].includes(existing.state)
            ? existing.state : 'NEW',
          ...((existing?.resolvedAt || existing?.dismissedAt)
            ? { lifecycleMarker: (existing.resolvedAt ?? existing.dismissedAt)?.toISOString() ?? null } : {}) };
      });
      for (const existing of existingSignals) {
        if (candidatesByKey.has(existing.logicalKey)) continue;
        const sourceDegraded = collected.sourceState[existing.source] === 'DEGRADED'
          && ['NEW', 'ACKNOWLEDGED'].includes(existing.state);
        const autoResolved = !sourceDegraded && collected.evaluatedSources.includes(existing.source)
          && ['NEW', 'ACKNOWLEDGED', 'STALE'].includes(existing.state);
        projectedSignals.push({ logicalKey: existing.logicalKey, fingerprint: existing.fingerprint,
          state: sourceDegraded ? 'STALE' : autoResolved ? 'RESOLVED' : existing.state,
          ...((existing.resolvedAt || existing.dismissedAt)
            ? { lifecycleMarker: (existing.resolvedAt ?? existing.dismissedAt)?.toISOString() ?? null } : {}) });
      }
      const evaluationFingerprint = monitoringEvaluationFingerprint(
        normalizedProjectId, candidates, collected.evaluatedSources, collected.sourceState, projectedSignals,
      );
      const evaluation = await this.snapshots.createEvaluation({
        projectId: normalizedProjectId,
        evaluationFingerprint,
        evaluatedSources: collected.evaluatedSources,
        sourceState: collected.sourceState,
        candidateCount: candidates.length,
        evaluatedAt,
      });
      if (!evaluation.created) {
        return { snapshot: evaluation.snapshot, created: 0, updated: 0, resolved: 0, unchanged: true,
          signals: await this.list({ projectId: normalizedProjectId, limit: 200 }) };
      }

      const degradedSources = Object.entries(collected.sourceState).flatMap(([source, state]) => state === 'DEGRADED' ? [source] : []);
      let created = 0;
      let updated = await this.signals.markSourcesStale({ projectId: normalizedProjectId, sources: degradedSources,
        snapshotId: evaluation.snapshot.id, evaluatedAt });
      for (const candidate of candidates) {
        const rule = STRATEGIC_MONITORING_RULES.find(({ code }) => code === candidate.ruleCode)!;
        const input = { projectId: normalizedProjectId, candidate, snapshotId: evaluation.snapshot.id,
          cooldownUntil: new Date(evaluatedAt.getTime() + rule.cooldownHours * 3_600_000), evaluatedAt };
        let result;
        try { result = await this.signals.applyCandidate(input); }
        catch (error) {
          if (!isUnique(error) || !await this.signals.findByLogicalKey(candidate.logicalKey)) throw error;
          result = await this.signals.applyCandidate(input);
        }
        if (result.created) created += 1;
        else if (result.changed) updated += 1;
      }
      const resolved = await this.signals.resolveMissing({
        projectId: normalizedProjectId,
        activeLogicalKeys: candidates.map(({ logicalKey }) => logicalKey),
        evaluatedSources: collected.evaluatedSources,
        snapshotId: evaluation.snapshot.id,
        evaluatedAt,
        cooldownHours: STRATEGIC_MONITORING_POLICY.defaultCooldownHours,
      });
      const snapshot = await this.snapshots.complete(evaluation.snapshot.id, {
        createdCount: created, updatedCount: updated, resolvedCount: resolved,
      });
      return { snapshot, created, updated, resolved, unchanged: false,
        signals: await this.list({ projectId: normalizedProjectId, limit: 200 }) };
    });
    this.evaluationLocks.set(lockKey, operation);
    try { return await operation; }
    finally { if (this.evaluationLocks.get(lockKey) === operation) this.evaluationLocks.delete(lockKey); }
  }

  async list(input: StrategicSignalListInput = {}) {
    if (input.projectId != null) input.projectId = normalizedId(input.projectId, 'projectId');
    if (input.state && !SIGNAL_STATES.includes(input.state as never)) throw new StrategicMonitoringValidationError('state is invalid');
    if (input.severity && !SIGNAL_SEVERITIES.includes(input.severity as never)) throw new StrategicMonitoringValidationError('severity is invalid');
    if (input.type && !STRATEGIC_SIGNAL_TYPES.includes(input.type as never)) throw new StrategicMonitoringValidationError('type is invalid');
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200)) throw new StrategicMonitoringValidationError('limit is invalid');
    return this.signals.findAll(input);
  }

  async get(signalId: string) {
    const signal = await this.signals.findById(normalizedId(signalId, 'signalId'));
    if (!signal) throw new StrategicSignalNotFoundError();
    return signal;
  }

  private async transition(signalId: string, state: SignalState, inputReason?: string | null) {
    const existing = await this.get(signalId);
    if (['RESOLVED', 'DISMISSED'].includes(existing.state) && existing.state !== state) {
      throw new StrategicSignalConflictError('closed signal cannot change state manually');
    }
    const signal = await this.signals.transition(existing.id, state, reason(inputReason), this.clock());
    if (!signal) throw new StrategicSignalNotFoundError();
    return signal;
  }

  acknowledge(signalId: string, inputReason?: string | null) { return this.transition(signalId, 'ACKNOWLEDGED', inputReason); }
  dismiss(signalId: string, inputReason?: string | null) { return this.transition(signalId, 'DISMISSED', inputReason); }
  resolve(signalId: string, inputReason?: string | null) { return this.transition(signalId, 'RESOLVED', inputReason); }

  async listForPlanner(projectId: string | null, limit = 5) {
    const rows = await this.list({ projectId, limit: Math.min(10, limit) });
    return rows.filter(({ state }) => ['NEW', 'ACKNOWLEDGED'].includes(state)).slice(0, limit)
      .map(({ id, type, severity, subject, summary, confidence, limitations, detectedAt }) => ({
        id, type, severity, subject, summary, confidence, limitations, detectedAt,
      }));
  }

  async getOperationalSummary(projectId?: string | null) {
    const rows = await this.list({ ...(projectId !== undefined ? { projectId } : {}), limit: 200 });
    const active = rows.filter(({ state }) => ['NEW', 'ACKNOWLEDGED'].includes(state));
    return {
      total: rows.length,
      active: active.length,
      high: active.filter(({ severity }) => severity === 'HIGH').length,
      critical: active.filter(({ severity }) => severity === 'CRITICAL').length,
      stale: rows.filter(({ state, type }) => state === 'STALE' || type === 'DATA_STALE').length,
      signals: active.filter(({ severity }) => ['HIGH', 'CRITICAL'].includes(severity)).slice(0, 10)
        .map(({ id, type, severity, subject, summary, confidence, detectedAt }) => ({ id, type, severity, subject, summary, confidence, detectedAt })),
    };
  }
}
