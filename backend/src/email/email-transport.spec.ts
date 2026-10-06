import type { PinoLogger } from 'nestjs-pino';
import { stableStringify } from '../common/stable-json';
import { maskEmail } from './email-transport';
import { LogEmailTransport } from './log-email.transport';

describe('email', () => {
  it('masks recipients in logs', () => {
    expect(maskEmail('someone@example.com')).toBe('s***@example.com');
    expect(maskEmail('broken')).toBe('***');
  });

  it('the log transport never logs variable values (they can be one-time secrets)', async () => {
    const info = vi.fn();
    const transport = new LogEmailTransport({ setContext: vi.fn(), info } as unknown as PinoLogger);
    await transport.send({ to: 'someone@example.com', template: 'password-reset', variables: { resetUrl: 'https://x/reset?token=SECRET123' } });
    const logged = stableStringify(info.mock.calls);
    expect(logged).not.toContain('SECRET123');
    expect(logged).not.toContain('someone@example.com');
    expect(logged).toContain('resetUrl');
  });
});

describe('stableStringify', () => {
  it('sorts keys recursively', () => {
    expect(stableStringify({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}');
  });
});
