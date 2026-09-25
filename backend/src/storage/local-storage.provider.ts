import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { AppConfig } from '../config/app-config.service';
import { assertSafeKey, type StorageMetadata, type StorageProvider, type UploadOptions } from './storage-provider';

/** Filesystem-backed `StorageProvider` (`STORAGE_DRIVER=local`, the default in dev/test/Docker). */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly config: AppConfig) {}

  private absolutePath(key: string): string {
    assertSafeKey(key);
    const root = resolve(this.config.get('STORAGE_LOCAL_DIR'));
    const target = resolve(root, key);
    // Belt and braces beyond assertSafeKey: the resolved path must still land inside the root.
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`Unsafe storage key: ${key}`);
    }
    return target;
  }

  async upload(key: string, data: Buffer | Readable, _options?: UploadOptions): Promise<void> {
    const path = this.absolutePath(key);
    await mkdir(dirname(path), { recursive: true });
    const source = Buffer.isBuffer(data) ? Readable.from(data) : data;
    await pipeline(source, createWriteStream(path));
  }

  download(key: string): Promise<Readable> {
    return Promise.resolve(createReadStream(this.absolutePath(key)));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.absolutePath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.getMetadata(key)) !== null;
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    try {
      const info = await stat(this.absolutePath(key));
      return info.isFile() ? { size: info.size } : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
}
