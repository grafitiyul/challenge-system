import * as bcrypt from 'bcrypt';
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdminUserDto, UpdateAdminUserDto } from './dto/admin-user.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.adminUser.findMany({
      select: { id: true, fullName: true, email: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateAdminUserDto) {
    const existing = await this.prisma.adminUser.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) throw new ConflictException('כתובת אימייל זו כבר קיימת במערכת');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.adminUser.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        fullName: dto.fullName,
        passwordHash,
        isActive: true,
      },
    });
    return { id: user.id, fullName: user.fullName, email: user.email, isActive: user.isActive, createdAt: user.createdAt };
  }

  async update(id: string, dto: UpdateAdminUserDto) {
    const user = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('מנהל לא נמצא');

    if (dto.email) {
      const conflict = await this.prisma.adminUser.findFirst({
        where: { email: dto.email.toLowerCase().trim(), id: { not: id } },
      });
      if (conflict) throw new ConflictException('כתובת אימייל זו כבר קיימת במערכת');
    }

    const updated = await this.prisma.adminUser.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.email !== undefined && { email: dto.email.toLowerCase().trim() }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: { id: true, fullName: true, email: true, isActive: true, createdAt: true },
    });
    return updated;
  }

  async setPassword(id: string, password: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('מנהל לא נמצא');
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.adminUser.update({ where: { id }, data: { passwordHash } });
    return { ok: true };
  }
}
