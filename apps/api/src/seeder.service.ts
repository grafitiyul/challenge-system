import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { SettingsService } from './modules/settings/settings.service';

const DEFAULT_CHALLENGE_TYPES = [
  { name: 'ירידה במשקל', sortOrder: 1 },
  { name: 'כסף',          sortOrder: 2 },
  { name: 'אנגלית',       sortOrder: 3 },
  { name: 'כושר',         sortOrder: 4 },
  { name: 'הרגלים',       sortOrder: 5 },
];

@Injectable()
export class SeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeederService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedChallengeTypes();
    await this.settings.seedDefaults();
  }

  private async seedChallengeTypes(): Promise<void> {
    let created = 0;
    for (const type of DEFAULT_CHALLENGE_TYPES) {
      const exists = await this.prisma.challengeType.findFirst({
        where: { name: type.name },
        select: { id: true },
      });
      if (!exists) {
        await this.prisma.challengeType.create({
          data: { name: type.name, sortOrder: type.sortOrder, isActive: true },
        });
        created++;
      }
    }
    if (created > 0) {
      this.logger.log(`Seeded ${created} challenge type(s).`);
    }
  }
}
