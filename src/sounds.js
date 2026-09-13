import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { SOUND_BYTES as SOUND_LIMIT, extensionOf, soundFileName, validSoundName } from './sound-choices.js';

/**
 * Notification sounds.
 *
 * Built-ins are synthesised in the browser with WebAudio (no assets ship in the package), so they
 * work offline and in every browser. Users who want their own sound upload it into the
 * profile-owned data directory (`<dataDir>/sounds/`) — never into the plugin package, which is
 * replaced on every reinstall. The Host owns listing, validation and serving; the client owns
 * playback.
 */
export const SOUND_DIR = 'sounds';
export { BUILTIN_SOUNDS, SOUND_BYTES, extensionOf, parseSoundChoice, soundFileName, validSoundName } from './sound-choices.js';
const safeJoin = (dir, name) => join(dir, basename(name));

export function createSoundLibrary({ dataDir } = {}) {
  const enabled = typeof dataDir === 'string' && dataDir.length > 0;
  const dir = enabled ? join(dataDir, SOUND_DIR) : undefined;
  const ensure = async () => { await mkdir(dir, { recursive: true }); };
  return {
    enabled,
    dir,
    /** Names + sizes of the uploaded sounds, newest first; never throws for a missing directory. */
    async list() {
      if (!enabled) return [];
      try {
        await ensure();
        const names = (await readdir(dir)).filter((name) => validSoundName(name)).sort();
        const entries = [];
        for (const name of names) {
          try { const info = await stat(safeJoin(dir, name)); entries.push({ name, bytes: info.size, at: info.mtimeMs }); } catch { /* vanished */ }
        }
        return entries.sort((left, right) => right.at - left.at);
      } catch { return []; }
    },
    /** Store one upload. Returns a discriminated result; never writes outside `dir`. */
    async put(name, bytes) {
      if (!enabled) return { ok: false, reason: 'persistence-disabled' };
      const file = soundFileName(name);
      if (!file) return { ok: false, reason: 'invalid-name' };
      if (!bytes || bytes.byteLength === 0) return { ok: false, reason: 'empty' };
      if (bytes.byteLength > SOUND_LIMIT) return { ok: false, reason: 'too-large' };
      try {
        await ensure();
        const target = safeJoin(dir, file);
        const staging = `${target}.upload`;
        await writeFile(staging, bytes);
        await rename(staging, target);
        return { ok: true, name: file, bytes: bytes.byteLength };
      } catch { return { ok: false, reason: 'write-failed' }; }
    },
    async read(name) {
      if (!enabled || !validSoundName(name)) return undefined;
      try { const bytes = await readFile(safeJoin(dir, name)); return { bytes, type: extensionOf(name) }; } catch { return undefined; }
    },
    async remove(name) {
      if (!enabled || !validSoundName(name)) return false;
      try { await unlink(safeJoin(dir, name)); return true; } catch { return false; }
    },
  };
}
