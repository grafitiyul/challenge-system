-- CreateIndex
CREATE INDEX "participant_groups_groupId_idx" ON "participant_groups"("groupId");

-- CreateIndex
CREATE INDEX "questionnaire_answers_submissionId_idx" ON "questionnaire_answers"("submissionId");

-- CreateIndex
CREATE INDEX "questionnaire_answers_questionId_idx" ON "questionnaire_answers"("questionId");

-- CreateIndex
CREATE INDEX "questionnaire_external_links_templateId_idx" ON "questionnaire_external_links"("templateId");

-- CreateIndex
CREATE INDEX "questionnaire_questions_templateId_idx" ON "questionnaire_questions"("templateId");

-- CreateIndex
CREATE INDEX "questionnaire_submissions_templateId_idx" ON "questionnaire_submissions"("templateId");

-- CreateIndex
CREATE INDEX "questionnaire_submissions_participantId_idx" ON "questionnaire_submissions"("participantId");

-- CreateIndex
CREATE INDEX "questionnaire_submissions_externalLinkId_idx" ON "questionnaire_submissions"("externalLinkId");
