/**
 * Resolves the database the e2e suite may use. Tests TRUNCATE tables, so they only ever run
 * against a database whose name ends in "_test" — never the developer's working database.
 *
 *   TEST_DATABASE_URL set → used as is
 *   otherwise            → DATABASE_URL with the database name suffixed "_test"
 */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.TEST_DATABASE_URL;
  const base = explicit ?? env.DATABASE_URL;
  if (!base) throw new Error('E2E tests need DATABASE_URL (or TEST_DATABASE_URL) — copy .env.example to .env');
  const url = new URL(base);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!explicit && !name.endsWith('_test')) url.pathname = `/${name}_test`;
  const finalName = decodeURIComponent(url.pathname.slice(1));
  if (!finalName.endsWith('_test')) {
    throw new Error(`Refusing to run e2e tests against "${finalName}": the database name must end in "_test"`);
  }
  return url.toString();
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}
