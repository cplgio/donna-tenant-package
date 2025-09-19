// Dependencies
import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrismaClient } from '@prisma/client';

// Types
import type {
  TenantContextSnapshot,
  TenantContextState,
  TenantSecretBundle,
  TenantSnapshot,
} from '../types';

// Utils
const cloneTenant = (tenant: TenantSnapshot): TenantSnapshot => ({
  ...tenant,
  microsoft: tenant.microsoft ? { ...tenant.microsoft } : undefined,
});

@Injectable()
export class TenantContextService {
  private readonly logger = new Logger(TenantContextService.name);
  private readonly storage = new AsyncLocalStorage<TenantContextState>();

  // Services

  async runWithTenant<T>(snapshot: TenantContextSnapshot, handler: () => Promise<T>): Promise<T> {
    const metadata = Object.freeze({ ...snapshot.metadata });
    const state: TenantContextState = Object.freeze({
      tenant: Object.freeze(cloneTenant(snapshot.tenant)),
      prisma: snapshot.prisma,
      metadata,
      secrets: snapshot.secrets,
      createdAt: new Date(),
    });

    return this.storage.run(state, async () => {
      try {
        return await handler();
      } catch (error) {
        this.logger.error('Unhandled error inside tenant context', error as Error);
        throw error;
      }
    });
  }

  getContext(): TenantContextState | undefined {
    return this.storage.getStore();
  }

  isActive(): boolean {
    return Boolean(this.getContext());
  }

  getTenant(): TenantSnapshot {
    const context = this.getRequiredContext();
    return context.tenant;
  }

  getPrismaClient(): PrismaClient {
    const context = this.getRequiredContext();
    return context.prisma;
  }

  getMetadata(): TenantContextState['metadata'] {
    const context = this.getRequiredContext();
    return context.metadata;
  }

  getSecrets(): TenantSecretBundle {
    const context = this.getRequiredContext();
    return context.secrets;
  }

  private getRequiredContext(): TenantContextState {
    const context = this.getContext();
    if (!context) {
      throw new Error('Tenant context is not available in the current execution scope.');
    }
    return context;
  }
}
