-- AlterTable: add portal opening time fields to groups
-- portalCallTime: scheduled opening-call moment (State A countdown target)
-- portalOpenTime: when the portal actually becomes accessible (State C unlock)
-- Both nullable — null means portal is always open (backward compatible)

ALTER TABLE "groups" ADD COLUMN "portalCallTime" TIMESTAMP(3);
ALTER TABLE "groups" ADD COLUMN "portalOpenTime" TIMESTAMP(3);
