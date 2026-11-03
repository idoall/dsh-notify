import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import * as notify from '../src/index.js';
import * as client from '../src/client.js';

test('real Cordis loads the client and disposes both slot registrations exactly once', async () => {
  const context = new Context();
  const active = new Set();
  let cleaned = 0;
  context.provide('slots', {
    inject(_name, callback) { return callback(); },
    register({ name }) { active.add(name); return () => { active.delete(name); cleaned += 1; }; },
  });
  const fiber = context.plugin(client);
  try {
    await fiber;
    assert.equal(fiber.state, 2);
    assert.deepEqual([...active], ['settings.section', 'shell.overlay']);
  } finally {
    await fiber.dispose();
  }
  assert.equal(active.size, 0);
  assert.equal(cleaned, 2);
});

test('client disposer remains callable and idempotent without slots', () => {
  const dispose = client.apply({});
  assert.equal(typeof dispose, 'function');
  assert.equal(dispose.status.service, 'unavailable');
  dispose();
  dispose.destroy();
});

test('real Cordis rejects an async plugin resolving to an object but loads dsh-notify disposer', async (t) => {
  const invalidContext = new Context();
  const invalidFiber = invalidContext.plugin({ name: 'invalid-object-effect', async apply() { return { runtime: true }; } });
  await assert.rejects(Promise.resolve(invalidFiber), /Invalid effect/);

  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-notify-cordis-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const context = new Context(); const routes = new Set();
  context.provide('webServer', { register(route) { routes.add(route.path); return () => routes.delete(route.path); } });
  context.provide('connection', { requestRejection() { return undefined; } });
  const fiber = context.plugin(notify, { dataDir, pushAllowedSuffixes: [] });
  await fiber;
  assert.equal(fiber.state, 2); assert.equal(routes.has('/plugins/dsh-notify/health'), true);
  await fiber.dispose();
  assert.equal(fiber.state, 4); assert.equal(routes.size, 0);
});
