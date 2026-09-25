import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../src/config/app-config.service';
import type { Env } from '../../src/config/env.schema';

/** AppConfig with per-suite overrides (the validated env is otherwise fixed at import time). */
class OverriddenConfig extends AppConfig {
  constructor(
    config: ConfigService<Env, true>,
    private readonly overrides: Partial<Env>,
  ) {
    super(config);
  }

  override get<K extends keyof Env>(key: K): Env[K] {
    return Object.hasOwn(this.overrides, key) ? (this.overrides[key] as Env[K]) : super.get(key);
  }
}

/** Use with `.overrideProvider(AppConfig).useFactory(withConfig({...}))`. */
export function withConfig(overrides: Partial<Env>) {
  return {
    inject: [ConfigService],
    factory: (config: ConfigService<Env, true>) => new OverriddenConfig(config, overrides),
  };
}
