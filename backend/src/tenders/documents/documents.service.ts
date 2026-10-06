import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { AppError } from '../../common/errors/app-error';
import { sha256HexBuffer, sniffMimeType } from '../../common/file-inspect';
import { PrismaService } from '../../database/prisma.service';
import type { TenderDocument } from '../../generated/prisma/client';
import type { TenderDocumentType } from '../../generated/prisma/enums';
import { STORAGE_PROVIDER, type StorageProvider } from '../../storage/storage-provider';

export interface RegisterDocumentInput {
  tenderId: string;
  documentType: TenderDocumentType;
  fileName: string;
  data: Buffer;
  declaredMimeType: string;
  sourceUrl?: string;
  sourceRecordId?: string;
  sourceDocumentId?: string;
}

const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'application/zip', 'application/octet-stream']);

/**
 * Document metadata + content-addressed storage (docs/ARCHITECTURE.md Sec 19; builds on the
 * `stored_files`/`tender_documents` foundation Phase 2 already created). `StoredFile` is keyed by
 * SHA-256 checksum, so two tenders (or two versions) that happen to reference byte-identical content
 * share one stored blob - registering never re-uploads a file whose checksum already exists.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * Registers one document version for a tender. Idempotent by content: registering the exact same
   * bytes for the same tender+documentType a second time is a no-op that returns the existing row.
   * Registering *different* bytes for a documentType that already has a version creates a new,
   * separate `TenderDocument` row chained via `supersedesId` - the older row is kept, never deleted
   * (docs/ARCHITECTURE.md Sec 19 "document versioning").
   */
  async register(input: RegisterDocumentInput): Promise<TenderDocument> {
    if (input.data.length === 0) throw new AppError('VALIDATION_FAILED', 'Document content is empty.');
    if (input.data.length > MAX_DOCUMENT_SIZE_BYTES) throw new AppError('VALIDATION_FAILED', `Document exceeds the ${MAX_DOCUMENT_SIZE_BYTES} byte limit.`);

    const checksum = sha256HexBuffer(input.data);
    const sniffed = sniffMimeType(input.data);
    // A recognised signature always wins over the caller's claim; an unrecognised one falls back to
    // it rather than rejecting a legitimate but unsniffed type.
    const mimeType = sniffed ?? input.declaredMimeType;
    if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new AppError('VALIDATION_FAILED', `Unsupported document type: ${mimeType}.`);
    if (sniffed && input.declaredMimeType && sniffed !== input.declaredMimeType && input.declaredMimeType !== 'application/octet-stream') {
      throw new AppError('VALIDATION_FAILED', `Declared content type "${input.declaredMimeType}" does not match the file's actual content ("${sniffed}").`);
    }

    return this.prisma.$transaction(async (tx) => {
      const storedFile = await tx.storedFile.upsert({
        where: { checksumSha256: checksum },
        create: {
          checksumSha256: checksum,
          storageProvider: 'LOCAL',
          storageKey: `documents/${checksum}`,
          mimeType,
          fileSize: BigInt(input.data.length),
          originalName: input.fileName,
        },
        update: {},
      });

      const existingForFile = await tx.tenderDocument.findUnique({ where: { tenderId_fileId: { tenderId: input.tenderId, fileId: storedFile.id } } });
      if (existingForFile) return existingForFile;

      if (!(await this.storage.exists(storedFile.storageKey))) {
        await this.storage.upload(storedFile.storageKey, input.data, { contentType: mimeType });
      }

      const previous = await tx.tenderDocument.findFirst({
        where: { tenderId: input.tenderId, documentType: input.documentType, deletedAt: null },
        orderBy: { version: 'desc' },
      });

      return tx.tenderDocument.create({
        data: {
          tenderId: input.tenderId,
          fileId: storedFile.id,
          documentType: input.documentType,
          fileName: input.fileName,
          version: (previous?.version ?? 0) + 1,
          supersedesId: previous?.id ?? null,
          sourceUrl: input.sourceUrl ?? null,
          sourceRecordId: input.sourceRecordId ?? null,
          sourceDocumentId: input.sourceDocumentId ?? null,
          downloadedAt: new Date(),
          status: 'DOWNLOADED',
        },
      });
    });
  }

  list(tenderId: string, params: { take: number; skip: number }) {
    const where = { tenderId, deletedAt: null };
    return this.prisma.$transaction([
      this.prisma.tenderDocument.count({ where }),
      this.prisma.tenderDocument.findMany({ where, orderBy: [{ documentType: 'asc' }, { version: 'desc' }], take: params.take, skip: params.skip }),
    ]);
  }

  async get(tenderId: string, documentId: string): Promise<TenderDocument & { storedFile: { mimeType: string; fileSize: bigint; storageKey: string } }> {
    const doc = await this.prisma.tenderDocument.findFirst({
      where: { id: documentId, tenderId, deletedAt: null },
      include: { storedFile: { select: { mimeType: true, fileSize: true, storageKey: true } } },
    });
    if (!doc) throw new AppError('NOT_FOUND', 'Document not found.');
    return doc;
  }

  /** Streams the document's bytes - never buffers the whole file in memory (docs/ARCHITECTURE.md Sec 20). */
  async downloadStream(tenderId: string, documentId: string): Promise<{ stream: Readable; mimeType: string; fileName: string; fileSize: bigint }> {
    const doc = await this.get(tenderId, documentId);
    const stream = await this.storage.download(doc.storedFile.storageKey);
    return { stream, mimeType: doc.storedFile.mimeType, fileName: doc.fileName, fileSize: doc.storedFile.fileSize };
  }
}
