import { open, mkdir, rename, unlink } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const VERSION = 1;
const RECORD_CAP = 300;
const CHANGE_CAP = 600;
const SELF_TEST_CAP = 512;
const FILE_BYTES = Object.freeze({ records: 2 * 1024 * 1024, settings: 64 * 1024, selfTest: 1024 * 1024 });
const FILES = Object.freeze({ records: 'records.json', settings: 'settings.json', selfTest: 'self-test.json' });
const VALIDATORS = Object.freeze({ records: validRecords, settings: validSettings, selfTest: validSelfTest });
const DANGEROUS = new Set(['__proto__', 'prototype', 'constructor']);
const RECORD_FIELDS = new Set(['eventId', 'kind', 'mergeKey', 'sessionId', 'title', 'body', 'at', 'unread', 'phase', 'outcome', 'deepLink', 'deliveryScope', 'testRunId', 'turn']);
const KINDS = new Set(['approval', 'question', 'plan-review', 'completed', 'failed', 'job-end', 'subagent-end', 'workflow-end', 'test']);

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const emptyRecords = (epoch = 1) => ({ version: VERSION, epoch, cursor: 0, records: [], changes: [], evictedOpen: 0 });
const emptySettings = () => ({ version: VERSION, value: {} });
const emptySelfTest = () => ({ version: VERSION, bindings: [], runs: [], probes: [] });
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const string = (value, max, allowEmpty = false) => typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0);
function plain(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value);
  return keys.every((key) => !DANGEROUS.has(key) && fields.has(key));
}
function validRecord(value) {
  if (!plain(value, RECORD_FIELDS)) return false;
  return string(value.eventId, 256) && string(value.mergeKey, 512) && KINDS.has(value.kind)
    && string(value.title, 240) && string(value.body, 240, true) && integer(value.at)
    && typeof value.unread === 'boolean' && ['open', 'settled', 'expired'].includes(value.phase)
    && (value.sessionId === undefined || string(value.sessionId, 256))
    && (value.outcome === undefined || string(value.outcome, 128, true))
    && (value.turn === undefined || (integer(value.turn, 1) && value.turn <= 1_000_000))
    && (value.deepLink === undefined || string(value.deepLink, 512, true))
    && (value.kind === 'test'
      ? value.deliveryScope === 'a-only' && string(value.testRunId, 256)
      : value.deliveryScope === undefined && value.testRunId === undefined);
}
function validRecords(value) {
  if (!plain(value, new Set(['version', 'epoch', 'cursor', 'records', 'changes', 'evictedOpen']))
    || value.version !== VERSION || !integer(value.epoch, 1) || !integer(value.cursor)
    || !integer(value.evictedOpen) || !Array.isArray(value.records) || value.records.length > RECORD_CAP
    || !Array.isArray(value.changes) || value.changes.length > CHANGE_CAP || !value.records.every(validRecord)) return false;
  if (new Set(value.records.map((record) => record.eventId)).size !== value.records.length || new Set(value.records.map((record) => record.mergeKey)).size !== value.records.length) return false;
  const currentById = new Map(value.records.map((record) => [record.eventId, record]));
  let previous = 0;
  for (const change of value.changes) {
    const current = currentById.get(change?.record?.eventId);
    if (!plain(change, new Set(['cursor', 'record'])) || !integer(change.cursor, 1) || change.cursor <= previous || change.cursor > value.cursor || !validRecord(change.record)
      || !current || current.mergeKey !== change.record.mergeKey) return false;
    previous = change.cursor;
  }
  return value.cursor === 0 ? value.changes.length === 0 : value.changes.length > 0 && value.changes.at(-1).cursor === value.cursor;
}
function validSettings(value) {
  const fields = new Set(['verbosity', 'toastPosition', 'toastEnabled', 'subtaskNotify', 'soundEnabled', 'sound', 'readRetentionDays']);
  if (!plain(value, new Set(['version', 'value'])) || value.version !== VERSION || !plain(value.value, fields)) return false;
  return (value.value.subtaskNotify === undefined || typeof value.value.subtaskNotify === 'boolean')
    && (value.value.soundEnabled === undefined || typeof value.value.soundEnabled === 'boolean')
    && (value.value.sound === undefined || (typeof value.value.sound === 'string' && value.value.sound.length > 0 && value.value.sound.length <= 96))
    && (value.value.readRetentionDays === undefined || (integer(value.value.readRetentionDays) && value.value.readRetentionDays <= 365))
    && (value.value.verbosity === undefined || ['normal', 'detailed'].includes(value.value.verbosity));
}
function validBinding(value) {
  return plain(value, new Set(['ownerHash', 'recipientId', 'nonceHash', 'endpointHash', 'status', 'createdAt', 'updatedAt']))
    && string(value.ownerHash, 128) && string(value.recipientId, 256) && string(value.nonceHash, 128) && string(value.endpointHash, 128)
    && ['active', 'revoked'].includes(value.status) && integer(value.createdAt) && integer(value.updatedAt);
}
function validRunResult(value) {
  return plain(value, new Set(['testRunId', 'dimension', 'status', 'reason', 'submittedAt']))
    && string(value.testRunId, 256) && ['a-history', 'navigation', 'persistence-roundtrip'].includes(value.dimension)
    && ['passed', 'submitted', 'failed', 'unsupported', 'untested'].includes(value.status)
    && string(value.reason, 256, true) && integer(value.submittedAt);
}
function validSelfTestRun(value) {
  return plain(value, new Set(['testRunId', 'ownerHash', 'dimension', 'requestHash', 'reservationId', 'state', 'reservedAt', 'finishedAt', 'result']))
    && string(value.testRunId, 256) && string(value.ownerHash, 128)
    && ['a-history', 'navigation', 'persistence-roundtrip'].includes(value.dimension)
    && string(value.requestHash, 128) && string(value.reservationId, 128)
    && ['reserved', 'finished'].includes(value.state) && integer(value.reservedAt)
    && (value.state === 'reserved'
      ? value.finishedAt === undefined && value.result === undefined
      : integer(value.finishedAt) && validRunResult(value.result));
}
function validProbe(value) {
  return plain(value, new Set(['testRunId', 'nonce', 'createdAt'])) && string(value.testRunId, 256) && string(value.nonce, 128) && integer(value.createdAt);
}
function validSelfTest(value) {
  if (!plain(value, new Set(['version', 'bindings', 'runs', 'probes'])) || value.version !== VERSION
    || !Array.isArray(value.bindings) || value.bindings.length > SELF_TEST_CAP || !value.bindings.every(validBinding)
    || !Array.isArray(value.runs) || value.runs.length > SELF_TEST_CAP || !value.runs.every(validSelfTestRun)
    || !Array.isArray(value.probes) || value.probes.length > 8 || !value.probes.every(validProbe)) return false;
  return new Set(value.bindings.map((item) => item.recipientId)).size === value.bindings.length
    && new Set(value.bindings.filter((item) => item.status === 'active').map((item) => item.ownerHash)).size === value.bindings.filter((item) => item.status === 'active').length
    && new Set(value.runs.map((item) => item.testRunId)).size === value.runs.length
    && new Set(value.probes.map((item) => item.testRunId)).size === value.probes.length;
}
async function boundedRead(path, limit) {
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > limit) throw Object.assign(new Error('document exceeds byte limit'), { code: 'EFBIG' });
    const buffer = Buffer.allocUnsafe(limit + 1); let offset = 0;
    while (offset <= limit) {
      const { bytesRead } = await handle.read(buffer, offset, limit + 1 - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > limit) throw Object.assign(new Error('document exceeds byte limit'), { code: 'EFBIG' });
    return buffer.subarray(0, offset).toString('utf8');
  } finally { await handle.close(); }
}
async function readDocument(path, fallback, validate, limit) {
  try {
    const parsed = JSON.parse(await boundedRead(path, limit));
    if (!validate(parsed)) throw new Error('invalid document shape');
    return { value: parsed, missing: false, recovered: false };
  } catch (error) {
    if (error?.code === 'ENOENT') return { value: fallback(), missing: true, recovered: false };
    return { value: fallback(), missing: false, recovered: true, error };
  }
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function atomicJson(path, directory, value) {
  const temp = join(directory, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, path);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}

function nextRecoveryEpoch(previous) {
  if (Number.isSafeInteger(previous) && previous > 0 && previous < Number.MAX_SAFE_INTEGER) return Math.max(previous + 1, Date.now());
  return Date.now();
}

function recordIndex(records, record) {
  if (record?.mergeKey !== undefined) return records.findIndex((item) => item.mergeKey === record.mergeKey);
  if (record?.eventId !== undefined) return records.findIndex((item) => item.eventId === record.eventId);
  return -1;
}

function evictionIndex(records) {
  const byAge = (a, b) => (Number(a.item.at) || 0) - (Number(b.item.at) || 0);
  const indexed = records.map((item, index) => ({ item, index })).sort(byAge);
  return indexed.find(({ item }) => item.unread === false && item.phase === 'settled')?.index
    ?? indexed.find(({ item }) => item.phase !== 'open' || item.unread === false)?.index
    ?? indexed[0]?.index;
}

class DisabledStore {
  constructor(reason) {
    this.status = Object.freeze({ persist: 'disabled', reason, recovered: [] });
    this.enabled = false;
    this.epoch = 1;
    this.cursor = 0;
  }
  pull() { return { epoch: this.epoch, cursor: this.cursor, items: [], reset: true }; }
  getRecords() { return []; }
  getSettings() { return {}; }
  checkRecipientClaim() { return { ok: false, reason: this.status.reason }; }
  getTestRun() { return undefined; }
  async putRecord() { return { ok: false, reason: this.status.reason }; }
  async ack() { return { ok: false, reason: this.status.reason }; }
  async clearRecords() { return { ok: false, reason: this.status.reason }; }
  async deleteRecords() { return { removed: 0, epoch: this.epoch, cursor: this.cursor, items: [] }; }
  async setSettings() { return { ok: false, reason: this.status.reason }; }
  async reserveSelfTestRun() { return { ok: false, reason: this.status.reason }; }
  async finishSelfTestRun() { return { ok: false, reason: this.status.reason }; }
  async persistenceProbe() { return { ok: false, reason: this.status.reason }; }
  async clearTestRecords() { return { epoch: this.epoch, cursor: this.cursor, removed: 0 }; }
}

class FileStore {
  constructor(dataDir, documents, recovered) {
    this.dataDir = dataDir;
    this.enabled = true;
    this.documents = documents;
    this.status = { persist: recovered.length ? 'recovered' : 'ok', recovered };
    this.#writes = Promise.resolve();
  }
  #writes;
  get epoch() { return this.documents.records.epoch; }
  get cursor() { return this.documents.records.cursor; }
  #queue(write) {
    const result = this.#writes.then(write);
    this.#writes = result.catch(() => {});
    return result;
  }
  async #commit(name, document) {
    if (!VALIDATORS[name](document)) throw new TypeError(`invalid ${name} document`);
    if (Buffer.byteLength(`${JSON.stringify(document, null, 2)}\n`) > FILE_BYTES[name]) throw new RangeError(`${name} document exceeds byte limit`);
    await atomicJson(join(this.dataDir, FILES[name]), this.dataDir, document);
    this.documents[name] = document;
  }
  getRecords() { return clone(this.documents.records.records); }
  getSettings() { return clone(this.documents.settings.value); }
  getTestRun(testRunId) { return clone(this.documents.selfTest.runs.find((item) => item.testRunId === testRunId)); }
  pull({ epoch, cursor = 0 } = {}) {
    const state = this.documents.records;
    const firstCursor = state.changes[0]?.cursor ?? state.cursor + 1;
    const reset = epoch !== state.epoch || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > state.cursor || cursor < firstCursor - 1;
    return {
      epoch: state.epoch,
      cursor: state.cursor,
      items: clone(reset ? state.records : state.changes.filter((change) => change.cursor > cursor).map((change) => change.record)),
      reset,
    };
  }
  async putRecord(record) {
    if (!validRecord(record)) throw new TypeError('invalid record');
    return this.#queue(async () => {
      const state = clone(this.documents.records);
      const incoming = clone(record);
      const index = recordIndex(state.records, incoming);
      if (index === -1) state.records.push(incoming);
      else state.records[index] = { ...state.records[index], ...incoming, eventId: state.records[index].eventId };
      state.cursor += 1;
      const stored = clone(index === -1 ? state.records.at(-1) : state.records[index]);
      state.changes.push({ cursor: state.cursor, record: stored });
      let resetForEviction = false;
      while (state.records.length > RECORD_CAP) {
        const evict = evictionIndex(state.records);
        const [removed] = state.records.splice(evict, 1);
        if (removed?.phase === 'open' && removed?.unread !== false) state.evictedOpen += 1;
        resetForEviction = true;
      }
      if (resetForEviction) {
        state.epoch += 1;
        state.cursor = 0;
        state.changes = [];
      } else if (state.changes.length > CHANGE_CAP) {
        state.changes.splice(0, state.changes.length - CHANGE_CAP);
      }
      await this.#commit('records', state);
      return clone(stored);
    });
  }
  async ack(eventId) {
    return this.#queue(async () => {
      const state = clone(this.documents.records);
      const record = state.records.find((item) => item.eventId === eventId);
      if (!record) return false;
      record.unread = false;
      state.cursor += 1;
      state.changes.push({ cursor: state.cursor, record: clone(record) });
      if (state.changes.length > CHANGE_CAP) state.changes.shift();
      await this.#commit('records', state);
      return true;
    });
  }
  async clearRecords() {
    return this.#queue(async () => {
      const next = emptyRecords(this.documents.records.epoch + 1);
      next.evictedOpen = this.documents.records.evictedOpen;
      await this.#commit('records', next);
      return { epoch: next.epoch, cursor: 0 };
    });
  }
  /**
   * Remove specific records. Advancing the epoch makes the change observable to every client exactly
   * like `/clear` does: the next pull answers `reset` and carries the surviving records, so a
   * partial delete never leaves another tab (or the phone) showing a record the Host has dropped.
   */
  async deleteRecords(eventIds) {
    if (!Array.isArray(eventIds) || eventIds.length === 0 || eventIds.length > RECORD_CAP || !eventIds.every((id) => string(id, 256))) throw new TypeError('invalid event ids');
    return this.#queue(async () => {
      const state = clone(this.documents.records);
      const drop = new Set(eventIds);
      const keep = state.records.filter((record) => !drop.has(record.eventId));
      const removed = state.records.length - keep.length;
      if (removed === 0) return { removed: 0, epoch: state.epoch, cursor: state.cursor, items: keep };
      const next = { ...emptyRecords(state.epoch + 1), records: keep, evictedOpen: state.evictedOpen };
      await this.#commit('records', next);
      return { removed, epoch: next.epoch, cursor: 0, items: keep };
    });
  }
  async clearTestRecords(testRunId) {
    if (testRunId !== undefined && !string(testRunId, 256)) throw new TypeError('invalid test run id');
    return this.#queue(async () => {
      const state = clone(this.documents.records);
      const keep = state.records.filter((record) => record.kind !== 'test' || (testRunId !== undefined && record.testRunId !== testRunId));
      const removed = state.records.length - keep.length;
      if (!removed) return { epoch: state.epoch, cursor: state.cursor, removed: 0 };
      state.records = keep; state.epoch += 1; state.cursor = 0; state.changes = [];
      await this.#commit('records', state);
      return { epoch: state.epoch, cursor: 0, removed };
    });
  }
  async setSettings(value) {
    if (!validSettings({ version: VERSION, value })) throw new TypeError('invalid settings');
    return this.#queue(async () => {
      const document = { version: VERSION, value: clone(value) };
      await this.#commit('settings', document);
      return clone(document.value);
    });
  }
  async reserveSelfTestRun({ testRunId, ownerHash, dimension, requestHash, now = Date.now() }) {
    if (![testRunId, ownerHash, dimension, requestHash].every((value) => string(value, 256)) || !integer(now)) throw new TypeError('invalid self-test reservation');
    return this.#queue(async () => {
      const document = clone(this.documents.selfTest);
      const existing = document.runs.find((item) => item.testRunId === testRunId);
      if (existing) {
        if (existing.ownerHash !== ownerHash || existing.dimension !== dimension || existing.requestHash !== requestHash) return { ok: false, reason: 'conflict', run: clone(existing) };
        return { ok: false, reason: existing.state === 'finished' ? 'finished' : 'active', run: clone(existing) };
      }
      const run = { testRunId, ownerHash, dimension, requestHash, reservationId: randomBytes(18).toString('base64url'), state: 'reserved', reservedAt: now };
      const terminal = document.runs.filter((item) => item.state === 'finished').slice(-Math.max(0, SELF_TEST_CAP - document.runs.filter((item) => item.state === 'reserved').length - 1));
      document.runs = document.runs.filter((item) => item.state === 'reserved').concat(terminal, run);
      await this.#commit('selfTest', document);
      return { ok: true, run: clone(run) };
    });
  }
  async finishSelfTestRun(testRunId, reservationId, result, now = Date.now()) {
    if (!string(testRunId, 256) || !string(reservationId, 128) || !validRunResult(result) || !integer(now)) throw new TypeError('invalid self-test result');
    return this.#queue(async () => {
      const document = clone(this.documents.selfTest);
      const run = document.runs.find((item) => item.testRunId === testRunId);
      if (!run || run.reservationId !== reservationId) return { ok: false, reason: 'stale' };
      if (run.state === 'finished') return { ok: true, duplicate: true, run: clone(run) };
      run.state = 'finished'; run.finishedAt = now; run.result = clone(result);
      await this.#commit('selfTest', document);
      return { ok: true, run: clone(run) };
    });
  }
  async persistenceProbe({ testRunId, nonce, now = Date.now() }) {
    if (!string(testRunId, 256) || !string(nonce, 128) || !integer(now)) throw new TypeError('invalid persistence probe');
    return this.#queue(async () => {
      const document = clone(this.documents.selfTest);
      document.probes.push({ testRunId, nonce, createdAt: now });
      await this.#commit('selfTest', document);
      const readBack = this.documents.selfTest.probes.some((item) => item.testRunId === testRunId && item.nonce === nonce);
      const cleaned = clone(this.documents.selfTest); cleaned.probes = cleaned.probes.filter((item) => item.testRunId !== testRunId);
      await this.#commit('selfTest', cleaned);
      return { ok: readBack, cleaned: !this.documents.selfTest.probes.some((item) => item.testRunId === testRunId) };
    });
  }
}

export async function createStore({ dataDir } = {}) {
  if (typeof dataDir !== 'string' || dataDir.trim() === '') return new DisabledStore('dataDir is required');
  if (!isAbsolute(dataDir)) return new DisabledStore('dataDir must be absolute');
  try {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const specs = {
      records: [emptyRecords, validRecords],
      settings: [emptySettings, validSettings],
      selfTest: [emptySelfTest, validSelfTest],
    };
    const reads = {};
    for (const [name, [fallback, validate]] of Object.entries(specs)) reads[name] = await readDocument(join(dataDir, FILES[name]), fallback, validate, FILE_BYTES[name]);
    const recovered = Object.entries(reads).filter(([, result]) => result.recovered).map(([name]) => FILES[name]);
    const documents = Object.fromEntries(Object.entries(reads).map(([name, result]) => [name, result.value]));
    if (recovered.length) {
      documents.records.epoch = nextRecoveryEpoch(reads.records.recovered ? undefined : documents.records.epoch);
      documents.records.cursor = 0;
      documents.records.changes = [];
    }
    // Publish default/recovered documents before exposing an enabled store.
    for (const [name, result] of Object.entries(reads)) {
      if (result.missing || result.recovered || (recovered.length && name === 'records')) await atomicJson(join(dataDir, FILES[name]), dataDir, documents[name]);
    }
    return new FileStore(dataDir, documents, recovered);
  } catch (error) {
    return new DisabledStore(`dataDir unavailable: ${error?.code || error?.message || 'unknown error'}`);
  }
}

export const STORAGE_LIMITS = Object.freeze({ records: RECORD_CAP, changes: CHANGE_CAP, selfTests: SELF_TEST_CAP, fileBytes: FILE_BYTES });
