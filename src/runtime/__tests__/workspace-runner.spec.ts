// Dependencies
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

// Services
import { TenantWorkspaceRunner } from '../workspace-runner';
import type { TenantService } from '../../services/tenant.service';
import { TenantContextService } from '../../services/tenant-context.service';

// Types
import type {
  TenantContextSnapshot,
  TenantSecretBundle,
  TenantSnapshot,
} from '../../types';

// Utils
const createTenantContextSnapshot = (): TenantContextSnapshot => ({
  tenant: Object.freeze({
    id: 'tenant-1',
    db: 'postgres://example',
    microsoft: Object.freeze({ GRAPH_TENANT_ID: 'workspace-1' }),
  }) as TenantSnapshot,
  prisma: {} as PrismaClient,
  metadata: Object.freeze({
    source: 'workspaceTenantId',
    identifier: 'workspace-1',
  }),
  secrets: Object.freeze({}) as TenantSecretBundle,
});

const createTenantServiceStub = (
  tenantContext: TenantContextService,
  runner: <T>(handler: () => Promise<T>) => Promise<T>,
): TenantService => {
  const stub = {
    tenantContext,
    async runWithWorkspaceContextInternal<T>(
      workspaceTenantId: string,
      handler: () => Promise<T>,
    ) {
      void workspaceTenantId;
      return runner(handler);
    },
  } satisfies Partial<TenantService> & {
    tenantContext: TenantContextService;
    runWithWorkspaceContextInternal: <T>(
      workspaceTenantId: string,
      handler: () => Promise<T>,
    ) => Promise<T>;
  };

  return stub as unknown as TenantService;
};

describe('TenantWorkspaceRunner', () => {
  it('runs handler and returns value', async () => {
    const tenantContext = new TenantContextService();
    const snapshot = createTenantContextSnapshot();
    const baseRunnerMock = mock.fn(async (handler: () => Promise<unknown>) =>
      tenantContext.runWithTenant(snapshot, handler),
    );
    const baseRunner = function <T>(handler: () => Promise<T>): Promise<T> {
      return baseRunnerMock(handler) as Promise<T>;
    };
    const service = createTenantServiceStub(tenantContext, baseRunner);

    const result = await TenantWorkspaceRunner.run(service, 'workspace-1', async (context) => {
      assert.equal(context.getTenant().id, 'tenant-1');
      assert.equal(context.getMetadata().identifier, 'workspace-1');
      assert.equal(context.getPrismaClient(), snapshot.prisma);
      assert.equal(context.getSecrets(), snapshot.secrets);
      return 'ok';
    });

    assert.equal(result, 'ok');
    assert.equal(baseRunnerMock.mock.calls.length, 1);
  });

  it('logs and rethrows when handler fails', async () => {
    const tenantContext = new TenantContextService();
    const snapshot = createTenantContextSnapshot();
    const baseRunnerMock = mock.fn(async (handler: () => Promise<unknown>) =>
      tenantContext.runWithTenant(snapshot, handler),
    );
    const baseRunner = function <T>(handler: () => Promise<T>): Promise<T> {
      return baseRunnerMock(handler) as Promise<T>;
    };
    const service = createTenantServiceStub(tenantContext, baseRunner);
    const errorMock = mock.fn((message: unknown, error: unknown) => {
      void message;
      void error;
    });
    const logger: Pick<Logger, 'error'> = {
      error: errorMock as unknown as Logger['error'],
    };

    await assert.rejects(
      TenantWorkspaceRunner.run(
        service,
        'workspace-1',
        async () => {
          throw new Error('boom');
        },
        { logger },
      ),
      /boom/,
    );

    assert.ok(errorMock.mock.calls.length >= 1);
    const lastCall = errorMock.mock.calls[errorMock.mock.calls.length - 1];
    const [message, error] = lastCall.arguments as [unknown, unknown];
    assert.equal(message, 'Failed to execute handler within workspace workspace-1.');
    assert.equal((error as Error).message, 'boom');
  });

  it('logs and rethrows when context fails to resolve', async () => {
    const tenantContext = new TenantContextService();
    const baseRunnerMock = mock.fn(async (_handler: () => Promise<unknown>) => {
      throw new Error('context-error');
    });
    const baseRunner = function <T>(handler: () => Promise<T>): Promise<T> {
      return baseRunnerMock(handler) as Promise<T>;
    };
    const service = createTenantServiceStub(tenantContext, baseRunner);
    const errorMock = mock.fn((message: unknown, error: unknown) => {
      void message;
      void error;
    });
    const logger: Pick<Logger, 'error'> = {
      error: errorMock as unknown as Logger['error'],
    };

    await assert.rejects(
      TenantWorkspaceRunner.run(
        service,
        'workspace-1',
        async () => 'ok',
        { logger, contextErrorMessage: 'custom context failure' },
      ),
      /context-error/,
    );

    assert.ok(errorMock.mock.calls.length >= 1);
    const lastCall = errorMock.mock.calls[errorMock.mock.calls.length - 1];
    const [message, error] = lastCall.arguments as [unknown, unknown];
    assert.equal(message, 'custom context failure');
    assert.equal((error as Error).message, 'context-error');
  });

  it('reuses active context without creating a new one', async () => {
    const tenantContext = new TenantContextService();
    const snapshot = createTenantContextSnapshot();
    const reuseSpy = mock.fn(async (handler: () => Promise<unknown>) => handler());
    const baseRunnerMock = mock.fn(async (handler: () => Promise<unknown>) => {
      const active = tenantContext.getContext();
      if (active) {
        return reuseSpy(handler);
      }
      return tenantContext.runWithTenant(snapshot, handler);
    });
    const baseRunner = function <T>(handler: () => Promise<T>): Promise<T> {
      return baseRunnerMock(handler) as Promise<T>;
    };
    const service = createTenantServiceStub(tenantContext, baseRunner);

    const result = await tenantContext.runWithTenant(snapshot, () =>
      TenantWorkspaceRunner.run(service, 'workspace-1', async () => 'ok'),
    );

    assert.equal(result, 'ok');
    assert.equal(reuseSpy.mock.calls.length, 1);
  });
});
