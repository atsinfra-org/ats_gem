import { escapeHtml, preferencesUrl, renderEmail, sanitizeSubject, tenderUrl, type RenderContext } from './email-templates';
import { sanitizeError } from './notification-email.handler';
import { UpdatePreferencesSchema } from './notification-preferences.service';
import { dueOffsetHours, humanRemaining } from './notification-scheduled.handlers';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_KEYS,
  NOTIFY_WORTHY_TENDER_FIELDS,
  NotificationMetadataSchema,
  dedupKeys,
  isNotificationType,
} from './notification-types';
import { isValidTimeOfDay, isValidTimeZone, quietHoursDelayMs } from './quiet-hours';

const T = '0198c1a2-3b4c-7d5e-8f60-123456789abc';
const BASE = 'https://app.example.test';

const ctx = (over: Partial<RenderContext['notification']> = {}, extra: Partial<RenderContext> = {}): RenderContext => ({
  baseUrl: BASE,
  recipientName: 'Asha',
  notification: { type: 'TENDER_UPDATED', title: 'Tender updated: Road works', message: 'Changed: closing date.', metadata: { tenderId: T, tenderTitle: 'Road works', referenceNumber: 'PWD/2026/1', closingAt: '2026-10-10T09:30:00.000Z' }, ...over },
  ...extra,
});

describe('notification type registry', () => {
  it('has a category, priority and template for every type, and only security types are critical', () => {
    for (const k of NOTIFICATION_TYPE_KEYS) {
      const d = NOTIFICATION_TYPES[k];
      expect(d.category).toBeTruthy();
      expect(d.template).toBeTruthy();
    }
    expect(NOTIFICATION_TYPE_KEYS.filter((k) => NOTIFICATION_TYPES[k].priority === 'CRITICAL')).toEqual(['SECURITY']);
    expect(isNotificationType('TENDER_CORRIGENDUM')).toBe(true);
    expect(isNotificationType('NOPE')).toBe(false);
  });

  it('does not treat description, city or source url changes as notify-worthy', () => {
    for (const f of ['description', 'city', 'locationText', 'sourceUrl', 'currency', 'publishedAt', 'referenceNumber']) {
      expect((NOTIFY_WORTHY_TENDER_FIELDS as readonly string[]).includes(f)).toBe(false);
    }
    for (const f of ['closingAt', 'estimatedValue', 'lifecycle', 'title']) expect((NOTIFY_WORTHY_TENDER_FIELDS as readonly string[]).includes(f)).toBe(true);
  });

  it('builds deterministic dedup keys that change only when the underlying event changes', () => {
    const d = new Date('2026-10-10T09:30:00.000Z');
    expect(dedupKeys.deadline(T, d, 24)).toBe(dedupKeys.deadline(T, new Date(d), 24));
    expect(dedupKeys.deadline(T, d, 24)).not.toBe(dedupKeys.deadline(T, d, 3));
    expect(dedupKeys.deadline(T, d, 24)).not.toBe(dedupKeys.deadline(T, new Date(d.getTime() + 1000), 24));
    expect(dedupKeys.savedSearchMatch(T)).toBe(dedupKeys.savedSearchMatch(T));
    expect(dedupKeys.tenderEvent('TENDER_UPDATED', 'e1')).not.toBe(dedupKeys.tenderEvent('TENDER_UPDATED', 'e2'));
  });

  it('metadata is a closed, validated shape', () => {
    expect(NotificationMetadataSchema.safeParse({ tenderId: T, changedFields: ['closingAt'] }).success).toBe(true);
    expect(NotificationMetadataSchema.safeParse({ tenderId: T, password: 'x' }).success).toBe(false);
    expect(NotificationMetadataSchema.safeParse({ tenderId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('deadline offsets', () => {
  const H = 3_600_000;
  it('fires the smallest configured offset that still covers the remaining time', () => {
    expect(dueOffsetHours([168, 72, 24, 3], 100 * H)).toBe(168);
    expect(dueOffsetHours([168, 72, 24, 3], 70 * H)).toBe(72);
    expect(dueOffsetHours([168, 72, 24, 3], 20 * H)).toBe(24);
    expect(dueOffsetHours([168, 72, 24, 3], 2 * H)).toBe(3);
  });
  it('is not due when farther away than every offset, already past, or nothing is configured', () => {
    expect(dueOffsetHours([24], 30 * H)).toBeNull();
    expect(dueOffsetHours([24], 0)).toBeNull();
    expect(dueOffsetHours([24], -5 * H)).toBeNull();
    expect(dueOffsetHours([], 2 * H)).toBeNull();
  });
  it('a tender saved late only gets the reminder that still applies', () => {
    expect(dueOffsetHours([72, 24], 5 * H)).toBe(24);
  });
  it('describes the remaining time humanly', () => {
    expect(humanRemaining(90 * 60_000)).toBe('2 hours');
    expect(humanRemaining(20 * H)).toBe('20 hours');
    expect(humanRemaining(72 * H)).toBe('3 days');
  });
});

describe('quiet hours', () => {
  const q = { enabled: true, start: '22:00', end: '07:00', timezone: 'Asia/Kolkata' };
  // 2026-10-01T17:00:00Z == 22:30 IST
  it('holds mail sent inside an overnight window until it ends', () => {
    const at = new Date('2026-10-01T17:00:00.000Z');
    expect(quietHoursDelayMs(at, q)).toBe(8.5 * 3_600_000);
  });
  it('sends immediately outside the window and when disabled or degenerate', () => {
    expect(quietHoursDelayMs(new Date('2026-10-01T09:00:00.000Z'), q)).toBe(0); // 14:30 IST
    expect(quietHoursDelayMs(new Date('2026-10-01T17:00:00.000Z'), { ...q, enabled: false })).toBe(0);
    expect(quietHoursDelayMs(new Date('2026-10-01T17:00:00.000Z'), { ...q, start: '10:00', end: '10:00' })).toBe(0);
    expect(quietHoursDelayMs(new Date('2026-10-01T17:00:00.000Z'), { ...q, timezone: 'Not/AZone' })).toBe(0);
  });
  it('handles same-day windows and the early-morning half of an overnight window', () => {
    const day = { enabled: true, start: '13:00', end: '15:00', timezone: 'Asia/Kolkata' };
    expect(quietHoursDelayMs(new Date('2026-10-01T08:00:00.000Z'), day)).toBe(3_600_000 * 1.5); // 13:30 IST -> 15:00
    expect(quietHoursDelayMs(new Date('2026-10-01T22:30:00.000Z'), q)).toBe(3 * 3_600_000); // 04:00 IST -> 07:00
  });
  it('validates times and zones', () => {
    expect(isValidTimeOfDay('07:05')).toBe(true);
    expect(isValidTimeOfDay('7:5')).toBe(false);
    expect(isValidTimeOfDay('24:00')).toBe(false);
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
  });
});

describe('preference input validation', () => {
  it('accepts partial category toggles, allowed offsets and quiet hours', () => {
    expect(UpdatePreferencesSchema.safeParse({ categories: { CORRIGENDA: { email: false } }, deadlineOffsetsHours: [72, 3], quietHours: { enabled: true, start: '22:00', end: '07:00' } }).success).toBe(true);
  });
  it('rejects unknown categories, extra keys, disallowed offsets', () => {
    expect(UpdatePreferencesSchema.safeParse({ categories: { MARKETING: { email: true } } }).success).toBe(false);
    expect(UpdatePreferencesSchema.safeParse({ categories: { CORRIGENDA: { sms: true } } }).success).toBe(false);
    expect(UpdatePreferencesSchema.safeParse({ deadlineOffsetsHours: [5] }).success).toBe(false);
    expect(UpdatePreferencesSchema.safeParse({ userId: 'other' }).success).toBe(false);
  });
});

describe('email templates', () => {
  it('escapes every dynamic value in HTML (no raw interpolation)', () => {
    const evil = '<script>alert(1)</script> & "quotes" \'x\'';
    const out = renderEmail('tender-update', ctx({ title: evil, message: evil, metadata: { tenderId: T, tenderTitle: evil, referenceNumber: evil } }, { recipientName: evil }));
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).toContain('&amp;');
    expect(out.html).not.toMatch(/<[a-z]+[^>]*\son\w+=/i);
  });

  it('every template produces subject, text and html with the tender link and a preferences link', () => {
    const cases: Parameters<typeof renderEmail>[0][] = ['saved-search-match', 'tender-update', 'deadline-reminder', 'tender-corrigendum'];
    for (const t of cases) {
      const out = renderEmail(t, ctx());
      expect(out.subject.length).toBeGreaterThan(3);
      expect(out.text).toContain(`${BASE}/tenders/${T}`);
      expect(out.html).toContain(`${BASE}/tenders/${T}`);
      expect(out.text).toContain(preferencesUrl(BASE));
      expect(out.html).toContain('Manage notification preferences');
      expect(out.text).toContain('PWD/2026/1');
      expect(out.text).toMatch(/IST/);
    }
  });

  it('security mail has no tender link, says it cannot be turned off, and never contains tokens', () => {
    const out = renderEmail('system-security', ctx({ type: 'SECURITY', title: 'Your password was changed', message: 'The password was changed.', metadata: { securityKind: 'PASSWORD_CHANGED' } }));
    expect(out.text).not.toContain('/tenders/');
    expect(out.text).toContain('cannot be turned off');
    expect(out.text + out.html).not.toMatch(/token|bearer|refresh/i);
  });

  it('subjects cannot carry header injection', () => {
    expect(sanitizeSubject('Hello\r\nBcc: attacker@example.com')).toBe('Hello Bcc: attacker@example.com');
    const out = renderEmail('tender-update', ctx({ title: 'A\r\nBcc: x@y.z' }));
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it('only links to our own origin with a validated tender id', () => {
    expect(tenderUrl(BASE, T)).toBe(`${BASE}/tenders/${T}`);
    expect(tenderUrl(BASE, 'javascript:alert(1)')).toBeNull();
    expect(tenderUrl(BASE, '../../admin')).toBeNull();
    expect(tenderUrl(BASE, undefined)).toBeNull();
    const out = renderEmail('tender-update', ctx({ metadata: { tenderId: undefined } }));
    expect(out.html).not.toContain('View tender');
  });

  it('renders the digest with a cap and a "more" line', () => {
    const items = [{ title: 'New tender matches "Roads"', message: 'Bridge repair (PWD/1)', tenderId: T }];
    const out = renderEmail('saved-search-digest', ctx({ title: 'Your daily tender digest: 25 new matches', message: '', metadata: {} }, { items, moreCount: 24 }));
    expect(out.text).toContain('Bridge repair');
    expect(out.text).toContain('and 24 more');
    expect(out.text).toContain(`${BASE}/notifications`);
  });

  it('escapeHtml handles the dangerous characters', () => {
    expect(escapeHtml('<a href="x">&\'`')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&#96;');
  });
});

describe('error sanitizing', () => {
  it('removes addresses and long tokens from stored errors', () => {
    const msg = sanitizeError(new Error('550 5.1.1 someone@example.com rejected; token abcdefghijklmnopqrstuvwxyz0123456789ABCD'));
    expect(msg).not.toContain('someone@example.com');
    expect(msg).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789ABCD');
    expect(msg.length).toBeLessThanOrEqual(200);
  });
});
