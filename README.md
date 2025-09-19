# aDonna Tenancy

Este repositório contém o módulo `@donna/tenancy` — conhecido como **aDonna Tenancy** — utilizado para resolver tenants em aplicações NestJS com Prisma.

## Instalação

```bash
npm install @donna/tenancy firebase-admin ioredis @prisma/client
```

> O pacote já é publicado com builds ESM e CJS e definições de tipos. Após instalar as dependências acima (e as dependências do
> NestJS, como `@nestjs/common` e `@nestjs/core`), nenhuma etapa adicional de configuração ou build é necessária.

## Uso

```typescript
// AppModule
import { Module } from '@nestjs/common';
import { TenantModule } from '@donna/tenancy';

@Module({
  imports: [TenantModule],
})
export class AppModule {}
```

```typescript
// Service
import { Injectable } from '@nestjs/common';
import { TenantService } from '@donna/tenancy';

@Injectable()
export class ExampleService {
  constructor(private readonly tenantService: TenantService) {}

  async handle() {
    try {
      const prisma = await this.tenantService.getPrismaFor({ tenantId: 'abc' });
      // use prisma
    } catch (err) {
      // trate o erro conforme necessário
    }
  }
}
```

## Comportamento do sistema

1. **Cache de tenant**: o `TenantCacheService` tenta resolver o tenant primeiro em memória local e depois em Redis. Se não encontrar, busca no Firestore e salva em ambos os caches.
2. **Pool do Prisma**: o `PrismaPoolService` mantém um cliente Prisma por tenant com TTL e política LRU. Clientes expirados são desconectados automaticamente.
3. **Serviço principal**: o `TenantService` reúne cache, Firestore e pool Prisma para oferecer APIs simples de resolução de tenant.

## Conectando ao tenant correto

Use o `TenantService` para obter o `PrismaClient` já apontando para o banco do tenant desejado:

```typescript
const { prisma, tenant } = await tenantService.getWorkspaceByMicrosoft(workspaceTenantId);
const users = await prisma.user.findMany();
```

Também é possível resolver diretamente por `tenantId`:

```typescript
const prisma = await tenantService.getPrismaFor({ tenantId: 'abc' });
```

## Contexto de tenant por unidade de trabalho

O módulo fornece um `TenantContextService` baseado em `AsyncLocalStorage` que mantém o tenant ativo durante toda a unidade de trabalho (requisições HTTP, jobs de fila, crons). Isso evita a necessidade de repassar `tenantId` entre camadas e elimina `await` repetitivos para recuperar o mesmo `PrismaClient`.

```typescript
// Controller ou consumer do job
@Controller()
export class BillingController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly tenantContext: TenantContextService,
    // Service do domínio responsável pela cobrança
    private readonly billingService: BillingService,
  ) {}

  @Post(':tenantId/charge')
  async chargeTenant(@Param('tenantId') tenantId: string) {
    return this.tenantService.withTenantContext({ tenantId }, async () => {
      const prisma = this.tenantContext.getPrismaClient();
      const tenant = this.tenantContext.getTenant();

      // Toda a cadeia de chamadas abaixo reaproveita o mesmo contexto
      await this.billingService.charge(prisma, tenant);
      return { tenantId: tenant.id, chargedAt: new Date() };
    });
  }
}
```

### Comportamento do contexto

1. **Isolamento por escopo**: cada chamada de `withTenantContext` cria um armazenamento isolado. Handlers aninhados reutilizam o contexto ativo quando resolvem o mesmo tenant.
2. **Cache em camadas**: ao iniciar o contexto, o serviço reutiliza dados em memória, depois Redis e por fim Firestore, reduzindo I/O sempre que possível.
3. **Acesso seguro**: `TenantContextService` lança exceção caso seja utilizado fora de um escopo inicializado, evitando leituras inseguras ou de tenants incorretos.
4. **Tipagem forte**: as estruturas `TenantContextSnapshot` e `TenantContextMetadata` descrevem todo o ciclo do contexto, auxiliando no entendimento do fluxo.
5. **Segredos fora do tenant**: o contexto mantém apenas dados sanitizados do tenant. Segredos são materializados pelo `TenantSecretVaultService` em objetos `KeyObject` e ficam disponíveis via `tenantContext.getSecrets()`.

Durante o handler, injete apenas `TenantContextService` para recuperar `tenant`, `metadata`, `secrets` ou `PrismaClient` sem chamadas adicionais ao banco.

### Cofre de segredos do tenant

Quando o tenant é resolvido, o `TenantSecretVaultService` extrai todas as chaves sensíveis (por exemplo `GRAPH_CLIENT_SECRET`) e as armazena em memória utilizando `KeyObject` do Node.js. Dessa forma, os segredos nunca circulam como `string` na aplicação, reduzindo riscos de logs acidentais ou serialização indevida.

```typescript
// Service do domínio
@Injectable()
export class GraphService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async createAccessToken() {
    const { microsoft } = this.tenantContext.getSecrets();
    if (!microsoft) throw new Error('Tenant não possui configuração Microsoft.');

    const secretBuffer = microsoft.clientSecret.export();
    // use secretBuffer para assinar requisições ou gerar tokens
  }
}
```

> `TenantSecretVaultService` também pode ser injetado diretamente para acessar ou invalidar segredos fora do escopo do contexto (`getSecrets`, `clearSecrets`). Utilize esse recurso para rotacionar chaves com segurança após operações de gerenciamento.

Os segredos são renovados toda vez que o tenant é buscado do Firestore, garantindo alinhamento com rotações de credenciais e reduzindo o número de acessos diretos ao banco.

## Tratamento de erros

Todos os métodos do `TenantService` utilizam `try/catch` e registram logs detalhados. Ao consumir o serviço, envolva as chamadas em `try/catch` para capturar falhas de rede ou tenants inexistentes:

```typescript
try {
  const prisma = await tenantService.getPrismaFor({ tenantId: 'abc' });
  // ...
} catch (err) {
  // log ou reaja ao erro
}
```

## APIs

### TenantService
- `getTenantById(tenantId: string): Promise<TenantDoc>`
- `getTenantByWorkspaceId(workspaceTenantId: string): Promise<TenantDoc>`
- `getWorkspaceByMicrosoft(microsoftTenantId: string): Promise<{ prisma: PrismaClient; tenant: TenantDoc }>`
- `getPrismaFor(input: ResolveInput): Promise<PrismaClient>`
- `getPrismaByWorkspaceTenantId(workspaceTenantId: string): Promise<{ prisma: PrismaClient; tenant: TenantDoc }>`

> Os tenants retornados são sanitizados: nenhum método expõe `GRAPH_CLIENT_SECRET`. Utilize `TenantContextService.getSecrets()` ou `TenantSecretVaultService.getSecrets()` para acessar segredos quando necessário.

### TenantCacheService
- `getTenant(tenantId: string): Promise<TenantDoc | null>`
- `setTenant(tenant: TenantDoc, ttlSeconds?: number): Promise<void>`
- `getTenantIdByWorkspace(workspaceTenantId: string): Promise<string | null>`
- `invalidateTenant(tenantId: string, workspaceTenantId?: string): Promise<void>`

### PrismaPoolService
- `getClient(key: string, url: string): PrismaClient`

### TenantSecretVaultService
- `sanitizeTenant(tenant: TenantDoc): TenantSnapshot`
- `captureFromTenant(tenant: TenantDoc): TenantSecretBundle`
- `getSecrets(tenantId: string): TenantSecretBundle | undefined`
- `clearSecrets(tenantId: string): void`

## Prisma schema e migrations

O pacote não distribui models do Prisma. Cada microsserviço deve:

1. Definir seu próprio `schema.prisma` com os modelos necessários.
2. Executar `npx prisma generate` após editar o schema.
3. Para aplicar migrations em cada tenant, exporte `DATABASE_URL` apontando para o banco do tenant e rode `npx prisma migrate deploy` (ou `prisma db push` em desenvolvimento).

O campo `db` de `TenantDoc` deve conter a string de conexão de cada tenant. O `TenantService` usa essa URL para criar o `PrismaClient` correspondente.

Não instancie `PrismaClient` diretamente; sempre utilize o cliente retornado pelo `TenantService` para aproveitar o pool e o gerenciamento de conexões.

## Variáveis de Ambiente

| Nome | Descrição |
|------|-------------|
| `REDIS_URL` | URL do Redis para cache de tenants (opcional, recomenda-se Redis em produção) |
| `TENANT_CACHE_TTL_SECONDS` | TTL do cache de tenant (padrão 3600) |
| `TENANT_PRISMA_CACHE_TTL_MS` | TTL em ms para conexões Prisma (padrão 1800000) |
| `TENANT_PRISMA_CACHE_MAX` | Limite de conexões Prisma em cache (padrão 20) |
| `FIREBASE_PROJECT_ID` | ID do projeto Firebase |
| `FIREBASE_CLIENT_EMAIL` | Email do cliente Firebase |
| `FIREBASE_PRIVATE_KEY` | Chave privada do Firebase |

## Testes

```bash
npm run build
```

> O pipeline usa [`tsc`](https://www.typescriptlang.org/docs/) com projetos de build separados para gerar bundles ESM/CJS e declarações de tipos prontas para publicação.

