import { createServiceClient } from "./auth.ts";

/**
 * Writes an immutable audit log entry using the service_role client.
 * Never include secrets or sensitive data in metadata.
 */
export async function writeAuditLog(params: {
  businessId: string;
  userId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}) {
  const serviceClient = createServiceClient();

  await serviceClient.from("audit_logs").insert({
    business_id: params.businessId,
    user_id: params.userId,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId,
    metadata: params.metadata ?? {},
    ip_address: params.ipAddress,
  });
}
