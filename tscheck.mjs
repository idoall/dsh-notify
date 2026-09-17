import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function files(dir) {
  const list = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(list.map((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}
const source = await files('src');
for (const file of source.filter((item) => item.endsWith('.js'))) {
  const text = await readFile(file, 'utf8');
  if (/\bexport const inject\s*=\s*\[[^\]]*['"](?:tools|webServer)['"]/.test(text)) throw new Error(`${file}: forbidden static Host service inject`);
  if (/\b(?:exec|spawn)\s*\(/.test(text) || /shell\s*:\s*true/.test(text)) throw new Error(`${file}: shell command composition is forbidden`);
}
const host = await readFile('src/index.js', 'utf8');
if (!host.includes('export const inject = [];') || !host.includes("ctx?.on?.('session/event'")) throw new Error('Host API seam is not wired');
if (!host.includes("kind: 'exact'") || !host.includes('connection.requestRejection(req)')) throw new Error('authenticated raw route seam is not wired');
const client = await readFile('src/client.js', 'utf8');
if (!client.includes("slots.inject('settings.section'") || !client.includes("slots.inject('shell.overlay'")) throw new Error('client slots are not wired');
// The plugin keeps no history: nothing may write an ack, an epoch or a persisted record. (buffer.js
// is exempt because it is the file that explains, in prose, why those concepts are gone.)
const buffer = await readFile('src/buffer.js', 'utf8');
if (!buffer.includes('createBuffer') || !buffer.includes('createSettings')) throw new Error('the live buffer seam is not wired');
for (const file of source.filter((item) => item.endsWith('.js') && item !== 'src/buffer.js')) {
  const text = await readFile(file, 'utf8');
  // The history protocol, named exactly: an epoch/cursor pair, a read-retention setting, or one of the
  // routes that only existed to serve a stored list.
  if (/\b(?:epoch|readRetentionDays|resetPullDelivers)\b/.test(text) || /['"]\/(?:ack|settle|clear|delete)['"]/.test(text)) throw new Error(`${file}: history bookkeeping must not come back`);
}
console.log(`Static source checks passed for ${source.length} source files and required Host/Client seams.`);
