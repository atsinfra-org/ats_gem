import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../auth/public.decorator';
import { ApiPayload } from '../../common/http/api-response';
import { DocumentsService } from './documents.service';

/**
 * Read-only document API (docs/ARCHITECTURE.md Sec 19/25). Registration is an internal operation
 * (future crawler document-fetch step, Phase 6) - there is no public upload endpoint here. Tender
 * documents are public in this architecture (the same tenders are public), same visibility rule as
 * `GET /tenders/:id`; nothing here reveals a storage key or credential.
 */
@ApiTags('tender-documents')
@Controller('tenders/:tenderId/documents')
@Public()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  async list(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const take = Math.min(Number(pageSize) || 20, 100);
    const skip = ((Number(page) || 1) - 1) * take;
    const [total, rows] = await this.documents.list(tenderId, { take, skip });
    const data = rows.map((d) => ({
      id: d.id,
      documentType: d.documentType,
      fileName: d.fileName,
      version: d.version,
      supersedesId: d.supersedesId,
      sourceUrl: d.sourceUrl,
      sourceDocumentId: d.sourceDocumentId,
      status: d.status,
      downloadedAt: d.downloadedAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    }));
    return new ApiPayload(data, { pagination: { page: Number(page) || 1, pageSize: take, total, totalPages: Math.ceil(total / take) } });
  }

  @Get(':documentId')
  async detail(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    const doc = await this.documents.get(tenderId, documentId);
    return {
      id: doc.id,
      documentType: doc.documentType,
      fileName: doc.fileName,
      version: doc.version,
      supersedesId: doc.supersedesId,
      sourceUrl: doc.sourceUrl,
      sourceDocumentId: doc.sourceDocumentId,
      status: doc.status,
      mimeType: doc.storedFile.mimeType,
      fileSize: doc.storedFile.fileSize.toString(),
      downloadedAt: doc.downloadedAt?.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  /** Streams the file directly - never buffers it whole, never returns a storage key/credential. */
  @Get(':documentId/download')
  async download(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Res() res: Response) {
    const { stream, mimeType, fileName, fileSize } = await this.documents.downloadStream(tenderId, documentId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', fileSize.toString());
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
