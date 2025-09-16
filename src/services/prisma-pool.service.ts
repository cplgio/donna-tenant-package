import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { getPrismaCacheMax, getPrismaCacheTtlMs } from '../utils/env.util';

interface PoolEntry {
  prisma: PrismaClient;
  expiresAt: number;
  lastUsed: number;
}

@Injectable()
export class PrismaPoolService {
  private readonly logger = new Logger(PrismaPoolService.name);
  private readonly pool = new Map<string, PoolEntry>();
  // Services
  async getClient(key: string, url: string): Promise<PrismaClient> {
    await this.cleanupExpired();
    const now = Date.now();
    const existing = this.pool.get(key);
    if (existing && existing.expiresAt > now) {
      existing.lastUsed = now;
      return existing.prisma;
    }
    if (existing) {
      try {
        await existing.prisma.$disconnect();
      } catch (err) {
        this.logger.warn(`Failed to disconnect stale Prisma client for ${key}`, err as Error);
      }
      this.pool.delete(key);
    }
    try {
      const ttlMs = getPrismaCacheTtlMs();
      const cacheLimit = getPrismaCacheMax();
      const prisma = new PrismaClient({ datasources: { db: { url } } });
      const entry: PoolEntry = {
        prisma,
        expiresAt: now + ttlMs,
        lastUsed: now,
      };
      this.pool.set(key, entry);
      await this.enforceLimit(cacheLimit);
      return prisma;
    } catch (err) {
      this.logger.error(`Failed to create Prisma client for ${key}`, err as Error);
      throw err;
    }
  }

  // Utils
  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.pool.entries()) {
      if (entry.expiresAt <= now) {
        try {
          await entry.prisma.$disconnect();
        } catch (err) {
          this.logger.warn(`Failed to disconnect expired Prisma client for ${key}`, err as Error);
        }
        this.pool.delete(key);
      }
    }
  }

  private async enforceLimit(cacheLimit: number): Promise<void> {
    if (this.pool.size <= cacheLimit) return;
    let lruKey: string | null = null;
    let lruTime = Infinity;
    for (const [key, entry] of this.pool.entries()) {
      if (entry.lastUsed < lruTime) {
        lruKey = key;
        lruTime = entry.lastUsed;
      }
    }
    if (lruKey) {
      const entry = this.pool.get(lruKey);
      if (entry) {
        try {
          await entry.prisma.$disconnect();
        } catch (err) {
          this.logger.warn(`Failed to disconnect LRU Prisma client for ${lruKey}`, err as Error);
        }
      }
      this.pool.delete(lruKey);
    }
  }
}

