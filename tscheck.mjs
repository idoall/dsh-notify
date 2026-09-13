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
if (!client.includes("slots.inject('sidebar.footer.action'") || !client.includes("slots.inject('settings.section'")) throw new Error('client slots are not wired');
console.log(`Static source checks passed for ${source.length} source files and required Host/Client seams.`);
