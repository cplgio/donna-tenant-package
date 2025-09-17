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

Um `schema.prisma` completo de referência está disponível em `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Users
model User {
  id          String  @id @default(uuid())
  email       String  @unique
  firebaseUid String? @unique
  name        String?

  givenName         String?
  surname           String?
  userPrincipalName String?

  jobTitle       String?
  department     String?
  officeLocation String?

  fileId String?

  active         Boolean      @default(false)
  follow         Boolean      @default(false)
  externalActive Boolean      @default(false)
  phone          String?      @unique
  threadId       String?
  firstAccess    Boolean      @default(false)
  provider       AuthProvider @default(local)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  // Relations
  photo          File?              @relation(fields: [fileId], references: [id])
  subscriptions  UserSubscription[]
  emails         Email[]
  chatHistory    ChatHistory[]
  Invite         Invite[]
  InviteAttendee InviteAttendee[]

  @@map("users")
}

enum AuthProvider {
  local
  google
  microsoft
}

model UserSubscription {
  id             String               @id @default(uuid())
  userId         String
  provider       SubscriptionProvider
  subscriptionId String?
  active         Boolean              @default(true)
  nextRenewalAt  DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, provider])
  @@map("user_subscriptions")
}

enum SubscriptionProvider {
  email
  teams
  calendar
  ondrive
}

// Files
model File {
  id        String @id @default(uuid())
  name      String
  extension String
  baseUrl   String
  folder    String
  file      String
  url       String @unique
  size      Int

  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  postId     String?
  User       User[]
  contractId String?
  Contract   Contract? @relation(fields: [contractId], references: [id])

  @@index([id, createdAt(sort: Desc)])
  @@map("files")
}

model Contract {
  id          String    @id @default(uuid())
  companyName String
  description String?
  website     String?
  startDate   DateTime
  endDate     DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  files File[]

  @@map("contracts")
}

enum FileType {
  IMAGE
  DOCUMENT
  VIDEO
}

// Emails
model Email {
  id               String    @id @default(uuid())
  emailIdExternal  String    @unique @map("email_id_external")
  userId           String?   @map("user_id")
  subject          String
  body             String
  from             String    @map("from_email")
  to               String[]  @map("to_emails")
  isRead           Boolean   @default(false) @map("is_read")
  isDraft          Boolean   @default(false) @map("is_draft")
  flagged          Boolean   @default(false)
  importance       String?
  threadId         String?   @map("thread_id")
  timestamp        DateTime? @map("timestamp")
  webLink          String?   @map("web_link")
  status           String    @default("open")
  tags             String[]  @default([])
  summary          String?
  needsReply       Boolean?  @map("needs_reply")
  type             String?
  cleanText        String?   @map("clean_text")
  detectedEntities String[]  @default([]) @map("detected_entities")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relação com User (opcional) com onDelete seguro
  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@map("emails")
}

// Chat history
model ChatHistory {
  id         String     @id @default(uuid())
  whatsappId String
  message    String
  timestamp  DateTime
  origin     ChatOrigin
  userId     String?
  user       User?      @relation(fields: [userId], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@map("chat_history")
}

enum ChatOrigin {
  user
  donna
}

// Invites
model Invite {
  id String @id @default(uuid())

  eventIdExternal String  @unique @map("event_id_external")
  iCalUId         String? @unique @map("ical_uid")

  // Básico do evento
  subject String
  status  InviteStatus @default(scheduled)

  start         DateTime
  end           DateTime
  startTimeZone String?  @map("start_tz")
  endTimeZone   String?  @map("end_tz")

  // Local/online
  locationName    String? @map("location_name")
  locationAddress String? @map("location_address")
  isOnlineMeeting Boolean @default(false) @map("is_online")
  joinUrl         String?
  webLink         String?

  // Extra info
  description String?

  // Organizador (pode ser interno ou externo)
  organizerUserId String? @map("organizer_user_id")
  organizerName   String? @map("organizer_name")
  organizerEmail  String? @map("organizer_email")
  organizer       User?   @relation(fields: [organizerUserId], references: [id], onDelete: SetNull)

  attendees InviteAttendee[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([start, end])
  @@index([organizerUserId])
  @@map("invites")
}

// Invite Attendees
model InviteAttendee {
  id String @id @default(uuid())

  inviteId String
  invite   Invite @relation(fields: [inviteId], references: [id], onDelete: Cascade)

  userId String?
  user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)

  name  String?
  email String?

  // Tipo e resposta
  type     InviteAttendeeType @default(required)
  response InviteResponse     @default(none)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([inviteId, email])
  @@index([inviteId])
  @@index([email])
  @@map("invite_attendees")
}

enum InviteStatus {
  scheduled
  updated
  cancelled
}

enum InviteAttendeeType {
  required
  optional
  resource
}

enum InviteResponse {
  none
  accepted
  declined
  tentative
  organizer
}
```

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

