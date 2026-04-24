import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Record<string, string>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (this.prisma as any).systemSetting.findMany();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  }

  async get(key: string): Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.prisma as any).systemSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<Record<string, string>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.prisma as any).systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return this.findAll();
  }

  // Called from SeederService on startup to ensure defaults exist
  async seedDefaults() {
    const defaults: Record<string, string> = {
      mockParticipantsEnabled: 'false',
      // Phase 3: email-sender identity for outbound system mail. The
      // transport (SMTP host/port/user/pass) stays env-driven; these two
      // are admin-editable metadata shown in the From header.
      emailSenderName: '',
      emailSenderAddress: '',
    };
    for (const [key, value] of Object.entries(defaults)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.prisma as any).systemSetting.upsert({
        where: { key },
        create: { key, value },
        update: {}, // never overwrite an existing value on startup
      });
    }
  }
}
