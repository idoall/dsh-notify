import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, CLIENT_COMPOSITION, clearNotificationHistory, createLocalSelfTestRecord, createToastTimer, layoutFor, mountNotifyClient, navigateNotificationRecord, pwaGuidance, prioritizedToastRecords, syncPull, toastPolicy } from '../src/client.js';

test('layout and persistent toast', () => { assert.equal(layoutFor({ width: 375, coarse: true }).hitTarget, 44); assert.equal(toastPolicy({ phase: 'open' }, { width: 375 }).persistent, true); });
test('toast timer pauses for pointer/focus semantics and resumes remaining duration', () => {
  let time = 0; let scheduled; let cleared = 0; let expired = 0;
  const timer = createToastTimer({ durationMs: 6000, now: () => time, setTimeoutFn: (fn, ms) => { scheduled = { fn, ms }; return 1; }, clearTimeoutFn: () => { cleared += 1; }, onExpire: () => expired += 1 });
  time = 2000; assert.equal(timer.pause(), 4000); assert.equal(cleared, 1); timer.resume(); assert.equal(scheduled.ms, 4000); scheduled.fn(); assert.equal(expired, 1); timer.destroy();
  const persistent = createToastTimer({ durationMs: null, setTimeoutFn: () => { throw new Error('must not schedule'); } }); assert.equal(persistent.remaining(), null); persistent.destroy();
});
test('PWA guidance distinguishes HTTPS, ordinary iOS Safari and standalone unverified state', () => {
  assert.equal(pwaGuidance({ ios: true, secure: false }).state, 'needs-https');
  assert.equal(pwaGuidance({ ios: true, secure: true, standalone: false }).state, 'needs-home-screen');
  assert.equal(pwaGuidance({ ios: true, secure: true, standalone: true }).state, 'unverified');
});
test('pull reports offline', async () => { const result = await syncPull(async () => { throw new Error('offline'); }); assert.equal(result.offline, true); });
test('client apply uses declared sidebar and settings slot lifecycles', () => {
  const keys = []; const removed = []; const sessions = {};
  const slots = { inject(key, callback) { keys.push(key); const dispose = callback(); return () => { removed.push(key); dispose?.(); }; }, register(options) { assert.equal(options.name, keys.at(-1)); if (options.name === 'sidebar.footer.action') assert.equal(options.inject().sessions, sessions); return () => {}; } };
  const mounted = apply({ slots, get(name) { return name === 'sessions' ? sessions : undefined; } });
  assert.deepEqual(keys, ['sidebar.footer.action', 'settings.section', 'shell.overlay']); assert.deepEqual(Object.values(mounted.status.seats), ['active', 'active', 'active']);
  mounted.destroy();
  assert.deepEqual(removed, ['shell.overlay', 'settings.section', 'sidebar.footer.action']);
});
test('client composition reports missing service and per-seat injection failures without DOM fallback', () => {
  const missing = mountNotifyClient(); assert.equal(missing.status.service, 'unavailable'); assert.deepEqual(missing.status.seats, {}); missing.destroy();
  const registrations = [];
  const partial = mountNotifyClient({ slots: { inject(name, callback) { if (name === 'settings.section') throw new Error('seat missing'); callback(); return () => {}; }, register(options) { registrations.push(options.name); return () => {}; } } });
  assert.deepEqual(CLIENT_COMPOSITION.modules, ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-settings-general']); assert.deepEqual(CLIENT_COMPOSITION.seats, ['sidebar.footer.action', 'settings.section', 'shell.overlay']);
  assert.equal(partial.status.seats['sidebar.footer.action'], 'active'); assert.equal(partial.status.seats['settings.section'], 'unavailable'); assert.equal(partial.status.seats['shell.overlay'], 'active'); assert.deepEqual(registrations, ['sidebar.footer.action', 'shell.overlay']); partial.destroy();
});
test('clear cancellation sends nothing, failure keeps local state, and success publishes epoch reset', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0; let reset;
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => ({ ok: true, reset: true, epoch: 7, cursor: 0, items: [] }) }; };
  assert.deepEqual(await clearNotificationHistory({ confirmed: false, onReset: () => { throw new Error('must not reset'); } }), { status: 'cancelled' }); assert.equal(calls, 0);
  globalThis.fetch = async () => { calls += 1; return { ok: false, status: 500 }; };
  await assert.rejects(() => clearNotificationHistory({ confirmed: true, onReset: () => { throw new Error('must not reset'); } }), (error) => error.status === 500); assert.equal(calls, 1);
  globalThis.fetch = async (_url, init) => { calls += 1; assert.deepEqual(JSON.parse(init.body), { confirm: true }); return { ok: true, json: async () => ({ ok: true, reset: true, epoch: 7, cursor: 0, items: [] }) }; };
  const result = await clearNotificationHistory({ confirmed: true, onReset: (value) => { reset = value; } }); assert.equal(result.status, 'cleared'); assert.deepEqual(reset, { ok: true, reset: true, epoch: 7, cursor: 0, items: [] });
});
test('own open interactions stay ahead of completion toasts without claiming official modal visibility', () => {
  const completed = { eventId: 'done', phase: 'settled' }; const approval = { eventId: 'ask', phase: 'open' };
  assert.deepEqual(prioritizedToastRecords([completed, approval]), [approval]); assert.deepEqual(prioritizedToastRecords([completed]), [completed]);
});





test('notification navigation requires an authoritative listed binding and current selection before ack', async () => {
  const record = { eventId: 'event-1', sessionId: 'session-1' }; let acks = 0; let opens = 0;
  const missing = { binding: () => undefined, open: () => { opens += 1; }, list: { getSnapshot: () => ({ current: undefined }) } };
  assert.equal((await navigateNotificationRecord(record, { sessions: missing, acknowledge: async () => { acks += 1; } })).status, 'navigation-failed'); assert.equal(opens, 0); assert.equal(acks, 0);
  const throws = { binding: () => ({}), open: () => { throw new Error('unknown'); }, list: { getSnapshot: () => ({ current: undefined }) } };
  assert.equal((await navigateNotificationRecord(record, { sessions: throws, acknowledge: async () => { acks += 1; } })).status, 'failed'); assert.equal(acks, 0);
  const refused = { binding: () => ({}), open: () => false, list: { getSnapshot: () => ({ current: 'other' }) } };
  assert.equal((await navigateNotificationRecord(record, { sessions: refused, acknowledge: async () => { acks += 1; } })).status, 'navigation-failed'); assert.equal(acks, 0);
  const order = []; const success = { binding: () => ({}), open: () => { order.push('open'); }, list: { getSnapshot: () => ({ current: 'session-1' }) } };
  assert.equal((await navigateNotificationRecord(record, { sessions: success, acknowledge: async () => { order.push('ack'); acks += 1; } })).status, 'acknowledged'); assert.deepEqual(order, ['open', 'ack']); assert.equal(acks, 1);
  const ackError = await navigateNotificationRecord(record, { sessions: success, acknowledge: async () => { throw new Error('HTTP 500'); } }); assert.equal(ackError.status, 'failed');
});

