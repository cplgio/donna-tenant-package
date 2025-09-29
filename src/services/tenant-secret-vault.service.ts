// Dependencies
import { Injectable, Logger } from '@nestjs/common';

// Types
import type {
  TenantDoc,
  TenantSecretBundle,
  TenantSnapshot,
} from '../types';

// Utils
const cloneWithoutSecrets = (tenant: TenantDoc): TenantSnapshot => {
  const { microsoft, qdrant, ...rest } = tenant;

  let safeMicrosoft: TenantSnapshot['microsoft'];
  if (microsoft) {
    const { GRAPH_CLIENT_SECRET: _secret, ...microsoftSafe } = microsoft;
    safeMicrosoft = Object.freeze({ ...microsoftSafe }) as TenantSnapshot['microsoft'];
  }

  let safeQdrant: TenantSnapshot['qdrant'];
  if (qdrant) {
    safeQdrant = Object.freeze({ ...qdrant }) as TenantSnapshot['qdrant'];
  }

  const safeTenant: TenantSnapshot = Object.freeze({
    ...rest,
    ...(safeMicrosoft ? { microsoft: safeMicrosoft } : {}),
    ...(safeQdrant ? { qdrant: safeQdrant } : {}),
  }) as TenantSnapshot;

  return safeTenant;
};

@Injectable()
export class TenantSecretVaultService {
  private readonly logger = new Logger(TenantSecretVaultService.name);
  private readonly vault = new Map<string, TenantSecretBundle>();

  // Services

  sanitizeTenant(tenant: TenantDoc): TenantSnapshot {
    return cloneWithoutSecrets(tenant);
  }

  captureFromTenant(tenant: TenantDoc): TenantSecretBundle {
    try {
      const existing = this.vault.get(tenant.id);
      const secrets = this.buildBundle(tenant, existing);
      this.vault.set(tenant.id, secrets);
      return secrets;
    } catch (error) {
      this.logger.error(`Failed to create secret bundle for tenant ${tenant.id}`, error as Error);
      throw error;
    }
  }

  getSecrets(tenantId: string): TenantSecretBundle | undefined {
    const entry = this.vault.get(tenantId);
    if (!entry) return undefined;
    return entry;
  }

  clearSecrets(tenantId: string): void {
    this.vault.delete(tenantId);
  }

  // Utils

  private buildBundle(
    tenant: TenantDoc,
    existing: TenantSecretBundle | undefined,
  ): TenantSecretBundle {
    const microsoftSecret = tenant.microsoft?.GRAPH_CLIENT_SECRET
      ? tenant.microsoft.GRAPH_CLIENT_SECRET
      : existing?.microsoft?.clientSecret;
    const qdrantSecret = tenant.qdrant?.QDRANT_API_KEY
      ? tenant.qdrant.QDRANT_API_KEY
      : existing?.qdrant?.apiKey;

    if (!microsoftSecret && !qdrantSecret) {
      return Object.freeze({}) as TenantSecretBundle;
    }

    const bundle: TenantSecretBundle = Object.freeze({
      ...(microsoftSecret
        ? {
            microsoft: Object.freeze({
              clientSecret: microsoftSecret,
            }),
          }
        : {}),
      ...(qdrantSecret
        ? {
            qdrant: Object.freeze({
              apiKey: qdrantSecret,
            }),
          }
        : {}),
    });

    return bundle;
  }
}
