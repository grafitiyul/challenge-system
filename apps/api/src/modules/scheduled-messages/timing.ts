// Shared timing helpers — used by:
//   * programs.service.ts (when writing CommunicationTemplate scheduling
//     fields, to validate timing-mode coherence)
//   * group-messages.service.ts (to resolve a template's relative timing
//     into an absolute scheduledAt for a specific group)
//   * scheduled-messages auto-create hooks (template create / group create)
//
// Centralised so the four timing modes — exact / day_of / before_start /
// after_end — have a single source of truth for both validation and the
// Asia/Jerusalem date math.

import { BadRequestException } from '@nestjs/common';

export const TIMING_TYPES = ['exact', 'day_of', 'before_start', 'after_end'] as const;
export type TimingType = (typeof TIMING_TYPES)[number];

const PARTICIPANT_TZ = 'Asia/Jerusalem';

/**
 * Validate that the supplied timing fields cohere for the given mode.
 * Throws BadRequestException with a clear Hebrew message on the first
 * violation.
 *
 *   exact         → exactAt (date-time) required
 *   day_of        → dayOfNumber (>=1) + timeOfDay required
 *   before_start  → offsetDays (>=0) + timeOfDay required
 *   after_end     → offsetDays (>=0) + timeOfDay required
 */
export function validateTimingFields(
  timingType: TimingType,
  fields: {
    exactAt?: string | Date | null;
    dayOfNumber?: number | null;
    offsetDays?: number | null;
    timeOfDay?: string | null;
  },
): void {
  switch (timingType) {
    case 'exact':
      if (!fields.exactAt) {
        throw new BadRequestException('עבור תזמון "תאריך מדויק" יש לציין תאריך ושעה');
      }
      return;
    case 'day_of':
      if (!fields.dayOfNumber || fields.dayOfNumber < 1) {
        throw new BadRequestException('עבור תזמון "יום N של המשחק" יש לציין מספר יום (1 ומעלה)');
      }
      if (!fields.timeOfDay) {
        throw new BadRequestException('עבור תזמון "יום N של המשחק" יש לציין שעה ביום');
      }
      return;
    case 'before_start':
      if (fields.offsetDays === null || fields.offsetDays === undefined || fields.offsetDays < 0) {
        throw new BadRequestException('עבור תזמון "X ימים לפני התחלה" יש לציין מספר ימים (0 ומעלה)');
      }
      if (!fields.timeOfDay) {
        throw new BadRequestException('עבור תזמון "X ימים לפני התחלה" יש לציין שעה ביום');
      }
      return;
    case 'after_end':
      if (fields.offsetDays === null || fields.offsetDays === undefined || fields.offsetDays < 0) {
        throw new BadRequestException('עבור תזמון "X ימים אחרי סיום" יש לציין מספר ימים (0 ומעלה)');
      }
      if (!fields.timeOfDay) {
        throw new BadRequestException('עבור תזמון "X ימים אחרי סיום" יש לציין שעה ביום');
      }
      return;
  }
}

// ── Asia/Jerusalem timing resolver ─────────────────────────────────────────
// Compose an absolute UTC Date from a YYYY-MM-DD calendar day (in
// Asia/Jerusalem) plus an HH:mm wall-clock time. Robust against DST
// transitions because we anchor on the local calendar day and shift
// by the actual offset that day.
function jerusalemDateAtTime(ymd: string, hhmm: string): Date {
  const [hh, mm] = hhmm.split(':').map(Number);
  const [y, m, d] = ymd.split('-').map(Number);
  // Probe at UTC noon on the target Y/M/D — guaranteed to land on the
  // correct calendar day in Asia/Jerusalem regardless of DST. Read the
  // local hour the probe shows; the difference from 12 is that day's
  // offset, which we use to shift to the target wall-clock.
  const probe = new Date(Date.UTC(y, (m as number) - 1, d, 12, 0, 0));
  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARTICIPANT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(probe);
  const localHour = Number(localParts.find((p) => p.type === 'hour')?.value);
  const offsetHours = localHour - 12;
  return new Date(Date.UTC(y, (m as number) - 1, d, hh - offsetHours, mm, 0));
}

function jerusalemYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PARTICIPANT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m as number) - 1, d + days));
  return jerusalemYmd(dt);
}

/**
 * Resolve a CommunicationTemplate's scheduling fields into a single
 * absolute UTC instant for a specific group. Throws BadRequestException
 * when the group lacks the date the timing type depends on.
 */
export function resolveTemplateScheduledAt(
  template: {
    timingType: string | null;
    exactAt: Date | null;
    dayOfNumber: number | null;
    offsetDays: number | null;
    timeOfDay: string | null;
  },
  group: { startDate: Date | null; endDate: Date | null },
): Date {
  if (!template.timingType) {
    throw new BadRequestException('התבנית אינה תבנית תזמון (timingType ריק)');
  }
  switch (template.timingType) {
    case 'exact': {
      if (!template.exactAt) {
        throw new BadRequestException('תבנית "תאריך מדויק" ללא תאריך מוגדר');
      }
      return template.exactAt;
    }
    case 'day_of': {
      if (!group.startDate) {
        throw new BadRequestException('לא ניתן לייבא תבנית "יום N של המשחק" לקבוצה ללא תאריך התחלה');
      }
      if (!template.dayOfNumber || !template.timeOfDay) {
        throw new BadRequestException('תבנית "יום N של המשחק" חסרה מספר יום או שעה');
      }
      const startYmd = jerusalemYmd(group.startDate);
      const targetYmd = addDaysYmd(startYmd, template.dayOfNumber - 1);
      return jerusalemDateAtTime(targetYmd, template.timeOfDay);
    }
    case 'before_start': {
      if (!group.startDate) {
        throw new BadRequestException('לא ניתן לייבא תבנית "X ימים לפני התחלה" לקבוצה ללא תאריך התחלה');
      }
      if (template.offsetDays === null || !template.timeOfDay) {
        throw new BadRequestException('תבנית "X ימים לפני התחלה" חסרה מספר ימים או שעה');
      }
      const startYmd = jerusalemYmd(group.startDate);
      const targetYmd = addDaysYmd(startYmd, -template.offsetDays);
      return jerusalemDateAtTime(targetYmd, template.timeOfDay);
    }
    case 'after_end': {
      if (!group.endDate) {
        throw new BadRequestException('לא ניתן לייבא תבנית "X ימים אחרי סיום" לקבוצה ללא תאריך סיום');
      }
      if (template.offsetDays === null || !template.timeOfDay) {
        throw new BadRequestException('תבנית "X ימים אחרי סיום" חסרה מספר ימים או שעה');
      }
      const endYmd = jerusalemYmd(group.endDate);
      const targetYmd = addDaysYmd(endYmd, template.offsetDays);
      return jerusalemDateAtTime(targetYmd, template.timeOfDay);
    }
    default:
      throw new BadRequestException(`timingType לא נתמך: ${template.timingType}`);
  }
}
