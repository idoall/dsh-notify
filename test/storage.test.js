import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, STORAGE_LIMITS } from '../src/storage.js';

async function tempStore(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-storage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store: await createStore({ dataDir: dir }) };
}

const record = (n, overrides = {}) => ({
  eventId: `event-${n}`,
  mergeKey: `turn:s:${n}`,
  kind: 'completed',
  title: `title ${n}`,
  body: `body ${n}`,
  at: n,
  unread: true,
  phase: 'settled',
  ...overrides,
});

test('missing or relative dataDir disables persistence without guessing a profile', async () => {
  const missing = await createStore();
  const relative = await createStore({ dataDir: 'profiles/web/data/dsh-notify' });
  assert.equal(missing.enabled, false);
  assert.equal(missing.status.persist, 'disabled');
  assert.equal(relative.enabled, false);
  assert.match(relative.status.reason, /absolute/);
  assert.deepEqual(missing.pull(), { epoch: 1, cursor: 0, items: [], reset: true });
});

test('records and settings reopen from an explicit storage directory', async (t) => {
  const { dir, store } = await tempStore(t);
  const first = await store.putRecord(record(1));
  await store.ack(first.eventId);
  await store.setSettings({ soundEnabled: true, sound: 'ping' });

  const epoch = store.epoch;
  const cursor = store.cursor;
  const reopened = await createStore({ dataDir: dir });
  assert.equal(reopened.status.persist, 'ok');
  assert.equal(reopened.epoch, epoch);
  assert.equal(reopened.cursor, cursor);
  assert.equal(reopened.getRecords()[0].unread, false);
  assert.deepEqual(reopened.getSettings(), { soundEnabled: true, sound: 'ping' });
  assert.equal(reopened.pull({ epoch, cursor: 0 }).reset, false);
  assert.equal(reopened.pull({ epoch, cursor: 0 }).items.at(-1).unread, false);
  assert.deepEqual((await readdir(dir)).sort(), ['records.json', 'self-test.json', 'settings.json']);
  assert.equal(JSON.parse(await readFile(join(dir, 'records.json'), 'utf8')).version, 1);
});

test('corrupt document recovers defaults, advances epoch and forces stale clients to reset', async (t) => {
  const { dir, store } = await tempStore(t);
  await store.putRecord(record(1));
  await store.setSettings({ soundEnabled: true });
  const oldEpoch = store.epoch;
  await writeFile(join(dir, 'settings.json'), '{broken', 'utf8');

  const recovered = await createStore({ dataDir: dir });
  assert.equal(recovered.status.persist, 'recovered');
  assert.deepEqual(recovered.status.recovered, ['settings.json']);
  assert.ok(recovered.epoch > oldEpoch);
  assert.deepEqual(recovered.getSettings(), {});
  assert.equal(recovered.getRecords().length, 1);
  const pull = recovered.pull({ epoch: oldEpoch, cursor: store.cursor });
  assert.equal(pull.reset, true);
  assert.equal(pull.items.length, 1);
  const reopened = await createStore({ dataDir: dir });
  assert.equal(reopened.epoch, recovered.epoch);
  assert.equal(reopened.status.persist, 'ok');
});

test('deep schemas reject legal-JSON wrong types, duplicate identities and invalid change cursors with epoch reset', async (t) => {
  const cases = [
    { name: 'records.json', document: { version: 1, epoch: 2, cursor: 0, records: [{ ...record(1), unread: 'yes' }], changes: [], evictedOpen: 0 } },
    { name: 'records.json', document: { version: 1, epoch: 2, cursor: 0, records: [record(1), record(2, { eventId: 'event-1' })], changes: [], evictedOpen: 0 } },
    { name: 'records.json', document: { version: 1, epoch: 2, cursor: 0, records: [record(1), record(2, { mergeKey: 'turn:s:1' })], changes: [], evictedOpen: 0 } },
    { name: 'records.json', document: { version: 1, epoch: 2, cursor: 3, records: [record(1)], changes: [{ cursor: 2, record: record(1) }, { cursor: 1, record: record(1) }], evictedOpen: 0 } },
    { name: 'records.json', document: { version: 1, epoch: 2, cursor: 3, records: [record(1)], changes: [{ cursor: 2, record: record(1) }], evictedOpen: 0 } },
    { name: 'records.json', document: { version: 1, epoch: 2, cursor: 1, records: [record(1)], changes: [{ cursor: 1, record: record(2) }], evictedOpen: 0 } },
    { name: 'settings.json', document: { version: 1, value: { soundEnabled: 'yes' } } },
  ];
  for (const [index, entry] of cases.entries()) {
    const { dir, store } = await tempStore(t); await store.putRecord(record(index + 100)); const oldEpoch = store.epoch;
    await writeFile(join(dir, entry.name), JSON.stringify(entry.document), 'utf8');
    const recovered = await createStore({ dataDir: dir });
    assert.equal(recovered.status.persist, 'recovered'); assert.deepEqual(recovered.status.recovered, [entry.name]); assert.ok(recovered.epoch > oldEpoch);
    assert.equal(recovered.cursor, 0); assert.equal(recovered.pull({ epoch: oldEpoch, cursor: store.cursor }).reset, true);
  }
});

test('schema rejects dangerous and unknown properties at every persisted boundary', async (t) => {
  const { dir, store } = await tempStore(t); await store.putRecord(record(100)); const oldEpoch = store.epoch;
  await writeFile(join(dir, 'settings.json'), '{"version":1,"value":{"__proto__":{"polluted":true}}}', 'utf8');
  let recovered = await createStore({ dataDir: dir });
  assert.deepEqual(recovered.status.recovered, ['settings.json']); assert.equal({}.polluted, undefined); assert.ok(recovered.epoch > oldEpoch);
  await writeFile(join(dir, 'records.json'), JSON.stringify({ version: 1, epoch: recovered.epoch, cursor: 0, records: [{ ...record(1), constructor: 'bad' }], changes: [], evictedOpen: 0 }), 'utf8');
  recovered = await createStore({ dataDir: dir }); assert.deepEqual(recovered.status.recovered, ['records.json']);
  recovered = await createStore({ dataDir: dir }); assert.equal(recovered.status.persist, 'ok');
});

test('file, collection and field limits recover before unbounded parsing or allocation', async (t) => {
  const { dir, store } = await tempStore(t); await store.putRecord(record(100)); const oldEpoch = store.epoch;
  await writeFile(join(dir, 'records.json'), Buffer.alloc(STORAGE_LIMITS.fileBytes.records + 1, 0x20));
  let recovered = await createStore({ dataDir: dir }); assert.deepEqual(recovered.status.recovered, ['records.json']); assert.ok(recovered.epoch > oldEpoch);
  const records = Array.from({ length: STORAGE_LIMITS.records + 1 }, (_, index) => record(index));
  await writeFile(join(dir, 'records.json'), JSON.stringify({ version: 1, epoch: recovered.epoch, cursor: 0, records, changes: [], evictedOpen: 0 }), 'utf8');
  recovered = await createStore({ dataDir: dir }); assert.deepEqual(recovered.status.recovered, ['records.json']);
});

test('writers reject values that would create invalid or oversized documents without corrupting committed state', async (t) => {
  const { dir, store } = await tempStore(t);
  await assert.rejects(() => store.putRecord(record(1, { body: 'x'.repeat(241) })), /invalid record/);
  await assert.rejects(() => store.setSettings({ soundEnabled: true, constructor: 'bad' }), /invalid settings/);
  const reopened = await createStore({ dataDir: dir }); assert.equal(reopened.status.persist, 'ok'); assert.equal(reopened.getRecords().length, 0); assert.deepEqual(reopened.getSettings(), {});
});

test('self-test records, ownership, atomic run reservation and targeted cleanup persist safely', async (t) => {
  const { dir, store } = await tempStore(t);
  await store.putRecord(record(900));
  const testRunId = 'self-test:a-history:12345678';
  await store.putRecord(record(901, { kind: 'test', mergeKey: `test:${testRunId}`, deliveryScope: 'a-only', testRunId }));
  await assert.rejects(() => store.putRecord(record(902, { kind: 'test' })), /invalid record/);
  await assert.rejects(() => store.putRecord(record(903, { deliveryScope: 'a-only', testRunId })), /invalid record/);
  const request = { testRunId, ownerHash: 'owner-a', dimension: 'a-history', requestHash: 'request-a', now: 4 };
  const [first, second] = await Promise.all([store.reserveSelfTestRun(request), store.reserveSelfTestRun(request)]);
  assert.equal([first, second].filter((item) => item.ok).length, 1); assert.equal([first, second].find((item) => !item.ok).reason, 'active');
  const token = [first, second].find((item) => item.ok).run.reservationId;
  assert.equal((await store.reserveSelfTestRun({ ...request, requestHash: 'changed' })).reason, 'conflict');
  const uncertainId = 'self-test:a-history:uncertain1234'; await store.reserveSelfTestRun({ testRunId: uncertainId, ownerHash: 'owner-a', dimension: 'a-history', requestHash: 'request-c', now: 4 });
  const afterReservationRestart = await createStore({ dataDir: dir }); assert.equal((await afterReservationRestart.reserveSelfTestRun({ testRunId: uncertainId, ownerHash: 'owner-a', dimension: 'a-history', requestHash: 'request-c', now: 10 })).reason, 'active');
  const result = { testRunId, dimension: 'a-history', status: 'passed', reason: 'stored', submittedAt: 5 };
  assert.equal((await store.finishSelfTestRun(testRunId, token, result, 6)).ok, true);
  assert.equal((await store.finishSelfTestRun(testRunId, 'stale-token', result, 7)).reason, 'stale');
  const reopened = await createStore({ dataDir: dir }); assert.equal(reopened.getTestRun(testRunId).result.status, 'passed');
  const oldEpoch = reopened.epoch; const cleared = await reopened.clearTestRecords(testRunId); assert.equal(cleared.removed, 1); assert.ok(cleared.epoch > oldEpoch); assert.equal(reopened.getRecords().some((item) => item.kind === 'test'), false); assert.equal(reopened.getRecords().some((item) => item.eventId === 'event-900'), true);
});

test('capacity prefers read settled eviction, diagnoses hard-cap open eviction, and clear advances epoch', async (t) => {
  const { dir } = await tempStore(t);
  const opens = Array.from({ length: STORAGE_LIMITS.records - 1 }, (_, index) => record(`open-${index}`, {
    mergeKey: `approval:${index}`, kind: 'approval', phase: 'open', unread: true, at: index,
  }));
  const disposable = record('read', { unread: false, at: 0 });
  await writeFile(join(dir, 'records.json'), `${JSON.stringify({ version: 1, epoch: 10, cursor: 0, records: [...opens, disposable], changes: [], evictedOpen: 0 }, null, 2)}\n`, 'utf8');
  const store = await createStore({ dataDir: dir });

  await store.putRecord(record('new-open', { mergeKey: 'approval:new', kind: 'approval', phase: 'open', unread: true, at: 999 }));
  assert.equal(store.getRecords().length, STORAGE_LIMITS.records);
  assert.ok(!store.getRecords().some((item) => item.eventId === disposable.eventId));
  assert.equal(JSON.parse(await readFile(join(dir, 'records.json'), 'utf8')).evictedOpen, 0);

  await store.putRecord(record('hard-cap', { mergeKey: 'approval:hard-cap', kind: 'approval', phase: 'open', unread: true, at: 1000 }));
  assert.equal(store.getRecords().length, STORAGE_LIMITS.records);
  assert.equal(JSON.parse(await readFile(join(dir, 'records.json'), 'utf8')).evictedOpen, 1);

  const before = store.epoch;
  const cleared = await store.clearRecords();
  assert.equal(cleared.epoch, before + 1);
  assert.equal(store.getRecords().length, 0);
  assert.equal(store.pull({ epoch: before, cursor: 0 }).reset, true);
});
