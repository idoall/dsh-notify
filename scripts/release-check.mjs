import assert from 'node:assert/strict';
import { compareVersions } from '../src/update.js';

/** Keep release metadata aligned without mistaking historical rows for current claims. */
export function checkReleaseMetadata({ manifest, lock, readmes, changelog, notes }) {
  const version = manifest.version;
  const releases = Object.keys(manifest.dsh.compatibility.dshReleases);
  const latestHost = releases.sort(compareVersions).at(-1);
  const range = manifest.dsh.engines.dsh;
  assert.equal(lock.version, version, 'lockfile version must match package.json');
  assert.equal(lock.packages[''].version, version, 'lockfile root version must match package.json');
  assert.deepEqual(lock.packages[''].peerDependencies, manifest.peerDependencies, 'lockfile peers must match package.json');
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies, 'lockfile devDependencies must match package.json');
  for (const [name, text] of Object.entries(readmes)) {
    assert.ok(text.includes(`badge/DSH-${latestHost.replaceAll('-', '--')}-`), `${name}: stale DSH badge`);
    const current = text.split('\n').find(line => /^(Current release:|当前发布：)/.test(line));
    assert.ok(current?.includes(`**\`${version}\`**`) && current.includes(`**\`${latestHost}\`**`), `${name}: stale current release`);
    const newestRow = text.split('\n').find(line => /^\| \*\*`\d/.test(line));
    assert.ok(newestRow?.startsWith(`| **\`${version}\`** | \`${latestHost}\``), `${name}: stale compatibility table`);
    assert.ok(text.includes(`git tag v${version}\n`) && text.includes(`git push origin v${version}\n`), `${name}: stale release commands`);
    assert.ok(text.includes(range), `${name}: missing DSH requirement`);
  }
  assert.ok(changelog.startsWith('# Changelog\n'), 'missing changelog heading');
  assert.equal(/^## \[([^\]]+)\]/m.exec(changelog)?.[1], version, 'newest changelog entry must match release');
  for (const language of ['cn', 'en']) {
    assert.ok(notes.includes(`id="${language}-v${version.replaceAll('.', '')}">DSH Notify ${version}</h3>`), `missing ${language} release heading`);
  }
  assert.equal(notes.split(`dsh plugin --profile web add @idoall/dsh-notify@${version}`).length - 1, 2, 'both release upgrade commands must match');
  assert.ok(notes.includes(`\`${latestHost}\``) && notes.includes(`\`${range}\``), 'release notes must name supported DSH version and range');
}
