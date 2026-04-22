# Project: Challenge System

## Environment
- Windows (PowerShell)
- Project path: C:\Projects\challenge-system
- Uses Antigravity (VS Code-like)

## Run commands
- API: npm run api
- WEB: npm run web

## Rules
- Always run API and WEB in separate terminals
- Never close terminals with running servers
- Always test locally before pushing
- Production deploy only happens on git push

## Structure
- apps/api = backend (NestJS + Prisma)
- apps/web = frontend (Next.js)

## Communication style
- Explain everything step-by-step like to a 10-year-old
- Do not skip steps
- Be very precise and explicit

## Execution Behavior — No Unnecessary Confirmations
When executing tasks:
- Do NOT stop for unnecessary confirmations.
- Always prefer continuing execution rather than pausing for approval.
- Assume "YES" by default for safe, non-destructive actions.

Only stop and request confirmation if:
1. The action is destructive and irreversible (e.g. deleting production data).
2. There is real ambiguity about user intent.
3. The environment strictly blocks execution without explicit approval.

Otherwise:
- Continue execution.
- Complete the full task end-to-end.
- Avoid partial progress caused by confirmation pauses.

Additional clarification:
- If a process was interrupted due to a declined confirmation, automatically resume and complete it.
- Do not require the user to manually restart flows.
- Always aim to deliver a fully working result in one execution.

## Goal
Build a system for:
- Programs (challenges, coaching, games)
- Participants management (CRM-like)
- WhatsApp integration
- Gamification (points, habits, progress)
- Mobile-first (later PWA)