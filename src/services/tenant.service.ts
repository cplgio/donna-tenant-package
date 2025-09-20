// Dependencies
import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Firestore } from 'firebase-admin/firestore';

// Services
import { TenantCacheService } from './tenant-cache.service';
import { PrismaPoolService } from './prisma-pool.service';
import { TenantContextService } from './tenant-context.service';
import { TenantSecretVaultService } from './tenant-secret-vault.service';
import type {
  TenantWorkspaceCallback,
  TenantWorkspaceHandler,
  TenantWorkspaceRunnerOptions,
} from '../runtime/workspace-runner';
import { TenantWorkspaceRunner } from '../runtime/workspace-runner';

// Types
import type {
  ResolveInput,
  TenantContextMetadata,
  TenantContextSnapshot,
  TenantContextState,
  TenantDoc,
  TenantSecretBundle,
} from '../types';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly firestore: Firestore,
    private readonly cache: TenantCacheService,
    private readonly prismaPool: PrismaPoolService,
    private readonly secretVault: TenantSecretVaultService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // Services

  async getTenantById(tenantId: string): Promise<TenantDoc> {
    try {
      const context = this.tenantContext.getContext();
      if (context?.tenant.id === tenantId) {
        return context.tenant;
      }

      const cached = await this.cache.getTenant(tenantId);
      if (cached) {
        await this.ensureSecretBundle(cached);
        return cached;
      }

      return await this.fetchTenantById(tenantId);
    } catch (err) {
      this.logger.error(`Failed to get tenant by id ${tenantId}`, err as Error);
      throw err;
    }
  }

  async getTenantByWorkspaceId(workspaceTenantId: string): Promise<TenantDoc> {
    const { tenant } = await this.getWorkspaceByMicrosoft(workspaceTenantId);
    return tenant;
  }

  async getWorkspaceByMicrosoft(
    microsoftTenantId: string,
  ): Promise<{ prisma: PrismaClient; tenant: TenantDoc }> {
    try {
      const context = this.tenantContext.getContext();
      if (this.matchesWorkspaceTenant(context, microsoftTenantId)) {
        this.logger.log(
          `Workspace ${microsoftTenantId} already resolved in active context. Reusing Prisma instance from AsyncLocalStorage.`,
        );
        return { tenant: context.tenant, prisma: context.prisma };
      }

      this.logger.log(
        `Workspace ${microsoftTenantId} not found in active context. Attempting cache lookup for workspace -> tenant mapping.`,
      );
      const cachedId = await this.cache.getTenantIdByWorkspace(microsoftTenantId);
      if (cachedId) {
        this.logger.log(
          `Cache hit for workspace ${microsoftTenantId}. Resolving tenant ${cachedId} without hitting Firestore.`,
        );
        const tenant = await this.getTenantById(cachedId);
        const prisma = await this.getPrismaForTenant(tenant);
        return { tenant, prisma };
      }

      this.logger.log(
        `Cache miss for workspace ${microsoftTenantId}. Querying Firestore for tenant registration.`,
      );
      const snap = await this.firestore
        .collection('tenants')
        .where('microsoft.GRAPH_TENANT_ID', '==', microsoftTenantId)
        .limit(1)
        .get();
      if (snap.empty) {
        throw new Error(`Tenant workspace ${microsoftTenantId} not found`);
      }
      const doc = snap.docs[0];
      this.logger.log(
        `Firestore lookup for workspace ${microsoftTenantId} returned tenant ${doc.id}. Registering tenant in caches and secret vault.`,
      );
      const registered = await this.registerTenant({
        id: doc.id,
        ...(doc.data() as Omit<TenantDoc, 'id'>),
      });
      const prisma = await this.getPrismaForTenant(registered);
      this.logger.log(
        `Tenant ${registered.id} ready for workspace ${microsoftTenantId}. Prisma client pooled and cached.`,
      );
      return { tenant: registered, prisma };
    } catch (err) {
      this.logger.error(
        `Failed to get workspace by Microsoft tenant id ${microsoftTenantId}`,
        err as Error,
      );
      throw err;
    }
  }

  async getPrismaFor(input: ResolveInput): Promise<PrismaClient> {
    try {
      const context = this.tenantContext.getContext();
      if (context && this.matchesContextInput(context, input)) {
        return context.prisma;
      }

      if (input.tenantId) {
        const tenant = await this.getTenantById(input.tenantId);
        return await this.getPrismaForTenant(tenant);
      }
      if (input.userId) {
        const tenant = await this.getTenantByUserId(input.userId);
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
      const context = this.tenantContext.getContext();
      if (this.matchesWorkspaceTenant(context, workspaceTenantId)) {
        return { prisma: context.prisma, tenant: context.tenant };
      }

      return await this.getWorkspaceByMicrosoft(workspaceTenantId);
    } catch (err) {
      this.logger.error(
        `Failed to get Prisma by workspace tenant id ${workspaceTenantId}`,
        err as Error,
      );
      throw err;
    }
  }

  async withTenantContext<T>(input: ResolveInput, handler: () => Promise<T>): Promise<T> {
    const activeContext = this.tenantContext.getContext();
    if (activeContext && this.matchesContextInput(activeContext, input)) {
      return handler();
    }

    const snapshot = await this.resolveTenantContext(input);
    return this.tenantContext.runWithTenant(snapshot, handler);
  }

  async runWithWorkspaceContext<T>(
    workspaceTenantId: string,
    handler: TenantWorkspaceCallback<T>,
  ): Promise<T>;
  async runWithWorkspaceContext<T>(
    workspaceTenantId: string,
    handler: TenantWorkspaceHandler<T> | TenantWorkspaceCallback<T>,
    options: TenantWorkspaceRunnerOptions,
  ): Promise<T>;
  async runWithWorkspaceContext<T>(
    workspaceTenantId: string,
    handler: TenantWorkspaceHandler<T> | TenantWorkspaceCallback<T>,
    options?: TenantWorkspaceRunnerOptions,
  ): Promise<T> {
    if (!options && handler.length === 0) {
      return this.runWithWorkspaceContextInternal(workspaceTenantId, handler as TenantWorkspaceCallback<T>);
    }

    return TenantWorkspaceRunner.run(this, workspaceTenantId, handler, options);
  }

  createWorkspaceHandler<T>(
    handler: TenantWorkspaceHandler<T> | TenantWorkspaceCallback<T>,
  ): (workspaceTenantId: string) => Promise<T>;
  createWorkspaceHandler<T>(
    handler: TenantWorkspaceHandler<T> | TenantWorkspaceCallback<T>,
    options: TenantWorkspaceRunnerOptions,
  ): (workspaceTenantId: string) => Promise<T>;
  createWorkspaceHandler<T>(
    handler: TenantWorkspaceHandler<T> | TenantWorkspaceCallback<T>,
    options?: TenantWorkspaceRunnerOptions,
  ): (workspaceTenantId: string) => Promise<T> {
    return async (workspaceTenantId: string) => {
      if (!options && handler.length === 0) {
        return this.runWithWorkspaceContext(
          workspaceTenantId,
          handler as TenantWorkspaceCallback<T>,
        );
      }
      return TenantWorkspaceRunner.run(this, workspaceTenantId, handler, options);
    };
  }

  private async runWithWorkspaceContextInternal<T>(
    workspaceTenantId: string,
    handler: TenantWorkspaceCallback<T>,
  ): Promise<T> {
    const activeContext = this.tenantContext.getContext();
    if (this.matchesWorkspaceTenant(activeContext, workspaceTenantId)) {
      this.logger.log(
        `runWithWorkspaceContext: Reusing active context for workspace ${workspaceTenantId}.`,
      );
      return handler();
    }

    this.logger.log(
      `runWithWorkspaceContext: Resolving workspace ${workspaceTenantId} and creating scoped tenant context.`,
    );
    const { tenant, prisma } = await this.getWorkspaceByMicrosoft(workspaceTenantId);
    const snapshot = await this.createContextSnapshot(tenant, prisma, {
      source: 'workspaceTenantId',
      identifier: workspaceTenantId,
    });
    this.logger.log(
      `runWithWorkspaceContext: Context snapshot created for workspace ${workspaceTenantId}. Executing handler within scoped context.`,
    );
    return this.tenantContext.runWithTenant(snapshot, handler);
  }

  // Utils

  private async getPrismaForTenant(tenant: TenantDoc): Promise<PrismaClient> {
    return this.prismaPool.getClient(tenant.id, tenant.db);
  }

  private matchesWorkspaceTenant(
    context: TenantContextState | undefined,
    workspaceTenantId: string,
  ): context is TenantContextState {
    return context?.tenant.microsoft?.GRAPH_TENANT_ID === workspaceTenantId;
  }

  private matchesContextInput(context: TenantContextState, input: ResolveInput): boolean {
    if (input.tenantId) {
      return context.tenant.id === input.tenantId;
    }

    if (input.userId) {
      return (
        context.metadata.source === 'userId' && context.metadata.identifier === input.userId
      );
    }

    return false;
  }

  private async resolveTenantContext(input: ResolveInput): Promise<TenantContextSnapshot> {
    if (input.tenantId) {
      const tenant = await this.getTenantById(input.tenantId);
      const prisma = await this.getPrismaForTenant(tenant);
      return await this.createContextSnapshot(tenant, prisma, {
        source: 'tenantId',
        identifier: input.tenantId,
      });
    }

    if (input.userId) {
      const tenant = await this.getTenantByUserId(input.userId);
      const prisma = await this.getPrismaForTenant(tenant);
      return await this.createContextSnapshot(tenant, prisma, {
        source: 'userId',
        identifier: input.userId,
      });
    }

    throw new Error('tenantId or userId required');
  }

  private async createContextSnapshot(
    tenant: TenantDoc,
    prisma: PrismaClient,
    metadata: TenantContextMetadata,
  ): Promise<TenantContextSnapshot> {
    await this.ensureSecretBundle(tenant);
    const safeTenant = tenant.microsoft?.GRAPH_CLIENT_SECRET
      ? this.secretVault.sanitizeTenant(tenant)
      : (tenant as TenantContextSnapshot['tenant']);
    const secrets =
      this.secretVault.getSecrets(tenant.id) ?? (Object.freeze({}) as TenantSecretBundle);
    return { tenant: safeTenant, prisma, metadata, secrets };
  }

  private async fetchTenantById(tenantId: string): Promise<TenantDoc> {
    const doc = await this.firestore.collection('tenants').doc(tenantId).get();
    if (!doc.exists) {
      throw new Error(`Tenant ${tenantId} not found`);
    }
    return this.registerTenant({ id: doc.id, ...(doc.data() as Omit<TenantDoc, 'id'>) });
  }

  private async registerTenant(tenant: TenantDoc): Promise<TenantDoc> {
    this.secretVault.captureFromTenant(tenant);
    const sanitized = this.secretVault.sanitizeTenant(tenant);
    await this.cache.setTenant(sanitized);
    return sanitized as TenantDoc;
  }

  private async ensureSecretBundle(tenant: TenantDoc): Promise<void> {
    if (this.secretVault.getSecrets(tenant.id)) {
      return;
    }

    if (tenant.microsoft?.GRAPH_CLIENT_SECRET) {
      this.secretVault.captureFromTenant(tenant);
      return;
    }

    await this.fetchTenantById(tenant.id);
  }

  private async getTenantByUserId(userId: string): Promise<TenantDoc> {
    const context = this.tenantContext.getContext();
    if (context?.metadata.source === 'userId' && context.metadata.identifier === userId) {
      return context.tenant;
    }

    const snap = await this.firestore
      .collection('user_tenants')
      .where('userId', '==', userId)
      .where('active', '==', true)
      .limit(1)
      .get();
    const tenantId = snap.docs[0]?.data()?.tenantId as string | undefined;
    if (!tenantId) throw new Error(`Tenant for user ${userId} not found`);
    return this.getTenantById(tenantId);
  }
}
