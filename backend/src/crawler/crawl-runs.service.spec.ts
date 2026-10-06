import { runOutcome, tallyOutcomes } from './crawl-runs.service';
import { finalizeJobId, ingestJobId } from './handlers/discover-source.handler';
import { JOB_ID_PATTERN } from '../queues/job.registry';

describe('crawl run tallies', () => {
  it('folds child results and ignored failures into counters', () => {
    const tally = tallyOutcomes(
      [{ outcome: 'created' }, { outcome: 'created' }, { outcome: 'updated' }, { outcome: 'unchanged' }, { outcome: 'invalid' }, null, { other: 1 }],
      2,
    );
    expect(tally).toEqual({ created: 2, updated: 1, unchanged: 1, invalid: 1, suppressed: 0, errors: 2 });
  });

  it('classifies run outcomes', () => {
    expect(runOutcome(tallyOutcomes([{ outcome: 'created' }], 0))).toBe('success');
    expect(runOutcome(tallyOutcomes([], 0))).toBe('success');
    expect(runOutcome(tallyOutcomes([{ outcome: 'created' }], 1))).toBe('partial');
    expect(runOutcome(tallyOutcomes([], 3))).toBe('failure');
  });
});

describe('crawl job ids', () => {
  const runId = '0199a3b2-0000-7000-8000-000000000001';

  it('are deterministic and valid BullMQ custom ids, whatever the external id contains', () => {
    const weird = 'GEM/2026:B/12345 (corrigendum)';
    expect(ingestJobId(runId, weird)).toBe(ingestJobId(runId, weird));
    expect(ingestJobId(runId, weird)).toMatch(JOB_ID_PATTERN);
    expect(ingestJobId(runId, 'a')).not.toBe(ingestJobId(runId, 'b'));
    expect(finalizeJobId(runId)).toMatch(JOB_ID_PATTERN);
  });
});
