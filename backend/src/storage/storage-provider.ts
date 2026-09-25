import { Readable } from 'node:stream';

export interface StorageMetadata {
  size: number;
  contentType?: string;
}

export interface UploadOptions {
  contentType?: string;
}

/**
 * Object-storage abstraction (docs/ARCHITECTURE.md Sec 19 "Storage abstraction"). `storageKey` is
 * an opaque identifier the provider assigns meaning to - callers never build filesystem/bucket paths
 * themselves (docs/DATABASE.md ADR-10: no bytes live in Postgres, and no caller-controlled path may
 * reach the filesystem or object store directly - see `assertSafeKey` below).
 */
export interface StorageProvider {
  upload(key: string, data: Buffer | Readable, options?: UploadOptions): Promise<void>;
  /** Returns a readable stream - callers must stream this to the response, never buffer it whole. */
  download(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getMetadata(key: string): Promise<StorageMetadata | null>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/**
 * Rejects a storage key that could escape the provider's own root - `..` segments, absolute paths,
 * or a leading slash. Every `StorageProvider` implementation must call this before touching the
 * filesystem or an object-storage path, so a caller-supplied key (however it got there) can never
 * cause a path-traversal read/write outside the intended storage root.
 */
export function assertSafeKey(key: string): void {
  if (!key || key.startsWith('/') || key.includes('\0')) throw new Error(`Unsafe storage key: ${key}`);
  const segments = key.split(/[/\\]/);
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}
