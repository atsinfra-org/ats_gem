import { slugify, withRandomSuffix } from './slugify';

describe('slugify', () => {
  it('lower-cases, hyphenates and strips punctuation', () => {
    expect(slugify("Ada's Workspace!")).toBe('ada-s-workspace');
    expect(slugify('  Multiple   spaces  ')).toBe('multiple-spaces');
  });

  it('strips accents', () => {
    expect(slugify('Café Déjà Vu')).toBe('cafe-deja-vu');
  });

  it('never returns an empty string', () => {
    expect(slugify('')).not.toBe('');
    expect(slugify('!!!')).not.toBe('');
  });

  it('truncates very long input', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe('withRandomSuffix', () => {
  it('appends a short suffix and stays deterministically different each call', () => {
    const a = withRandomSuffix('my-org');
    const b = withRandomSuffix('my-org');
    expect(a).toMatch(/^my-org-[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
  });
});
