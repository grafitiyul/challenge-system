-- DropForeignKey
ALTER TABLE "participants" DROP CONSTRAINT "participants_registrationId_fkey";

-- AlterTable
ALTER TABLE "participants" ALTER COLUMN "registrationId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
