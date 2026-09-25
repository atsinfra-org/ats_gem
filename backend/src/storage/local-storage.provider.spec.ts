import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { AppConfig } from '../config/app-config.service';
import { LocalStorageProvider } from './local-storage.provider';

describe('LocalStorageProvider', () => {
  let dir: string;
  let provider: LocalStorageProvider;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ats-gem-storage-'));
    const moduleRef = await Test.createTestingModule({
      providers: [LocalStorageProvider, { provide: AppConfig, useValue: { get: (key: string) => (key === 'STORAGE_LOCAL_DIR' ? dir : undefined) } }],
    }).compile();
    provider = moduleRef.get(LocalStorageProvider);
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('uploads, reports metadata, downloads and deletes a file round-trip', async () => {
    await provider.upload('docs/a.txt', Buffer.from('hello world'));
    expect(await provider.exists('docs/a.txt')).toBe(true);
    expect(await provider.getMetadata('docs/a.txt')).toEqual({ size: 11 });

    const stream = await provider.download('docs/a.txt');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello world');

    await provider.delete('docs/a.txt');
    expect(await provider.exists('docs/a.txt')).toBe(false);
  });

  it('deleting a file that does not exist is a no-op', async () => {
    await expect(provider.delete('docs/never-existed.txt')).resolves.toBeUndefined();
  });

  it('getMetadata returns null for a missing file', async () => {
    expect(await provider.getMetadata('docs/missing.txt')).toBeNull();
  });

  it.each(['../escape.txt', '/etc/passwd', 'a/../../escape.txt', 'a\0b'])('rejects an unsafe key "%s"', async (key) => {
    await expect(provider.upload(key, Buffer.from('x'))).rejects.toThrow(/unsafe/i);
  });

  it('writes the file under the configured root, not the working directory', async () => {
    await provider.upload('nested/b.txt', Buffer.from('nested content'));
    const onDisk = await readFile(join(dir, 'nested', 'b.txt'), 'utf8');
    expect(onDisk).toBe('nested content');
  });
});
