export interface TenantMicrosoftConfig {
  GRAPH_TENANT_ID: string;
  GRAPH_CLIENT_ID: string;
  GRAPH_CLIENT_SECRET: string;
  GRAPH_REDIRECT_URI?: string;
  GRAPH_SCOPE?: string;
}

export interface TenantDoc {
  id: string;
  name?: string;
  active?: boolean;
  db: string;
  microsoft?: TenantMicrosoftConfig;
}

export interface ResolveInput {
  tenantId?: string;
  userId?: string;
}
