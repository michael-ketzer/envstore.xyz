-- Per-email rolling failure counter for OTP verification. See
-- `OtpFailureBudget` in schema.prisma for the rationale: the `attempts`
-- column on VerificationToken caps brute force against ONE code, this
-- table caps brute force across an email's full 24h window of OTPs.
CREATE TABLE "OtpFailureBudget" (
    "identifier" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtpFailureBudget_pkey" PRIMARY KEY ("identifier")
);
