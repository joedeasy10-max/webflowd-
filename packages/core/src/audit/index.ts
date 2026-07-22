import type { AuditAction } from "@webflowd/shared";
import { getDb, type Database } from "../db/client.js";
import { auditLog } from "../db/schema.js";
import { redact } from "../security/redact.js";

export interface AuditEntry {
  tenantId?: string | null;
  /** 'ai' | 'system' | a user id */
  actor: string;
  action: AuditAction | (string & {});
  entityType?: string;
  entityId?: string;
  metadata?: unknown;
  ip?: string;
}

/**
 * Append an audit record. Metadata is redacted before storage so secrets/PII
 * never land in the log. The table is append-only (UPDATE/DELETE revoked in the
 * migration), so writes here are the only mutation path.
 */
export async function writeAudit(entry: AuditEntry, database: Database = getDb()): Promise<void> {
  await database.insert(auditLog).values({
    tenantId: entry.tenantId ?? null,
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata === undefined ? null : (redact(entry.metadata) as object),
    ip: entry.ip ?? null,
  });
}
