export class SessionTenantMismatchError extends Error {
  constructor(
    readonly sessionId: string,
    readonly tenantId: string,
    readonly actualTenantId: string,
  ) {
    super("session_tenant_mismatch");
    this.name = "SessionTenantMismatchError";
  }
}
