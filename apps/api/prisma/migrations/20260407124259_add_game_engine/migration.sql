-- CreateTable
CREATE TABLE "game_actions" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "inputType" TEXT NOT NULL DEFAULT 'boolean',
    "points" INTEGER NOT NULL DEFAULT 0,
    "maxPerDay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_action_logs" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT 'true',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_events" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "groupId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "points" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_rules" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "conditionJson" JSONB NOT NULL DEFAULT '{}',
    "rewardJson" JSONB NOT NULL DEFAULT '{"points":0}',
    "activationType" TEXT NOT NULL DEFAULT 'immediate',
    "activationDays" INTEGER,
    "requiresAdminApproval" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_rule_unlocks" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedBy" TEXT,

    CONSTRAINT "group_rule_unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_game_states" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "currentDay" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_game_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_game_states" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "bestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActionDate" TIMESTAMP(3),
    "shieldsRemaining" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "participant_game_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_events" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_actions_programId_idx" ON "game_actions"("programId");

-- CreateIndex
CREATE INDEX "user_action_logs_participantId_programId_idx" ON "user_action_logs"("participantId", "programId");

-- CreateIndex
CREATE INDEX "user_action_logs_actionId_idx" ON "user_action_logs"("actionId");

-- CreateIndex
CREATE INDEX "score_events_participantId_programId_idx" ON "score_events"("participantId", "programId");

-- CreateIndex
CREATE INDEX "score_events_groupId_idx" ON "score_events"("groupId");

-- CreateIndex
CREATE INDEX "game_rules_programId_idx" ON "game_rules"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "group_rule_unlocks_groupId_ruleId_key" ON "group_rule_unlocks"("groupId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "group_game_states_groupId_key" ON "group_game_states"("groupId");

-- CreateIndex
CREATE INDEX "participant_game_states_programId_idx" ON "participant_game_states"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "participant_game_states_participantId_programId_key" ON "participant_game_states"("participantId", "programId");

-- CreateIndex
CREATE INDEX "feed_events_groupId_idx" ON "feed_events"("groupId");

-- CreateIndex
CREATE INDEX "feed_events_programId_idx" ON "feed_events"("programId");

-- AddForeignKey
ALTER TABLE "game_actions" ADD CONSTRAINT "game_actions_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_action_logs" ADD CONSTRAINT "user_action_logs_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_action_logs" ADD CONSTRAINT "user_action_logs_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_action_logs" ADD CONSTRAINT "user_action_logs_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "game_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rules" ADD CONSTRAINT "game_rules_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_rule_unlocks" ADD CONSTRAINT "group_rule_unlocks_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_rule_unlocks" ADD CONSTRAINT "group_rule_unlocks_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "game_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_game_states" ADD CONSTRAINT "group_game_states_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_game_states" ADD CONSTRAINT "participant_game_states_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_game_states" ADD CONSTRAINT "participant_game_states_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
