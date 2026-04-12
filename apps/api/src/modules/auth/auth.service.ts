import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── First-run setup ──────────────────────────────────────────────────────

  async needsSetup(): Promise<boolean> {
    const count = await this.prisma.adminUser.count();
    return count === 0;
  }

  async createFirstAdmin(fullName: string, email: string, password: string) {
    const count = await this.prisma.adminUser.count();
    if (count > 0) {
      throw new BadRequestException('System is already set up — use the admin panel to manage users.');
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return this.prisma.adminUser.create({
      data: { email: email.toLowerCase().trim(), fullName, passwordHash, isActive: true },
    });
  }

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

  // ─── Utility ─────────────────────────────────────────────────────────────

  async setPassword(adminId: string, password: string): Promise<void> {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { passwordHash } });
  }
}
