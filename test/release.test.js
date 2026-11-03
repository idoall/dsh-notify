import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReleaseMetadata } from '../scripts/release-check.mjs';

function fixture() {
  const version = '0.4.12';
  const dsh = '0.2.2-alpha.3';
  const range = '>=0.1.7-rc.1 <0.3.0';
  const manifest = { version, peerDependencies: { '@deepseek-ai/dsh-jobs': range }, devDependencies: {}, dsh: { engines: { dsh: range }, compatibility: { dshReleases: { '0.2.2-alpha.2': 'compatible', [dsh]: 'compatible' } } } };
  const readme = `badge/DSH-0.2.2--alpha.3-\nCurrent release: **\`${version}\`** / **\`${dsh}\`**\n| **\`${version}\`** | \`${dsh}\` |\ngit tag v${version}\ngit push origin v${version}\n${range}`;
  return { manifest, lock: { version, packages: { '': { version, peerDependencies: { ...manifest.peerDependencies }, devDependencies: {} } } }, readmes: { 'README.md': readme, 'README.zh.md': readme.replace('Current release:', '当前发布：') }, changelog: `# Changelog\n\n## [${version}] - 2026-11-03\n`, notes: ['cn', 'en'].map(lang => `<h3 id="${lang}-v0412">DSH Notify ${version}</h3>\n\`${dsh}\` / \`${range}\`\ndsh plugin --profile web add @idoall/dsh-notify@${version}`).join('\n') };
}

test('release gate accepts aligned bilingual documents and lockfile', () => {
  assert.doesNotThrow(() => checkReleaseMetadata(fixture()));
});

test('release gate rejects stale lockfile versions and DSH peer ranges', () => {
  for (const mutate of [f => { f.lock.version = '0.4.11'; }, f => { f.lock.packages[''].version = '0.4.11'; }, f => { f.lock.packages[''].peerDependencies['@deepseek-ai/dsh-jobs'] = '>=0.1.7-rc.1 <0.2.0'; }]) {
    const data = fixture(); mutate(data); assert.throws(() => checkReleaseMetadata(data), /lockfile/);
  }
});

test('release gate checks both README versions, badges, tables and commands', () => {
  for (const name of ['README.md', 'README.zh.md']) {
    for (const old of ['badge/DSH-0.2.2--alpha.3-', '**`0.4.12`**', '| **`0.4.12`**', 'git tag v0.4.12', 'git push origin v0.4.12']) {
      const data = fixture(); data.readmes[name] = data.readmes[name].replace(old, 'stale');
      assert.throws(() => checkReleaseMetadata(data), new RegExp(name.replaceAll('.', '\\.')));
    }
  }
});

test('release gate rejects mismatched changelog and bilingual release notes', () => {
  const changelog = fixture(); changelog.changelog = changelog.changelog.replace('[0.4.12]', '[0.4.11]');
  assert.throws(() => checkReleaseMetadata(changelog), /changelog/);
  for (const old of ['cn-v0412', 'en-v0412', '@idoall/dsh-notify@0.4.12']) {
    const data = fixture(); data.notes = data.notes.replace(old, 'stale'); assert.throws(() => checkReleaseMetadata(data), /release/);
  }
});
