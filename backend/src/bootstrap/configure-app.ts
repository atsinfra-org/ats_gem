import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from '../common/http/all-exceptions.filter';
import { requestIdMiddleware } from '../common/http/request-id.middleware';
import { ResponseEnvelopeInterceptor } from '../common/http/response-envelope.interceptor';
import { createValidationPipe } from '../common/http/validation.pipe';
import { AppConfig } from '../config/app-config.service';

export const API_PREFIX = 'api/v1';
export const SWAGGER_PATH = 'api/docs';

/** Shared HTTP setup used by main.api.ts and the e2e tests, so tests exercise the real pipeline. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfig);

  app.use(requestIdMiddleware);
  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS'));
  app.disable('x-powered-by');

  const swaggerEnabled = config.get('SWAGGER_ENABLED');
  app.use(
    helmet({
      // Swagger UI needs inline scripts/styles; the API itself only serves JSON.
      contentSecurityPolicy: swaggerEnabled
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'https:'],
            },
          }
        : undefined,
    }),
  );

  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Requested-With', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    maxAge: 600,
  });

  app.useBodyParser('json', { limit: '1mb' });
  // Only the refresh-token cookie is ever read; it is unsigned (the token itself is opaque and
  // hashed server-side, so there is nothing for cookie signing to protect against tampering with).
  app.use(cookieParser());

  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'health/queues', method: RequestMethod.GET },
    ],
  });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.enableShutdownHooks();

  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ATS Gem API')
        .setDescription('Tender aggregation & procurement intelligence platform. See docs/API-CONTRACT.md.')
        .setVersion('v1')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
        .build(),
    );
    SwaggerModule.setup(SWAGGER_PATH, app, document, {
      jsonDocumentUrl: `${SWAGGER_PATH}/openapi.json`,
      swaggerOptions: { persistAuthorization: true },
    });
  }
}
