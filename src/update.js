/**
 * dsh-notify — online version detection for the settings page.
 *
 * Asks the public npm registry for the newest published version and compares it with the version that
 * is actually running. Read-only by design: this module NEVER installs anything and never restarts
 * DSH. The settings page shows the result plus a copyable upgrade command, and the operator decides
 * when to run it.
 *
 * The comparison lives here on purpose: `semver` would be a new runtime dependency for ~30 lines of
 * arithmetic, and this plugin ships no runtime dependency beyond the DSH peers.
 */

/** Package name on npm. The unscoped `dsh-notify` belongs to another author, so the scope is load-bearing. */
export const PACKAGE_NAME = '@idoall/dsh-notify';
/** Registry document that carries the `latest` tag. The slash stays percent-encoded: it is a path segment. */
export const REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME.replace('/', '%2F')}/latest`;
/** How long one lookup is reused before the registry is asked again. */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
/** Network timeout for the lookup. */
export const FETCH_TIMEOUT_MS = 5_000;
/** The one failure code the page renders: offline is a normal state, not an error to shout about. */
export const REGISTRY_UNAVAILABLE = 'registry_unavailable';

/**
 * Parse a version string.
 *
 * @param {string} value - e.g. `0.3.4`, `0.4.0-rc.1`.
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[] } | undefined} the parsed
 *   version, or `undefined` when it is not a version.
 */
export function parseVersion(value) {
  // `String.prototype.match`, not the RegExp method of the same purpose: this project's static source
  // check refuses that method name anywhere in `src/` so that no module can compose a shell command,
  // and it cannot tell a regex call apart from the shell one. The shell ban is worth the API choice.
  const match = String(value ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (match === null) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/** Compare two prerelease identifier lists per semver's precedence rules. */
function comparePrerelease(left, right) {
  // A release outranks any prerelease of the same x.y.z.
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index]; const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumber = /^\d+$/.test(a) ? Number(a) : undefined;
    const bNumber = /^\d+$/.test(b) ? Number(b) : undefined;
    if (aNumber !== undefined && bNumber !== undefined) {
      if (aNumber !== bNumber) return aNumber < bNumber ? -1 : 1;
      continue;
    }
    if (aNumber !== undefined) return -1;
    if (bNumber !== undefined) return 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

/**
 * Compare two versions.
 *
 * @param {string} left - first version.
 * @param {string} right - second version.
 * @returns {number} `-1`, `0` or `1`; an unparsable version compares as equal, so a broken string can
 *   never claim an update is available.
 */
export function compareVersions(left, right) {
  const a = parseVersion(left); const b = parseVersion(right);
  if (a === undefined || b === undefined) return 0;
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * Whether `latest` is newer than `current`.
 *
 * @param {string} latest - the version published on npm.
 * @param {string} current - the version this process runs.
 * @returns {boolean} true only when `latest` is strictly newer.
 */
export function isNewer(latest, current) {
  return compareVersions(latest, current) > 0;
}

/** The shape the settings page consumes. */
export function updateStatus(current, { latest = null, checkedAtMs = null, error = null } = {}) {
  return {
    current,
    latest,
    hasUpdate: latest !== null && isNewer(latest, current),
    checkedAtMs,
    error,
  };
}

/**
 * Build the checker the Host route uses.
 *
 * @param {object} options - checker options.
 * @param {string} options.currentVersion - the version this process runs.
 * @param {typeof fetch} [options.fetchImpl] - injected for tests; defaults to the global fetch.
 * @param {() => number} [options.now] - injected clock.
 * @param {number} [options.ttlMs] - cache lifetime; defaults to {@link CACHE_TTL_MS}.
 * @param {(message: string) => void} [options.log] - optional diagnostics sink.
 * @returns {{ currentVersion: string, check: (options?: { force?: boolean }) => Promise<object> }} the checker.
 */
export function createUpdateChecker({ currentVersion, fetchImpl, now = () => Date.now(), ttlMs = CACHE_TTL_MS, log } = {}) {
  const version = typeof currentVersion === 'string' && currentVersion !== '' ? currentVersion : '0.0.0';
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  let cached;
  return {
    currentVersion: version,
    /**
     * Look up the newest published version. A failure is reported in `error`, never thrown: the
     * registry being unreachable must not break the settings page.
     *
     * @param {{ force?: boolean }} [options] - `force` bypasses the cache.
     * @returns {Promise<object>} the status.
     */
    async check({ force = false } = {}) {
      if (!force && cached !== undefined) {
        const age = now() - (cached.checkedAtMs ?? 0);
        if (age < ttlMs) return cached;
      }
      let status;
      try {
        if (typeof doFetch !== 'function') throw new Error('fetch unavailable');
        const response = await doFetch(REGISTRY_LATEST_URL, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`registry ${String(response.status)}`);
        const body = await response.json();
        const latest = typeof body?.version === 'string' ? body.version : null;
        if (latest === null) throw new Error('registry response had no version');
        status = updateStatus(version, { latest, checkedAtMs: now() });
        if (status.hasUpdate) log?.(`update available current=${version} latest=${latest}`);
      } catch (error) {
        // Offline is a normal state: report it and keep notifying.
        log?.(`update check failed name=${error?.name ?? 'Error'}`);
        status = updateStatus(version, { checkedAtMs: now(), error: REGISTRY_UNAVAILABLE });
      }
      cached = status;
      return status;
    },
  };
}
