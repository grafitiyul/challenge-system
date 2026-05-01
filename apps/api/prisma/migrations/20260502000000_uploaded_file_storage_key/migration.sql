-- Add storageKey to participant_uploaded_files so the admin delete
-- path can reach the R2 object directly instead of parsing it back
-- out of `url`. Nullable: existing rows (pre-R2-cutover, or local
-- dev disk uploads) have no R2 object to delete; the admin delete
-- handler skips the R2 remove call when this column is null.

ALTER TABLE "participant_uploaded_files"
  ADD COLUMN "storageKey" TEXT;
