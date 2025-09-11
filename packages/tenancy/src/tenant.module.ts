import { Global, Module } from '@nestjs/common';
import { TenantService } from './services/tenant.service';
import { TenantCacheService } from './services/tenant-cache.service';
import { PrismaPoolService } from './services/prisma-pool.service';

@Global()
@Module({
  providers: [TenantCacheService, PrismaPoolService, TenantService],
  exports: [TenantCacheService, PrismaPoolService, TenantService],
})
export class TenantModule {}
