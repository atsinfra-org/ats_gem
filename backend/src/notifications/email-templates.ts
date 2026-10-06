import { TEMPLATE_VERSION, type NotificationMetadata, type TemplateKey } from './notification-types';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface TemplateNotification {
  type: string;
  title: string;
  message: string;
  metadata: NotificationMetadata;
}

export interface RenderContext {
  /** Public base URL of the web app (FRONTEND_URL). */
  baseUrl: string;
  recipientName?: string;
  notification: TemplateNotification;
  /** Digest only: the alerts folded into it (already limited by the caller) and how many more there were. */
  items?: { title: string; message: string; tenderId?: string }[];
  moreCount?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escapes text for HTML element/attribute contexts. Every dynamic value goes through this - there is no raw interpolation. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c] as string);
}

/** Header-injection safe: line breaks and control characters cannot survive into a subject. */
export function sanitizeSubject(value: string): string {
  return value.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

const plain = (value: string) => value.replace(/\p{Cc}/gu, ' ').slice(0, 2000);

/** Only ever links to our own origin with a validated UUID; anything else yields no link. */
export function tenderUrl(baseUrl: string, tenderId: string | undefined): string | null {
  if (!tenderId || !UUID.test(tenderId)) return null;
  try {
    return new URL(`/tenders/${tenderId}`, baseUrl).toString();
  } catch {
    return null;
  }
}

export function preferencesUrl(baseUrl: string): string {
  return new URL('/profile?tab=notifications', baseUrl).toString();
}

const fmtDate = (iso: string | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(d)} IST`;
};

interface Layout {
  heading: string;
  lines: string[];
  facts: [string, string][];
  cta?: { label: string; url: string } | null;
  footerNote: string;
}

function layout(ctx: RenderContext, l: Layout): { text: string; html: string } {
  const prefs = preferencesUrl(ctx.baseUrl);
  const greeting = ctx.recipientName ? `Hello ${plain(ctx.recipientName)},` : 'Hello,';
  const text = [
    greeting,
    '',
    l.heading,
    '',
    ...l.lines.map(plain),
    ...(l.facts.length ? ['', ...l.facts.map(([k, v]) => `${k}: ${plain(v)}`)] : []),
    ...(l.cta ? ['', `${l.cta.label}: ${l.cta.url}`] : []),
    '',
    '--',
    'ATS GeM',
    l.footerNote,
    `Manage notification preferences: ${prefs}`,
  ].join('\n');

  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#0f3d6b;color:#ffffff;padding:16px 24px;font-size:18px;font-weight:bold">ATS GeM</td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>
<h1 style="margin:0 0 12px;font-size:18px">${escapeHtml(l.heading)}</h1>
${l.lines.map((line) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(plain(line))}</p>`).join('\n')}
${l.facts.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;font-size:14px">${l.facts.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">${escapeHtml(k)}</td><td style="padding:2px 0">${escapeHtml(plain(v))}</td></tr>`).join('')}</table>` : ''}
${l.cta ? `<p style="margin:16px 0"><a href="${escapeHtml(l.cta.url)}" style="background:#0f3d6b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">${escapeHtml(l.cta.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280">${escapeHtml(l.footerNote)}<br><a href="${escapeHtml(prefs)}" style="color:#0f3d6b">Manage notification preferences</a></td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

function tenderFacts(m: NotificationMetadata): [string, string][] {
  const facts: [string, string][] = [];
  if (m.referenceNumber) facts.push(['Reference', m.referenceNumber]);
  if (m.tenderTitle) facts.push(['Tender', m.tenderTitle]);
  const closing = fmtDate(m.closingAt);
  if (closing) facts.push(['Closing', closing]);
  const prev = fmtDate(m.previousClosingAt);
  if (prev) facts.push(['Previously', prev]);
  return facts;
}

/**
 * Renders one of the notification templates. Pure: same input, same output, no I/O. Content comes from the stored
 * notification snapshot (title/message/metadata), so an email always matches the in-app record it belongs to.
 */
export function renderEmail(template: TemplateKey, ctx: RenderContext): RenderedEmail {
  const n = ctx.notification;
  const link = tenderUrl(ctx.baseUrl, n.metadata.tenderId);
  const cta = link ? { label: 'View tender', url: link } : null;
  const base = { facts: tenderFacts(n.metadata), cta };

  switch (template) {
    case 'saved-search-match': {
      const names = n.metadata.savedSearchNames?.join(', ');
      const out = layout(ctx, { ...base, heading: n.title, lines: [n.message, ...(names ? [`Matched your saved search: ${names}`] : [])], footerNote: 'You are receiving this because alerts are on for a saved search.' });
      return { subject: sanitizeSubject(`New tender: ${n.metadata.tenderTitle ?? n.title}`), ...out };
    }
    case 'tender-update': {
      const out = layout(ctx, { ...base, heading: n.title, lines: [n.message], footerNote: 'You are receiving this because you saved this tender.' });
      return { subject: sanitizeSubject(n.title), ...out };
    }
    case 'tender-corrigendum': {
      const out = layout(ctx, {
        ...base,
        heading: n.title,
        lines: [n.message, ...(n.metadata.corrigendumTitle ? [`Corrigendum: ${n.metadata.corrigendumTitle}`] : [])],
        footerNote: 'You are receiving this because you saved this tender or a saved-search alert matches it.',
      });
      return { subject: sanitizeSubject(`Corrigendum: ${n.metadata.tenderTitle ?? n.title}`), ...out };
    }
    case 'deadline-reminder': {
      const out = layout(ctx, { ...base, heading: n.title, lines: [n.message], footerNote: 'You are receiving this deadline reminder because you saved this tender.' });
      return { subject: sanitizeSubject(n.title), ...out };
    }
    case 'system-security': {
      const out = layout(ctx, {
        facts: [],
        cta: null,
        heading: n.title,
        lines: [n.message, 'If you did not do this, reset your password immediately and contact support.'],
        footerNote: 'Security and account messages cannot be turned off.',
      });
      return { subject: sanitizeSubject(n.title), ...out };
    }
    case 'saved-search-digest': {
      const items = ctx.items ?? [];
      const lines = items.map((i) => `${i.title} - ${i.message}`);
      if (ctx.moreCount && ctx.moreCount > 0) lines.push(`...and ${ctx.moreCount} more. Open your notifications to see them all.`);
      const out = layout(ctx, {
        facts: [],
        cta: { label: 'Open notifications', url: new URL('/notifications', ctx.baseUrl).toString() },
        heading: n.title,
        lines,
        footerNote: 'You are receiving this daily digest because alerts are on for your saved searches.',
      });
      return { subject: sanitizeSubject(n.title), ...out };
    }
  }
}

export { TEMPLATE_VERSION };
