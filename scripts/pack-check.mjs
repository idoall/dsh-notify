import { access, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const required = ['package.json', 'cordis.patch.yml', 'dist/index.js', 'dist/core.js', 'dist/buffer.js', 'dist/sound-choices.js', 'dist/sounds.js', 'dist/client.js'];
for (const file of required) await access(file);
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.main !== './dist/index.js' || manifest.exports?.['./client'] !== './dist/client.js') throw new Error('package exports do not expose Host and client builds');
if (manifest.dsh?.client?.platform !== 'web' || manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('missing dsh client/bundle declarations');
// DSH 0.1.7 refuses an incompatible bundle at profile load, and dshmarket derives its host verdict from
// `engines.dsh` plus every `@deepseek-ai/dsh-*` peer, so these declarations decide whether the plugin
// loads at all. Keep one requirement, stated once, and let the verified list name only releases the
// requirement admits.
if (manifest.dsh?.manifestVersion !== 1) throw new Error('dsh.manifestVersion must be 1');
const dshRange = manifest.dsh?.engines?.dsh;
if (typeof dshRange !== 'string' || !/^>=\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? <\d+\.\d+\.\d+$/.test(dshRange)) {
  throw new Error(`dsh.engines.dsh must be a ">=<version> <<version>" requirement, received ${JSON.stringify(dshRange)}`);
}
const [, floor, ceiling] = /^>=(\S+) <(\S+)$/.exec(dshRange);
const dshPeers = Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => /^@deepseek-ai\/dsh(?:-|$)/.test(name));
if (dshPeers.length === 0) throw new Error('no @deepseek-ai/dsh-* peer declares the running host the plugin binds to');
for (const [name, range] of dshPeers) if (range !== dshRange) throw new Error(`peer ${name} is ${range} but dsh.engines.dsh is ${dshRange}; one requirement, one statement`);
const verified = manifest.dsh?.compatibility?.dshReleases;
if (verified === null || typeof verified !== 'object' || Array.isArray(verified) || Object.keys(verified).length === 0) {
  throw new Error('dsh.compatibility.dshReleases must name at least one verified release');
}
const rank = (version) => {
  const [, major, minor, patch, pre = ''] = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(version) ?? [];
  if (major === undefined) throw new Error(`dsh.compatibility.dshReleases has a non-semver key ${JSON.stringify(version)}`);
  // A release with a prerelease tag sorts below the same release without one.
  return [Number(major), Number(minor), Number(patch), pre === '' ? 1 : 0, pre];
};
const compare = (left, right) => {
  const [a, b] = [rank(left), rank(right)];
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    return a[index] > b[index] ? 1 : -1;
  }
  return 0;
};
for (const [release, verdict] of Object.entries(verified)) {
  if (verdict !== 'compatible') throw new Error(`dsh.compatibility.dshReleases lists ${release} as ${JSON.stringify(verdict)}; only a verified release is declared`);
  if (compare(release, floor) < 0 || compare(release, ceiling) >= 0) throw new Error(`dsh.compatibility.dshReleases names ${release}, which dsh.engines.dsh ${dshRange} does not admit`);
}
const releases = Object.keys(verified);
const lowest = releases.reduce((minimum, release) => (compare(release, minimum) < 0 ? release : minimum));
if (lowest !== floor) throw new Error(`the lowest verified release must be the dsh.engines.dsh floor ${floor}, received ${lowest}`);
// `@deepseek-ai/schemastery` is a peer, not a plain dependency: DSH 0.1.7 resolves only a linked plugin's
// peer dependencies from the running installation, so a `link:` install would otherwise fail to import the
// Host half. The devDependency copy serves this repository's own tests.
if (manifest.dependencies?.['@deepseek-ai/schemastery'] !== undefined) throw new Error('@deepseek-ai/schemastery must not be a plain dependency');
if (manifest.peerDependencies?.['@deepseek-ai/schemastery'] === undefined) throw new Error('@deepseek-ai/schemastery must be a peer');
if (manifest.devDependencies?.['@deepseek-ai/schemastery'] === undefined) throw new Error('@deepseek-ai/schemastery needs a devDependency for this repository\'s tests');
// Publishing preconditions. npm OIDC validates repository.url against the GitHub
// repository and a scoped package needs public access.
if (manifest.private === true || manifest.publishConfig?.access !== 'public') throw new Error('manifest is not publishable as a public scoped package');
if (manifest.repository?.url !== 'git+https://github.com/idoall/dsh-notify.git') throw new Error('repository.url must exactly match the GitHub repository for npm OIDC provenance');
// npm rewrites the READMEs' relative image paths onto this repository's raw URLs
// (https://raw.githubusercontent.com/idoall/dsh-notify/HEAD/<path>), so those files
// must stay committed here; shipping them inside the tarball changes nothing on npm.
for (const readme of ['README.md', 'README.zh.md']) {
  for (const [, src] of (await readFile(readme, 'utf8')).matchAll(/<img[^>]+src="(?!https?:)([^"]+)"/g)) {
    const target = src.replace(/^\.\//, '');
    try {
      await access(target);
    } catch {
      throw new Error(`${readme} references ${src}, which is not in the repository — npm serves README images from this repository's raw URLs`);
    }
  }
}
// The bundle patch mounts by Node-resolvable package name, so it must track the manifest.
const patchName = /^\s*name:\s*(.+)$/m.exec(await readFile('cordis.patch.yml', 'utf8'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
if (patchName !== manifest.name) throw new Error(`cordis.patch.yml mounts ${patchName} but package.json is ${manifest.name}`);
const client = await readFile('dist/client.js', 'utf8');
if (!client.startsWith('window.__ModuleLoader__.load({') || !client.includes(`id: ${JSON.stringify(manifest.name)}`)) throw new Error('client is not a DSH lazy-CJS registration for this package name');
let clientDefinition;
vm.runInNewContext(client, { window: { __ModuleLoader__: { load(definition) { clientDefinition = definition; } } } });
if (clientDefinition?.id !== manifest.name || typeof clientDefinition.factory !== 'function') throw new Error('client registration did not reach ModuleLoader under the manifest package name');
const clientExports = clientDefinition.factory((id) => id === 'react' ? { createElement() {}, Fragment: Symbol('Fragment'), useEffect() {}, useRef(value) { return { current: value }; }, useState(value) { return [value, () => {}]; } } : (() => { throw new Error(`unexpected client external: ${id}`); })());
if (!Array.isArray(clientExports.inject) || typeof clientExports.apply !== 'function') throw new Error('client factory exports are not materializable');
const composition = clientExports.CLIENT_COMPOSITION;
const modules = manifest.dsh?.client?.inject;
if (clientExports.inject.join(',') !== 'slots' || !composition || JSON.stringify(modules) !== JSON.stringify(composition.modules)) throw new Error('manifest modules and client slots composition disagree');
const declaredSeats = new Set(['settings.section', 'shell.overlay']);
if (JSON.stringify([...declaredSeats]) !== JSON.stringify(composition.seats)) throw new Error('client composition does not name the shipped seats');
const registrations = [];
const slots = {
  inject(name, callback) { if (!declaredSeats.has(name)) throw new Error(`undeclared seat: ${name}`); const dispose = callback(); return () => dispose?.(); },
  register(options) { if (!declaredSeats.has(options.name)) throw new Error(`registration missed declared seat: ${options.name}`); registrations.push(options.name); return () => {}; },
};
const mounted = clientExports.apply({ slots });
if (mounted?.status?.service !== 'available' || Object.values(mounted.status.seats).some((state) => state !== 'active') || registrations.length !== 2) throw new Error('materialized client did not activate all official composition seats');
mounted.destroy();
if (clientExports.apply({})?.status?.service !== 'unavailable') throw new Error('materialized client does not degrade without slots service');
const host = await import(`${pathToFileURL(`${process.cwd()}/dist/index.js`).href}?pack-check=${Date.now()}`);
if (host.name !== 'dsh-notify' || typeof host.apply !== 'function' || typeof host.Config !== 'function') throw new Error('Host entry is not importable as a DSH plugin');
console.log(`Package check passed for ${manifest.name}: ${required.length} files, publish preconditions, Host exports, and the lazy-CJS client bundle.`);
