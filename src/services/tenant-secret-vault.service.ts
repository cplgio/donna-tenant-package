// Dependencies
import { Injectable, Logger } from '@nestjs/common';
import { createSecretKey } from 'node:crypto';

// Types
import type { TenantDoc, TenantSecretBundle, TenantSnapshot } from '../types';

// Utils
const cloneWithoutSecrets = (tenant: TenantDoc): TenantSnapshot => {
  if (!tenant.microsoft) {
    return Object.freeze({ ...tenant }) as TenantSnapshot;
  }

  const { GRAPH_CLIENT_SECRET: _secret, ...safeMicrosoft } = tenant.microsoft;
  return Object.freeze({
    ...tenant,
    microsoft: Object.freeze({ ...safeMicrosoft }),
  }) as TenantSnapshot;
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
      const secrets = this.buildBundle(tenant);
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

  private buildBundle(tenant: TenantDoc): TenantSecretBundle {
    if (!tenant.microsoft?.GRAPH_CLIENT_SECRET) {
      return Object.freeze({}) as TenantSecretBundle;
    }

    const clientSecret = createSecretKey(Buffer.from(tenant.microsoft.GRAPH_CLIENT_SECRET, 'utf8'));
    const bundle: TenantSecretBundle = Object.freeze({
      microsoft: Object.freeze({
        clientSecret,
      }),
    });
    return bundle;
  }
}
