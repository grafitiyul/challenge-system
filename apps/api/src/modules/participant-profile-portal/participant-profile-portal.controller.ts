import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as path from 'path';
import { resolveUploadsDir } from '../upload/uploads-dir';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { ParticipantProfilePortalService, ProfileSnapshot } from './participant-profile-portal.service';
import { SetProfileValueDto } from './dto/set-value.dto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const multer = require('multer');

// Mirrors the local UploadedFileInfo type used by the admin upload
// controller; avoids pulling in @types/multer.
interface UploadedFileInfo {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  filename: string;
  path: string;
  size: number;
}

const UPLOADS_DIR = resolveUploadsDir();

function generateFilename(originalname: string): string {
  const ext = path.extname(originalname).toLowerCase();
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rand}${ext}`;
}

// ── Token-authorised participant routes ─────────────────────────────────────
//
// The :token URL param is the participant.accessToken. It identifies the
// participant + active program; no admin session is needed. Mirrors
// /api/public/participant/:token used by the game portal.

@Controller('public/participant/:token/profile')
export class ParticipantProfilePortalController {
  constructor(private readonly svc: ParticipantProfilePortalService) {}

  @Get()
  async getProfile(@Param('token') token: string): Promise<ProfileSnapshot> {
    const ctx = await this.svc.resolveByToken(token);
    return this.svc.getProfileForParticipant(ctx.participantId, ctx.programId);
  }

  @Patch('value')
  async setValue(
    @Param('token') token: string,
    @Body() dto: SetProfileValueDto,
  ): Promise<ProfileSnapshot> {
    const ctx = await this.svc.resolveByToken(token);
    return this.svc.setValueForParticipant(ctx.participantId, ctx.programId, dto.fieldKey, dto.value);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req: unknown, file: { originalname: string }, cb: (err: null, name: string) => void) => {
          cb(null, generateFilename(file.originalname));
        },
      }),
      // 20 MB ceiling — image avatars stay tiny; video clips
      // (before-photos gallery, etc.) need the headroom.
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (_req: unknown, file: { originalname: string; mimetype: string }, cb: (err: Error | null, accept: boolean) => void) => {
        // Images: jpg/jpeg/png/gif/webp.  Videos: mp4/mov/webm.
        // Both extension and mime must agree — prevents an mp4 file
        // disguised as .jpg from sneaking past the gallery picker.
        const allowedExt  = /\.(jpg|jpeg|png|gif|webp|mp4|mov|webm)$/i;
        const allowedMime = /^(image|video)\//i;
        if (!allowedExt.test(file.originalname) || !allowedMime.test(file.mimetype)) {
          return cb(
            new BadRequestException(
              'רק קבצי תמונה (jpg / jpeg / png / gif / webp) או וידאו (mp4 / mov / webm)',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadFile(
    @Param('token') token: string,
    @UploadedFile() file: UploadedFileInfo,
  ): Promise<{ id: string; url: string; mimeType: string; sizeBytes: number; uploadedAt: string }> {
    if (!file) throw new BadRequestException('No file uploaded');
    const ctx = await this.svc.resolveByToken(token);
    return this.svc.recordUpload(ctx.participantId, {
      url: `/uploads/${file.filename}`,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });
  }
}

// ── Admin read-only access for the participant detail page ─────────────────
// Mirrors the portal endpoint shape so the admin and participant see
// exactly the same data. No write endpoints — admin editing is a future
// phase.

@UseGuards(AdminSessionGuard)
@Controller('admin/participants/:participantId/profile')
export class ParticipantProfileAdminController {
  constructor(private readonly svc: ParticipantProfilePortalService) {}

  @Get(':programId')
  getProfile(
    @Param('participantId') participantId: string,
    @Param('programId') programId: string,
  ): Promise<ProfileSnapshot> {
    return this.svc.getProfileForParticipant(participantId, programId);
  }
}
