import { describeError, LogThrottle } from './describe-error';

describe('describeError', () => {
  it('uses the message, first line only', () => {
    expect(describeError(new Error('boom\n    at somewhere'))).toBe('boom');
  });

  it('falls back to the code for message-less connection errors', () => {
    const err = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' });
    expect(describeError(err)).toBe('ECONNREFUSED');
    expect(describeError(new AggregateError([], ''))).toBe('AggregateError');
  });

  it('handles non-errors', () => {
    expect(describeError('plain')).toBe('plain');
  });
});

describe('LogThrottle', () => {
  it('lets one call through per interval until reset', () => {
    const throttle = new LogThrottle(1_000);
    expect(throttle.ready(0)).toBe(true);
    expect(throttle.ready(500)).toBe(false);
    expect(throttle.ready(1_000)).toBe(true);
    throttle.reset();
    expect(throttle.ready(1_001)).toBe(true);
  });
});
