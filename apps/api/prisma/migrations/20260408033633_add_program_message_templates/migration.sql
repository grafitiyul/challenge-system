-- DropForeignKey
ALTER TABLE "questionnaire_templates" DROP CONSTRAINT "questionnaire_templates_programId_fkey";

-- CreateTable
CREATE TABLE "program_message_templates" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_message_templates_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "program_message_templates" ADD CONSTRAINT "program_message_templates_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_templates" ADD CONSTRAINT "questionnaire_templates_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
