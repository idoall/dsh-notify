import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

/**
 * Live delivery, and nothing else.
 *
 * The plugin keeps no history. A record lives here until newer ones push it out, and a page that was
 * not connected when the event happened never learns about it. That is the deliberate trade: the
 * toast IS the notification, so there is no read state to reconcile, no ack, no epoch, no cursor, no
 * queue that survives a restart — and nothing to validate, recover or evict by policy.
 *
 * What a page needs is one number. It asks for everything after the sequence it already has, which
 * makes a poll idempotent and lets a lagging tab catch up on its own.
 */
export const BUFFER_LIMIT = 50;

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

export function createBuffer({ limit = BUFFER_LIMIT } = {}) {
  const cap = Number.isSafeInteger(limit) && limit > 0 ? limit : BUFFER_LIMIT;
  let seq = 0;
  const entries = [];
  const index = new Map();   // mergeKey -> the sequence of its newest copy
  return {
    get seq() { return seq; },
    get size() { return entries.length; },
    /**
     * Keep the newest copy of a record, at the end of the buffer. The reducer merges in place, so the
     * same record legitimately arrives twice (an approval asked, then decided): a page following the
     * sequence has to see the update, and nobody needs the superseded copy.
     */
    push(record) {
      if (!record || typeof record.mergeKey !== 'string') return null;
      const dropAt = (at) => {
        if (at === -1) return;
        const dropped = entries.splice(at, 1)[0];
        if (index.get(dropped.record.mergeKey) === dropped.seq) index.delete(dropped.record.mergeKey);
      };
      dropAt(entries.findIndex((entry) => entry.seq === index.get(record.mergeKey)));
      // A complementary merge rekeys `unlinked:…` onto the real callId but keeps the eventId, so the
      // toast can update in place. The old merge identity is not news and must not sit beside it.
      if (typeof record.eventId === 'string' && record.eventId !== '') {
        dropAt(entries.findIndex((entry) => entry.record.eventId === record.eventId));
      }
      seq += 1;
      entries.push({ seq, record: clone(record) });
      index.set(record.mergeKey, seq);
      while (entries.length > cap) {
        const dropped = entries.shift();
        if (index.get(dropped.record.mergeKey) === dropped.seq) index.delete(dropped.record.mergeKey);
      }
      return seq;
    },
    /**
     * Everything after `since`. A client that has never polled (or that asks with a sequence from a
     * previous host process) gets what the buffer holds; the caller decides what counts as news.
     */
    pull({ since = 0 } = {}) {
      const boundary = Number.isSafeInteger(since) && since > 0 ? Math.min(since, seq) : 0;
      return { seq, items: entries.filter((entry) => entry.seq > boundary).map((entry) => clone(entry.record)) };
    },
  };
}

/**
 * Preferences are the one thing worth keeping on disk: they are the user's own choices (sound, toast
 * position, subtask noise) and losing them on every restart would be a regression, not a
 * simplification. No schema, no recovery machinery — a malformed file is simply replaced, and a file
 * written by the store this replaced is unwrapped rather than allowed to shadow what the user chose.
 */
export const SETTINGS_VERSION = 1;
/**
 * @param options.dataDir — profile-owned directory; without an absolute one, preferences are per process.
 * @param options.keys — the settings this version knows. A file from an older one is filtered through
 *   it, so a key that no longer exists cannot be carried forward forever; omitting it keeps every key.
 */
export function createSettings({ dataDir, keys } = {}) {
  const file = typeof dataDir === 'string' && isAbsolute(dataDir) ? join(dataDir, 'settings.json') : null;
  const allowed = Array.isArray(keys) ? new Set(keys) : null;
  const clean = (input) => (allowed ? Object.fromEntries(Object.entries(input ?? {}).filter(([key]) => allowed.has(key))) : { ...(input ?? {}) });
  let value = {};
  if (file) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      const document = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      // The deleted store kept preferences as a `{version, value}` document. Leaving that wrapper in
      // place would shadow every setting already chosen, and it would be written back forever; the
      // next `set` rewrites the file flat.
      const legacy = document?.version === SETTINGS_VERSION && document.value && typeof document.value === 'object' && !Array.isArray(document.value);
      value = clean(legacy ? document.value : document);
    } catch { /* first run, or a file we are about to overwrite */ }
  }
  return {
    get: () => ({ ...value }),
    set(next = {}) {
      value = { ...value, ...clean(next) };
      if (!file) return { ...value };
      try {
        mkdirSync(dirname(file), { recursive: true });
        const temporary = `${file}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        renameSync(temporary, file);
      } catch { /* a read-only profile still gets the setting for this process */ }
      return { ...value };
    },
    /** What `/config` reports about durability: records never persist, preferences usually do. */
    get status() { return { records: 'memory', preferences: file ? 'file' : 'session' }; },
  };
}
