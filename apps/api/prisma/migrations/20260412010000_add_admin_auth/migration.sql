-- AlterTable: add passwordHash to AdminUser
ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- CreateTable: AdminSession
CREATE TABLE IF NOT EXISTS "admin_sessions" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AdminAuthCode
CREATE TABLE IF NOT EXISTS "admin_auth_codes" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_auth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AdminPasswordReset
CREATE TABLE IF NOT EXISTS "admin_password_resets" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "admin_sessions_token_key" ON "admin_sessions"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "admin_password_resets_token_key" ON "admin_password_resets"("token");

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_auth_codes" ADD CONSTRAINT "admin_auth_codes_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_password_resets" ADD CONSTRAINT "admin_password_resets_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
