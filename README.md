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

## Prisma Modules
`@donna/tenancy` expõe um módulo especializado para orquestrar conexões Prisma multi-tenant:

| Módulo/Serviço | Responsabilidade | Como usar |
| --- | --- | --- |
| `PrismaPoolService` | Gerencia pool de `PrismaClient` por tenant com TTL e política LRU. | Injetado automaticamente via `TenantModule`; pode ser utilizado diretamente quando for necessário obter um Prisma Client compartilhado chamando `getClient(tenantId, dbUrl)`. Geralmente é acessado indiretamente através do `TenantService`. |

## NestJS Module
### `TenantModule`
Registers all tenancy services (cache, Prisma pooling, context management, secret vault, workspace runner) as global providers so that any NestJS component can inject them.

## Services
### `TenantService`
Fachada principal que orquestra a resolução de locatários, o gerenciamento do pool de Prisma Clients, o isolamento de contexto e a execução de handlers multiworkspaces. Todas as funções são assíncronas e idempotentes sempre que possível.

| Função | Quando usar | Comportamento |
| --- | --- | --- |
| `getTenantById(tenantId: string): Promise<TenantDoc>` | Quando você já possui o `tenantId` e precisa recuperar o documento completo do Firestore ou dos caches. | Reutiliza o tenant ativo no contexto atual, faz lookup em cache de memória/Redis e, em último caso, consulta o Firestore e registra o tenant (incluindo secrets) antes de retornar. |
| `getTenantByWorkspaceId(workspaceTenantId: string): Promise<TenantDoc>` | Quando o identificador do workspace Microsoft é conhecido, mas você só precisa do tenant sanitizado. | Delegado de `getWorkspaceByMicrosoft`; retorna apenas o `TenantDoc` sanitizado após garantir caches e segredos. |
| `getWorkspaceByMicrosoft(microsoftTenantId: string): Promise<{ prisma: PrismaClient; tenant: TenantDoc }>` | Use ao preparar pipelines que exigem simultaneamente o tenant e um Prisma Client preparado para o banco configurado. | Reaproveita contexto ativo, consulta cache de mapeamento workspace→tenant, lê Firestore em caso de miss e registra o tenant e Prisma Client no pool antes de devolver ambos. |
| `getPrismaFor(input: ResolveInput): Promise<PrismaClient>` | Em fluxos que conhecem o `tenantId` ou `userId` e precisam apenas do Prisma Client associado. | Valida o contexto ativo, resolve o tenant (por ID ou usuário) e retorna um Prisma Client do pool compartilhado. Lança erro se nenhum identificador for informado. |
| `getPrismaByWorkspaceTenantId(workspaceTenantId: string): Promise<{ prisma: PrismaClient; tenant: TenantDoc }>` | Quando é necessário garantir tenant e Prisma Client para um workspace específico sem recriar contexto manualmente. | Reutiliza contexto ativo quando possível ou delega para `getWorkspaceByMicrosoft` com logs consistentes. |
| `withTenantContext<T>(input: ResolveInput, handler: () => Promise<T>): Promise<T>` | Utilize em pipelines que não dependem de workspaces, mas precisam executar blocos dentro de `AsyncLocalStorage` com o tenant correto. | Preserva o contexto existente que corresponda aos critérios informados; caso contrário, cria `TenantContextSnapshot` e executa o handler com `TenantContextService.runWithTenant`. |
| `runWithWorkspaceContext<T>(workspaceTenantId: string, handler: TenantWorkspaceHandler<T> \| TenantWorkspaceCallback<T>, options?: TenantWorkspaceRunnerOptions): Promise<T>` | Entrada recomendada para executar handlers voltados a workspaces (jobs, webhooks, filas). | Se o handler não espera contexto e nenhuma `options` é fornecida, usa um caminho otimizado interno; caso contrário, delega para `TenantWorkspaceRunner.run`, oferecendo logging configurável e reaproveitamento de contexto ativo. |
| `createWorkspaceHandler<T>(handler, options?): (workspaceTenantId: string) => Promise<T>` | Ideal para gerar funções reutilizáveis/injetáveis que encapsulam `runWithWorkspaceContext`. | Retorna função memoizada que aplica as mesmas regras de contexto/logging que `runWithWorkspaceContext`, permitindo armazená-la em serviços ou filas. |

> ℹ️ Métodos privados (por exemplo, `runWithWorkspaceContextInternal`, `resolveTenantContext`, `createContextSnapshot`, `getTenantByUserId`) são utilizados internamente para compor as operações públicas acima e não devem ser invocados externamente.

### `TenantCacheService`
Cache híbrido (memória + Redis opcional) para metadados de tenants e mapeamentos workspace→tenant.

| Função | Quando usar | Comportamento |
| --- | --- | --- |
| `getTenant(tenantId: string): Promise<TenantDoc \| null>` | Para recuperar rapidamente tenants sanitizados antes de consultar Firestore. | Verifica cache em memória e, se configurado, tenta Redis (`JSON.parse` do payload) com TTL configurável (`TENANT_CACHE_TTL_SECONDS`). |
| `setTenant(tenant: TenantDoc, ttlSeconds?: number): Promise<void>` | Após registrar/atualizar tenants, para manter caches consistentes. | Atualiza caches locais, grava Redis com TTL (default 1 hora) e indexa mapeamento `workspaceTenantId → tenantId` quando disponível. |
| `getTenantIdByWorkspace(workspaceTenantId: string): Promise<string \| null>` | Sempre que você possuir apenas o workspace Microsoft e precisar descobrir o `tenantId`. | Consulta cache de memória e, se necessário, Redis para obter e memorizar o relacionamento. |
| `invalidateTenant(tenantId: string, workspaceTenantId?: string): Promise<void>` | Para garantir que mudanças críticas em tenants não usem dados antigos. | Remove entradas em memória e Redis, tanto por tenant quanto por workspace (quando informado), falhando de forma tolerante com logs de warning. |

### `PrismaPoolService`
Serviço especializado que atua como "Prisma Module" desta biblioteca, concentrando a criação, reuso e descarte de `PrismaClient` por tenant.

| Função | Quando usar | Comportamento |
| --- | --- | --- |
| `getClient(key: string, url: string): Promise<PrismaClient>` | Sempre que um tenant precisa de conexão com banco de dados isolada (geralmente chamado via `TenantService`). | Limpa clientes expirados, reaproveita instância válida existente, cria novo cliente configurando `datasources.db.url` quando necessário e garante política LRU (`TENANT_PRISMA_CACHE_MAX`, `TENANT_PRISMA_CACHE_TTL_MS`). |

### `TenantContextService`
Wrapper de `AsyncLocalStorage` responsável por disponibilizar snapshot imutável do tenant durante a execução.

| Função | Quando usar | Comportamento |
| --- | --- | --- |
| `runWithTenant<T>(snapshot: TenantContextSnapshot, handler: () => Promise<T>): Promise<T>` | Para executar blocos de código garantindo acesso a tenant, Prisma, metadata e segredos via contexto. | Congela os dados recebidos, injeta-os no `AsyncLocalStorage` e executa o handler, logando erros não tratados antes de propagá-los. |
| `getContext(): TenantContextState \| undefined` | Ao inspecionar se existe contexto ativo (por exemplo, em interceptors). | Retorna snapshot imutável ou `undefined` quando não houver contexto vigente. |
| `isActive(): boolean` | Checagens rápidas para condicionar lógica baseada em contexto. | Retorna `true` quando `getContext()` possui valor. |
| `getTenant(): TenantSnapshot` | Em handlers que precisam do tenant sanitizado atualmente ativo. | Lança erro se nenhum contexto estiver disponível. |
| `getPrismaClient(): PrismaClient` | Quando for necessário acessar o Prisma Client associado ao contexto vigente. | Recupera o Prisma do snapshot, lançando erro se usado fora de contexto. |
| `getMetadata(): TenantContextMetadata` | Para obter informações sobre a origem do contexto (tenantId, userId, workspace, etc.). | Retorna o objeto imutável definido em `TenantContextSnapshot.metadata`. |
| `getSecrets(): TenantSecretBundle` | Quando for preciso acessar segredos capturados para o tenant corrente. | Retorna bundle congelado armazenado pelo `TenantSecretVaultService` ou lança erro se não houver contexto. |

### `TenantSecretVaultService`
Responsável por isolar informações sensíveis de cada tenant e fornecer snapshots seguros para o restante da aplicação.

| Função | Quando usar | Comportamento |
| --- | --- | --- |
| `sanitizeTenant(tenant: TenantDoc): TenantSnapshot` | Antes de compartilhar dados de tenant com consumidores que não devem ver segredos. | Remove `GRAPH_CLIENT_SECRET`, congela objetos internos e retorna um `TenantSnapshot` seguro. |
| `captureFromTenant(tenant: TenantDoc): TenantSecretBundle` | Ao registrar/atualizar tenants contendo secrets que precisam ser reutilizados. | Constrói `TenantSecretBundle` com `KeyObject` derivado do secret, armazena no vault interno e retorna a instância congelada. |
| `getSecrets(tenantId: string): TenantSecretBundle \| undefined` | Para recuperar secrets previamente capturados ao montar contexto ou executar integrações. | Busca no vault em memória e retorna bundle (imutável) ou `undefined` quando inexistente. |
| `clearSecrets(tenantId: string): void` | Quando um tenant é desativado/rotacionado e os secrets não devem permanecer em memória. | Remove a entrada correspondente no vault. |

### `TenantWorkspaceRunner`
Helper de runtime que pode ser usado fora do ecossistema NestJS (por exemplo, em scripts Node). Também está exposto como `runWithWorkspaceContext` via re-export.

| Função | Quando usar | Comportamento |
| --- | --- | --- |
| `TenantWorkspaceRunner.run<T>(tenantService, workspaceTenantId, handler, options?)` | Ao precisar executar handlers multitenant com controle explícito sobre dependências (útil em testes ou ambientes utilitários). | Localiza o runner interno de `TenantService`, garante acesso ao `TenantContextService` e executa o handler com criação/reuso de contexto, enriquecendo logs de erro com mensagens customizadas quando fornecidas. |
| `runWithWorkspaceContext` | Alias direto de `TenantWorkspaceRunner.run`. | Mesmo comportamento descrito acima. |

### `TenantModule`
Módulo global NestJS que disponibiliza todos os serviços acima via injeção de dependência. Inclui providers para Firestore, Redis (opcional) e para os serviços Prisma/Cache/Context/Vault/Tenant. Registre-o uma única vez no `AppModule` para evitar múltiplas inicializações do Firebase Admin SDK.

## Types
### Estruturas de tenant
| Type | Quando usar | Propriedades relevantes |
| --- | --- | --- |
| `TenantMicrosoftConfig` | Representar configuração Microsoft Graph de um tenant sempre que dados completos (incluindo secret opcional) forem necessários para autenticação OAuth. | `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET?`, `GRAPH_REDIRECT_URI?`, `GRAPH_SCOPE?`. |
| `TenantDoc` | Mapear o documento persistido no Firestore, normalmente retornado por `TenantService.getTenantById`/`getWorkspaceByMicrosoft`. | `id`, `db`, `name?`, `active?`, `microsoft?`. |
| `TenantSnapshot` | Compartilhar informações de tenant com segurança (sem secrets) entre handlers/contexto. | Mesmos campos de `TenantDoc`, mas com `microsoft` sem `GRAPH_CLIENT_SECRET`. |
| `TenantSecretBundle` | Armazenar de forma imutável secrets sensíveis capturados pelo `TenantSecretVaultService`. | `microsoft?.clientSecret` (`KeyObject`). |

### Resolução e contexto
| Type | Quando usar | Propriedades relevantes |
| --- | --- | --- |
| `ResolveInput` | Entrada aceita por `TenantService.withTenantContext` e `TenantService.getPrismaFor` para indicar como resolver o tenant. | `tenantId?`, `userId?`. |
| `TenantContextSource` | Controlar a origem do contexto ativo para fins de auditoria e depuração. | Valores literais: `'tenantId'`, `'userId'`, `'workspaceTenantId'`, `'microsoftTenantId'`. |
| `TenantContextMetadata` | Metadados imutáveis anexados ao snapshot de contexto para identificar quem originou a resolução. | `source: TenantContextSource`, `identifier: string`. |
| `TenantContextSnapshot` | Estrutura consumida por `TenantContextService.runWithTenant` ao inicializar um contexto. | `tenant: TenantSnapshot`, `prisma: PrismaClient`, `metadata: TenantContextMetadata`, `secrets: TenantSecretBundle`. |
| `TenantContextState` | Representação enriquecida armazenada no `AsyncLocalStorage`, disponibilizada pelos getters do `TenantContextService`. | Todos os campos de `TenantContextSnapshot` + `createdAt: Date`. |

### Workspace helper
| Type | Quando usar | Propriedades relevantes |
| --- | --- | --- |
| `TenantWorkspaceRunnerOptions` | Customizar mensagens e logging de `runWithWorkspaceContext`/`TenantWorkspaceRunner.run`. | `logger?: Pick<Logger, 'error'>`, `contextErrorMessage?`, `handlerErrorMessage?`. |
| `TenantWorkspaceHandlerContext` | Acessar `tenant`, `prisma`, `secrets` e `metadata` dentro de handlers que recebem contexto explícito. | Métodos: `getTenant()`, `getPrismaClient()`, `getSecrets()`, `getMetadata()`. |
| `TenantWorkspaceHandler<T>` | Declarar handlers que recebem o contexto explícito. | Assinatura: `(context: TenantWorkspaceHandlerContext) => Promise<T>`. |
| `TenantWorkspaceCallback<T>` | Declarar handlers que não precisam do contexto explícito, apenas executam lógica assíncrona. | Assinatura: `() => Promise<T>`. |

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
