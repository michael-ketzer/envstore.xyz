-- Drop IP address and User-Agent from AuditLog. Both are personal data under
-- GDPR; the audit log doesn't need them to answer its core question ("who
-- changed what, when") and keeping them around past the original request was
-- a retention liability we don't want.

ALTER TABLE "AuditLog" DROP COLUMN "ipAddress";
ALTER TABLE "AuditLog" DROP COLUMN "userAgent";
