import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { ParticipantProfilePortalService, ProfileSnapshot } from './participant-profile-portal.service';
import { SetProfileValueDto } from './dto/set-value.dto';
import { MulterExceptionFilter } from './multer-exception.filter';
import { getMediaStorage, generateStorageKey } from '../upload/media-storage';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const multer = require('multer');

// Mirrors the multer file shape; avoids pulling in @types/multer.
// IMPORTANT: with memoryStorage, `buffer` carries the full file body
// and the disk-only fields (filename / path) are absent.
interface UploadedFileInfo {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

// Per-mime size budgets. Images get 15 MB — generous enough for
// straight-from-camera phone shots without re-encoding. Videos get
// 50 MB so short clips for "before photos" land cleanly.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

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
  // Convert opaque multer "File too large" / fileFilter rejections
  // into clear Hebrew JSON the XHR client can surface verbatim.
  @UseFilters(new MulterExceptionFilter(MAX_IMAGE_BYTES, MAX_VIDEO_BYTES))
  @UseInterceptors(
    FileInterceptor('file', {
      // memoryStorage keeps the file body in a Buffer instead of
      // writing to disk — we then stream that buffer to R2. Required
      // for production: Railway's container filesystem is ephemeral,
      // so any disk write disappears on the next redeploy. The
      // memory cost is bounded by the limits.fileSize cap below.
      storage: multer.memoryStorage(),
      // 50 MB ceiling — videos can run to 50 MB; we then re-check
      // image uploads against the tighter 15 MB image budget below.
      limits: { fileSize: MAX_VIDEO_BYTES },
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
    // Per-mime budget — images stay small (15 MB), videos may run to
    // 50 MB. multer's fileFilter only sees the mime, not the size, so
    // the cross-check happens here AFTER the bytes are in the buffer.
    // No disk file to clean up — memoryStorage drops the buffer on
    // throw via the GC.
    if (/^image\//i.test(file.mimetype) && file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException(`קובץ תמונה חורג מ-${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    }
    const ctx = await this.svc.resolveByToken(token);
    // Stream the buffer to whichever backend is active (R2 in
    // production, disk fallback in dev). The returned URL is the
    // canonical address — public R2 URL when MEDIA_PUBLIC_URL_BASE
    // is set, /uploads/<filename> otherwise. Both shapes are already
    // handled by the admin + portal renderers (see frontend's
    // url.startsWith('/uploads') ternary).
    const storage = getMediaStorage();
    const key = generateStorageKey('profile', ctx.participantId, file.originalname);
    const stored = await storage.store({
      key,
      mimeType: file.mimetype,
      data: file.buffer,
    });
    return this.svc.recordUpload(ctx.participantId, {
      url: stored.url,
      // Persist the R2 key so the admin delete path can later remove
      // the underlying object. For the disk fallback this is the
      // bare filename, which the admin delete uses to unlink the
      // local file. Either way: storageKey is the truth, url is the
      // display string.
      storageKey: stored.key,
      mimeType: file.mimetype,
      sizeBytes: stored.size,
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

// ── Admin: hard-delete a single uploaded file ──────────────────────────
// Authoritative cleanup: drops the catalog row, strips dangling
// references in profile values + the avatar column, and (for R2-backed
// uploads) deletes the underlying object. This is the ONLY path that
// physically removes from R2 — the participant portal "remove from
// gallery" path never calls storage.remove() per the operator policy
// (participant edits may be temporary; admin delete is the cleanup).

@UseGuards(AdminSessionGuard)
@Controller('admin/participants/:participantId/files')
export class ParticipantUploadedFileAdminController {
  constructor(private readonly svc: ParticipantProfilePortalService) {}

  @Delete(':fileId')
  delete(
    @Param('participantId') participantId: string,
    @Param('fileId') fileId: string,
  ): Promise<{ ok: true; storageRemoved: boolean; storageReason?: string }> {
    return this.svc.adminDeleteUploadedFile(participantId, fileId);
  }
}
