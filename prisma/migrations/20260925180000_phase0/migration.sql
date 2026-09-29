-- CreateSchema
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "verificationToken" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "activeBusinessId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'salon',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessMember" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'INACTIVE',
    "seats" INTEGER NOT NULL DEFAULT 1,
    "renewBlocked" BOOLEAN NOT NULL DEFAULT false,
    "currentPeriodEnd" TIMESTAMP(3),
    "provider" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SUPPORT',
    "mfaSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformAuditLog" (
    "id" TEXT NOT NULL,
    "staffId" TEXT,
    "action" TEXT NOT NULL,
    "businessId" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");
CREATE INDEX "Business_status_idx" ON "Business"("status");
CREATE UNIQUE INDEX "BusinessMember_businessId_userId_key" ON "BusinessMember"("businessId", "userId");
CREATE INDEX "BusinessMember_userId_idx" ON "BusinessMember"("userId");
CREATE UNIQUE INDEX "Subscription_businessId_key" ON "Subscription"("businessId");
CREATE UNIQUE INDEX "PlatformUser_email_key" ON "PlatformUser"("email");
CREATE INDEX "PlatformAuditLog_businessId_createdAt_idx" ON "PlatformAuditLog"("businessId", "createdAt");
CREATE INDEX "PlatformAuditLog_staffId_createdAt_idx" ON "PlatformAuditLog"("staffId", "createdAt");

ALTER TABLE "User" ADD CONSTRAINT "User_activeBusinessId_fkey" FOREIGN KEY ("activeBusinessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Business" ADD CONSTRAINT "Business_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformAuditLog" ADD CONSTRAINT "PlatformAuditLog_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "PlatformUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
