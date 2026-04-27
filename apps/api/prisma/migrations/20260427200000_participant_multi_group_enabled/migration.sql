-- Phase 8 — explicit opt-in for the participant-portal group switcher.
--
-- Without this flag the switcher's only gate is "participant has > 1
-- active membership in the same program", which silently exposed the
-- multi-group UI to anyone who happened to acquire a second active
-- membership (legacy auto-joins, admin re-assignment, etc.). The new
-- column makes the privilege explicit per-participant; default false so
-- nobody is exposed without an admin actively turning it on.

ALTER TABLE "participants"
  ADD COLUMN "multiGroupEnabled" BOOLEAN NOT NULL DEFAULT false;
