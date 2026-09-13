import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import * as notify from '../src/index.js';

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
