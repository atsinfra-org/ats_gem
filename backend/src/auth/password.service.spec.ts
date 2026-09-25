import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with Argon2id parameters matching docs/ARCHITECTURE.md §5.3', async () => {
    const hash = await service.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('verifies a correct password and rejects an incorrect one', async () => {
    const hash = await service.hash('correct horse battery staple');
    await expect(service.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong password')).resolves.toBe(false);
  });

  it('never throws on a malformed hash — treats it as a failed match', async () => {
    await expect(service.verify('not-a-real-hash', 'anything')).resolves.toBe(false);
  });
});
