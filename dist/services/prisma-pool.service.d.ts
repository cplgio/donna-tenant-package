import { PrismaClient } from '@prisma/client';
export declare class PrismaPoolService {
    private readonly logger;
    private readonly pool;
    getClient(key: string, url: string): Promise<PrismaClient>;
    private cleanupExpired;
    private enforceLimit;
}
