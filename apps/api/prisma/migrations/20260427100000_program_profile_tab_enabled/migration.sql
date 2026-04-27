-- Phase 7 — feature flag for the participant-facing "פרטים אישיים" tab.
--
-- profileTabEnabled gates whether the participant portal renders the
-- new profile tab for a given program. Default false so configuration
-- can be staged in admin without exposing a half-built form to
-- participants. Existing programs default to disabled.

ALTER TABLE "programs"
  ADD COLUMN "profileTabEnabled" BOOLEAN NOT NULL DEFAULT false;
