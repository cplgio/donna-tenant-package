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

### TenantCacheService
- `getTenant(tenantId: string): Promise<TenantDoc | null>`
- `setTenant(tenant: TenantDoc, ttlSeconds?: number): Promise<void>`
- `getTenantIdByWorkspace(workspaceTenantId: string): Promise<string | null>`
- `invalidateTenant(tenantId: string, workspaceTenantId?: string): Promise<void>`

### PrismaPoolService
- `getClient(key: string, url: string): PrismaClient`

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

