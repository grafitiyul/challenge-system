import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

// Multer surfaces oversize/limit failures as BadRequest with a curt
// English string ("File too large") which then bubbles up to the
// frontend as exactly that — useless to a participant on the portal.
// This filter catches the 4xx side and rewrites known multer codes
// into clear Hebrew messages that include the actual size budget,
// so the per-file row in the UI shows e.g.
//   "שגיאה: סרטון חורג מ-50MB"
// instead of "שגיאה: File too large".
//
// Non-multer errors fall through to NestJS's default handler so the
// existing 400/403/404 responses elsewhere stay untouched.
@Catch()
export class MulterExceptionFilter implements ExceptionFilter {
  constructor(private readonly imageMaxBytes: number, private readonly videoMaxBytes: number) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    // multer attaches `code` on its own MulterError and on errors thrown
    // from fileFilter when the rejection wraps a BadRequestException.
    const code = (exception as { code?: string })?.code;
    if (code === 'LIMIT_FILE_SIZE') {
      const imgMb = Math.round(this.imageMaxBytes / 1024 / 1024);
      const vidMb = Math.round(this.videoMaxBytes / 1024 / 1024);
      return res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: `הקובץ גדול מדי. מקסימום: ${imgMb}MB לתמונה, ${vidMb}MB לסרטון.`,
        error: 'PayloadTooLarge',
      });
    }

    // Generic HttpException (BadRequestException from fileFilter for the
    // mime-mismatch case, etc.) — re-emit with its own status + message.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      return res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
    }

    // Anything else — surface as 500 with a generic message rather than
    // letting the raw error leak to the participant.
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'העלאה נכשלה — שגיאה לא צפויה בשרת.',
    });
  }
}
