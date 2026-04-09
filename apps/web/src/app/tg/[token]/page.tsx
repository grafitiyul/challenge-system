'use client';

/**
 * /tg/[token] — Task engine portal (participant self-managed planning surface).
 *
 * Dedicated route for task planning only. Uses the same ParticipantGroup.accessToken
 * as /t/[token] (game portal) but renders a completely separate surface:
 * no game chrome, no score reporting, no leaderboard.
 *
 * Route separation:
 *   /t/[token]  → game portal (report, stats, feed, rules)
 *   /tg/[token] → task portal (weekly plan, goals, tasks, chat with coach)
 *
 * Sidebar is bypassed via sidebar-layout.tsx (pathname.startsWith('/tg/')).
 * Token model is stable: toggling taskEngineEnabled never destroys the token.
 */

import { use } from 'react';
import { PlanTab } from '../../../app/t/[token]/plan-tab';

export default function TaskPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <PlanTab token={token} />;
}
