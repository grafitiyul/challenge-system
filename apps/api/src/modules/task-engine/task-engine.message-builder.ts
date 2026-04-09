/**
 * Task Engine — Message Builder
 *
 * Pure string-builder layer. Zero Prisma / DB access.
 * The service computes the data; this module converts it to a preview string.
 *
 * Extracted here so that future configurable wording can be applied by
 * replacing or wrapping these functions without touching the data layer.
 */

export interface DailySummaryData {
  participantName: string;
  date: string; // "YYYY-MM-DD"
  dateFormatted: string; // Pre-formatted Hebrew date string
  completed: { taskId: string; title: string }[];
  incomplete: { taskId: string; title: string }[];
  carriedForward: { taskId: string; title: string }[];
  tomorrowPlan: { taskId: string; title: string; startTime: string | null }[];
}

export interface WeeklySummaryData {
  participantName: string;
  weekStart: string; // "YYYY-MM-DD"
  weekEnd: string; // "YYYY-MM-DD"
  goalStats: { goal: { id: string; title: string }; total: number; completed: number }[];
  completedTasks: { title: string }[];
  incompleteTasks: { title: string }[];
}

export function buildDailySummaryMessage(data: DailySummaryData): string {
  const lines: string[] = [];
  lines.push(`📋 *סיכום יומי — ${data.dateFormatted}*`);
  lines.push('');

  if (data.completed.length > 0) {
    lines.push('✅ *הושלם היום:*');
    data.completed.forEach((t) => lines.push(`• ${t.title}`));
    lines.push('');
  }

  if (data.incomplete.length > 0) {
    lines.push('⏳ *לא הושלם:*');
    data.incomplete.forEach((t) => lines.push(`• ${t.title}`));
    lines.push('');
  }

  if (data.carriedForward.length > 0) {
    lines.push('↪️ *הועבר לתאריך אחר:*');
    data.carriedForward.forEach((t) => lines.push(`• ${t.title}`));
    lines.push('');
  }

  if (data.tomorrowPlan.length > 0) {
    lines.push('📅 *תוכנית למחר:*');
    data.tomorrowPlan.forEach((t) => {
      const timeStr = t.startTime ? ` (${t.startTime})` : '';
      lines.push(`• ${t.title}${timeStr}`);
    });
  }

  return lines.join('\n');
}

export function buildWeeklySummaryMessage(data: WeeklySummaryData): string {
  const lines: string[] = [];
  lines.push(`📋 *סיכום שבועי — ${data.weekStart} עד ${data.weekEnd}*`);
  lines.push('');

  if (data.goalStats.length > 0) {
    lines.push('🎯 *יעדים שבועיים:*');
    data.goalStats.forEach((gs) => {
      lines.push(`• ${gs.goal.title}: ${gs.completed}/${gs.total} משימות הושלמו`);
    });
    lines.push('');
  }

  if (data.completedTasks.length > 0) {
    lines.push('✅ *הושלם השבוע:*');
    data.completedTasks.forEach((t) => lines.push(`• ${t.title}`));
    lines.push('');
  }

  if (data.incompleteTasks.length > 0) {
    lines.push('⏭️ *עובר לשבוע הבא:*');
    data.incompleteTasks.forEach((t) => lines.push(`• ${t.title}`));
  }

  return lines.join('\n');
}
