import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError, type ErrorDetail } from '../errors/app-error';

function flatten(errors: ValidationError[], parent?: string): ErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.entries(error.constraints ?? {}).map(([constraint, message]) => ({
      field,
      code: constraint.toUpperCase(),
      message,
    }));
    return [...own, ...flatten(error.children ?? [], field)];
  });
}

/**
 * Global DTO validation: strips unknown properties, rejects requests that send them,
 * transforms primitives to declared types, and reports failures as VALIDATION_FAILED.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    stopAtFirstError: false,
    exceptionFactory: (errors) =>
      new AppError('VALIDATION_FAILED', 'The request is invalid.', flatten(errors)),
  });
}
