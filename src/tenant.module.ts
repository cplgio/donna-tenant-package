// Dependencies
import { Global, Module, Provider } from '@nestjs/common';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import Redis from 'ioredis';

// Services
import { TenantCacheService } from './services/tenant-cache.service';
import { PrismaPoolService } from './services/prisma-pool.service';
import { TenantService } from './services/tenant.service';

// Utils
import { FIRESTORE_PROVIDER, REDIS_PROVIDER } from './tenancy.constants';

type RedisClient = Redis | null;

const firestoreProvider: Provider = {
  provide: FIRESTORE_PROVIDER,
  useFactory: (): Firestore => {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firebase credentials are required for tenancy resolution.');
    }

    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    }

    return getFirestore();
  },
};

const redisProvider: Provider = {
  provide: REDIS_PROVIDER,
  useFactory: (): RedisClient => {
    const url = process.env.REDIS_URL;
    if (!url) {
      return null;
    }

    return new Redis(url, { lazyConnect: true });
  },
};

const tenantCacheProvider: Provider = {
  provide: TenantCacheService,
  useFactory: (redis: RedisClient): TenantCacheService =>
    new TenantCacheService(redis ?? undefined),
  inject: [REDIS_PROVIDER],
};

const prismaPoolProvider: Provider = {
  provide: PrismaPoolService,
  useFactory: (): PrismaPoolService => new PrismaPoolService(),
};

const tenantServiceProvider: Provider = {
  provide: TenantService,
  useFactory: (
    firestore: Firestore,
    cache: TenantCacheService,
    prismaPool: PrismaPoolService,
  ): TenantService => new TenantService(firestore, cache, prismaPool),
  inject: [FIRESTORE_PROVIDER, TenantCacheService, PrismaPoolService],
};

@Global()
@Module({
  providers: [
    firestoreProvider,
    redisProvider,
    tenantCacheProvider,
    prismaPoolProvider,
    tenantServiceProvider,
  ],
  exports: [TenantService, TenantCacheService, PrismaPoolService],
})
export class TenantModule {}
