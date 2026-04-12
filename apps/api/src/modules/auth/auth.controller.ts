import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AdminSessionGuard } from './admin-session.guard';
import { LoginDto, SetupDto } from './dto/auth.dto';

const COOKIE_NAME = 'admin_session';
const COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_TTL_MS,
    path: '/',
  });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // GET /api/auth/setup-needed — public, returns whether first-run setup is required
  @Get('setup-needed')
  async setupNeeded() {
    const needsSetup = await this.authService.needsSetup();
    return { needsSetup };
  }

  // POST /api/auth/setup — public, creates first admin; blocked if any admin exists
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async setup(@Body() dto: SetupDto) {
    await this.authService.createFirstAdmin(dto.fullName, dto.email, dto.password);
    return { ok: true };
  }

  // POST /api/auth/login — email + password
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin = await this.authService.loginWithPassword(dto.email, dto.password);
    const token = await this.authService.createSession(admin.id);
    setSessionCookie(res, token);
    return { ok: true, admin: { id: admin.id, email: admin.email, fullName: admin.fullName } };
  }

  // POST /api/auth/logout — clear session
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
    if (token) await this.authService.deleteSession(token);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  // GET /api/auth/me — return current admin
  @Get('me')
  @UseGuards(AdminSessionGuard)
  getMe(@Req() req: Request & { admin?: { id: string; email: string; fullName: string } }) {
    const a = req.admin!;
    return { id: a.id, email: a.email, fullName: a.fullName };
  }
}
