import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfig } from './app-config.service';
import { validateEnv } from './env.schema';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Tests inject their own environment; everything else reads .env if present.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnv,
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
