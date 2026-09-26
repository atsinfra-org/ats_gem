/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script executed with plain node inside the backend container */
// DEV-ONLY fixture tool. Run INSIDE the backend api container (needs shell access there), e.g.
//   docker cp scripts/dev-fixtures.cjs <api-container>:/app/dev-fixtures.cjs
//   docker exec <api-container> node /app/dev-fixtures.cjs token <email> PASSWORD_RESET|EMAIL_VERIFY
//   docker exec <api-container> node /app/dev-fixtures.cjs document <tenderId> <TYPE> <fileName>
// It calls the backend's own services; it is not an HTTP endpoint and adds no bypass.
process.env.PROCESS_ROLE = "cli";
const { NestFactory } = require("@nestjs/core");

async function main() {
  const [mode, a, b, c] = process.argv.slice(2);
  const { CliModule } = require("/app/dist/cli.module.js");
  const { PrismaService } = require("/app/dist/database/prisma.service.js");
  const app = await NestFactory.createApplicationContext(CliModule, { logger: false });
  const prisma = app.get(PrismaService);
  try {
    if (mode === "token") {
      const { AuthTokenService } = require("/app/dist/auth/auth-token.service.js");
      const user = await prisma.user.findFirstOrThrow({ where: { email: a } });
      const svc = new AuthTokenService(prisma);
      console.log(await svc.issue(user.id, b));
    } else if (mode === "document") {
      const { DocumentsService } = require("/app/dist/tenders/documents/documents.service.js");
      const { LocalStorageProvider } = require("/app/dist/storage/local-storage.provider.js");
      const { AppConfig } = require("/app/dist/config/app-config.service.js");
      const storage = new LocalStorageProvider(app.get(AppConfig));
      const svc = new DocumentsService(prisma, storage);
      const body = `BT /F1 18 Tf 72 720 Td (ATS Gem dev fixture ${c}) Tj ET`;
      const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${body.length}>>stream\n${body}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
      const doc = await svc.register({ tenderId: a, documentType: b, fileName: c, data: Buffer.from(pdf), declaredMimeType: "application/pdf" });
      console.log(JSON.stringify({ id: doc.id, version: doc.version }));
    } else {
      throw new Error("unknown mode");
    }
  } finally {
    await app.close();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
