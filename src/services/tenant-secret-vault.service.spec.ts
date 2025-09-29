// Dependencies
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Services
import { TenantSecretVaultService } from './tenant-secret-vault.service';

// Types
import type { TenantDoc } from '../types';

describe('TenantSecretVaultService', () => {
  const baseTenant: TenantDoc = {
    id: 'tenant-id',
    db: 'postgres://tenant',
    microsoft: {
      GRAPH_TENANT_ID: 'workspace-tenant',
      GRAPH_CLIENT_ID: 'client-id',
      GRAPH_CLIENT_SECRET: 'graph-secret',
    },
    qdrant: {
      QDRANT_URL: 'https://qdrant.local',
      QDRANT_API_KEY: 'qdrant-secret',
    },
  };

  it('preserves microsoft secrets when capturing sanitized tenants', () => {
    const vault = new TenantSecretVaultService();
    const initialBundle = vault.captureFromTenant(baseTenant);

    assert.ok(initialBundle.microsoft?.clientSecret);
    assert.equal(typeof initialBundle.microsoft?.clientSecret.export, 'function');
    assert.strictEqual(
      initialBundle.microsoft?.clientSecret.export().toString('utf8'),
      baseTenant.microsoft!.GRAPH_CLIENT_SECRET,
    );

    assert.ok(initialBundle.qdrant?.apiKey);
    assert.equal(typeof initialBundle.qdrant?.apiKey.export, 'function');
    assert.strictEqual(
      initialBundle.qdrant?.apiKey.export().toString('utf8'),
      baseTenant.qdrant!.QDRANT_API_KEY,
    );

    const sanitizedTenant: TenantDoc = {
      ...baseTenant,
      microsoft: {
        GRAPH_TENANT_ID: baseTenant.microsoft!.GRAPH_TENANT_ID,
        GRAPH_CLIENT_ID: baseTenant.microsoft!.GRAPH_CLIENT_ID,
      },
      qdrant: {
        ...baseTenant.qdrant!,
      },
    };

    const recaptured = vault.captureFromTenant(sanitizedTenant);

    assert.strictEqual(recaptured.microsoft?.clientSecret, initialBundle.microsoft?.clientSecret);
    assert.ok(recaptured.qdrant?.apiKey);
    assert.strictEqual(
      recaptured.qdrant?.apiKey.export().toString('utf8'),
      baseTenant.qdrant!.QDRANT_API_KEY,
    );

    const stored = vault.getSecrets(baseTenant.id);
    assert.strictEqual(stored?.microsoft?.clientSecret, initialBundle.microsoft?.clientSecret);
    assert.ok(stored?.qdrant?.apiKey);
    assert.equal(typeof stored?.qdrant?.apiKey.export, 'function');
  });
});
