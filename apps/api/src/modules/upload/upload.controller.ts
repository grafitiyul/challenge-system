import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { FileInterceptor } from '@nestjs/platform-express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const multer = require('multer');
import { getMediaStorage, generateStorageKey } from './media-storage';

// Local type stub (avoids @types/multer dependency). With
// memoryStorage, `buffer` carries the body and disk fields are absent.
interface UploadedFileInfo {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@UseGuards(AdminSessionGuard)
@Controller('upload')
export class UploadController {
  // POST /api/upload — generic admin upload route used by the rich
  // text editor / questionnaire builder / various admin tools.
  // Streams to R2 (production) or local disk (dev fallback) via the
  // shared media-storage helper, so every admin upload also lands
  // in persistent storage instead of Railway's ephemeral filesystem.
  //
  // Returned shape kept exactly the same as before to avoid breaking
  // existing callers: { url, originalName, size }. URL is now the
  // public R2 URL when configured, /uploads/<filename> otherwise.
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // memoryStorage so the buffer lands in RAM and we stream it
      // straight to the storage backend. The 10 MB ceiling caps
      // memory pressure per request.
      storage: multer.memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req: unknown, file: { originalname: string }, cb: (err: Error | null, accept: boolean) => void) => {
        const allowed = /\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|xlsx|csv|mp4|mov)$/i;
        if (!allowed.test(file.originalname)) {
          return cb(new BadRequestException('File type not allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: UploadedFileInfo,
    @Req() req: { user?: { adminId?: string } },
  ): Promise<{ url: string; originalName: string; size: number }> {
    if (!file) throw new BadRequestException('No file uploaded');
    const adminId = req.user?.adminId ?? 'admin';
    const storage = getMediaStorage();
    const key = generateStorageKey('admin', adminId, file.originalname);
    const stored = await storage.store({
      key,
      mimeType: file.mimetype,
      data: file.buffer,
    });
    return {
      url: stored.url,
      originalName: file.originalname,
      size: stored.size,
    };
  }
}
