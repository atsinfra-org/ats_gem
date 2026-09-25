export interface EmailMessage {
  to: string;
  template: string;
  /** Template variables. May contain secrets (reset links, OTPs) — never log values. */
  variables: Record<string, string>;
}

export interface SendResult {
  messageId: string;
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
