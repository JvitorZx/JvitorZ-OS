const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { OPPORTUNITY_FACTOR_WEIGHTS, OpportunityScoringService } = require('../dist/domains/editorial-decision');

const scorer = new OpportunityScoringService();
const candidate = (overrides = {}) => ({ key: 'candidate-a', label: 'Candidate A', type: 'IDEA', ...overrides });
const factor = (id, value, overrides = {}) => ({
  id, value, confidence: 0.8, quality: 'GOOD', source: `test:${id}`,
  summary: `${id} observed`, classification: 'fact', ...overrides,
});

describe('OpportunityScoringService', () => {
  test('keeps a candidate with no evidence explicitly insufficient', () => {
    const result = scorer.score(candidate(), []);
    assert.equal(result.category, 'INSUFFICIENT_DATA');
    assert.equal(result.value, 0);
    assert.equal(result.confidence, 0);
    assert.equal(result.missingData.length, 10);
  });

  test('keeps one isolated strong metric insufficient', () => {
    const result = scorer.score(candidate(), [factor('CTR', 95)]);
    assert.equal(result.category, 'INSUFFICIENT_DATA');
    assert.ok(result.coverage < 0.2);
  });

  test('reduces confidence for stale, partial and inconsistent evidence', () => {
    const good = scorer.score(candidate(), [factor('HISTORICAL_PERFORMANCE', 70), factor('TREND', 70)]);
    const degraded = scorer.score(candidate(), [
      factor('HISTORICAL_PERFORMANCE', 70, { quality: 'STALE' }),
      factor('TREND', 70, { quality: 'INCONSISTENT' }),
    ]);
    assert.ok(degraded.confidence < good.confidence);
    assert.ok(degraded.risks.some(({ code }) => code.startsWith('QUALITY_')));
  });

  test('classifies conflicting strong signals for reevaluation', () => {
    const result = scorer.score(candidate(), [factor('HISTORICAL_PERFORMANCE', 85), factor('TREND', 20)]);
    assert.equal(result.category, 'REEVALUATE');
    assert.ok(result.risks.some(({ code }) => code === 'CONFLICTING_SIGNALS'));
    assert.equal(result.favorableEvidence.length, 1);
    assert.equal(result.contraryEvidence.length, 1);
  });

  test('continues a healthy series with sufficient supporting history', () => {
    const result = scorer.score(candidate({ type: 'SERIES' }), [
      factor('SERIES_HEALTH', 85), factor('HISTORICAL_PERFORMANCE', 65),
    ]);
    assert.equal(result.category, 'CONTINUE');
  });

  test('pauses a consistently weak series only with sufficient confidence', () => {
    const result = scorer.score(candidate({ type: 'SERIES' }), [
      factor('SERIES_HEALTH', 20, { confidence: 1 }), factor('HISTORICAL_PERFORMANCE', 25, { confidence: 1 }),
    ]);
    assert.equal(result.category, 'PAUSE');
  });

  test('prioritizes a known candidate with compatible strong factors', () => {
    const result = scorer.score(candidate(), [
      factor('HISTORICAL_PERFORMANCE', 84), factor('TREND', 78), factor('FORMAT_FIT', 76),
    ]);
    assert.equal(result.category, 'PRIORITIZE');
    assert.ok(result.value >= 75);
  });

  test('ranks ties deterministically by candidate key', () => {
    const factors = [factor('HISTORICAL_PERFORMANCE', 70), factor('TREND', 70)];
    const ranked = scorer.rank([
      { candidate: candidate({ key: 'b', label: 'B' }), factors },
      { candidate: candidate({ key: 'a', label: 'A' }), factors },
    ]);
    assert.deepEqual(ranked.map(({ candidate: item }) => item.key), ['a', 'b']);
  });

  test('prevents a single metric from dominating the documented weights', () => {
    assert.ok(Math.abs(Object.values(OPPORTUNITY_FACTOR_WEIGHTS).reduce((sum, value) => sum + value, 0) - 1) < 1e-10);
    assert.ok(Math.max(...Object.values(OPPORTUNITY_FACTOR_WEIGHTS)) <= 0.15);
  });

  test('does not mutate candidate, factors, risks or constraints', () => {
    const inputCandidate = candidate();
    const factors = [factor('HISTORICAL_PERFORMANCE', 75), factor('TREND', 65)];
    const risks = [{ code: 'KNOWN_RISK', severity: 'LOW', summary: 'Known risk' }];
    const constraints = [{ code: 'BUDGET', summary: 'Limited budget' }];
    const before = structuredClone({ inputCandidate, factors, risks, constraints });
    scorer.score(inputCandidate, factors, constraints, risks);
    assert.deepEqual({ inputCandidate, factors, risks, constraints }, before);
  });

  test('same input produces the same structural decision', () => {
    const factors = [factor('HISTORICAL_PERFORMANCE', 72), factor('TREND', 68)];
    assert.deepEqual(scorer.score(candidate(), factors), scorer.score(candidate(), factors));
  });

  test('states that score is not a view prediction or success probability', () => {
    const result = scorer.score(candidate(), [factor('HISTORICAL_PERFORMANCE', 70), factor('TREND', 70)]);
    assert.match(result.disclaimer, /não prevê views/i);
    assert.match(result.disclaimer, /não probabilidade de sucesso/i);
  });
});
