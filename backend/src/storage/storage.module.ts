import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { LocalStorageProvider } from './local-storage.provider';
import { STORAGE_PROVIDER, type StorageProvider } from './storage-provider';

/**
 * `STORAGE_DRIVER=local` (default everywhere today - dev, test, Docker) is fully implemented.
 * `STORAGE_DRIVER=s3` is validated at config load (`env.schema.ts`: requires `S3_BUCKET`/`S3_REGION`)
 * and the interface is designed so an `S3StorageProvider` slots in without changing any caller, but
 * no S3 client is implemented in this phase (no AWS SDK dependency exists in the project yet, and
 * nothing today actually sets `STORAGE_DRIVER=s3`) - documented as a follow-up, not faked.
 */
@Module({
  providers: [
    LocalStorageProvider,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (config: AppConfig, local: LocalStorageProvider): StorageProvider => {
        const driver = config.get('STORAGE_DRIVER');
        if (driver === 'local') return local;
        throw new Error(`STORAGE_DRIVER=${driver} is configured but has no StorageProvider implementation yet (Phase 4 ships "local" only).`);
      },
      inject: [AppConfig, LocalStorageProvider],
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
