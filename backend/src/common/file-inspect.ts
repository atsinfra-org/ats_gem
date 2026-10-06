import { createHash } from 'node:crypto';

export function sha256HexBuffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Best-effort magic-byte sniffing for the document types this platform actually deals with
 * (tender PDFs, scanned images, Office/zip-based documents). Not a full file-type library - just
 * enough to catch a client lying about `Content-Type` (docs/ARCHITECTURE.md Sec 20: "do not trust
 * client-provided MIME type alone when actual file inspection is available"). Returns `null` when
 * the signature is not recognised; callers fall back to the declared type in that case rather than
 * rejecting an otherwise-valid upload.
 */
export function sniffMimeType(data: Buffer): string | null {
  if (data.length < 4) return null;
  if (data.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  // ZIP local-file-header signature: also covers docx/xlsx/pptx (all zip containers) - reported
  // generically since distinguishing the Office subtype requires reading the archive's contents.
  if (data[0] === 0x50 && data[1] === 0x4b && (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07)) return 'application/zip';
  return null;
}
