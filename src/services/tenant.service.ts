import { Injectable, Logger } from '@nestjs/common';
import type { Firestore } from 'firebase-admin/firestore';
import type { PrismaClient } from '@prisma/client';
import { TenantCacheService } from './tenant-cache.service';
import { PrismaPoolService } from './prisma-pool.service';
import { ResolveInput, TenantDoc } from '../types';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly firestore: Firestore,
    private readonly cache: TenantCacheService,
    private readonly prismaPool: PrismaPoolService,
  ) {}

  // Services

  async getTenantById(tenantId: string): Promise<TenantDoc> {
    try {
      const cached = await this.cache.getTenant(tenantId);
      if (cached) return cached;

      const doc = await this.firestore.collection('tenants').doc(tenantId).get();
      if (!doc.exists) {
        throw new Error(`Tenant ${tenantId} not found`);
      }
      const tenant = { id: doc.id, ...(doc.data() as Omit<TenantDoc, 'id'>) };
      await this.cache.setTenant(tenant);
      return tenant;
    } catch (err) {
      this.logger.error(`Failed to get tenant by id ${tenantId}`, err as Error);
      throw err;
    }
  }

  async getTenantByWorkspaceId(workspaceTenantId: string): Promise<TenantDoc> {
    try {
      const cachedId = await this.cache.getTenantIdByWorkspace(workspaceTenantId);
      if (cachedId) return await this.getTenantById(cachedId);

      const snap = await this.firestore
        .collection('tenants')
        .where('microsoft.GRAPH_TENANT_ID', '==', workspaceTenantId)
        .limit(1)
        .get();
      if (snap.empty) {
        throw new Error(`Tenant workspace ${workspaceTenantId} not found`);
      }
      const doc = snap.docs[0];
      const tenant = { id: doc.id, ...(doc.data() as Omit<TenantDoc, 'id'>) };
      await this.cache.setTenant(tenant);
      return tenant;
    } catch (err) {
      this.logger.error(
        `Failed to get tenant by workspace id ${workspaceTenantId}`,
        err as Error,
      );
      throw err;
    }
  }

  async getPrismaFor(input: ResolveInput): Promise<PrismaClient> {
    try {
      if (input.tenantId) {
        const tenant = await this.getTenantById(input.tenantId);
        return await this.getPrismaForTenant(tenant);
      }
      if (input.userId) {
        const snap = await this.firestore
          .collection('user_tenants')
          .where('userId', '==', input.userId)
          .where('active', '==', true)
          .limit(1)
          .get();
        const tenantId = snap.docs[0]?.data()?.tenantId as string | undefined;
        if (!tenantId) throw new Error(`Tenant for user ${input.userId} not found`);
        const tenant = await this.getTenantById(tenantId);
        return await this.getPrismaForTenant(tenant);
      }
      throw new Error('tenantId or userId required');
    } catch (err) {
      this.logger.error('Failed to resolve Prisma client', err as Error);
      throw err;
    }
  }

  async getPrismaByWorkspaceTenantId(workspaceTenantId: string): Promise<{ prisma: PrismaClient; tenant: TenantDoc }> {
    try {
      const tenant = await this.getTenantByWorkspaceId(workspaceTenantId);
      const prisma = await this.getPrismaForTenant(tenant);
      return { prisma, tenant };
    } catch (err) {
      this.logger.error(
        `Failed to get Prisma by workspace tenant id ${workspaceTenantId}`,
        err as Error,
      );
      throw err;
    }
  }

  // Utils

  private async getPrismaForTenant(tenant: TenantDoc): Promise<PrismaClient> {
    return this.prismaPool.getClient(tenant.id, tenant.db);
  }
}
