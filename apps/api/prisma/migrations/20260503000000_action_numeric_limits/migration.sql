-- Per-action numeric input safety limits. Three nullable columns —
-- existing rows have NULL for all three, so the legacy "no
-- restriction" behavior is preserved end-to-end. Backend logAction
-- and the participant portal both enforce when these are non-null.
--
-- maxDigits  — count of numeric digits in the parsed value
--              (separators / decimal point / sign not counted)
-- maxValue   — inclusive upper bound on the parsed numeric value
-- minValue   — inclusive lower bound on the parsed numeric value
--
-- Decimal(20,4) matches the precision the codebase already uses for
-- scoring (Prisma.Decimal everywhere) so a stored 50000 round-trips
-- exactly without floating-point drift.

ALTER TABLE "game_actions"
  ADD COLUMN "maxDigits" INTEGER,
  ADD COLUMN "maxValue"  DECIMAL(20, 4),
  ADD COLUMN "minValue"  DECIMAL(20, 4);
