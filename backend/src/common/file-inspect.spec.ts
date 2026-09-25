import { sha256HexBuffer, sniffMimeType } from './file-inspect';

describe('sniffMimeType', () => {
  it('recognises a PDF by its magic bytes', () => {
    expect(sniffMimeType(Buffer.from('%PDF-1.4 rest of file'))).toBe('application/pdf');
  });

  it('recognises a PNG by its magic bytes', () => {
    expect(sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe('image/png');
  });

  it('recognises a JPEG by its magic bytes', () => {
    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('recognises a zip/Office document by its magic bytes', () => {
    expect(sniffMimeType(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('application/zip');
  });

  it('returns null for an unrecognised or too-short buffer', () => {
    expect(sniffMimeType(Buffer.from('plain text'))).toBeNull();
    expect(sniffMimeType(Buffer.from([0x01]))).toBeNull();
  });
});

describe('sha256HexBuffer', () => {
  it('is deterministic and content-sensitive', () => {
    const a = sha256HexBuffer(Buffer.from('hello'));
    const b = sha256HexBuffer(Buffer.from('hello'));
    const c = sha256HexBuffer(Buffer.from('hello!'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
