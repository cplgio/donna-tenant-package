import type { Firestore } from 'firebase-admin/firestore';
import type { PrismaClient } from '@prisma/client';
import { TenantCacheService } from './tenant-cache.service';
import { PrismaPoolService } from './prisma-pool.service';
import { ResolveInput, TenantDoc } from '../types';
export declare class TenantService {
    private readonly firestore;
    private readonly cache;
    private readonly prismaPool;
    private readonly logger;
    constructor(firestore: Firestore, cache: TenantCacheService, prismaPool: PrismaPoolService);
    getTenantById(tenantId: string): Promise<TenantDoc>;
    getTenantByWorkspaceId(workspaceTenantId: string): Promise<TenantDoc>;
    getPrismaFor(input: ResolveInput): Promise<PrismaClient>;
    getPrismaByWorkspaceTenantId(workspaceTenantId: string): Promise<{
        prisma: PrismaClient;
        tenant: TenantDoc;
    }>;
    private getPrismaForTenant;
}
