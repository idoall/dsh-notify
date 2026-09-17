import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUFFER_LIMIT, createBuffer, createSettings } from '../src/buffer.js';

const record = (n, overrides = {}) => ({
  eventId: `event-${n}`,
  mergeKey: `turn:s:${n}`,
  kind: 'completed',
  sessionId: 's',
  title: `title ${n}`,
  body: '',
  at: n,
  phase: 'settled',
  ...overrides,
});

test('a page asks for everything after the sequence it already has', () => {
  const buffer = createBuffer();
  assert.deepEqual(buffer.pull(), { seq: 0, items: [] });

  buffer.push(record(1));
  buffer.push(record(2));
  const first = buffer.pull();
  assert.equal(first.seq, 2);
  assert.deepEqual(first.items.map((item) => item.eventId), ['event-1', 'event-2'], 'a page that never polled gets what the buffer holds');

  const caught = buffer.pull({ since: first.seq });
  assert.deepEqual(caught.items, [], 'and asking again from the same sequence delivers nothing twice');

  buffer.push(record(3));
  const next = buffer.pull({ since: caught.seq });
  assert.deepEqual(next.items.map((item) => item.eventId), ['event-3']);
  assert.equal(next.seq, 3);
});

test('the newest copy of a record replaces the older one, at the end of the queue', () => {
  const buffer = createBuffer();
  buffer.push(record(1));
  buffer.push(record(2));
  const before = buffer.pull();
  // The same interaction, asked and then decided: one record, one notification.
  buffer.push(record(1, { phase: 'settled', outcome: 'allowed-once' }));
  const after = buffer.pull({ since: before.seq });
  assert.deepEqual(after.items.map((item) => item.eventId), ['event-1'], 'the update is delivered as news');
  assert.equal(after.items[0].outcome, 'allowed-once');
  assert.equal(buffer.size, 2, 'and the superseded copy is not kept');
});

test('the buffer is a live tail: an overflow drops the oldest and forgets its identity', () => {
  const buffer = createBuffer({ limit: 3 });
  for (const n of [1, 2, 3, 4]) buffer.push(record(n));
  assert.equal(buffer.size, 3);
  const tail = buffer.pull();
  assert.deepEqual(tail.items.map((item) => item.eventId), ['event-2', 'event-3', 'event-4'], 'the oldest fell out of the window');
  assert.equal(tail.seq, 4);
  // Re-pushing the dropped record is a new record again, not a merge into a stale slot.
  buffer.push(record(2));
  assert.equal(buffer.size, 3);
  assert.deepEqual(buffer.pull().items.map((item) => item.eventId), ['event-3', 'event-4', 'event-2']);
});

test('a nonsense sequence cannot make the host lie about what it has', () => {
  const buffer = createBuffer();
  buffer.push(record(1));
  assert.deepEqual(buffer.pull({ since: -5 }).items.map((item) => item.eventId), ['event-1']);
  assert.deepEqual(buffer.pull({ since: Number.NaN }).items.map((item) => item.eventId), ['event-1']);
  // A sequence from a previous host process is ahead of this one: nothing is owed, and the page adopts ours.
  const future = buffer.pull({ since: 999 });
  assert.deepEqual(future.items, []);
  assert.equal(future.seq, 1);
  assert.equal(buffer.push(null), null, 'a record without a merge key is refused');
  assert.equal(BUFFER_LIMIT, 50);
});

test('preferences are the one thing that survives a restart, and a broken file is simply replaced', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-buffer-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const fresh = createSettings({ dataDir: dir });
  assert.deepEqual(fresh.get(), {});
  assert.deepEqual(fresh.status, { records: 'memory', preferences: 'file' });
  fresh.set({ sound: 'ping', toastPosition: 'viewport' });
  assert.deepEqual(fresh.get(), { sound: 'ping', toastPosition: 'viewport' });
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')), { sound: 'ping', toastPosition: 'viewport' });

  const reopened = createSettings({ dataDir: dir });
  assert.deepEqual(reopened.get(), { sound: 'ping', toastPosition: 'viewport' }, 'a restart keeps the users own choices');

  await writeFile(join(dir, 'settings.json'), '{ not json', 'utf8');
  const recovered = createSettings({ dataDir: dir });
  assert.deepEqual(recovered.get(), {}, 'a malformed file is not a crash, it is a fresh start');
  assert.deepEqual(recovered.set({ sound: 'alert' }), { sound: 'alert' });

  const session = createSettings({});
  assert.deepEqual(session.status, { records: 'memory', preferences: 'session' });
  session.set({ sound: 'chime' });
  assert.deepEqual(session.get(), { sound: 'chime' }, 'without a profile directory the setting still applies to this process');
  const relative = createSettings({ dataDir: 'profiles/web/data/dsh-notify' });
  assert.equal(relative.status.preferences, 'session', 'a relative path is never guessed into a profile');
});

test('a preferences file written by the store this replaced is unwrapped, not allowed to shadow it', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-buffer-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Exactly what the deleted store wrote: a {version, value} wrapper, plus a setting this version
  // does not have any more.
  await writeFile(join(dir, 'settings.json'), `${JSON.stringify({ version: 1, value: { sound: 'ping', toastPosition: 'viewport', readRetentionDays: 7 } }, null, 2)}\n`, 'utf8');
  const settings = createSettings({ dataDir: dir, keys: ['sound', 'toastPosition', 'subtaskNotify'] });
  assert.deepEqual(settings.get(), { sound: 'ping', toastPosition: 'viewport' }, 'the wrapper is transparent, and a key this version no longer has is dropped');

  settings.set({ subtaskNotify: true });
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')), { sound: 'ping', toastPosition: 'viewport', subtaskNotify: true }, 'and the next write flattens the file without the dead key');
  const reopened = createSettings({ dataDir: dir });
  assert.equal(reopened.get().sound, 'ping', 'a restart still finds what the user chose');
});
