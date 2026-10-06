import { Inject, Injectable } from '@nestjs/common';
import { PermanentJobError } from '../../queues/job-errors';
import type { SourceAdapter } from './source-adapter';

export const SOURCE_ADAPTERS = Symbol('SOURCE_ADAPTERS');

/** Resolves a source's adapter by `tender_sources.adapter_key`. Adding a portal = adding an adapter. */
@Injectable()
export class AdapterRegistry {
  private readonly adapters = new Map<string, SourceAdapter>();

  constructor(@Inject(SOURCE_ADAPTERS) adapters: SourceAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.key)) throw new Error(`Duplicate crawler adapter "${adapter.key}"`);
      this.adapters.set(adapter.key, adapter);
    }
  }

  get(key: string): SourceAdapter {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new PermanentJobError(`No crawler adapter registered for "${key}"`);
    return adapter;
  }

  keys(): string[] {
    return [...this.adapters.keys()];
  }
}
