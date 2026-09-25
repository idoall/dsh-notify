import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_TTL_MS, PACKAGE_NAME, REGISTRY_LATEST_URL, compareVersions, createUpdateChecker, isNewer, parseVersion } from '../src/update.js';

/** A fetch double that records every URL and answers with a scripted registry document. */
function registry(values = {}, { ok = true, status = 200 } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const body = typeof values === 'function' ? values() : values;
    return { ok, status, json: async () => body };
  };
  return { impl, calls };
}

test('the update check reads the scoped package document, not the unscoped name', () => {
  assert.equal(PACKAGE_NAME, '@idoall/dsh-notify', 'the unscoped dsh-notify belongs to another author');
  assert.equal(REGISTRY_LATEST_URL, 'https://registry.npmjs.org/@idoall%2Fdsh-notify/latest', 'the scope slash is a path segment and stays encoded');
});

test('version comparison follows semver, including prereleases and build metadata', () => {
  assert.deepEqual(parseVersion('0.3.4'), { major: 0, minor: 3, patch: 4, prerelease: [] });
  assert.deepEqual(parseVersion('v0.3.4-rc.2+build.7')?.prerelease, ['rc', '2']);
  assert.equal(parseVersion('nope'), undefined);
  assert.equal(parseVersion(undefined), undefined);
  assert.equal(compareVersions('0.3.4', '0.3.4'), 0);
  assert.equal(compareVersions('0.3.5', '0.3.4'), 1);
  assert.equal(compareVersions('0.4.0', '0.10.0'), -1, 'minor compares numerically, not as a string');
  assert.equal(compareVersions('0.4.0-rc.1', '0.4.0'), -1, 'a release outranks its own prerelease');
  assert.equal(compareVersions('0.4.0-rc.2', '0.4.0-rc.10'), -1, 'numeric prerelease identifiers compare numerically');
  assert.equal(compareVersions('0.4.0-beta', '0.4.0-rc'), -1, 'a non-numeric identifier compares as a string');
  assert.equal(compareVersions('0.4.0-rc.1', '0.4.0-rc.1.1'), -1, 'a longer prerelease list outranks its prefix');
  assert.equal(compareVersions('garbage', '0.3.4'), 0, 'an unparsable version compares as equal');
  assert.equal(isNewer('0.3.5', '0.3.4'), true);
  assert.equal(isNewer('0.3.4', '0.3.4'), false);
  assert.equal(isNewer('garbage', '0.3.4'), false, 'a broken registry answer can never claim an update');
});

test('a newer published version is reported with the running version it was compared against', async () => {
  const { impl, calls } = registry({ version: '0.4.0' });
  const checker = createUpdateChecker({ currentVersion: '0.3.4', fetchImpl: impl, now: () => 1_700_000_000_000 });
  const status = await checker.check();
  assert.deepEqual(status, { current: '0.3.4', latest: '0.4.0', hasUpdate: true, checkedAtMs: 1_700_000_000_000, error: null });
  assert.equal(checker.currentVersion, '0.3.4');
  assert.deepEqual(calls, [REGISTRY_LATEST_URL], 'one lookup, and it is the registry document');
});

test('the same version, a prerelease of it, and an older publish are all "already newest"', async () => {
  for (const version of ['0.3.4', '0.3.4-rc.1', '0.2.9']) {
    const { impl } = registry({ version });
    const status = await createUpdateChecker({ currentVersion: '0.3.4', fetchImpl: impl }).check();
    assert.equal(status.hasUpdate, false, `${version} must not be announced as an update`);
  }
});

test('an unreachable or malformed registry is a reported state, never a thrown error', async () => {
  const failing = async () => { throw Object.assign(new Error('offline'), { name: 'TimeoutError' }); };
  const offline = await createUpdateChecker({ currentVersion: '0.3.4', fetchImpl: failing, now: () => 42 }).check();
  assert.deepEqual(offline, { current: '0.3.4', latest: null, hasUpdate: false, checkedAtMs: 42, error: 'registry_unavailable' });

  const { impl: serverError } = registry({}, { ok: false, status: 503 });
  assert.equal((await createUpdateChecker({ currentVersion: '0.3.4', fetchImpl: serverError }).check()).error, 'registry_unavailable');

  const { impl: shapeless } = registry({ name: PACKAGE_NAME });
  assert.equal((await createUpdateChecker({ currentVersion: '0.3.4', fetchImpl: shapeless }).check()).error, 'registry_unavailable');

  const { impl: noFetch } = registry({ version: '0.4.0' });
  assert.equal(typeof noFetch, 'function');
  // A runtime without fetch must report the same state rather than throwing inside the route.
  const savedFetch = globalThis.fetch;
  globalThis.fetch = undefined;
  try {
    const withoutFetch = await createUpdateChecker({ currentVersion: '0.3.4', now: () => 7 }).check();
    assert.deepEqual(withoutFetch, { current: '0.3.4', latest: null, hasUpdate: false, checkedAtMs: 7, error: 'registry_unavailable' });
  } finally { globalThis.fetch = savedFetch; }
});

test('the cache serves one lookup until it expires or a human forces a fresh one', async () => {
  let clock = 1_000;
  const { impl, calls } = registry({ version: '0.4.0' });
  const checker = createUpdateChecker({ currentVersion: '0.3.4', fetchImpl: impl, now: () => clock, ttlMs: CACHE_TTL_MS });
  await checker.check();
  await checker.check();
  assert.equal(calls.length, 1, 'the second call is answered from the cache');
  clock += CACHE_TTL_MS;
  await checker.check();
  assert.equal(calls.length, 2, 'a cache older than the TTL is not reused');
  await checker.check({ force: true });
  assert.equal(calls.length, 3, 'force bypasses a still-fresh cache, which is what the 检查更新 button needs');
});

test('a failed lookup is cached too, so an offline host is asked once per TTL', async () => {
  const { impl, calls } = registry({}, { ok: false, status: 500 });
  const checker = createUpdateChecker({ currentVersion: '0.3.4', fetchImpl: impl, now: () => 5 });
  assert.equal((await checker.check()).error, 'registry_unavailable');
  assert.equal((await checker.check()).error, 'registry_unavailable');
  assert.equal(calls.length, 1, 'offline is a state, not a reason to hammer the registry');
});

test('a missing running version falls back to 0.0.0 instead of throwing', async () => {
  const { impl } = registry({ version: '0.4.0' });
  const checker = createUpdateChecker({ currentVersion: undefined, fetchImpl: impl });
  assert.equal(checker.currentVersion, '0.0.0');
  assert.equal((await checker.check()).hasUpdate, true);
});
