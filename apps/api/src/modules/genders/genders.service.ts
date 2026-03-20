import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GendersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.gender.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
