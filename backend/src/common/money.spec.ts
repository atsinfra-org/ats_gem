import { Prisma } from '../generated/prisma/client';
import { toMoney } from './money';

describe('toMoney', () => {
  it('formats a Decimal to exactly two places with the given currency', () => {
    expect(toMoney(new Prisma.Decimal('1234567.5'), 'INR')).toEqual({ amount: '1234567.50', currency: 'INR' });
  });

  it('returns null for a null amount', () => {
    expect(toMoney(null, 'INR')).toBeNull();
  });

  it('never loses precision to floating point', () => {
    expect(toMoney(new Prisma.Decimal('99999999999999.99'), 'INR')?.amount).toBe('99999999999999.99');
  });
});
