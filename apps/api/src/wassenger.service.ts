import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

// Minimal typing for the parts of the Wassenger payload we care about.
// rawPayload is always stored in full regardless of what we can parse.
interface WassengerData {
  id?: string;
  type?: string;
  body?: string;
  timestamp?: number;
  from?: string;
  fromContact?: { name?: string; phone?: string };
  chat?: { id?: string; name?: string };
  media?: { url?: string };
}

interface WassengerPayload {
  event?: string;
  type?: string;
  data?: WassengerData;
  // Some Wassenger events wrap differently — handle both shapes
  [key: string]: unknown;
}

@Injectable()
export class WassengerService {
  constructor(private readonly prisma: PrismaService) {}

  async saveEvent(payload: WassengerPayload) {
    const data = payload.data ?? {};
    const eventType = payload.event ?? payload.type ?? null;
    const fromContact = data.fromContact ?? {};
    const chat = data.chat ?? {};

    return this.prisma.whatsAppEvent.create({
      data: {
        eventType,
        rawPayload: payload as object,
        phoneNumber: fromContact.phone ?? data.from ?? null,
        senderName: fromContact.name ?? null,
        chatId: chat.id ?? null,
        chatName: chat.name ?? null,
        messageText: typeof data.body === 'string' ? data.body : null,
        messageType: data.type ?? null,
        mediaUrl: data.media?.url ?? null,
        timestampFromSource:
          typeof data.timestamp === 'number' ? BigInt(data.timestamp) : null,
      },
    });
  }

  async getLatestEvents(limit = 50) {
    const rows = await this.prisma.whatsAppEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // BigInt is not JSON-serialisable — convert to number for the API response
    return rows.map((row) => ({
      ...row,
      timestampFromSource:
        row.timestampFromSource != null
          ? Number(row.timestampFromSource)
          : null,
    }));
  }
}
