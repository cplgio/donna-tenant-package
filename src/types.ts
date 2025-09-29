// Dependencies
import type { PrismaClient } from "@prisma/client";
import type { KeyObject } from "node:crypto";

// Types
export interface TenantMicrosoftConfig {
  GRAPH_TENANT_ID: string;
  GRAPH_CLIENT_ID: string;
  GRAPH_CLIENT_SECRET: string;
  GRAPH_REDIRECT_URI?: string;
  GRAPH_SCOPE?: string;
}

export interface TenantQdrantConfig {
  QDRANT_URL: string;
  QDRANT_API_KEY?: string;
}

export interface TenantDoc {
  id: string;
  name?: string;
  active?: boolean;
  db: string;
  microsoft?: TenantMicrosoftConfig;
  qdrant?: TenantQdrantConfig;
}

export type TenantSnapshot = Omit<TenantDoc, "microsoft" | "qdrant"> & {
  readonly microsoft?: TenantMicrosoftConfig;
  readonly qdrant?: TenantQdrantConfig;
};

export interface ResolveInput {
  tenantId?: string;
  userId?: string;
  userPhoneNumber?: string;
}

export type TenantContextSource =
  | "tenantId"
  | "userId"
  | "userPhoneNumber"
  | "workspaceTenantId"
  | "microsoftTenantId";

export interface TenantContextMetadata {
  readonly source: TenantContextSource;
  readonly identifier: string;
}

export interface TenantContextSnapshot {
  readonly tenant: TenantSnapshot;
  readonly prisma: PrismaClient;
  readonly metadata: TenantContextMetadata;
  readonly secrets: TenantSecretBundle;
}

export interface TenantContextState extends TenantContextSnapshot {
  readonly createdAt: Date;
}

export interface TenantSecretBundle {
  readonly microsoft?: {
    readonly clientSecret: KeyObject;
  };
  readonly qdrant?: {
    readonly apiKey: KeyObject;
  };
}
