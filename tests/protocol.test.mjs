import assert from 'node:assert/strict';
import test from 'node:test';

test('release manifest uses a stable marketplace-safe plugin id', async () => {
  const manifest = await import('../manifest.json', { with: { type: 'json' } });
  assert.equal(manifest.default.id, 'beav-connector');
  assert.equal(manifest.default.name, 'Beav Connector');
  assert.equal(manifest.default.isDesktopOnly, true);
});
