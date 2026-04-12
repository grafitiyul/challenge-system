import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
const CODE_TTL_MS = 10 * 60 * 1000;                 // 10 minutes
const RESET_TTL_MS = 60 * 60 * 1000;                // 1 hour
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ─── Password login ───────────────────────────────────────────────────────

  async loginWithPassword(emailInput: string, password: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: emailInput.toLowerCase().trim() },
    });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('אימייל או סיסמה שגויים');
    }
    if (!admin.passwordHash) {
      throw new UnauthorizedException('אימייל או סיסמה שגויים');
    }
    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('אימייל או סיסמה שגויים');
    }
    return admin;
  }

  // ─── Email OTP ────────────────────────────────────────────────────────────

  async requestEmailCode(emailInput: string): Promise<void> {
    // Fail immediately if email is not configured — do not simulate success
    if (!this.email.isConfigured) {
      throw new BadRequestException(
        'שליחת קוד אינה זמינה — שירות האימייל אינו מוגדר. פנה למנהל המערכת.',
      );
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { email: emailInput.toLowerCase().trim() },
    });
    // Always succeed to prevent email enumeration (only after the SMTP check above)
    if (!admin || !admin.isActive) return;

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    await this.prisma.adminAuthCode.create({
      data: { adminId: admin.id, code, expiresAt },
    });

    // Propagate — a failed send means the code was never delivered
    await this.email.sendLoginCode(admin.email, code);
  }

  async verifyEmailCode(emailInput: string, code: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: emailInput.toLowerCase().trim() },
    });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('קוד שגוי או פג תוקף');
    }

    const record = await this.prisma.adminAuthCode.findFirst({
      where: {
        adminId: admin.id,
        code,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) {
      throw new UnauthorizedException('קוד שגוי או פג תוקף');
    }

    await this.prisma.adminAuthCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return admin;
  }

  // ─── Password reset ───────────────────────────────────────────────────────

  async requestPasswordReset(emailInput: string): Promise<void> {
    // Fail immediately if email is not configured — do not simulate success
    if (!this.email.isConfigured) {
      throw new BadRequestException(
        'שחזור סיסמה אינו זמין — שירות האימייל אינו מוגדר. פנה למנהל המערכת.',
      );
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { email: emailInput.toLowerCase().trim() },
    });
    // Always succeed to prevent email enumeration (only after the SMTP check above)
    if (!admin || !admin.isActive) return;

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    await this.prisma.adminPasswordReset.create({
      data: { adminId: admin.id, token, expiresAt },
    });

    const baseUrl = process.env['FRONTEND_URL'] ?? 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    // Propagate — a failed send means the reset link was never delivered
    await this.email.sendPasswordReset(admin.email, resetUrl);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.adminPasswordReset.findUnique({
      where: { token },
      include: { admin: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('הקישור אינו בתוקף או כבר נוצל');
    }
    if (!record.admin.isActive) {
      throw new BadRequestException('החשבון אינו פעיל');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: { id: record.adminId },
        data: { passwordHash },
      }),
      this.prisma.adminPasswordReset.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  // ─── Session management ───────────────────────────────────────────────────

  async createSession(adminId: string): Promise<string> {
    const token = crypto.randomUUID() + '-' + crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.adminSession.create({ data: { adminId, token, expiresAt } });
    return token;
  }

  async validateSession(token: string) {
    const session = await this.prisma.adminSession.findUnique({
      where: { token },
      include: { admin: true },
    });
    if (!session || session.expiresAt < new Date() || !session.admin.isActive) {
      return null;
    }
    return session.admin;
  }

  async deleteSession(token: string): Promise<void> {
    await this.prisma.adminSession.deleteMany({ where: { token } });
  }

  // ─── Utility: set initial password (used by seed/admin tools) ────────────

  async setPassword(adminId: string, password: string): Promise<void> {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { passwordHash } });
  }
}
