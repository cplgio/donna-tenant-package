// Dependencies
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type { Firestore } from 'firebase-admin/firestore';

// Services
import { TenantService } from './tenant.service';
import { TenantContextService } from './tenant-context.service';
import { TenantSecretVaultService } from './tenant-secret-vault.service';
import { TenantCacheService } from './tenant-cache.service';
import { PrismaPoolService } from './prisma-pool.service';

// Types
import type {
  TenantContextMetadata,
  TenantContextSnapshot,
  TenantDoc,
} from '../types';
import type { TenantWorkspaceRunnerOptions } from '../runtime/workspace-runner';

type TestLogger = NonNullable<TenantWorkspaceRunnerOptions['logger']>;

describe('TenantService.createWorkspaceHandler', () => {
  const workspaceTenantId = 'workspace-tenant';
  const prisma = {} as PrismaClient;
  const tenant: TenantDoc = {
    id: 'tenant-id',
    db: 'postgres://tenant',
    microsoft: {
      GRAPH_TENANT_ID: workspaceTenantId,
      GRAPH_CLIENT_ID: 'client-id',
      GRAPH_CLIENT_SECRET: 'secret-value',
    },
    qdrant: {
      QDRANT_URL: 'https://qdrant.local',
      QDRANT_API_KEY: 'qdrant-secret',
    },
  };

  let tenantService: TenantService;
  let tenantContext: TenantContextService;
  let secretVault: TenantSecretVaultService;
  let getWorkspaceInvocations: number;
  let capturedSecrets: TenantContextSnapshot['secrets'];

  const getSnapshotFactory = () =>
    (tenantService as unknown as {
      createContextSnapshot(
        tenantDoc: TenantDoc,
        tenantPrisma: PrismaClient,
        metadata: TenantContextMetadata,
      ): Promise<TenantContextSnapshot>;
    }).createContextSnapshot.bind(tenantService);

  const stubGetWorkspaceByMicrosoft = (implementation: () => Promise<{ tenant: TenantDoc; prisma: PrismaClient }>) => {
    (tenantService as unknown as {
      getWorkspaceByMicrosoft(
        microsoftTenantId: string,
      ): Promise<{ tenant: TenantDoc; prisma: PrismaClient }>;
    }).getWorkspaceByMicrosoft = async (microsoftTenantId: string) => {
      getWorkspaceInvocations += 1;
      assert.equal(microsoftTenantId, workspaceTenantId);
      return implementation();
    };
  };

  const createLogger = (): { logger: TestLogger; entries: Array<{ message: string; error: unknown }> } => {
    const entries: Array<{ message: string; error: unknown }> = [];
    const logger: TestLogger = {
      error: (message: any, stack?: any) => {
        entries.push({ message: String(message), error: stack });
      },
    };
    return { logger, entries };
  };

  beforeEach(() => {
    tenantContext = new TenantContextService();
    secretVault = new TenantSecretVaultService();
    tenantService = new TenantService(
      {} as unknown as Firestore,
      new TenantCacheService(),
      new PrismaPoolService(),
      secretVault,
      tenantContext,
    );
    getWorkspaceInvocations = 0;
    capturedSecrets = secretVault.captureFromTenant(tenant);
    stubGetWorkspaceByMicrosoft(async () => ({ tenant, prisma }));
  });

  it('reuses the active workspace context when already resolved', async () => {
    const createSnapshot = getSnapshotFactory();
    const snapshot = await createSnapshot(tenant, prisma, {
      source: 'workspaceTenantId',
      identifier: workspaceTenantId,
    });

    const handler = tenantService.createWorkspaceHandler(async () => {
      const context = tenantContext.getContext();
      assert.ok(context);
      return context.metadata.identifier;
    });

    const result = await tenantContext.runWithTenant(snapshot, async () =>
      handler(workspaceTenantId),
    );

    assert.equal(result, workspaceTenantId);
    assert.equal(getWorkspaceInvocations, 0);
  });

  it('propagates context preparation failures and logs with the provided message', async () => {
    const contextError = new Error('context failure');
    stubGetWorkspaceByMicrosoft(async () => {
      throw contextError;
    });
    const { logger, entries } = createLogger();

    const handler = tenantService.createWorkspaceHandler(async () => 'ok', {
      logger,
      contextErrorMessage: 'Unable to prepare context',
    });

    await assert.rejects(handler(workspaceTenantId), contextError);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.message, 'Unable to prepare context');
    assert.strictEqual(entries[0]?.error, contextError);
    assert.equal(tenantContext.isActive(), false);
  });

  it('logs handler failures and keeps the context clean', async () => {
    const handlerError = new Error('handler failure');
    const { logger, entries } = createLogger();

    const handler = tenantService.createWorkspaceHandler(async () => {
      throw handlerError;
    }, {
      logger,
      handlerErrorMessage: 'Handler execution failed',
    });

    await assert.rejects(handler(workspaceTenantId), handlerError);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.message, 'Handler execution failed');
    assert.strictEqual(entries[0]?.error, handlerError);
    assert.equal(tenantContext.isActive(), false);
  });

  it('provides handler bag accessors when requested', async () => {
    const handler = tenantService.createWorkspaceHandler(async ({
      getMetadata,
      getPrismaClient,
      getSecrets,
      getTenant,
    }) => {
      const tenantSnapshot = getTenant();
      assert.equal(tenantSnapshot.id, tenant.id);
      assert.equal(tenantSnapshot.microsoft?.GRAPH_TENANT_ID, workspaceTenantId);
      assert.ok(!('GRAPH_CLIENT_SECRET' in (tenantSnapshot.microsoft ?? {})));
      assert.equal(tenantSnapshot.qdrant?.QDRANT_URL, tenant.qdrant?.QDRANT_URL);
      assert.equal(tenantSnapshot.qdrant?.QDRANT_API_KEY, tenant.qdrant?.QDRANT_API_KEY);
      assert.strictEqual(getPrismaClient(), prisma);
      assert.deepEqual(getMetadata(), {
        source: 'workspaceTenantId',
        identifier: workspaceTenantId,
      });
      assert.strictEqual(getSecrets(), capturedSecrets);
      assert.ok(capturedSecrets.qdrant?.apiKey);
      return 'success';
    });

    const result = await handler(workspaceTenantId);
    assert.equal(result, 'success');
    assert.equal(getWorkspaceInvocations, 1);
  });
});
