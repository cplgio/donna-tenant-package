// Dependencies
import type { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

// Services
import type { TenantService } from '../services/tenant.service';
import type { TenantContextService } from '../services/tenant-context.service';

// Types
import type {
  TenantContextMetadata,
  TenantSecretBundle,
  TenantSnapshot,
} from '../types';

// DTOs
export interface TenantWorkspaceRunnerOptions {
  logger?: Pick<Logger, 'error'>;
  contextErrorMessage?: string;
  handlerErrorMessage?: string;
}

// Utils
export interface TenantWorkspaceHandlerContext {
  getTenant(): TenantSnapshot;
  getPrismaClient(): PrismaClient;
  getSecrets(): TenantSecretBundle;
  getMetadata(): TenantContextMetadata;
}

export type TenantWorkspaceHandler<T> = (
  context: TenantWorkspaceHandlerContext,
) => Promise<T>;

export type TenantWorkspaceCallback<T> = () => Promise<T>;

interface TenantWorkspaceRunnerDeps {
  tenantService: TenantService;
  tenantContext: TenantContextService;
  workspaceTenantId: string;
  options?: TenantWorkspaceRunnerOptions;
}

type InternalWorkspaceRunner = <T>(
  workspaceTenantId: string,
  handler: TenantWorkspaceCallback<T>,
) => Promise<T>;

const DEFAULT_CONTEXT_ERROR = (workspaceTenantId: string) =>
  `Failed to prepare workspace context for ${workspaceTenantId}.`;
const DEFAULT_HANDLER_ERROR = (workspaceTenantId: string) =>
  `Failed to execute handler within workspace ${workspaceTenantId}.`;
const HANDLER_ERROR_MARKER = Symbol('TenantWorkspaceHandlerError');

interface HandlerErrorMarker {
  [HANDLER_ERROR_MARKER]?: boolean;
}

const getInternalRunner = (
  tenantService: TenantService,
): InternalWorkspaceRunner => {
  const accessor = tenantService as unknown as {
    runWithWorkspaceContextInternal?: InternalWorkspaceRunner;
  };
  if (!accessor.runWithWorkspaceContextInternal) {
    throw new Error('Workspace runner is not available on TenantService instance.');
  }
  return accessor.runWithWorkspaceContextInternal.bind(tenantService);
};

const getTenantContextService = (
  tenantService: TenantService,
): TenantContextService => {
  const accessor = tenantService as unknown as { tenantContext?: TenantContextService };
  if (!accessor.tenantContext) {
    throw new Error('TenantContextService is not available on TenantService instance.');
  }
  return accessor.tenantContext;
};

const expectsHandlerContext = <T>(
  handler: TenantWorkspaceHandler<T> | TenantWorkspaceCallback<T>,
): handler is TenantWorkspaceHandler<T> => handler.length > 0;

const createHandlerContext = (
  tenantContext: TenantContextService,
): TenantWorkspaceHandlerContext => ({
  getTenant: () => tenantContext.getTenant(),
  getPrismaClient: () => tenantContext.getPrismaClient(),
  getSecrets: () => tenantContext.getSecrets(),
  getMetadata: () => tenantContext.getMetadata(),
});

const executeHandler = async <T>(
  tenantContext: TenantContextService,
  handler: TenantWorkspaceHandler<T> | TenantWorkspaceCallback<T>,
): Promise<T> => {
  if (expectsHandlerContext(handler)) {
    return handler(createHandlerContext(tenantContext));
  }
  return (handler as TenantWorkspaceCallback<T>)();
};

const logError = (
  options: TenantWorkspaceRunnerOptions | undefined,
  message: string,
  error: unknown,
): void => {
  if (!options?.logger) {
    return;
  }
  options.logger.error(message, error as Error);
};

const runWithDependencies = async <T>(
  deps: TenantWorkspaceRunnerDeps,
  handler: TenantWorkspaceHandler<T> | TenantWorkspaceCallback<T>,
): Promise<T> => {
  const { tenantService, tenantContext, workspaceTenantId, options } = deps;
  const internalRunner = getInternalRunner(tenantService);
  const contextErrorMessage =
    options?.contextErrorMessage ?? DEFAULT_CONTEXT_ERROR(workspaceTenantId);
  const handlerErrorMessage =
    options?.handlerErrorMessage ?? DEFAULT_HANDLER_ERROR(workspaceTenantId);

  try {
    return await internalRunner(workspaceTenantId, async () => {
      try {
        return await executeHandler(tenantContext, handler);
      } catch (handlerError) {
        logError(options, handlerErrorMessage, handlerError);
        if (handlerError && typeof handlerError === 'object') {
          Object.defineProperty(handlerError as HandlerErrorMarker, HANDLER_ERROR_MARKER, {
            value: true,
            configurable: true,
          });
        }
        throw handlerError;
      }
    });
  } catch (contextError) {
    if (
      contextError &&
      typeof contextError === 'object' &&
      (contextError as HandlerErrorMarker)[HANDLER_ERROR_MARKER]
    ) {
      throw contextError;
    }
    logError(options, contextErrorMessage, contextError);
    throw contextError;
  }
};

export const TenantWorkspaceRunner = {
  async run<T>(
    tenantService: TenantService,
    workspaceTenantId: string,
    handler: TenantWorkspaceHandler<T> | TenantWorkspaceCallback<T>,
    options?: TenantWorkspaceRunnerOptions,
  ): Promise<T> {
    const tenantContext = getTenantContextService(tenantService);
    return runWithDependencies(
      {
        tenantService,
        tenantContext,
        workspaceTenantId,
        options,
      },
      handler,
    );
  },
};

export const runWithWorkspaceContext = TenantWorkspaceRunner.run;
