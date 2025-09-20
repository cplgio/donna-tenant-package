# @donna/tenancy · Technical Reference

## Overview
`@donna/tenancy` centralises multi-tenant plumbing for aDonna services built with NestJS and Prisma. The package exposes a NestJS module, runtime helpers, caching utilities, and strongly typed services for resolving tenants, pooling Prisma clients, and managing execution context.

## Table of Contents
- [Installation](#installation)
- [Configuration](#configuration)
- [Runtime Helper](#runtime-helper)
- [Workspace handler factory](#workspace-handler-factory)
- [NestJS Module](#nestjs-module)
- [Services](#services)
  - [TenantService](#tenantservice)
  - [TenantCacheService](#tenantcacheservice)
  - [PrismaPoolService](#prismapoolservice)
  - [TenantContextService](#tenantcontextservice)
  - [TenantSecretVaultService](#tenantsecretvaultservice)
- [Types](#types)
  - [Tenant structures](#tenant-structures)
  - [Resolution and context](#resolution-and-context)
  - [Workspace helper](#workspace-helper)
- [Constants](#constants)
- [Development Scripts](#development-scripts)

## Installation
```bash
npm install @donna/tenancy
```

Register the provided module inside your NestJS root module to make every service available through dependency injection.

```ts
import { Module } from '@nestjs/common';
import { TenantModule } from '@donna/tenancy';

@Module({
  imports: [TenantModule],
})
export class AppModule {}
```

## Configuration
Set the following environment variables before bootstrapping your NestJS application.

| Variable | Required | Description |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | Yes | Firebase project identifier that stores tenant metadata. |
| `FIREBASE_CLIENT_EMAIL` | Yes | Service account client email used to authenticate with Firestore. |
| `FIREBASE_PRIVATE_KEY` | Yes | Base64 or escaped private key used by the service account; ensure `\n` characters are converted to new lines. |
| `REDIS_URL` | No | Connection URL for Redis caching. Leave unset to disable Redis-backed caching. |
| `TENANT_CACHE_TTL_SECONDS` | No | Time-to-live (seconds) applied when caching tenant documents. Defaults to `3600`. |
| `TENANT_PRISMA_CACHE_TTL_MS` | No | TTL (milliseconds) used by the Prisma client pool. Defaults to `1800000`. |
| `TENANT_PRISMA_CACHE_MAX` | No | Maximum number of pooled Prisma clients. Defaults to `20`. |

## Runtime Helper
`TenantWorkspaceRunner` exposes a single entry point, `runWithWorkspaceContext`, that executes asynchronous handlers inside a workspace-aware tenant context. The helper wraps `TenantService.runWithWorkspaceContext`, adds optional logging, and preserves existing context when one is already active.

### Signature
```ts
runWithWorkspaceContext<T>(
  tenantService: TenantService,
  workspaceTenantId: string,
  handler: TenantWorkspaceHandler<T> | TenantWorkspaceCallback<T>,
  options?: TenantWorkspaceRunnerOptions,
): Promise<T>
```

### Parameters
| Name | Description |
| --- | --- |
| `tenantService` | `TenantService` instance resolved through NestJS dependency injection. |
| `workspaceTenantId` | Microsoft tenant identifier of the workspace to resolve. |
| `handler` | Async callback executed inside the workspace context. Declare a parameter to receive `TenantWorkspaceHandlerContext` accessors (`getTenant`, `getPrismaClient`, `getSecrets`, `getMetadata`). |
| `options` | Optional logging configuration. |

### Options
| Property | Description |
| --- | --- |
| `logger` | Optional NestJS `Logger` (only the `error` method is used). When omitted, no helper-level error logs are emitted. |
| `contextErrorMessage` | Custom message logged when context preparation fails. Default: `Failed to prepare workspace context for <workspaceTenantId>.` |
| `handlerErrorMessage` | Custom message logged when the handler throws. Default: `Failed to execute handler within workspace <workspaceTenantId>.` |

### Behaviour
- Reuses an existing workspace context when one is already active within `AsyncLocalStorage`.
- Delegates to `TenantService.runWithWorkspaceContext` to resolve tenants, allocate Prisma clients, and run the handler inside `TenantContextService`.
- Logs helper-level errors only when a logger is provided.
- Rethrows both context and handler failures so applications remain responsible for retries and observability.

## Workspace handler factory
`TenantService.createWorkspaceHandler` builds reusable workspace-aware functions that forward to
`runWithWorkspaceContext`. The factory accepts the same handler signatures (with or without the
context accessor bag) and optional `TenantWorkspaceRunnerOptions`, returning an async function that
receives a workspace tenant identifier.

### Creating a handler
```ts
const processWorkspace = tenantService.createWorkspaceHandler(
  async ({ getTenant, getPrismaClient }) => {
    const tenant = getTenant();
    const prisma = getPrismaClient();
    // Handler logic scoped to the resolved workspace context.
  },
  {
    logger,
    contextErrorMessage: 'Workspace context could not be initialised.',
    handlerErrorMessage: 'Workspace handler execution failed.',
  },
);

await processWorkspace(workspaceTenantId);
```

### Behaviour
- Returns a memoised function that can be injected or stored in services for repeated use.
- Reuses any active workspace context before preparing a new one, matching
  `runWithWorkspaceContext` semantics.
- Supports both handler signatures: with access to the context bag or as a plain callback.
- Centralises logging and messaging through the provided `TenantWorkspaceRunnerOptions`.

## NestJS Module
### `TenantModule`
Registers all tenancy services (cache, Prisma pooling, context management, secret vault, workspace runner) as global providers so that any NestJS component can inject them.

## Services
### `TenantService`
Primary façade responsible for resolving tenants, pooling Prisma clients, creating execution contexts, and running workspace handlers.

| Member | Description |
| --- | --- |
| `getTenantById(tenantId: string): Promise<TenantDoc>` | Returns a tenant document using the active context, caches, and Firestore fallback. |
| `getTenantByWorkspaceId(workspaceTenantId: string): Promise<TenantDoc>` | Resolves the tenant registered for the provided workspace identifier. |
| `getWorkspaceByMicrosoft(microsoftTenantId: string): Promise<{ prisma: PrismaClient; tenant: TenantDoc }>` | Resolves the workspace, returning both the tenant document and a pooled Prisma client. |
| `getPrismaFor(input: ResolveInput): Promise<PrismaClient>` | Returns a Prisma client for a tenant resolved by `tenantId` or `userId`. |
| `getPrismaByWorkspaceTenantId(workspaceTenantId: string): Promise<{ prisma: PrismaClient; tenant: TenantDoc }>` | Retrieves a workspace context and exposes the Prisma client and tenant. |
| `withTenantContext<T>(input: ResolveInput, handler: () => Promise<T>): Promise<T>` | Ensures the handler runs inside a tenant context, creating one when required. |
| `runWithWorkspaceContext<T>(workspaceTenantId: string, handler: TenantWorkspaceHandler<T> \\| TenantWorkspaceCallback<T>, options?: TenantWorkspaceRunnerOptions): Promise<T>` | Executes the provided handler with optional logging while preserving reusable workspace state. |

### `TenantCacheService`
In-memory and optional Redis-backed cache for tenant metadata and workspace mappings.

| Member | Description |
| --- | --- |
| `getTenant(tenantId: string): Promise<TenantDoc \| null>` | Returns a tenant from memory or Redis caches. |
| `setTenant(tenant: TenantDoc, ttlSeconds?: number): Promise<void>` | Stores a tenant document in memory and Redis, caching workspace mappings when available. |
| `getTenantIdByWorkspace(workspaceTenantId: string): Promise<string \| null>` | Resolves the tenant identifier linked to a workspace. |
| `invalidateTenant(tenantId: string, workspaceTenantId?: string): Promise<void>` | Clears cached entries for the tenant and optional workspace mapping. |

### `PrismaPoolService`
Pools and reuses `PrismaClient` instances with TTL-based expiration and LRU eviction.

| Member | Description |
| --- | --- |
| `getClient(key: string, url: string): Promise<PrismaClient>` | Returns a pooled Prisma client for the supplied tenant database URL, creating a new instance when necessary. |

### `TenantContextService`
Wraps `AsyncLocalStorage` to expose tenant context within request handlers.

| Member | Description |
| --- | --- |
| `runWithTenant<T>(snapshot: TenantContextSnapshot, handler: () => Promise<T>): Promise<T>` | Creates an immutable context snapshot and executes the handler within it. |
| `getContext(): TenantContextState \| undefined` | Returns the currently active context if one exists. |
| `isActive(): boolean` | Indicates whether a context is active. |
| `getTenant(): TenantSnapshot` | Returns the tenant snapshot for the current scope. |
| `getPrismaClient(): PrismaClient` | Returns the Prisma client associated with the active context. |
| `getMetadata(): TenantContextMetadata` | Provides metadata describing the context origin. |
| `getSecrets(): TenantSecretBundle` | Returns the secret bundle captured for the tenant. |

### `TenantSecretVaultService`
Captures sensitive tenant fields, stores them securely, and exposes sanitised snapshots.

| Member | Description |
| --- | --- |
| `sanitizeTenant(tenant: TenantDoc): TenantSnapshot` | Returns an immutable tenant snapshot without secrets. |
| `captureFromTenant(tenant: TenantDoc): TenantSecretBundle` | Extracts sensitive values (for example, Microsoft client secret) and stores them in-memory. |
| `getSecrets(tenantId: string): TenantSecretBundle \| undefined` | Retrieves the cached secret bundle for the tenant. |
| `clearSecrets(tenantId: string): void` | Removes the tenant secret bundle from memory. |

## Types
### Tenant structures
| Type | Description | Key Properties |
| --- | --- | --- |
| `TenantMicrosoftConfig` | Microsoft tenant configuration used for authentication against Microsoft Graph. | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, optional `GRAPH_CLIENT_SECRET`, `GRAPH_REDIRECT_URI`, `GRAPH_SCOPE`. |
| `TenantDoc` | Full tenant document persisted in Firestore. | `id`, optional `name`, optional `active`, `db`, optional `microsoft`. |
| `TenantSnapshot` | Sanitised tenant document without secrets. | Matches `TenantDoc` but omits `GRAPH_CLIENT_SECRET` from the Microsoft configuration. |
| `TenantSecretBundle` | Immutable bundle of sensitive values captured from a tenant. | Optional `microsoft.clientSecret` as a Node `KeyObject`. |

### Resolution and context
| Type | Description | Key Properties |
| --- | --- | --- |
| `ResolveInput` | Criteria used to resolve a tenant context. | Optional `tenantId` or `userId`. |
| `TenantContextSource` | Literal union describing context origin. | `'tenantId'`, `'userId'`, `'workspaceTenantId'`, `'microsoftTenantId'`. |
| `TenantContextMetadata` | Immutable metadata stored inside the tenant context snapshot. | `source`, `identifier`. |
| `TenantContextSnapshot` | Data required to initialise a tenant context. | `tenant` (`TenantSnapshot`), `prisma` (`PrismaClient`), `metadata`, `secrets`. |
| `TenantContextState` | Runtime snapshot enriched with observability data. | Inherits `TenantContextSnapshot` plus `createdAt: Date`. |

### Workspace helper
| Type | Description | Key Properties |
| --- | --- | --- |
| `TenantWorkspaceRunnerOptions` | Optional configuration accepted by `runWithWorkspaceContext`. | `logger`, `contextErrorMessage`, `handlerErrorMessage`. |
| `TenantWorkspaceHandlerContext` | Accessor bag passed to workspace handlers that declare parameters. | `getTenant()`, `getPrismaClient()`, `getSecrets()`, `getMetadata()`. |
| `TenantWorkspaceHandler<T>` | Handler signature that receives the accessor bag. | `(context) => Promise<T>`. |
| `TenantWorkspaceCallback<T>` | Handler signature that does not require the accessor bag. | `() => Promise<T>`. |

## Constants
| Constant | Value | Purpose |
| --- | --- | --- |
| `FIRESTORE_PROVIDER` | `'TENANCY_FIRESTORE'` | Injection token used to expose the Firestore client. |
| `REDIS_PROVIDER` | `'TENANCY_REDIS'` | Injection token used to expose a Redis instance. |

## Development Scripts
| Command | Description |
| --- | --- |
| `npm run build` | Cleans the `dist` directory and builds both ESM and CJS bundles. |
| `npm run build:test` | Compiles TypeScript specs into `dist/test`. |
| `npm test` | Compiles tests and runs them with the Node.js test runner. |
