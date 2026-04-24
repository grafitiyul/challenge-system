-- UX clutter control — isHidden is orthogonal to isActive (archive).
-- Hidden rows are filtered out of every admin list/picker by default
-- and only surface when the admin flips the "הצג פריטים מוסתרים" toggle.
-- Data is untouched; foreign keys stay valid.

ALTER TABLE "programs" ADD COLUMN "isHidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "groups"   ADD COLUMN "isHidden" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "programs_isHidden_idx" ON "programs"("isHidden");
CREATE INDEX "groups_isHidden_idx"   ON "groups"("isHidden");
