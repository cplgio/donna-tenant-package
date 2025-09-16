const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
};

// Utils
export const getTenantCacheTtlSeconds = (): number =>
  parsePositiveInteger(process.env.TENANT_CACHE_TTL_SECONDS, 3600);

export const getPrismaCacheTtlMs = (): number =>
  parsePositiveInteger(process.env.TENANT_PRISMA_CACHE_TTL_MS, 30 * 60 * 1000);

export const getPrismaCacheMax = (): number =>
  parsePositiveInteger(process.env.TENANT_PRISMA_CACHE_MAX, 20);
