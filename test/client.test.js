import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, CLIENT_COMPOSITION, layoutFor, mountNotifyClient, navigateNotificationRecord } from '../src/client.js';

test('narrow layout keeps a coarse-pointer hit target', () => {
  assert.equal(layoutFor({ width: 375, coarse: true }).hitTarget, 44);
  assert.equal(layoutFor({ width: 1024 }).narrow, false);
});
test('client apply wires exactly the settings section and the toast overlay', () => {
  const keys = []; const removed = []; const sessions = {};
  const slots = { inject(key, callback) { keys.push(key); const dispose = callback(); return () => { removed.push(key); dispose?.(); }; }, register(options) { assert.equal(options.name, keys.at(-1)); if (options.name === 'settings.section') assert.equal(options.inject().sessions, sessions); return () => {}; } };
  const mounted = apply({ slots, get(name) { return name === 'sessions' ? sessions : undefined; } });
  assert.deepEqual(keys, ['settings.section', 'shell.overlay']);
  assert.deepEqual(Object.values(mounted.status.seats), ['active', 'active']);
  mounted.destroy();
  assert.deepEqual(removed, ['shell.overlay', 'settings.section']);
});
test('client composition reports missing services and per-seat failures without DOM fallback', () => {
  const missing = mountNotifyClient(); assert.equal(missing.status.service, 'unavailable'); assert.deepEqual(missing.status.seats, {}); missing.destroy();
  const registrations = [];
  const partial = mountNotifyClient({ slots: { inject(name, callback) { if (name === 'settings.section') throw new Error('seat missing'); callback(); return () => {}; }, register(options) { registrations.push(options.name); return () => {}; } } });
  assert.deepEqual(CLIENT_COMPOSITION.modules, ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-settings-general']);
  assert.deepEqual(CLIENT_COMPOSITION.seats, ['settings.section', 'shell.overlay']);
  assert.equal(partial.status.seats['settings.section'], 'unavailable');
  assert.equal(partial.status.seats['shell.overlay'], 'active');
  assert.deepEqual(registrations, ['shell.overlay']); partial.destroy();
});
test('notification navigation requires a listed binding and the session it actually opened', async () => {
  const record = { eventId: 'event-1', sessionId: 'session-1' }; let opens = 0;
  const missing = { binding: () => undefined, open: () => { opens += 1; }, list: { getSnapshot: () => ({ current: undefined }) } };
  assert.equal((await navigateNotificationRecord(record, { sessions: missing })).status, 'navigation-failed'); assert.equal(opens, 0);
  const throws = { binding: () => ({}), open: () => { throw new Error('unknown'); }, list: { getSnapshot: () => ({ current: undefined }) } };
  assert.equal((await navigateNotificationRecord(record, { sessions: throws })).status, 'failed');
  const refused = { binding: () => ({}), open: () => false, list: { getSnapshot: () => ({ current: 'other' }) } };
  assert.equal((await navigateNotificationRecord(record, { sessions: refused })).status, 'navigation-failed');
  const success = { binding: () => ({}), open: () => {}, list: { getSnapshot: () => ({ current: 'session-1' }) } };
  assert.equal((await navigateNotificationRecord(record, { sessions: success })).status, 'acknowledged');
});
test('a record with nowhere to go is still dismissible, but a real navigation failure is reported', async () => {
  const gone = { eventId: 'event-gone', sessionId: 'session-deleted' };
  const sessions = { binding: () => ({}), open: () => {}, list: { getSnapshot: () => ({ current: 'session-deleted', byId: {} }) } };
  assert.equal((await navigateNotificationRecord(gone, { sessions })).status, 'acknowledged-without-session');
  assert.equal((await navigateNotificationRecord({ eventId: 'x', sessionId: 'not a session id' }, { sessions })).status, 'acknowledged-without-session');
});
