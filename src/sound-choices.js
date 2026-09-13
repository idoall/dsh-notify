/**
 * Sound choices shared by the Host (file validation) and the client (playback). Kept free of any
 * Node or browser API so both bundles can import exactly one source of truth.
 */
export const BUILTIN_SOUNDS = Object.freeze(['chime', 'ping', 'alert', 'none']);
export const SOUND_BYTES = 1024 * 1024;
const EXTENSIONS = Object.freeze({ '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac', '.webm': 'audio/webm' });
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** MIME type for an allow-listed audio extension, or undefined when the extension is not allowed. */
export function extensionOf(name) {
  const index = typeof name === 'string' ? name.lastIndexOf('.') : -1;
  if (index <= 0) return undefined;
  return EXTENSIONS[name.slice(index).toLowerCase()];
}
/** A sound file name must be a single path segment with an allow-listed audio extension. */
export function validSoundName(name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name) || name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  return extensionOf(name) !== undefined;
}
/** Normalise an upload name to the stored `<stem>.<ext>` form, or undefined when it is unusable. */
export function soundFileName(name) {
  if (!validSoundName(name)) return undefined;
  const index = name.lastIndexOf('.');
  return `${name.slice(0, index).replace(/[^A-Za-z0-9._-]/g, '_')}${name.slice(index).toLowerCase()}`;
}
/** Parse a stored setting into a concrete choice: a built-in id or `custom:<file>`. */
export function parseSoundChoice(value) {
  if (typeof value !== 'string' || value.length === 0) return { kind: 'builtin', id: 'chime' };
  if (value.startsWith('custom:')) {
    const name = value.slice('custom:'.length);
    return validSoundName(name) ? { kind: 'custom', name } : { kind: 'builtin', id: 'chime' };
  }
  return { kind: 'builtin', id: BUILTIN_SOUNDS.includes(value) ? value : 'chime' };
}
/**
 * Built-in sounds are synthesised: no audio asset ships in the package, nothing is fetched, and the
 * same notes behave identically on every platform. Each note is `{ freq, at, dur, gain, type }`
 * seconds into the cue.
 */
export const SOUND_PRESETS = Object.freeze({
  chime: Object.freeze([{ freq: 880, at: 0, dur: 0.14, gain: 0.16, type: 'sine' }, { freq: 1318.5, at: 0.11, dur: 0.22, gain: 0.12, type: 'sine' }]),
  ping: Object.freeze([{ freq: 1318.5, at: 0, dur: 0.16, gain: 0.15, type: 'sine' }]),
  alert: Object.freeze([{ freq: 660, at: 0, dur: 0.11, gain: 0.2, type: 'triangle' }, { freq: 660, at: 0.17, dur: 0.11, gain: 0.2, type: 'triangle' }]),
  none: Object.freeze([]),
});
/** User-facing labels for the settings select, in display order. */
export const SOUND_LABELS = Object.freeze({ chime: '叮咚（默认）', ping: '轻提示', alert: '双响提醒', none: '静音' });
