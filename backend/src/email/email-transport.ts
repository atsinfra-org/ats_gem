export interface EmailMessage {
  to: string;
  template: string;
  /** Template variables. May contain secrets (reset links, OTPs) — never log values. */
  variables: Record<string, string>;
  /** Pre-rendered content (Phase 8 notification emails). When present, `template` is only an identifier for logs/audit. */
  subject?: string;
  text?: string;
  html?: string;
}

export interface SendResult {
  messageId: string;
}

/** The provider rejected the message for a reason retrying cannot fix (invalid recipient, blocked address, bad payload). */
export class PermanentEmailError extends Error {
  constructor(
    message: string,
    readonly code: string = 'REJECTED',
  ) {
    super(message);
    this.name = 'PermanentEmailError';
  }
}

export abstract class EmailTransport {
  abstract readonly driver: string;
  abstract send(message: EmailMessage): Promise<SendResult>;
}

/** "someone@example.com" → "s***@example.com": enough to debug delivery, not enough to identify. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${address[0]}***${address.slice(at)}`;
}
