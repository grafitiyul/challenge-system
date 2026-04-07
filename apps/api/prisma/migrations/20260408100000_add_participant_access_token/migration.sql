-- Add accessToken to participant_groups for the /t/:token participant portal
ALTER TABLE "participant_groups" ADD COLUMN "accessToken" TEXT UNIQUE;
