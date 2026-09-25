import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const name of ['index.js', 'core.js', 'buffer.js', 'sound-choices.js', 'sounds.js', 'update.js']) {
  await copyFile(`src/${name}`, `dist/${name}`);
}

const result = await build({
  entryPoints: ['src/client.js'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  write: false,
  legalComments: 'none',
});
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const body = result.outputFiles[0].text;
const registration = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(manifest.name)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${body.split('\n').map((line) => `    ${line}`).join('\n')}\n    return module.exports;\n  },\n});\n`;
await writeFile('dist/client.js', registration, 'utf8');
console.log(`Built Host modules and the DSH lazy-CJS client bundle for ${manifest.name}.`);
