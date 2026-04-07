-- AlterTable
ALTER TABLE "programs" ADD COLUMN     "showGroupComparison" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showIndividualLeaderboard" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showOtherGroupsCharts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showOtherGroupsMemberDetails" BOOLEAN NOT NULL DEFAULT false;
