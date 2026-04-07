-- CreateEnum
CREATE TYPE "ProgramType" AS ENUM ('challenge', 'game', 'group_coaching', 'personal_coaching');

-- CreateEnum
CREATE TYPE "GroupStatus" AS ENUM ('active', 'inactive');

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "programId" TEXT,
ADD COLUMN     "status" "GroupStatus" NOT NULL DEFAULT 'active',
ALTER COLUMN "endDate" DROP NOT NULL,
ALTER COLUMN "startDate" DROP NOT NULL;

-- CreateTable
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProgramType" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
