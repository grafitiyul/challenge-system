import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { FileInterceptor } from '@nestjs/platform-express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const multer = require('multer');
import * as path from 'path';
import * as fs from 'fs';

// Local type stub (avoids @types/multer dependency)
interface UploadedFileInfo {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  filename: string;
  path: string;
  size: number;
}

// Resolve uploads directory relative to project root
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

// Ensure directory exists at module load time
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function generateFilename(originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rand}${ext}`;
}

@UseGuards(AdminSessionGuard)
@Controller('upload')
export class UploadController {
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req: unknown, file: { originalname: string }, cb: (err: null, name: string) => void) => {
          cb(null, generateFilename(file.originalname));
        },
      }),
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
  uploadFile(@UploadedFile() file: UploadedFileInfo) {
    if (!file) throw new BadRequestException('No file uploaded');
    return { url: `/uploads/${file.filename}`, originalName: file.originalname, size: file.size };
  }
}
