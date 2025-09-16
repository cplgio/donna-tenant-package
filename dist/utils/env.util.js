"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrismaCacheMax = exports.getPrismaCacheTtlMs = exports.getTenantCacheTtlSeconds = void 0;
const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value ?? '', 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
};
// Utils
const getTenantCacheTtlSeconds = () => parsePositiveInteger(process.env.TENANT_CACHE_TTL_SECONDS, 3600);
exports.getTenantCacheTtlSeconds = getTenantCacheTtlSeconds;
const getPrismaCacheTtlMs = () => parsePositiveInteger(process.env.TENANT_PRISMA_CACHE_TTL_MS, 30 * 60 * 1000);
exports.getPrismaCacheTtlMs = getPrismaCacheTtlMs;
const getPrismaCacheMax = () => parsePositiveInteger(process.env.TENANT_PRISMA_CACHE_MAX, 20);
exports.getPrismaCacheMax = getPrismaCacheMax;
