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
import {
  LoginDto,
  RequestCodeDto,
  VerifyCodeDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto';

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

  // POST /api/auth/request-code — send OTP to email
  @Post('request-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestCode(@Body() dto: RequestCodeDto) {
    await this.authService.requestEmailCode(dto.email);
    return { ok: true };
  }

  // POST /api/auth/verify-code — verify OTP and create session
  @Post('verify-code')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyCode(
    @Body() dto: VerifyCodeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin = await this.authService.verifyEmailCode(dto.email, dto.code);
    const token = await this.authService.createSession(admin.id);
    setSessionCookie(res, token);
    return { ok: true, admin: { id: admin.id, email: admin.email, fullName: admin.fullName } };
  }

  // POST /api/auth/forgot-password — request reset email
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email);
    return { ok: true }; // Always 200 — never leak whether email exists
  }

  // POST /api/auth/reset-password — set new password using token
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
    return { ok: true };
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

  // GET /api/auth/me — return current admin (session guard applied here only)
  @Get('me')
  @UseGuards(AdminSessionGuard)
  getMe(@Req() req: Request & { admin?: { id: string; email: string; fullName: string } }) {
    const a = req.admin!;
    return { id: a.id, email: a.email, fullName: a.fullName };
  }
}
