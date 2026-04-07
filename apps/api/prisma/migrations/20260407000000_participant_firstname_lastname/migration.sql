-- Step 1: Add new columns (nullable first so existing rows are valid)
ALTER TABLE "participants" ADD COLUMN "firstName" TEXT;
ALTER TABLE "participants" ADD COLUMN "lastName" TEXT;

-- Step 2: Migrate data — split existing fullName on the first space
UPDATE "participants"
SET
  "firstName" = CASE
    WHEN POSITION(' ' IN "fullName") > 0
      THEN LEFT("fullName", POSITION(' ' IN "fullName") - 1)
    ELSE "fullName"
  END,
  "lastName" = CASE
    WHEN POSITION(' ' IN "fullName") > 0
      THEN NULLIF(TRIM(SUBSTRING("fullName" FROM POSITION(' ' IN "fullName") + 1)), '')
    ELSE NULL
  END;

-- Step 3: Now that all rows are populated, enforce NOT NULL
ALTER TABLE "participants" ALTER COLUMN "firstName" SET NOT NULL;

-- Step 4: Remove the old column
ALTER TABLE "participants" DROP COLUMN "fullName";
