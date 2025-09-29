# @donna/tenancy · Guia Completo de Integração

## Visão Geral
`@donna/tenancy` centraliza toda a infraestrutura multi-tenant utilizada pelos serviços Donna construídos com **NestJS** e **Prisma**. O pacote disponibiliza um módulo NestJS global, serviços de resolução de tenant, gerenciamento de pools do Prisma, isolamento de contexto via `AsyncLocalStorage`, helpers para handlers de workspace e tipos fortemente tipados que simplificam a integração com filas, jobs, webhooks e APIs HTTP.

O objetivo deste guia é servir como um "read absurdo de detalhado" para equipes consumidoras. A documentação cobre:

- Configuração e variáveis de ambiente.
- Reutilização do `schema.prisma` publicado pelo pacote.
- Integração passo a passo em uma aplicação NestJS.
- Fluxos recomendados para requisições HTTP, consumidores de filas e scripts.
- Referência completa de todas as funções públicas expostas pelos serviços e helpers.
- Tipos importantes para tipar DTOs, providers e interceptors.

---

## Índice
1. [Instalação](#instalação)
2. [Configuração de ambiente](#configuração-de-ambiente)
3. [Prisma schema compartilhado](#prisma-schema-compartilhado)
4. [Quickstart NestJS](#quickstart-nestjs)
5. [Fluxos práticos](#fluxos-práticos)
6. [Referência de serviços](#referência-de-serviços)
   - [TenantService](#tenantservice)
   - [TenantCacheService](#tenantcacheservice)
   - [PrismaPoolService](#prismapoolservice)
   - [TenantContextService](#tenantcontextservice)
   - [TenantSecretVaultService](#tenantsecretvaultservice)
7. [Helpers de runtime](#helpers-de-runtime)
8. [Tipos exportados](#tipos-exportados)
9. [Tokens de injeção e constantes](#tokens-de-injeção-e-constantes)
10. [Boas práticas e troubleshooting](#boas-práticas-e-troubleshooting)
11. [Scripts de desenvolvimento](#scripts-de-desenvolvimento)

---

## Instalação
```bash
npm install @donna/tenancy
```

#### Metadados de emails

O modelo `Email` segue o schema abaixo, alinhado ao payload de metadados processado pelos consumidores:

| Campo | Tipo | Observações |
| --- | --- | --- |
| `summary` | `string` | Resumo conciso da mensagem. |
| `tags` | `string[]` | Lista de categorias para triagem. |
| `needsReply` | `boolean` | Indica se alguma ação é necessária. |
| `importance` | `high \| medium \| low` | Importância percebida. |
| `type` | `string` | Categoria geral da mensagem (ex.: `email`, `support`). |
| `threadId` | `string` | Identificador de thread para agrupamento. |
| `detectedEntities` | `string[]` | Entidades extraídas do conteúdo. |
| `sentiment` | `positive \| neutral \| negative` | Sentimento predominante detectado. |
| `notify` | `boolean` | Se o usuário deve ser notificado imediatamente. |
| `notifyTone` | `string` | `positive`, `negative` ou vazio. |
| `notifyReason` | `string` | Motivo da notificação. |
| `notifyMessage` | `string` | Mensagem pronta para o usuário. |
| `shouldEscalate` | `boolean` | Se deve ser escalado para análise avançada. |
| `isAutomated` | `boolean` | Define se foi gerado automaticamente. |

O pacote é compatível com **NestJS 9+** e **Prisma 5+**. Não é necessário instalar `firebase-admin`, `@prisma/client` ou `ioredis` manualmente, pois eles já são dependências do pacote.

---

## Configuração de ambiente
Antes de inicializar a aplicação NestJS, configure as variáveis de ambiente abaixo.

| Variável | Obrigatório? | Descrição |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | ✅ | Projeto Firebase que armazena os documentos de tenants.
| `FIREBASE_CLIENT_EMAIL` | ✅ | E-mail do service account utilizado para autenticação.
| `FIREBASE_PRIVATE_KEY` | ✅ | Chave privada do service account. Garanta que os `\n` sejam convertidos para quebras de linha reais.
| `REDIS_URL` | ⚙️ | URL de conexão do Redis utilizado como cache distribuído. Quando omitido, o cache funciona apenas em memória.
| `TENANT_CACHE_TTL_SECONDS` | ⚙️ | TTL (segundos) aplicado às entradas de tenant no cache. Default: `3600`.
| `TENANT_PRISMA_CACHE_TTL_MS` | ⚙️ | TTL (ms) para expirar conexões no pool de Prisma. Default: `1_800_000` (30 minutos).
| `TENANT_PRISMA_CACHE_MAX` | ⚙️ | Limite máximo de Prisma Clients ativos simultaneamente. Default: `20`.

> ℹ️ **Boas práticas**: carregue todas as variáveis usando um `ConfigModule` do NestJS e valide com `class-validator` ou `zod` antes de registrar o `TenantModule`.

---

## Prisma schema compartilhado
O pacote publica o schema oficial de dados Donna em `@donna/tenancy/prisma/schema.prisma`. Isso permite reaproveitar o mesmo schema em todas as APIs sem duplicação.

### Como utilizar
1. Remova o `schema.prisma` do seu projeto consumidor.
2. Atualize os scripts do `package.json` para apontar para o schema publicado:

```jsonc
// package.json da API
{
  "scripts": {
    "prisma:generate": "prisma generate --schema node_modules/@donna/tenancy/prisma/schema.prisma",
    "prisma:migrate": "prisma migrate deploy --schema node_modules/@donna/tenancy/prisma/schema.prisma"
  }
}
```

3. Opcionalmente, defina `PRISMA_SCHEMA_PATH` para simplificar a execução manual:

```bash
export PRISMA_SCHEMA_PATH=node_modules/@donna/tenancy/prisma/schema.prisma
npx prisma generate
```

> ✅ Os artefatos publicados incluem o diretório `prisma/`, garantindo que o schema esteja disponível em ambientes de CI/CD e builds Docker.

---

## Quickstart NestJS
A seguir um exemplo minimalista de como registrar o módulo e utilizar os serviços no contexto de uma API NestJS.

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { TenantModule } from '@donna/tenancy';

@Module({
  imports: [TenantModule],
})
export class AppModule {}
```

### Consumindo o serviço em um controller
```ts
// Services
import { Injectable } from '@nestjs/common';
import { TenantService } from '@donna/tenancy';

@Injectable()
export class WorkspaceReportService {
  constructor(private readonly tenantService: TenantService) {}

  async generate(workspaceTenantId: string) {
    return this.tenantService.runWithWorkspaceContext(
      workspaceTenantId,
      async ({ getPrismaClient }) => {
        const prisma = getPrismaClient();
        return prisma.report.findMany({ take: 50 });
      },
    );
  }
}
```

### Configurando Swagger e validação
Ao integrar o módulo de tenancy, continue seguindo o padrão NestJS de expor Swagger e aplicar `ValidationPipe`. O pacote não interfere nessas configurações.

---

## Fluxos práticos
### 1. Requisições HTTP autenticadas
1. Extraia `tenantId` ou `workspaceTenantId` do token/JWT.
2. Dentro do controller ou service, utilize `tenantService.withTenantContext({ tenantId }, handler)` ou `tenantService.runWithWorkspaceContext(workspaceTenantId, handler)`.
3. Todos os serviços injetados dentro do handler terão acesso aos getters de contexto (`getPrismaClient`, `getTenant`, etc.) via `TenantContextService`.

### 2. Consumidor de filas / workers
Para handlers reutilizáveis (RabbitMQ, BullMQ, etc.), prefira `tenantService.createWorkspaceHandler` ou construa uma função com `createWorkspacePayloadRunner` (helper manual). Exemplos completos estão na seção [Helpers de runtime](#helpers-de-runtime).

### 3. Scripts externos (Node puro)
Use o helper estático `TenantWorkspaceRunner.run` para executar handlers sem precisar do ecossistema NestJS completo. Injete `TenantService` a partir do módulo NestJS ou construa um contexto manualmente usando a factory do Nest.

### 4. Resolução por usuário
Quando apenas o `userId` está disponível, utilize `tenantService.withTenantContext({ userId }, handler)` ou `tenantService.getPrismaFor({ userId })`. O serviço faz lookup na coleção `user_tenants` e reaproveita contexto ativo quando existir.

#### Lookup por telefone
Para fluxos autenticados apenas pelo número de telefone, utilize `tenantService.withTenantContext({ userPhoneNumber }, handler)` ou `tenantService.getPrismaFor({ userPhoneNumber })`. O pacote consulta `user_tenants.phone` (considerando apenas registros `active: true`) para descobrir o tenant e propaga o contexto automaticamente.

---

## Referência de serviços
### `TenantService`
Fachada principal que orquestra caches, Prisma pool, cofre de segredos e isolamento de contexto.

| Método | Assinatura | Uso recomendado | Comportamento |
| --- | --- | --- | --- |
| `getTenantById` | `(tenantId: string) => Promise<TenantDoc>` | Quando o `tenantId` já é conhecido. | Reutiliza contexto ativo, consulta caches (memória/Redis) e, em último caso, Firestore. Garante captura de segredos antes de devolver o tenant.
| `getTenantByWorkspaceId` | `(workspaceTenantId: string) => Promise<TenantDoc>` | Quando o fluxo parte do tenant Microsoft (workspaces). | Delegado de `getWorkspaceByMicrosoft`, retornando o tenant sanitizado.
| `getWorkspaceByMicrosoft` | `(microsoftTenantId: string) => Promise<{ tenant: TenantDoc; prisma: PrismaClient }>` | Pipelines que precisam do tenant e de um Prisma Client configurado. | Reaproveita contexto ativo, tenta resolver via cache de workspace→tenant e, se necessário, consulta Firestore e registra tenant/Prisma.
| `getPrismaFor` | `(input: ResolveInput) => Promise<PrismaClient>` | Resolução genérica quando há `tenantId`, `userId` ou `userPhoneNumber`. | Reutiliza contexto ativo, resolve tenant (por ID, usuário ou telefone) e retorna Prisma do pool. Lança erro se nenhum identificador for informado.
| `getPrismaByWorkspaceTenantId` | `(workspaceTenantId: string) => Promise<{ tenant: TenantDoc; prisma: PrismaClient }>` | Quando é necessário garantir tenant e Prisma para um workspace específico sem lidar com contexto manualmente. | Reaproveita contexto ativo ou delega para `getWorkspaceByMicrosoft`.
| `withTenantContext` | `(input: ResolveInput, handler: () => Promise<T>) => Promise<T>` | Execução de blocos que exigem `tenantId`, `userId` ou `userPhoneNumber` mas não dependem de workspace. | Reaproveita contexto ativo compatível e, se necessário, cria `TenantContextSnapshot` via `TenantContextService`.
| `runWithWorkspaceContext` | `(workspaceTenantId: string, handler: TenantWorkspaceHandler<T> \| TenantWorkspaceCallback<T>, options?) => Promise<T>` | Entrada padrão para jobs, filas e webhooks que usam `workspaceTenantId`. | Utiliza caminho otimizado quando o handler não recebe contexto nem opções; caso contrário, delega para `TenantWorkspaceRunner` com suporte a logging customizado.
| `createWorkspaceHandler` | `(handler, options?) => (workspaceTenantId: string) => Promise<T>` | Gerar funções reutilizáveis/injetáveis que encapsulam `runWithWorkspaceContext`. | Retorna função memoizada que aplica as mesmas regras de contexto/logging.

#### Exemplo: consumidor de fila
```ts
// Services
import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { TenantService } from '@donna/tenancy';

@Injectable()
export class EmailCreateConsumer {
  private readonly logger = new Logger(EmailCreateConsumer.name);
  private readonly runner = this.tenantService.createWorkspaceHandler(
    async ({ getPrismaClient, getTenant }, payload: EmailCreateWorkspacePayload) => {
      const prisma = getPrismaClient();
      const tenant = getTenant();
      await prisma.email.upsert({
        where: { id: payload.id },
        create: {
          id: payload.id,
          tenantId: tenant.id,
          workspaceTenantId: payload.workspaceTenantId,
        },
        update: {},
      });
    },
    { logger: this.logger },
  );

  constructor(private readonly tenantService: TenantService) {}

  @RabbitSubscribe({
    exchange: 'graph.email',
    routingKey: 'graph.email.create',
    queue: 'graph.email.create',
  })
  async handle(rawPayload: unknown) {
    const payload = mapEmailCreateEvent(rawPayload);
    await this.runner(payload.workspaceTenantId, payload);
  }
}
```

### `TenantCacheService`
Cache híbrido (memória + Redis opcional) responsável por armazenar tenants sanitizados e o mapeamento workspace→tenant.

| Método | Assinatura | Descrição |
| --- | --- | --- |
| `getTenant` | `(tenantId: string) => Promise<TenantDoc \| null>` | Consulta cache em memória e Redis. Retorna `null` em caso de miss.
| `setTenant` | `(tenant: TenantDoc, ttlSeconds?: number) => Promise<void>` | Persiste o tenant sanitizado nos caches. TTL padrão: 1 hora.
| `getTenantIdByWorkspace` | `(workspaceTenantId: string) => Promise<string \| null>` | Recupera o `tenantId` associado a um workspace.
| `invalidateTenant` | `(tenantId: string, workspaceTenantId?: string) => Promise<void>` | Remove entradas de cache (memória e Redis). Tolerante a falhas no Redis.

### `PrismaPoolService`
Gerencia o pool de `PrismaClient` por tenant, aplicando TTL e estratégia LRU.

| Método | Assinatura | Descrição |
| --- | --- | --- |
| `getClient` | `(key: string, url: string) => Promise<PrismaClient>` | Reaproveita clientes válidos ou cria novos com `datasources.db.url` ajustado. Expira instâncias com base em TTL/limite configurados.

### `TenantContextService`
Wrapper de `AsyncLocalStorage` que armazena `TenantContextSnapshot` para disponibilizar dados imutáveis durante a execução.

| Método | Assinatura | Descrição |
| --- | --- | --- |
| `runWithTenant` | `(snapshot: TenantContextSnapshot, handler: () => Promise<T>) => Promise<T>` | Injeta o snapshot no `AsyncLocalStorage` e executa o handler.
| `getContext` | `() => TenantContextState \| undefined` | Retorna o contexto atual, quando houver.
| `isActive` | `() => boolean` | Indica se existe contexto ativo.
| `getTenant` | `() => TenantSnapshot` | Recupera o tenant sanitizado do contexto. Lança erro quando não há contexto.
| `getPrismaClient` | `() => PrismaClient` | Retorna o Prisma Client do contexto.
| `getMetadata` | `() => TenantContextMetadata` | Informa a origem (`tenantId`, `userId`, `workspaceTenantId`, etc.).
| `getSecrets` | `() => TenantSecretBundle` | Devolve bundle imutável de segredos capturados.

### `TenantSecretVaultService`
Cofre em memória que mantém secrets sensíveis fora do snapshot compartilhado.

| Método | Assinatura | Descrição |
| --- | --- | --- |
| `sanitizeTenant` | `(tenant: TenantDoc) => TenantSnapshot` | Remove `GRAPH_CLIENT_SECRET` e expõe o bloco de Qdrant conforme persistido (incluindo `QDRANT_API_KEY`, quando presente). Objetos internos são congelados.
| `captureFromTenant` | `(tenant: TenantDoc) => TenantSecretBundle` | Constrói bundle imutável com secrets Microsoft e Qdrant preservados como `string`.
| `getSecrets` | `(tenantId: string) => TenantSecretBundle \| undefined` | Recupera bundle previamente capturado.
| `clearSecrets` | `(tenantId: string) => void` | Remove segredos do cofre.

> ⚠️ **Importante**: como `TenantSnapshot.qdrant` preserva `QDRANT_API_KEY`, evite serializar snapshots sanitizados para logs ou respostas HTTP. Utilize DTOs específicos quando necessário.

---

## Helpers de runtime
### `TenantWorkspaceRunner`
Disponibiliza helpers para execução de handlers multi-tenant fora do NestJS.

| Função | Assinatura | Uso |
| --- | --- | --- |
| `TenantWorkspaceRunner.run` | `(tenantService: TenantService, workspaceTenantId: string, handler: TenantWorkspaceHandler<T> \| TenantWorkspaceCallback<T>, options?: TenantWorkspaceRunnerOptions) => Promise<T>` | Executa handler aplicando resolução de workspace, caching e logging customizável.
| `runWithWorkspaceContext` | Alias exposto diretamente pelo pacote. Assinatura idêntica a `TenantWorkspaceRunner.run`.

### `createWorkspacePayloadRunner` (helper opcional)
Exemplo de helper interno que encapsula payloads adicionais:

```ts
export function createWorkspacePayloadRunner<TPayload extends WorkspacePayload, TResult>(
  tenantService: TenantService,
  handler: (context: TenantWorkspaceHandlerContext, payload: TPayload) => Promise<TResult>,
  options?: TenantWorkspaceRunnerOptions | ((payload: TPayload) => TenantWorkspaceRunnerOptions | undefined),
): (payload: TPayload) => Promise<TResult> {
  return async (payload: TPayload) => {
    const resolvedOptions = typeof options === 'function' ? options(payload) : options;
    const wrappedHandler: TenantWorkspaceHandler<TResult> = (context) => handler(context, payload);
    return tenantService.runWithWorkspaceContext(
      payload.workspaceTenantId,
      wrappedHandler,
      resolvedOptions,
    );
  };
}
```

---

## Tipos exportados
| Tipo | Descrição |
| --- | --- |
| `TenantMicrosoftConfig` | Configuração do Microsoft Graph (`GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET?`, `GRAPH_REDIRECT_URI?`, `GRAPH_SCOPE?`). |
| `TenantQdrantConfig` | Configuração do Qdrant (`QDRANT_URL`, `QDRANT_API_KEY?`). |
| `TenantDoc` | Documento completo do tenant no Firestore (`id`, `db`, `name?`, `active?`, `microsoft?`, `qdrant?`). |
| `TenantSnapshot` | Versão sanitizada compartilhada no contexto (sem `GRAPH_CLIENT_SECRET`). O bloco `qdrant` mantém `QDRANT_API_KEY?`. |
| `TenantSecretBundle` | Secrets imutáveis (`microsoft?.clientSecret`, `qdrant?.apiKey`), ambos como `string`. |
| `ResolveInput` | Entrada aceita por `getPrismaFor`/`withTenantContext` (`tenantId?`, `userId?`, `userPhoneNumber?`). |
| `TenantContextSource` | Origem do contexto (`'tenantId' | 'userId' | 'userPhoneNumber' | 'workspaceTenantId' | 'microsoftTenantId'`). |
| `TenantContextMetadata` | Metadados (`source`, `identifier`). |
| `TenantContextSnapshot` | Estrutura utilizada para iniciar contextos (`tenant`, `prisma`, `metadata`, `secrets`). |
| `TenantContextState` | Snapshot enriquecido com `createdAt`. |
| `TenantWorkspaceRunnerOptions` | Configuração para runners (`logger?: Pick<Logger, 'error'>`, `contextErrorMessage?`, `handlerErrorMessage?`). |
| `TenantWorkspaceHandlerContext` | Bag de acessores (`getTenant`, `getPrismaClient`, `getSecrets`, `getMetadata`). |
| `TenantWorkspaceHandler<T>` | Handler que recebe contexto explícito. |
| `TenantWorkspaceCallback<T>` | Handler sem parâmetros (contexto implícito). |

---

## Tokens de injeção e constantes
| Constante | Valor | Uso |
| --- | --- | --- |
| `FIRESTORE_PROVIDER` | `'TENANCY_FIRESTORE'` | Token do NestJS para injetar o cliente Firestore configurado. |
| `REDIS_PROVIDER` | `'TENANCY_REDIS'` | Token para injetar o cliente Redis, quando configurado. |
| `TENANCY_PACKAGE_VERSION` | Semver do pacote (derivado do `package.json`). | Disponibiliza a versão compilada para expor em healthchecks/logs. |

---

## Boas práticas e troubleshooting
- **Validação de entrada**: utilize DTOs com `class-validator` nos seus controllers e converta `tenantId`/`workspaceTenantId` para string antes de repassar ao `TenantService`.
- **Observabilidade**: os serviços utilizam `Logger` do NestJS para logs críticos. Injete um logger nos runners quando precisar de mensagens específicas.
- **Rotação de segredos**: após atualizar secrets no Firestore, chame `tenantCacheService.invalidateTenant(tenantId)` para forçar recaptura.
- **Limpeza de contexto**: sempre execute operações sensíveis dentro de `withTenantContext`/`runWithWorkspaceContext` para garantir isolamento. Evite armazenar snapshots em variáveis globais.
- **Serialização**: nunca retorne `TenantSnapshot` diretamente em respostas HTTP se o bloco `qdrant` contiver `QDRANT_API_KEY`. Crie DTOs específicos e omita a chave.
- **Testes**: ao testar serviços, você pode mockar `TenantContextService` para injetar snapshots customizados ou usar `TenantWorkspaceRunner.run` com um `TenantService` real.

### Checklist de implantação
1. Configurar variáveis de ambiente obrigatórias (Firebase + banco de dados).
2. Atualizar scripts do Prisma para usar o schema compartilhado.
3. Registrar `TenantModule` no `AppModule`.
4. Criar interceptors/guards para extrair `tenantId`/`workspaceTenantId` das requisições.
5. Utilizar `withTenantContext` ou `runWithWorkspaceContext` em todos os serviços que acessam o Prisma.
6. Configurar Swagger e DTOs validados para documentar endpoints multi-tenant.
7. Monitorar logs de erro provenientes do `TenantService` para agir em falhas de resolução.

---

## Scripts de desenvolvimento
| Comando | Descrição |
| --- | --- |
| `npm run build` | Limpa `dist/` e compila os bundles ESM e CJS.
| `npm run build:test` | Compila os testes TypeScript para `dist/test`.
| `npm test` | Executa a suíte de testes com o Node.js test runner.

---

> 📚 Necessita de exemplos adicionais? Consulte os testes em `dist/test` após executar `npm run build:test` ou explore a pasta `src/` para entender a implementação completa dos serviços documentados acima.
