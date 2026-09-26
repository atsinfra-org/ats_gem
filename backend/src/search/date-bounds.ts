import { AppError } from '../common/errors/app-error';

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date-filter semantics (docs/ARCHITECTURE.md Sec 20):
 *  - A date-only value ("2026-09-30") is a calendar day in India Standard Time. As a lower bound it is
 *    that day 00:00 IST (inclusive); as an upper bound it is the *next* day 00:00 IST (exclusive), so
 *    `from=to=2026-09-30` means exactly that one IST day.
 *  - A full ISO-8601 timestamp is an instant. As a lower bound it is inclusive (`>=`); as an upper
 *    bound it is inclusive too (`<=`), which is expressed here by adding 1 ms so callers can always use `<`.
 * Callers therefore always compare `column >= from` and `column < to`.
 */
export function lowerBound(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  if (DATE_ONLY.test(value)) return new Date(Date.parse(`${value}T00:00:00.000Z`) - IST_OFFSET_MS);
  return new Date(value);
}

export function upperBoundExclusive(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  if (DATE_ONLY.test(value)) return new Date(Date.parse(`${value}T00:00:00.000Z`) - IST_OFFSET_MS + 86_400_000);
  return new Date(new Date(value).getTime() + 1);
}

export function assertRange(name: string, from: Date | undefined, toExclusive: Date | undefined): void {
  if (from && toExclusive && from >= toExclusive) {
    throw new AppError('VALIDATION_FAILED', `${name}: the start of the range must not be after the end.`, [{ field: name, code: 'INVALID_RANGE', message: 'from must be on or before to' }]);
  }
}

export function assertMoneyRange(name: string, min: string | undefined, max: string | undefined): void {
  if (min !== undefined && max !== undefined && Number(min) > Number(max)) {
    throw new AppError('VALIDATION_FAILED', `${name}: the minimum must not exceed the maximum.`, [{ field: name, code: 'INVALID_RANGE', message: 'min must be <= max' }]);
  }
}
