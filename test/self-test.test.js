import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { mountNotifyClient, NotificationSelfTests } from '../src/client.js';

const response = (value) => ({ ok: true, json: async () => value });
function installDom(t, html = '<!doctype html><main id="root"></main>') {
  const dom = new JSDOM(html, { url: 'https://dsh.test/' });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent, KeyboardEvent: dom.window.KeyboardEvent, addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window), innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return { dom, restore() { for (const [key, descriptor] of Object.entries(saved)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; dom.window.close(); } };
}
const button = (document, text) => [...document.querySelectorAll('button')].find((node) => node.textContent.includes(text));
const click = async (document, text, times = 1) => { const target = button(document, text); assert.ok(target, `missing button ${text}`); await act(async () => { for (let count = 0; count < times; count += 1) target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

 test('the real self-test card mounts without executing anything and offers only channel A', async (t) => {
  const installed = installDom(t); const { dom } = installed; let root; let mounted;
  dom.window.localStorage.setItem('dsh-notify:pushBinding', JSON.stringify({ recipientId: 'recipient-current', recipientBindingNonce: 'binding-current' }));
  let posts = 0; const dimensions = []; let browserRuns = 0; let pullTimer;
  const runtimeSaved = Object.fromEntries(['setInterval', 'clearInterval', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'setInterval', { configurable: true, writable: true, value: (fn) => { pullTimer = fn; return 1; } });
  Object.defineProperty(globalThis, 'clearInterval', { configurable: true, writable: true, value() {} });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async (url) => String(url).includes('/pull?') ? response({ reset: true, epoch: 1, cursor: 0, items: [] }) : String(url).includes('/open-notification-settings') ? response({ ok: true, opened: true, supported: true, adapter: 'darwin-settings' }) : response({}) });
  t.after(async () => { if (root) await act(async () => root.unmount()); mounted?.destroy(); for (const [key, descriptor] of Object.entries(runtimeSaved)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; installed.restore(); });
  const components = new Map(); const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots }); const Bell = components.get('sidebar.footer.action'); const Overlay = components.get('shell.overlay');
  const request = async (dimension) => { posts += 1; dimensions.push(dimension); return { dimension, testRunId: `self-test:${dimension}:dom12345678`, status: dimension === 'a-history' ? 'passed' : 'submitted', reason: dimension === 'a-history' ? 'a-only record stored for pull' : 'submitted; seen unverified' }; };
  const runBrowser = async () => { browserRuns += 1; return { status: 'submitted', reason: '已提交；是否显示由浏览器和系统决定' }; };
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(React.Fragment, null, React.createElement(Bell, { wide: true }), React.createElement(Overlay), React.createElement(NotificationSelfTests, { config: {}, preflight: { persist: { persist: 'enabled' } }, browserPermission: 'granted', secureContext: true, request, runBrowser }))); });
  assert.equal(posts, 0); assert.equal(browserRuns, 0); assert.equal(typeof pullTimer, 'function');
  assert.ok(document.querySelector('[aria-label="A 页面里"]'));
  assert.equal(document.querySelector('[aria-label="B 这台浏览器"]'), null, 'the browser card is gone with the browser channel');
  assert.equal(document.querySelector('[aria-label="C 这台电脑"]'), null, 'the host channel is gone');
  assert.equal(document.querySelector('[aria-label="D 后台推送"]'), null, 'the push channel is gone');
  await click(document, '测试页面浮层'); assert.equal(posts, 0); const toast = document.querySelector('aside[role="status"]'); assert.ok(toast, document.body.innerHTML); assert.match(toast.textContent, /自测：页面浮层/);
  const bell = document.querySelector('button[aria-label^="通知"]'); await act(async () => bell.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const readTab = [...document.querySelectorAll('section[aria-label="通知历史"] [role="tab"]')].find((node) => node.textContent.includes('已读'));
  await act(async () => readTab.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  assert.match(document.querySelector('section[aria-label="通知历史"]').textContent, /自测：页面浮层/, 'the self-test record is not unread, so it lives under 已读');
  await click(document, '添加页内自测记录'); assert.equal(posts, 0); assert.ok(button(document, '确认写入自测历史'));
  await click(document, '确认写入自测历史'); assert.equal(posts, 1); assert.deepEqual(dimensions, ['a-history']); assert.ok(button(document, '清理此自测记录'));
});



