import type { Redis } from 'ioredis';
import { TenantDoc } from '../types';
export declare class TenantCacheService {
    private readonly redis?;
    private readonly logger;
    private readonly tenantMemory;
    private readonly workspaceMemory;
    constructor(redis?: Redis | undefined);
    getTenant(tenantId: string): Promise<TenantDoc | null>;
    setTenant(tenant: TenantDoc, ttlSeconds?: number): Promise<void>;
    getTenantIdByWorkspace(workspaceTenantId: string): Promise<string | null>;
    invalidateTenant(tenantId: string, workspaceTenantId?: string): Promise<void>;
}
