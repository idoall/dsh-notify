import { access, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const required = ['package.json', 'cordis.patch.yml', 'dist/index.js', 'dist/core.js', 'dist/buffer.js', 'dist/sound-choices.js', 'dist/sounds.js', 'dist/client.js'];
for (const file of required) await access(file);
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.main !== './dist/index.js' || manifest.exports?.['./client'] !== './dist/client.js') throw new Error('package exports do not expose Host and client builds');
if (manifest.dsh?.client?.platform !== 'web' || manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('missing dsh client/bundle declarations');
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
