import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { TenantDoc } from '../types';

const TENANT_CACHE_TTL_SECONDS = parseInt(process.env.TENANT_CACHE_TTL_SECONDS ?? '3600', 10);

// Utils
const tenantKey = (tenantId: string) => `tenants:${tenantId}`;
const workspaceKey = (workspaceTenantId: string) => `tenants:byWorkspace:${workspaceTenantId}`;

@Injectable()
export class TenantCacheService {
  private readonly logger = new Logger(TenantCacheService.name);

  // memory caches
  private readonly tenantMemory = new Map<string, TenantDoc>();
  private readonly workspaceMemory = new Map<string, string>();

  constructor(private readonly redis?: Redis) {}

  // Services

  async getTenant(tenantId: string): Promise<TenantDoc | null> {
    const cached = this.tenantMemory.get(tenantId);
    if (cached) {
      return cached;
    }

    if (!this.redis) return null;
    try {
      const data = await this.redis.get(tenantKey(tenantId));
      if (!data) return null;
      const parsed = JSON.parse(data) as TenantDoc;
      this.tenantMemory.set(tenantId, parsed);
      return parsed;
    } catch (err) {
      this.logger.warn(`Redis getTenant failed: ${err}`);
      return null;
    }
  }

  async setTenant(tenant: TenantDoc, ttlSeconds = TENANT_CACHE_TTL_SECONDS): Promise<void> {
    this.tenantMemory.set(tenant.id, tenant);
    if (tenant.microsoft?.GRAPH_TENANT_ID) {
      this.workspaceMemory.set(tenant.microsoft.GRAPH_TENANT_ID, tenant.id);
    }

    if (!this.redis) return;
    const payload = JSON.stringify(tenant);
    try {
      await this.redis.set(tenantKey(tenant.id), payload, 'EX', ttlSeconds);
      if (tenant.microsoft?.GRAPH_TENANT_ID) {
        await this.redis.set(workspaceKey(tenant.microsoft.GRAPH_TENANT_ID), tenant.id, 'EX', ttlSeconds);
      }
    } catch (err) {
      this.logger.warn(`Redis setTenant failed: ${err}`);
    }
  }

  async getTenantIdByWorkspace(workspaceTenantId: string): Promise<string | null> {
    const cached = this.workspaceMemory.get(workspaceTenantId);
    if (cached) return cached;

    if (!this.redis) return null;
    try {
      const data = await this.redis.get(workspaceKey(workspaceTenantId));
      if (!data) return null;
      this.workspaceMemory.set(workspaceTenantId, data);
      return data;
    } catch (err) {
      this.logger.warn(`Redis getTenantIdByWorkspace failed: ${err}`);
      return null;
    }
  }

  async invalidateTenant(tenantId: string, workspaceTenantId?: string): Promise<void> {
    this.tenantMemory.delete(tenantId);
    if (workspaceTenantId) {
      this.workspaceMemory.delete(workspaceTenantId);
    }

    if (!this.redis) return;
    try {
      await this.redis.del(tenantKey(tenantId));
      if (workspaceTenantId) {
        await this.redis.del(workspaceKey(workspaceTenantId));
      }
    } catch (err) {
      this.logger.warn(`Redis invalidateTenant failed: ${err}`);
    }
  }
}
