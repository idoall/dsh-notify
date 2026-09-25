import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { mountNotifyClient } from '../src/client.js';

const response = (value) => ({ ok: true, json: async () => value });

/**
 * Render the real settings section with a scripted host.
 *
 * @param {object} options - `update` is what `/update` answers; `failUpdate` makes that request reject.
 * @returns {Promise<object>} the mounted DOM, the recorded requests and a teardown.
 */
async function mountSettings({ update, failUpdate = false } = {}) {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', { url: 'https://dsh.test/' });
  const requests = [];
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: () => 1, clearInterval: () => {},
    fetch: async (url) => {
      const path = String(url);
      requests.push(path);
      if (path.includes('/update')) {
        if (failUpdate) throw new Error('offline');
        return response(update);
      }
      if (path.includes('/sounds')) return response({ builtins: [], custom: [] });
      if (path.includes('/config')) return response({ verbosity: 'normal', toastPosition: 'conversation', toastEnabled: true, notificationStyle: 'strong', stackCollapsed: true, subtaskNotify: false, soundEnabled: true, sound: 'chime', storage: { preferences: 'file' } });
      return response({});
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  const mounted = mountNotifyClient({ slots });
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(components.get('settings.section'), components.get('settings.section:props'))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  return {
    dom, requests, components, mounted, root,
    teardown: async () => {
      await act(async () => { root.unmount(); });
      mounted.destroy();
      for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
      dom.window.close();
    },
  };
}

test('the settings page shows the running version, the three links, and the upgrade command only when one exists', async (t) => {
  const harness = await mountSettings({ update: { current: '0.3.4', latest: '0.4.0', hasUpdate: true, checkedAtMs: 1, error: null } });
  t.after(harness.teardown);
  const { document } = harness.dom.window;

  const row = document.querySelector('.dsh-notify-update');
  assert.ok(row, 'the version row is part of the settings section');
  assert.equal(row.getAttribute('aria-label'), '版本与更新');
  const chip = row.querySelector('.dsh-notify-chip');
  assert.equal(chip.textContent, 'v0.3.4 ➔ v0.4.0', 'the chip names both versions when an update is available');
  assert.equal(chip.getAttribute('data-tone'), 'warn', 'an available update is the only state that draws attention');
  assert.equal(chip.getAttribute('role'), 'status');

  const links = [...row.querySelectorAll('a')].map((node) => [node.textContent, node.getAttribute('href')]);
  assert.deepEqual(links, [
    ['GitHub', 'https://github.com/idoall/dsh-notify'],
    ['更新日志', 'https://github.com/idoall/dsh-notify/blob/main/CHANGELOG.md'],
    ['反馈 Issue', 'https://github.com/idoall/dsh-notify/issues'],
  ], 'the same three links the reference settings page offers, pointing at this repository');
  for (const [, href] of links) assert.ok(href.startsWith('https://github.com/idoall/dsh-notify'), `${href} stays on the plugin repository`);

  const panel = document.querySelector('.dsh-notify-update-panel');
  assert.ok(panel, 'an available update reveals the upgrade command');
  assert.match(panel.textContent, /发现新版本 v0\.4\.0（当前 v0\.3\.4）/);
  assert.equal(panel.querySelector('code').textContent, 'dsh plugin --profile web add @idoall/dsh-notify@0.4.0');
  assert.match(panel.textContent, /不会自动安装，也不会重启 dsh/, 'the panel states the boundary this plugin keeps');
  assert.equal(document.querySelector('.dsh-notify-settings-status').textContent, '通知已连接', 'the notification status is untouched by the version row');

  // jsdom has no clipboard API: the copy must say so rather than claim it copied.
  const copyButton = [...panel.querySelectorAll('button')].find((node) => node.textContent === '复制命令');
  assert.ok(copyButton);
  await act(async () => { copyButton.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  assert.match(panel.textContent, /复制失败，请手动选择文本复制/);
  assert.equal([...panel.querySelectorAll('button')].some((node) => node.textContent === '已复制'), false, 'a copy that never happened is never reported as done');
});

test('the first lookup rides the page load, and the button is what forces a fresh one', async (t) => {
  const harness = await mountSettings({ update: { current: '0.3.4', latest: '0.3.4', hasUpdate: false, checkedAtMs: 1, error: null } });
  t.after(harness.teardown);
  const { document } = harness.dom.window;

  assert.deepEqual(harness.requests.filter((path) => path.includes('/update')), ['/plugins/dsh-notify/update'], 'the mount asks once, without forcing');
  assert.equal(document.querySelector('.dsh-notify-chip').textContent, 'v0.3.4 ✓ 最新');
  assert.equal(document.querySelector('.dsh-notify-chip').getAttribute('data-tone'), 'ok');
  assert.equal(document.querySelector('.dsh-notify-update-panel'), null, 'there is nothing to install, so no command panel');

  const check = [...document.querySelectorAll('.dsh-notify-update button')].find((node) => node.textContent === '检查更新');
  assert.ok(check, 'the row always offers a manual check');
  await act(async () => { check.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(harness.requests.filter((path) => path.includes('/update')), ['/plugins/dsh-notify/update', '/plugins/dsh-notify/update?force=1'], 'the button bypasses the host cache');
});

test('an unreachable host renders as a failed check, never as "newest"', async (t) => {
  const harness = await mountSettings({ failUpdate: true });
  t.after(harness.teardown);
  const { document } = harness.dom.window;
  const chip = document.querySelector('.dsh-notify-chip');
  assert.match(chip.textContent, /检查失败$/);
  assert.equal(chip.getAttribute('data-tone'), 'idle');
  assert.equal(document.querySelector('.dsh-notify-update-panel'), null, 'a failed check never shows an upgrade command');
});
