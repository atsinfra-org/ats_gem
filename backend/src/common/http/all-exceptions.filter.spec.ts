import { ArgumentsHost, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AppError } from '../errors/app-error';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-12345678', originalUrl: '/x', method: 'GET' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status: status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  beforeAll(() => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));

  it('renders AppError with its code, details and the request id', () => {
    const { status, body } = run(
      new AppError('VALIDATION_FAILED', 'The request is invalid.', [{ field: 'email', code: 'ISEMAIL', message: 'bad' }]),
    );
    expect(status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request is invalid.',
        details: [{ field: 'email', code: 'ISEMAIL', message: 'bad' }],
      },
      meta: { requestId: 'req-12345678' },
    });
  });

  it('maps framework HttpExceptions to stable codes', () => {
    expect(run(new NotFoundException('Cannot GET /x')).body.error.code).toBe('NOT_FOUND');
  });

  it('hides JSON parser details behind a generic message', () => {
    const { status, body } = run(new BadRequestException("Expected property name or '}' in JSON at position 1"));
    expect(status).toBe(400);
    expect(body.error.message).toBe('Malformed JSON request body.');
  });

  it('maps Prisma unique violations to CONFLICT', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    expect(run(err)).toMatchObject({ status: 409, body: { error: { code: 'CONFLICT' } } });
  });

  it('never leaks internal error messages for unknown errors', () => {
    const { status, body } = run(new Error('connect ECONNREFUSED postgresql://user:secret@db'));
    expect(status).toBe(500);
    expect(body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
